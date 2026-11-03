---
title: "OpenShift Service Mesh"
order: 8
description: "Install OpenShift Service Mesh 3 and Kiali as Operators, enable sidecar injection, enforce STRICT mTLS, and split traffic with a canary."
---

OpenShift Service Mesh is Red Hat's distribution of Istio. Version 3 is driven by
the Sail operator, which manages Istio through a small `Istio` custom resource
instead of the older multi-CR control plane. This chapter installs the mesh and
Kiali from OperatorHub, enrolls a namespace, turns on mutual TLS, and shifts a
slice of traffic to a second version with a canary. It is the first thing in this
guide delivered as an Operator, which sets up the Operators chapter next.

## What the mesh gives you

A service mesh puts a sidecar proxy next to each Pod and routes all service-to-
service traffic through those proxies. That buys you mutual TLS between services
without touching application code, fine-grained traffic control (canaries, retries,
timeouts), and uniform telemetry. On OpenShift the proxies are Envoy, the control
plane is Istio, and Kiali is the console that visualizes the mesh.

## Install the operators

The mesh needs two operators: the Sail operator (package `servicemeshoperator3`)
for Istio, and `kiali-ossm` for the dashboard. Both install from OperatorHub with a
pinned version and manual install-plan approval, the pattern Chapter 9 covers in
full. The `openshift/platform/` scaffold in this repository installs them for you:

```bash
./openshift/platform/install-mesh.sh
```

That script applies the pinned Subscriptions in
`openshift/platform/subscriptions/servicemesh.yaml` and `kiali.yaml`, waits for each
ClusterServiceVersion to reach `Succeeded`, then creates the `Istio` and `Kiali`
custom resources. To do it by hand, the shape is:

```yaml
# The control plane. Sail reconciles Istio from this one CR.
apiVersion: sailoperator.io/v1
kind: Istio
metadata:
  name: default
spec:
  namespace: istio-system
```

```bash
oc apply -f openshift/platform/mesh/istio.yaml
oc wait --for=condition=Ready istio/default --timeout=300s
```

## Enroll a namespace and inject sidecars

Service Mesh 3 uses *revisioned* injection: a Pod joins the mesh when its namespace
(or the Pod) carries the `istio.io/rev` label naming the control-plane revision,
not the older `istio-injection=enabled` annotation. Label the namespace and
re-roll its workloads so the sidecars are injected:

```bash
oc new-project mesh-demo
oc label namespace mesh-demo istio.io/rev=default
oc apply -f httpd-deployment.yaml          # from Chapter 5
oc rollout restart deployment/web          # re-roll so sidecars are injected
oc get pods -n mesh-demo                    # each Pod now shows 2/2 containers
```

The `2/2` is the tell: your container plus the injected Envoy sidecar.

> **⌨️ The `oc` way**
>
> There is no `kubectl` shortcut here; the mesh is all custom resources. What `oc`
> adds is the console: the **Kiali** link in the Networking menu opens the mesh
> graph, where you watch live traffic flow between sidecars and see the mTLS lock
> icons the next section turns on.

## Enforce mutual TLS

Turn on STRICT mTLS for the namespace so every in-mesh call is mutually
authenticated and encrypted:

```yaml
# strict-mtls.yaml
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
oc apply -f strict-mtls.yaml
```

One wrinkle on OpenShift: the cluster router delivers plaintext to a Route-facing
Pod, so a service that sits behind a Route needs a PERMISSIVE exception for that
port, or the router's plaintext connection is refused. Keep the namespace STRICT
and relax only the Route-facing workload.

## Split traffic with a canary

Istio routes by `VirtualService` and `DestinationRule`. To send most traffic to v1
and a slice to v2, define subsets and weight them:

```yaml
# canary 90/10 between two versions of "web"
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

Watch the split land in Kiali's graph: the two edges to v1 and v2 carry traffic in
roughly the ratio you set.

> **🤖 Explore with your agent**
>
> "Show me the mTLS status for every workload in mesh-demo, and confirm from the
> Envoy config that calls to the web service require a client certificate."

## Build, run, observe

```bash
./openshift/platform/install-mesh.sh                       # operators + Istio + Kiali
oc wait --for=condition=Ready istio/default --timeout=300s
oc new-project mesh-demo 2>/dev/null || oc project mesh-demo
oc label namespace mesh-demo istio.io/rev=default --overwrite
oc apply -f httpd-deployment.yaml && oc rollout restart deployment/web
oc get pods -n mesh-demo                                    # 2/2 per Pod
oc apply -f strict-mtls.yaml
oc get peerauthentication -n mesh-demo                      # STRICT
```

Pods at `2/2` and a STRICT `PeerAuthentication` confirm the mesh is enrolled and
enforcing mTLS.

## Where this fits

You installed your first two Operators to get the mesh. Chapter 9 steps back to
Operators themselves: how OperatorHub and OLM work, how to pin a version safely,
and the specific Operators this guide relies on, including Cluster Observability,
Node Tuning, and networking.
