---
title: "Service Discovery"
order: 16
part: "Behavioral"
description: "Reach a workload by a name that outlives any Pod on OpenShift: ClusterIP, NodePort, and LoadBalancer Services, CoreDNS, and external access through a Route (and the Ingress that becomes one)."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what a `Service` provides: a stable name and virtual address in front of a changing set of Pods
- Compare `ClusterIP`, `NodePort`, and `LoadBalancer` and know which audience each reaches
- Trace how CoreDNS resolves a Service name to its virtual IP without the caller learning a Pod IP
- Expose a workload to the host the OpenShift way with a Route, and explain how an Ingress becomes one

## Why this matters

Every chapter so far used a Service without naming what it is. `shipping-service` and the rest were reached by name, never by Pod IP, and that worked because a Service sits between caller and Pods. Stateless and Stateful Service both depend on this layer: a stateless Deployment can replace a Pod with a brand-new IP *because* nothing was calling that IP directly. Service Discovery is what makes every other pattern's "any replica can serve any request" hold up, by giving the cluster a name that survives Pods coming and going.

On OpenShift the internal half (ClusterIP, CoreDNS, EndpointSlices) is identical to plain Kubernetes, but the external half diverges: the native answer is a **Route**, not a `LoadBalancer` (which stays pending on CRC, with no cloud underneath) and not a raw Ingress (which works, but becomes a Route anyway). The example exposes one `shipping-service` every way to make the contrast concrete.

## ClusterIP and CoreDNS: the default, and the one most workloads need

```yaml
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: shipping-service
  ports:
    - port: 80
      targetPort: 8080
```

A `ClusterIP` Service gets a stable virtual IP, reachable only inside the cluster, and CoreDNS gives it an A record at `<service>.<namespace>.svc.cluster.local`. Resolved from inside a Pod, the name returns exactly that virtual IP:

```console
$ oc exec $POD -n patterns -- getent hosts shipping-service.patterns.svc.cluster.local
10.217.4.237   shipping-service.patterns.svc.cluster.local
$ oc get svc shipping-service -n patterns -o jsonpath='{.spec.clusterIP}'
10.217.4.237
```

The caller never learns a Pod IP; the name resolves fresh on every call, so a Pod restart (new IP, same name) never requires touching the caller's configuration. Within the namespace the short name is enough (CoreDNS's search path tries the current namespace first); across namespaces you need the fuller form. This is the type every Service in this appendix defaulted to, and the right default for in-cluster traffic.

The §17 data mesh is this pattern at scale: `graphql-gateway` reaches its backends with `ORDER_REST_URL=http://order-service` and `INVENTORY_GRPC_ADDR=inventory-service:50051`, both plain Service names, neither a Pod IP, neither needing to change for the life of the deployment. Every service-to-service call in that system, REST, gRPC, and the Kafka bootstrap address alike, is a Service name CoreDNS resolves fresh on each use. The whole mesh holds together on exactly the indirection this chapter names, which is why it never had to be described until now: it was already at work in every earlier example.

## NodePort and LoadBalancer

```console
$ oc get svc -n patterns shipping-nodeport shipping-lb
shipping-nodeport   NodePort       80:30180/TCP
shipping-lb         LoadBalancer   80:30231/TCP   # EXTERNAL-IP stays <pending>
```

A `NodePort` opens the same port on every node's IP, routing to a matching Pod wherever it runs. It's a building block (what a cloud `LoadBalancer` routes into) more than a type end users call directly. `LoadBalancer` asks the cloud provider to provision an external load balancer and populate `EXTERNAL-IP`; CRC has no cloud provider, so that field stays `<pending>` indefinitely (it still allocated a node port, `30231`, for the backing path, but nothing external points at it). Minikube papers over this with `minikube tunnel`; CRC has no equivalent, which is the practical reason neither type is how you expose a workload on OpenShift.

![Services of three types in front of shipping-service, with a Route exposing it to the host and an Ingress that becomes a second Route]({{ "/assets/diagrams/appendix-16-service-discovery.svg" | relative_url }})
*A caller reaches a Service name or a Route host, never a Pod IP: CoreDNS and the router make the substitution invisible.*

## Route: the OpenShift external answer

The native way to expose a Service to the host is a Route: a stable hostname under `apps-crc.testing` with TLS terminated at the edge, served by the OpenShift ingress router.

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: shipping-route
spec:
  to:
    kind: Service
    name: shipping-service
  port:
    targetPort: 8080
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

```console
$ oc get route shipping-route -n patterns -o jsonpath='{.spec.host}'
shipping-route-patterns.apps-crc.testing
$ curl -sk -o /dev/null -w '%{http_code}' https://shipping-route-patterns.apps-crc.testing/health
200
```

This is what the Routes chapter (§6) covered, here placed in the discovery context: where a cloud cluster reaches for `LoadBalancer`, OpenShift reaches for a Route, and CRC serves it locally with no tunnel or extra infrastructure.

## Ingress becomes a Route

Ingress works on OpenShift, but not as a separate dataplane: the same ingress router that serves Routes implements it, and OpenShift auto-creates a Route for each Ingress rule. Apply an Ingress and a matching Route appears beside the hand-written one:

```console
$ oc get route -n patterns
NAME                     HOST
shipping-ingress-rsjtf   shipping-ingress.apps-crc.testing
shipping-route           shipping-route-patterns.apps-crc.testing
```

`shipping-ingress-rsjtf` is the Route OpenShift generated from the Ingress. The practical consequence: on OpenShift, Ingress and Route aren't competing choices with different plumbing, they're two front-ends to one router, and a Route is the lower-level object even when you write an Ingress. For portability across clusters an Ingress is fine; for anything OpenShift-specific (edge/re-encrypt/passthrough TLS modes, per-Route timeouts) the Route exposes controls an Ingress doesn't.

## EndpointSlice: what a selector produces

A Service's `selector` doesn't route by itself: it's the input to an `EndpointSlice` (the scalable successor to the old `Endpoints` object) listing the IP:port of every ready matching Pod. The router and kube-proxy watch these, not the selector:

```console
$ oc get endpointslices -n patterns -l kubernetes.io/service-name=shipping-service \
    -o jsonpath='{range .items[*]}{.endpoints[*].addresses}{"\n"}{end}'
["10.217.0.156"] ["10.217.0.157"]
```

Two ready endpoints, the two `shipping-service` replicas. Checking this is the fastest diagnostic the first time a Service "isn't working" despite healthy Pods: an empty EndpointSlice on a correct-looking Service almost always means the selector's labels don't match the Pod template's. A Service with no selector at all is also valid, producing no automatic EndpointSlice, which is how you point a Service at an endpoint managed manually, a database running outside the cluster, for instance.

## ExternalName: a different indirection

`type: ExternalName` returns a `CNAME` to an arbitrary external DNS name, with no ClusterIP, selector, or EndpointSlice:

```yaml
spec:
  type: ExternalName
  externalName: reporting.example.com
```

It gives an external dependency a cluster-internal name consistent with how in-cluster dependencies are addressed, so an application needn't know whether `payments-provider` is a Pod here or a service elsewhere. None of this appendix's workloads need it, but it rounds out the Service types to recognize by name and behavior.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure networking (Services, DNS, and external access with Routes)
> **Competency:** Expose applications with the right Service type and a Route, and resolve them by DNS
> **Drill:** `oc get svc -n patterns shipping-service shipping-nodeport shipping-lb -o custom-columns=NAME:.metadata.name,TYPE:.spec.type`

> **🤖 Explore with your agent**
>
> "Add a second Route to inventory-service's /healthz endpoint with re-encrypt TLS instead of edge, apply it, and show me the curl command that reaches it, then explain what re-encrypt changes versus edge."

## Cleanup

```bash
oc delete -f service-discovery/06-ingress.yaml -f service-discovery/05-route.yaml \
  -f service-discovery/04-loadbalancer.yaml -f service-discovery/03-nodeport.yaml \
  -f service-discovery/02-clusterip.yaml -f service-discovery/01-deployment.yaml -n patterns
oc delete -f service-discovery/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/service-discovery/

The runnable example fronts `shipping-service` with a `ClusterIP` (resolved by CoreDNS to its virtual IP), a `NodePort`, and a `LoadBalancer` (whose `EXTERNAL-IP` stays `<pending>` on CRC), then exposes it to the host with a Route (`curl` returns `200`) and shows an Ingress auto-creating a second Route. It reads the Service's `EndpointSlice` to confirm its two ready endpoints. Full walkthrough in `examples/appendix-patterns/service-discovery/README.md`.
