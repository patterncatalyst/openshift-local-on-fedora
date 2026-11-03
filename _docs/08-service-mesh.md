---
title: "OpenShift Service Mesh"
order: 8
description: "Install OpenShift Service Mesh 3 and Kiali as Operators, bring up the Istio control plane, enable sidecar injection, enforce STRICT mTLS, and split traffic with a canary."
---

OpenShift Service Mesh is Red Hat's distribution of Istio. Version 3 is driven by
the Sail operator, which manages Istio through a small `Istio` custom resource
instead of the older multi-CR control plane. This chapter installs the mesh and
Kiali from OperatorHub, brings up the control plane, enrolls a namespace, turns on
mutual TLS, and shifts a slice of traffic to a second version with a canary. It is
the first thing in this guide delivered as an Operator, which sets up the Operators
chapter next.

## What the mesh gives you

A service mesh puts a sidecar proxy next to each Pod and routes all service-to-
service traffic through those proxies. That buys you mutual TLS between services
without touching application code, fine-grained traffic control (canaries, retries,
timeouts), and uniform telemetry. On OpenShift the proxies are Envoy, the control
plane is Istio, and Kiali is the console that visualizes the mesh.

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
> There is no `kubectl` shortcut here; the mesh is all custom resources. What the
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

## Where this fits

You installed your first two Operators to get the mesh. The next chapter steps back to
Operators themselves: how OperatorHub and OLM work, how to pin a version safely,
and the specific Operators this guide relies on, including Cluster Observability,
Node Tuning, and networking.
