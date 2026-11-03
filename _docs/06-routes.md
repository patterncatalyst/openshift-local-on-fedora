---
title: "Routes and edge TLS"
order: 6
description: "Expose a Service to your host with an OpenShift Route and TLS terminated at the edge, instead of a NodePort."
---

On plain Kubernetes you reach a Service from outside the cluster with a NodePort or
an Ingress. OpenShift has a built-in router and a first-class object for this: the
**Route**. A Route gives your Service a stable hostname under `apps-crc.testing`
and, with one setting, terminates TLS at the edge. This chapter exposes the web
app from Chapter 5 with a Route and verifies it over HTTPS the correct way.

## Why Routes instead of NodePorts

A NodePort opens a numbered port on the node and you reach the Service at
`node-ip:port`. It works, but the port is arbitrary and the URL is unfriendly.
OpenShift's router (an ingress controller that ships with the cluster) watches
Route objects and serves each one at a real hostname. On CRC every Route lands
under `*.apps-crc.testing`, which resolves to the cluster out of the box.

Routes are an OpenShift type, so `kubectl` has no verb to create one. This is a
chapter where `oc` is the primary tool, not a shortcut.

## Create a Service, then a Route

Start from a running Deployment (Chapter 5) and give it a Service so the Route has
something to target:

```bash
oc new-project route-demo
oc new-app --image=registry.access.redhat.com/ubi9/httpd-24:latest --name=web
# oc new-app already created a Service named "web" on port 8080.
oc get service web
```

Expose the Service as a Route:

```bash
oc expose service web
oc get route web -o jsonpath='{.spec.host}{"\n"}'
# web-route-demo.apps-crc.testing
```

`oc expose service` reads the Service's port and creates a Route that targets it.
That Route is plain HTTP so far.

## Terminate TLS at the edge

Edge termination means the router handles TLS and forwards plain HTTP to your Pod
on the cluster network. You do not manage a certificate in the Pod; the router
uses the cluster's ingress certificate. Re-create the Route with edge termination,
and redirect HTTP to HTTPS:

```bash
oc create route edge web --service=web \
  --insecure-policy=Redirect           # delete the plain route first if it exists
oc get route web -o jsonpath='{.spec.tls.termination} {.spec.host}{"\n"}'
# edge web-route-demo.apps-crc.testing
```

Or declare it as YAML:

```yaml
# web-route.yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: web
spec:
  to:
    kind: Service
    name: web
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

```bash
oc apply -f web-route.yaml
```

## Verify over HTTPS the correct way

The CRC ingress certificate is signed by the cluster's own CA, not a public one,
so a plain `curl` would reject it. The right fix is to trust that CA, not to skip
verification. Fetch the ingress CA and pass it to `curl`:

```bash
# Export the cluster's ingress CA bundle.
oc get configmap default-ingress-cert -n openshift-config-managed \
  -o jsonpath='{.data.ca-bundle\.crt}' > /tmp/crc-ca.crt

HOST=$(oc get route web -o jsonpath='{.spec.host}')
curl --cacert /tmp/crc-ca.crt "https://$HOST" | head -c 200
```

Use `--cacert`, never `--insecure`. Skipping verification hides exactly the kind
of certificate problem you would want to catch, and it teaches a habit you do not
want in any other environment.

> **⌨️ The `oc` way**
>
> There is no `kubectl` equivalent for any of this: Route is an OpenShift API type
> and `oc expose` / `oc create route` are the way to make one. On plain Kubernetes
> the nearest equivalent is an Ingress plus an ingress controller you install and
> configure yourself; OpenShift ships the router and the Route type ready to use.

## Reaching internal Services without a Route

Not everything should be exposed. For a Service that only other Pods talk to,
reach it from inside the cluster instead of giving it a Route:

```bash
oc exec deploy/web -- curl -s http://web:8080 | head -c 100
```

That keeps internal traffic internal and reserves Routes for what faces the host.

## Build, run, observe

```bash
oc new-project route-demo 2>/dev/null || oc project route-demo
oc new-app --image=registry.access.redhat.com/ubi9/httpd-24:latest --name=web
oc rollout status deployment/web
oc create route edge web --service=web --insecure-policy=Redirect
oc get configmap default-ingress-cert -n openshift-config-managed \
  -o jsonpath='{.data.ca-bundle\.crt}' > /tmp/crc-ca.crt
HOST=$(oc get route web -o jsonpath='{.spec.host}')
curl -sS --cacert /tmp/crc-ca.crt "https://$HOST" -o /dev/null -w '%{http_code}\n'   # 200
curl -sS "http://$HOST" -o /dev/null -w '%{http_code}\n'                              # 302/308 redirect to https
oc delete project route-demo
```

A `200` over HTTPS with the CA trusted, and a redirect from HTTP, confirms the
Route and edge TLS are working.

## Where this fits

Your Service is reachable from the host over HTTPS with a real hostname. Chapter 7
moves from single objects to packaging: deploying with Helm on OpenShift, and
OpenShift's own Helm integration.
