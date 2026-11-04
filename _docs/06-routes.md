---
title: "Routes and edge TLS"
order: 6
description: "Expose a Service to your host with an OpenShift Route and TLS terminated at the edge, instead of a NodePort."
---

On plain Kubernetes you reach a Service from outside the cluster with a NodePort or
an Ingress. OpenShift has a built-in router and a first-class object for this: the
**Route**. A Route gives your Service a stable hostname under `apps-crc.testing`
and, with one setting, terminates TLS at the edge. This chapter exposes the web
app you deployed earlier with a Route and verifies it over HTTPS the correct way.

## Why Routes instead of NodePorts

A NodePort opens a numbered port on the node and you reach the Service at
`node-ip:port`. It works, but the port is arbitrary (drawn from a high range like
30000-32767), the URL is unfriendly, and every NodePort is one more hole punched in the
node's firewall. On OpenShift it is also the wrong grain: you would be exposing raw ports on
the cluster node rather than naming an HTTP service, with no hostname, no TLS, and no path
routing. The Route exists precisely so you do not do that for web traffic.
OpenShift's router (an ingress controller that ships with the cluster) watches
Route objects and serves each one at a real hostname. On CRC every Route lands
under `*.apps-crc.testing`, which resolves to the cluster out of the box.

Routes are an OpenShift type, so `kubectl` has no verb to create one. This is a
chapter where `oc` is the primary tool, not a shortcut.

### How the router serves a Route

The router is a workload like any other, running in the `openshift-ingress` namespace,
built on HAProxy. It watches the Route objects across the cluster and rewrites its proxy
configuration whenever one changes, so a Route you create is served within seconds, with no
restart. Each Route carries a `host`, and the router keys its routing table on that
hostname: a request arriving for `web-route-demo.apps-crc.testing` is matched to the Route
with that host and forwarded to the Service behind it. The wildcard DNS that `crc setup`
installed is what makes every such hostname resolve to the cluster without you adding
entries for each one. On a production cluster the same router serves a public wildcard
domain; on CRC it serves `apps-crc.testing`, but the object and the mechanism are
identical, which is the point of learning it here.

## Create a Service, then a Route

Start from a running Deployment and give it a Service so the Route has
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

There are two commands here, and the difference matters. `oc expose service web`
generates a plain Route from an existing Service, inferring the target port, which is the
quickest way to get an HTTP Route. `oc create route edge` creates a Route with a specific
termination mode and options you set, which is what the next step uses to add TLS. When a
Service exposes more than one port, the Route needs `--port` to say which named port it
targets, because a Route forwards to exactly one. For a single-port Service like this one the
port is unambiguous, so neither command needs to be told.

## The three ways a Route handles TLS

A Route can terminate TLS in three ways, and choosing one is the main design decision when
you expose a service securely:

- **Edge**: the router terminates TLS and forwards plain HTTP to the Pod over the internal
  network. The Pod carries no certificate. This is the simplest option and the one this
  chapter uses, suited to any service that does not itself need to see encrypted traffic.
- **Passthrough**: the router does not decrypt at all; it forwards the encrypted connection
  straight to the Pod, which must present its own certificate. Use this when the application
  must terminate TLS itself, for example to satisfy a compliance rule that traffic is
  encrypted all the way to the process.
- **Reencrypt**: the router terminates the outside TLS connection, then opens a fresh TLS
  connection to the Pod using a certificate the router trusts. Use this when you want a
  single public certificate at the edge but still require encryption on the internal hop.

Edge is the right default, because it keeps certificate management in one place, the router,
and leaves the application unchanged. Reach for passthrough or reencrypt only when
encryption to the Pod is a stated requirement, since both move certificate handling into the
workload. The cost of that move is real: the application now owns a certificate, its renewal,
and its private key, which is work the router otherwise does for every Route at once. Picking
edge unless a requirement forces otherwise keeps that cost off your workloads.

## Terminate TLS at the edge

Edge termination means the router handles TLS and forwards plain HTTP to your Pod
on the cluster network. You do not manage a certificate in the Pod; the router
uses the cluster's ingress certificate. When a Route does not supply its own certificate,
the router falls back to the cluster's default ingress certificate, which is the wildcard
certificate for `apps-crc.testing` here, so your Route is served over TLS without you
providing anything. You can supply a per-Route certificate for a custom hostname, but for a
Route under the cluster's own domain the default is what you want. Re-create the Route with
edge termination, and redirect HTTP to HTTPS:

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

The `insecureEdgeTerminationPolicy` field decides what happens to plain HTTP on an
HTTPS Route, and it has three values worth knowing. `Redirect`, used above, answers HTTP
with a 301/302 to the HTTPS URL, which is what you want for a browser-facing service.
`None` refuses plain HTTP outright, for a service that must never be reached unencrypted.
`Allow` serves both, which is rarely the right choice because it leaves an unencrypted path
open. `Redirect` is the sensible default for anything a person will open in a browser.

### Custom hostnames and path-based routing

A Route does not have to take the generated hostname. Set `spec.host` to any name that
resolves to the cluster, and the router serves the Route there instead; on a real cluster
this is how a service gets a friendly public name. A Route can also match on a path, so
several Routes can share one hostname and send different prefixes to different Services:

```yaml
spec:
  host: web-route-demo.apps-crc.testing
  path: /api            # only requests under /api match this Route
```

Path-based Routes are how you put several backends behind one hostname, for example an API
under `/api` and a UI at `/`. The router matches the most specific path first, so the order
you create them in does not matter.

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

The certificate the router presents is signed by the cluster's own ingress CA, which no
public trust store knows about, which is why a plain `curl` rejects it. Trusting that CA, as
the `--cacert` command does, is the correct way to make the handshake succeed: it proves the
connection is encrypted and served by this cluster, rather than silently accepting whatever
certificate arrives. On a production cluster you would replace the ingress certificate with
one from a public or corporate CA, and then no `--cacert` would be needed, because clients
already trust the signer. The CRC default is self-signed only because it is a local cluster
with no public name, so the mechanism to trust is the same one you would configure in
production, just with a different signer.

## Routes and Ingress

OpenShift also understands the standard Kubernetes `Ingress` object, so a manifest written
for a generic cluster still works here. Under the hood, the ingress controller creates a
Route for each Ingress rule and serves it through the same router, so an Ingress on OpenShift
is a Route with an extra translation step. The Route is the native object, with direct
control over the termination mode and the OpenShift-specific options, so this guide uses
Routes directly. Knowing that an Ingress becomes a Route explains why a chart written for
plain Kubernetes deploys without change: its Ingress is quietly turned into the same object
you would have written by hand.

> **⌨️ The `oc` way**
>
> There is no `kubectl` equivalent for any of this: Route is an OpenShift API type
> and `oc expose` / `oc create route` are the way to make one. On plain Kubernetes
> the nearest equivalent is an Ingress plus an ingress controller you install and
> configure yourself; OpenShift ships the router and the Route type ready to use.

## Tuning and troubleshooting a Route

The router reads a set of annotations on the Route for behavior that does not fit in the
spec. Two come up often: `haproxy.router.openshift.io/timeout` raises the proxy timeout for a
slow backend, and `haproxy.router.openshift.io/balance` changes the load-balancing algorithm
across the Service's Pods. You rarely need them for a simple web app, but they are the lever
when a Route works and the backend is just slow.

When a Route does not serve what you expect, two status codes point straight at the cause. A
`503` from the router means the Route resolved but found no healthy endpoints behind its
Service, so the problem is the workload or the Service selector, not the Route. A connection
that never completes the TLS handshake, as opposed to returning a status code, means the
certificate trust is the issue, which is the `--cacert` matter below. Checking the Route
itself is quick:

```bash
oc describe route web      # the host, target Service, termination, and any router errors
oc get route web -o yaml   # the full object, including the resolved host
```

The router reports back on each Route through a status condition named `Admitted`. When the
router has accepted a Route and is serving it, that condition reads `True`; when it refuses
one, for example because the hostname clashes with an existing Route, the condition carries
the reason:

```bash
oc get route web -o jsonpath='{.status.ingress[0].conditions[0].type}={.status.ingress[0].conditions[0].status}{"\n"}'
# Admitted=True
```

Checking `Admitted` separates a Route the router has taken up from one it has rejected, which
is the first thing to confirm when a brand-new Route does not answer at all.

## Reaching internal Services without a Route

Not everything should be exposed. For a Service that only other Pods talk to,
reach it from inside the cluster instead of giving it a Route:

```bash
oc exec deploy/web -- curl -s http://web:8080 | head -c 100
```

That keeps internal traffic internal and reserves Routes for what faces the host.

The habit to build is least exposure: give a Service a Route only when something outside the
cluster needs to reach it, and leave everything else on its internal ClusterIP name. A
database, a cache, or a backend service that only other Pods call has no business with a
Route, because a Route is a public door. On a multi-tenant cluster you can go further and add
a `NetworkPolicy` that restricts which Pods may even open an internal connection to a Service,
so that "internal" means a specific set of callers rather than the whole cluster. CRC is
single-user, so you will not need NetworkPolicies here, but the principle, expose the
minimum, is the same one that keeps a real cluster's attack surface small.

### Routers on a production cluster

On CRC there is one router serving `apps-crc.testing`, and that is all you deal with. A
production cluster can run several `IngressController` objects, each serving a different
domain or a different slice of Routes, a pattern called router sharding, used to separate
internal from external traffic or to spread load. The Route object you write is identical in
every case; which router serves it is decided by labels and the controller's configuration.
Knowing the extra layer exists means a Route that is served in one place and not another is a
sharding question, not a broken Route.

## Build, run, observe

```bash
oc new-project route-demo 2>/dev/null || oc project route-demo
oc new-app --image=registry.access.redhat.com/ubi9/httpd-24:latest --name=web
oc rollout status deployment/web
oc create route edge web --service=web --insecure-policy=Redirect
oc get configmap default-ingress-cert -n openshift-config-managed \
  -o jsonpath='{.data.ca-bundle\.crt}' > /tmp/crc-ca.crt
HOST=$(oc get route web -o jsonpath='{.spec.host}')
curl -sS --cacert /tmp/crc-ca.crt "https://$HOST" -o /dev/null -w '%{http_code}\n'   # 403: empty docroot, handshake trusted
curl -sS "http://$HOST" -o /dev/null -w '%{http_code}\n'                              # 302 redirect to https
oc delete project route-demo
```

An HTTPS response with the CA trusted (here `403`, from the same empty `httpd`
docroot) and a redirect from HTTP confirm the Route and edge TLS are working.
The signal is the trusted-CA handshake succeeding, not the status code: run the
same `curl` without `--cacert` and it fails with a self-signed-certificate
error instead.

## Where this fits

Your Service is reachable from the host over HTTPS with a real hostname. The next chapter
moves from single objects to packaging: deploying with Helm on OpenShift, and
OpenShift's own Helm integration.
