---
title: "OpenShift Service Mesh"
order: 8
description: "Install OpenShift Service Mesh 3 and Kiali as Operators, bring up the Istio control plane, enable sidecar injection, enforce STRICT mTLS, and split traffic with a canary."
---

## Learning objectives

By the end of this chapter you can:

- Install OpenShift Service Mesh 3 and Kiali from OperatorHub
- Bring up the Istio control plane with the `Istio` custom resource
- Enroll a namespace for sidecar injection
- Enforce STRICT mutual TLS between services
- Split traffic to a second version with a canary

## Why this matters

OpenShift Service Mesh is Red Hat's distribution of Istio. Version 3 is driven by
the Sail operator, which manages Istio through a small `Istio` custom resource
instead of the older multi-CR control plane. This chapter installs the mesh and
Kiali from OperatorHub, brings up the control plane, enrolls a namespace, turns on
mutual TLS, and shifts a slice of traffic to a second version with a canary. It's
the first thing in this guide delivered as an Operator, which sets up the Operators
chapter next.

{% include excalidraw.html
   file="service-mesh"
   alt="In the mesh-demo namespace, labelled istio.io/rev=default, two Pods each run an app plus an Envoy sidecar and talk to each other over STRICT mutual TLS. The istiod control plane sends configuration and certificates to the proxies, and Kiali is the mesh console."
   caption="Figure 8.1: The istiod control plane configures the Envoy sidecars; the sidecars carry the traffic and enforce STRICT mutual TLS between Pods." %}

## What the mesh gives you

A service mesh puts a sidecar proxy next to each Pod and routes all service-to-
service traffic through those proxies. That buys you mutual TLS between services
without touching application code, fine-grained traffic control (canaries, retries,
timeouts), and uniform telemetry. On OpenShift the proxies are Envoy, the control
plane is Istio, and Kiali is the console that visualizes the mesh.

### What the sidecar actually does

The sidecar is an Envoy proxy, and once it's in a Pod, every connection the application
makes or receives passes through it first. The application still thinks it's talking plain
HTTP to another service; the proxy is what turns that into a mutually authenticated,
encrypted call, applies whatever routing rules are in force, and records the metrics. Because
the proxy sits in the data path for all traffic, the mesh can add encryption, retries,
timeouts, and telemetry without a line of application code, which is the whole reason a mesh
exists. The control plane, Istio's `istiod`, never handles your traffic itself; it configures
the proxies and leaves them to do the work, so the data path stays fast and the control plane
can restart without dropping connections. This split, a control plane that configures and a
data plane of proxies that carries traffic, is the shape to hold in mind for the rest of the
chapter: every object you apply is really an instruction to `istiod` about how to configure the
proxies, which then enforce it on each connection.

### Revisioned injection, not the old annotation

Service Mesh 3 enrolls a namespace by a *revision label*, `istio.io/rev`, rather than the
`istio-injection=enabled` annotation older Istio used. The label names a specific control-plane
revision, which is what makes a safe upgrade possible: you can run two control-plane revisions
side by side, move namespaces to the new one a few at a time by changing their label, and roll
back by changing it again. On this single control plane the revision is just `default`, but the
mechanism is the reason the label replaced the annotation, and it's worth starting with the
model that scales rather than the one that doesn't.

## Install the operators

The mesh needs two operators from OperatorHub: the Sail operator (package
`servicemeshoperator3`) for Istio, and `kiali-ossm` for the dashboard. Both install
with a pinned version and manual install-plan approval, the pattern the Operators
chapter covers in full. The `install_operator` helper in `openshift/lib.sh` applies
each pinned Subscription and approves only the InstallPlan naming its version:

```bash
source openshift/lib.sh
require_crc
install_operator openshift/platform/subscriptions/servicemesh.yaml \
  openshift-operators servicemeshoperator3 servicemeshoperator3.v3.4.4
install_operator openshift/platform/subscriptions/kiali.yaml \
  openshift-operators kiali-ossm kiali-operator.v2.33.1
```

Re-check the current CSV in each channel before you pin, because the catalog moves:

```bash
oc get packagemanifest servicemeshoperator3 -n openshift-marketplace \
  -o jsonpath='{range .status.channels[*]}{.name} {.currentCSV}{"\n"}{end}'
```

## Bring up the control plane

Sail reconciles the mesh from two custom resources. `IstioCNI` installs the CNI
plugin that wires each Pod's traffic into its proxy; `Istio` is the control plane
itself, pinned to an exact Istio release the operator offers, never a floating
`vX.Y-latest`:

```yaml
# openshift/platform/mesh/istio.yaml (abridged)
apiVersion: sailoperator.io/v1
kind: IstioCNI
metadata:
  name: default
spec:
  version: v1.30.5
  namespace: istio-cni
---
apiVersion: sailoperator.io/v1
kind: Istio
metadata:
  name: default
spec:
  version: v1.30.5
  namespace: istio-system
  updateStrategy:
    type: InPlace
```

```bash
oc apply -f openshift/platform/mesh/istio.yaml
oc wait istiocni/default --for=condition=Ready --timeout=300s
oc wait istio/default   --for=condition=Ready --timeout=600s
```

The two resources split a job that older Istio did with an init container. Getting a Pod's
traffic to flow through its sidecar requires rewriting the Pod's network rules, and doing that
per Pod needs elevated privileges that sit poorly with `restricted-v2`. `IstioCNI` moves the
rewrite into a CNI plugin that runs once on the node, so individual Pods no longer need the
privileged init container, which is a cleaner fit for OpenShift's security model. That's why
the control plane here's two custom resources rather than one: `IstioCNI` owns the per-node
networking, and `Istio` owns the control plane the proxies talk to.

The `Istio` CR named `default` serves the revision named `default`: a Pod joins the
mesh when it carries the label `istio.io/rev=default`. List the exact versions your
installed operator accepts before you pin one:

```bash
oc get crd istios.sailoperator.io -o json \
  | jq -r '.. | .version? | .enum? // empty | .[]' | sort -uV
```

## Enroll a namespace and inject sidecars

A Pod joins the mesh when its namespace (or the Pod) carries the `istio.io/rev`
label naming the control-plane revision, not the older `istio-injection=enabled`
annotation. Label the namespace first, then deploy: anything created afterward gets
its proxy injected automatically.

```bash
oc new-project mesh-demo
oc label namespace mesh-demo istio.io/rev=default --overwrite
oc apply -f examples/05-deploying/httpd-deployment.yaml   # the web Deployment + Service
oc rollout status deployment/web -n mesh-demo
oc get pods -n mesh-demo                                   # each Pod shows 2/2
```

The `2/2` is the tell. Service Mesh 3 injects the Envoy proxy as a *native sidecar*,
an init container named `istio-proxy` that starts before your app and keeps running,
so it counts toward the Pod's ready total without showing up in the normal container
list. For a workload that was already running when you labeled the namespace, re-roll
it so the proxy is injected:

```bash
oc rollout restart deployment/web -n mesh-demo
```

> **⌨️ The `oc` way**
>
> There's no `kubectl` shortcut here; the mesh is all custom resources. What the
> OpenShift console adds is **Kiali**, linked from the Networking menu: it draws the
> mesh topology and shows the per-workload mTLS status. The live traffic-rate graph
> needs a metrics source, which the observability chapter wires in by pointing Kiali
> at Prometheus.

## Enforce mutual TLS

Turn on STRICT mTLS for the namespace so every in-mesh call is mutually
authenticated and encrypted:

```yaml
# openshift/platform/mesh/strict-mtls.yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: mesh-demo
spec:
  mtls:
    mode: STRICT
```

```bash
oc apply -f openshift/platform/mesh/strict-mtls.yaml
oc get peerauthentication -n mesh-demo    # default = STRICT
```

One wrinkle on OpenShift: the cluster router delivers plaintext to a Route-facing
Pod, so a service that sits behind a Route needs a PERMISSIVE exception for that
port, or the router's plaintext connection is refused. Keep the namespace STRICT
and relax only the Route-facing workload. The Helm chart's `mesh.enabled` path adds
that exception for you.

### How mTLS works under the hood

The reason this needs no application changes is that `istiod` gives every workload an identity
and keeps its certificates fresh. Each sidecar receives a short-lived certificate tied to the
workload's ServiceAccount, encoded as a SPIFFE identity, and `istiod` rotates it automatically
long before it expires. When one sidecar connects to another, the two present these
certificates and verify each other, so both ends of every in-mesh call are authenticated, not
just encrypted. STRICT mode says a sidecar must refuse any connection that's not mutual TLS,
which is why a plaintext caller from outside the mesh is rejected. PERMISSIVE, the exception for
a Route-facing port, tells the sidecar to accept both, so the router's plaintext hop still
works while in-mesh traffic stays encrypted. The identities come from the ServiceAccount, which
is why workloads that run as distinct accounts can be told apart in an authorization policy.

## Split traffic with a canary

Istio splits traffic with two objects: a `DestinationRule` that names subsets of a
Service by Pod label, and a `VirtualService` that weights those subsets. Run two
versions of the workload, each carrying its own `version` label, then define the
subsets and the split:

```yaml
# Name the subsets by the version label.
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: web
spec:
  host: web
  subsets:
    - name: v1
      labels: { version: v1 }
    - name: v2
      labels: { version: v2 }
---
# Send 90% of traffic to v1 and 10% to v2.
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: web
spec:
  hosts: ["web"]
  http:
    - route:
        - destination: { host: web, subset: v1 }
          weight: 90
        - destination: { host: web, subset: v2 }
          weight: 10
```

The subsets resolve only if the Pods carry a `version` label, so the two Deployments
set `version: v1` and `version: v2` on their templates. With both running, the
VirtualService sends roughly nine in ten requests to v1. You read the resulting split
in Kiali's graph once the observability chapter connects Kiali to a metrics source.

## More than a canary: retries, timeouts, and outlier ejection

A weighted split is one use of the `VirtualService` and `DestinationRule` pair; the same two
objects carry the rest of the mesh's traffic control. A `VirtualService` can set a per-route
timeout and a retry policy, so a slow or flaky dependency is retried or cut off at the proxy
rather than in every caller's code:

```yaml
  http:
    - route: [{ destination: { host: web } }]
      timeout: 2s
      retries: { attempts: 3, perTryTimeout: 1s }
```

A `DestinationRule` carries the connection-level policy: connection-pool limits that cap how
much load a caller can pile onto a service, and *outlier detection*, which ejects a Pod from
the load-balancing pool after it returns a run of errors and brings it back once it recovers.
That ejection is Istio's form of circuit breaking, and like everything else here it's applied
by the proxies, so no application changes to add it. These are the controls that make a mesh
worth running beyond mTLS: the failure handling that would otherwise be copied into every
service lives in one place, described declaratively.

## Gateways and the OpenShift router

Traffic from outside the cluster needs a way in, and here the mesh and OpenShift overlap. A
mesh *Gateway* plus a `VirtualService` is Istio's own ingress, letting mesh rules apply to
north-south traffic the same way they apply inside. OpenShift already has the router and the
Route, covered earlier, which is the simplest way to expose a mesh service to your host: an
edge Route to the service, with a PERMISSIVE exception on the Route-facing port so the router's
plaintext hop is accepted. Use the Route for straightforward exposure, and reach for an Istio
Gateway only when you need mesh traffic policy applied at the edge itself. Mixing both without
a reason is the usual way to get confusing double-proxying, so pick the one the task calls for.

## Observability and Kiali

Because every call passes through a proxy, the mesh produces uniform telemetry on its own:
request counts, error rates, and latencies for each service, and distributed traces across
the hops of a request, all without instrumenting the application. Kiali is the console that
turns this into a picture, drawing the services as a graph with live traffic on the edges and
the mTLS lock on secured connections.

Kiali doesn't generate those metrics itself; it reads them from a Prometheus-compatible
source. On this cluster the Kiali custom resource ships with its metrics source disabled,
because OpenShift Local runs no standalone Prometheus by default. The observability chapter
installs the Red Hat build of OpenTelemetry and points Kiali at it, and only then does the
traffic graph fill in. Until that's wired, Kiali still shows the mesh topology and each
workload's mTLS status, which is enough to confirm a namespace is enrolled and secured; the
live traffic rates are what wait on the metrics source.

## Authorization policies

STRICT mTLS proves *who* a caller is; an `AuthorizationPolicy` decides *what* that caller may
do. Once workloads have identities, you can write a policy that allows only a named
ServiceAccount to reach a service and denies the rest:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: web-allow-frontend
  namespace: mesh-demo
spec:
  selector: { matchLabels: { app: web } }
  action: ALLOW
  rules:
    - from: [{ source: { principals: ["cluster.local/ns/mesh-demo/sa/frontend"] } }]
```

This moves access control off the network's IP addresses and onto cryptographic identity, so
the rule holds even as Pods move and IPs change. It's the layer that turns "traffic is
encrypted" into "only these callers are allowed," and it's worth knowing the object exists
even where this guide doesn't apply one.

## What a mesh costs

The mesh isn't free, and on a single-node cluster the cost is visible. Every enrolled Pod
gains an Envoy sidecar, which adds memory and a small per-request latency, and `istiod` plus
Kiali are more workloads competing for the one node's resources. That's part of why the
platform sizing target is larger. The payoff, encryption, traffic control, and telemetry with
no application changes, is worth it for a system of services talking to each other, and
overkill for a single app. Enroll the namespaces that benefit, and leave the rest out of the
mesh rather than meshing everything by reflex. The decision is per namespace, so you can start
with the one system that most needs mutual TLS or traffic shaping and widen the mesh later as
the case for it grows, rather than committing the whole cluster at once.

> **🤖 Explore with your agent**
>
> "Show me the mTLS status for every workload in mesh-demo, and confirm from the
> Envoy config that calls to the web service require a client certificate."

## Build, run, observe

```bash
source openshift/lib.sh
require_crc
# 1. Operators (pinned, manual approval) and the control plane
install_operator openshift/platform/subscriptions/servicemesh.yaml \
  openshift-operators servicemeshoperator3 servicemeshoperator3.v3.4.4
install_operator openshift/platform/subscriptions/kiali.yaml \
  openshift-operators kiali-ossm kiali-operator.v2.33.1
oc apply -f openshift/platform/mesh/istio.yaml
oc wait istiocni/default --for=condition=Ready --timeout=300s
oc wait istio/default   --for=condition=Ready --timeout=600s
# 2. Enroll a namespace and deploy into it
oc new-project mesh-demo
oc label namespace mesh-demo istio.io/rev=default --overwrite
oc apply -f examples/05-deploying/httpd-deployment.yaml
oc rollout status deployment/web -n mesh-demo
oc get pods -n mesh-demo                    # 2/2 per Pod: httpd + native istio-proxy
# 3. STRICT mTLS
oc apply -f openshift/platform/mesh/strict-mtls.yaml
oc get peerauthentication -n mesh-demo      # default = STRICT
oc delete project mesh-demo                 # clean up
```

Pods at `2/2` and a STRICT `PeerAuthentication` confirm the namespace is enrolled and
the mesh is enforcing mutual TLS. The repository also scripts this as
`./openshift/platform/install-mesh.sh`, which installs the same operators and control
plane and then wires the mesh into the Helm release from the Helm chapter, so it
expects that release already deployed.

## For deeper coverage

- [**Kubernetes Patterns**](https://www.oreilly.com/library/view/-/9781098131678/) (Ibryam and Huß, O'Reilly) covers the Sidecar and Service Discovery patterns a mesh puts to work.
- Official docs: the [Istio documentation](https://istio.io/latest/docs/) for the mesh concepts and the `Istio` resource, and the [OpenShift Container Platform documentation](https://docs.openshift.com/) for OpenShift Service Mesh 3 and the Sail operator.

## Where this fits

You installed your first two Operators to get the mesh. The next chapter steps back to
Operators themselves: how OperatorHub and OLM work, how to pin a version safely,
and the specific Operators this guide relies on, including Cluster Observability,
Node Tuning, and networking.
