---
title: "Final project: a data mesh on OpenShift"
order: 17
description: "The final project that converges the guide: a seven-service data mesh deployed to OpenShift Local, where restricted-v2, Routes, the integrated registry, Helm, the mesh, storage, and autoscaling all meet in one system."
---

## Learning objectives

By the end of this chapter you can:

- Describe how a seven-service data mesh maps onto one CRC cluster across two tiers
- Trace each earlier chapter's concept (restricted-v2, Routes, Helm, Operators, storage, mesh, autoscaling) into its place in a single running system
- Build the service images with podman and push them to the integrated registry, then deploy the live core with one `helm install`
- Explain why the app services run under `restricted-v2` while Postgres and Kafka need a scoped `nonroot-v2` grant
- Exercise the mesh end to end through the GraphQL gateway's edge-TLS Route and read its composed response

## Why this matters

This is where the guide converges. The earlier chapters introduced the pieces one at a
time: deploying under `restricted-v2`, exposing a Service with an edge-TLS Route,
packaging with Helm, installing Operators, adding the service mesh, giving workloads
storage, scaling them on load. This final project puts them together into a single
coherent system and shows when, how, and why each one fits alongside the others. It's the largest thing in
the guide, and the one that justifies the chapters before it, because it's where their
separate lessons have to work at the same time, on the same cluster, in one system.

The system is a **data mesh**: a domain of services modeling order-placement-through-
shipment, each owning its own data, its API surface, and its lifecycle. The services
talk over a mix of REST, gRPC, GraphQL, and Kafka, each protocol's strengths showing in a
different place. On OpenShift that mesh is seven application services (a GraphQL gateway
and six data-product services) plus Postgres, Kafka, and a schema registry, deployed by
one Helm chart to a single CRC cluster.

## Where the runnable project lives

The full data mesh, with all seven services' source, its Helm chart, and its own
live-verified OpenShift appendix, is maintained as two standalone reference
architectures, so this chapter is the convergence view rather than a second copy of that
code:

- [**Data mesh reference architecture: Python**](https://patterncatalyst.github.io/datamesh-reference-arch-python/)
  is the source of truth for the shared service code and carries an
  **Appendix: Running on OpenShift (CRC)** that deploys the live core and an opt-in
  platform tier, verified on CRC.
- [**Data mesh reference architecture: Quarkus**](https://patterncatalyst.github.io/datamesh-reference-arch-quarkus/)
  builds the same mesh with Quarkus and Camel, with its own OpenShift path.

Use this chapter to see how everything in this guide fits together on one CRC cluster;
use the reference architectures when the data mesh itself is the subject and you want the
runnable chart. Where the two drift, the reference architecture is canonical. Keeping the
full build there rather than copying it here's a choice, not a gap: the service code and
its chart have one home that stays current, and this chapter stays a stable map of how the
guide's chapters converge, which is the part that belongs in the guide itself.

## The architecture on CRC

The deployed system has two tiers. The **live core** is the seven services plus Postgres,
Kafka, and the Apicurio schema registry, deployed by a single Helm chart. On top of it an
opt-in **platform tier** adds the service mesh, autoscaling, and observability, the pieces
this guide installed as Operators. The split matters for sizing: the core fits the core
target, and the full platform tier wants the platform target, because every app Pod gains
a sidecar and the observability backend and autoscaler bring their own workloads.

The seven services divide the domain by ownership, which is the point of a data mesh: each
is a *data product* that owns its slice and exposes it through the protocol that fits.
The **GraphQL gateway** is the single front door, the only service with a Route, and it
composes the others. Behind it the six data-product services, inventory, order,
notification, and their peers, each own a table in Postgres and publish domain events to
Kafka. The protocols are chosen per edge rather than uniformly: GraphQL at the gateway for
a flexible client-facing API, gRPC between services where a typed, low-latency call fits,
REST where a plain HTTP resource is enough, and Kafka for the asynchronous events that let
a service react to another's changes without a direct call. The schema registry
(Apicurio) holds the contracts those edges agree on. The result is a system where no
single service owns everything and each protocol sits at the boundary it suits.

{% include excalidraw.html
   file="capstone-datamesh"
   alt="On one CRC cluster: a GraphQL gateway behind an edge-TLS Route fronts six data-product services that talk over REST, gRPC, GraphQL, and Kafka. The app services run under restricted-v2 with no fixed UID; Postgres and Kafka run under the nonroot-v2 SCC with pinned UIDs; Apicurio has its own Route; images come from the integrated registry; the platform tier adds the mesh, autoscaling, and observability."
   caption="Figure 17.1: The seven-service data mesh on one CRC cluster: an edge-TLS Route to the gateway, restricted-v2 app Pods, nonroot-v2 infra, the integrated registry, and an opt-in platform tier." %}

## How each building block shows up

The value of the final project is that every chapter's concept reappears here, doing real
work in one system rather than in isolation.

**The restricted-v2 default, from deploying.** The seven application images are built to
run as an arbitrary non-root UID in group 0, so their Deployments set `runAsNonRoot: true`
and no `runAsUser` at all. OpenShift assigns the UID, and the images already work under
whatever it picks. This is the deploying chapter's rule applied seven times over: prefer
an image that tolerates any UID, and the security default stops being something to fight.

**An SCC exception, scoped.** Postgres and Kafka are the exception the deploying chapter
flagged. Their upstream images own their data directories as specific UIDs (70 and 1000),
so dropping `runAsUser` would break them. The chart runs them under a dedicated
ServiceAccount bound to the `nonroot-v2` SCC, which allows their pinned UIDs, rather than
loosening the default for everything. The binding is ordinary RBAC pointed at the
cluster-generated `system:openshift:scc:nonroot-v2` role, the deliberate, narrow exception
the guide said to reach for only with a reason.

**Routes and edge TLS, from the Routes chapter.** Only the GraphQL gateway and the schema
registry face the host, each through an edge-terminated Route that redirects HTTP to HTTPS.
Every other service stays `ClusterIP`-only, reachable in the cluster but with no Route,
which is the least-exposure habit from the Routes chapter: a Route is a public door, so
give one only to what needs it.

**The integrated registry, fed by podman.** The seven service images are built on your host
with **podman**, from multi-stage Containerfiles (a UBI 10 builder stage that resolves the
Python dependencies into a virtualenv, then a slim non-root runtime stage that copies only
that venv and the app), and pushed to OpenShift's **integrated registry** over its exposed
route. The chart then pulls them back by the registry's in-cluster Service DNS, with no
external registry account. This is the CRC build path, and it differs from the minikube one
by design: minikube does a local `docker build` and `minikube image load`, while on CRC you
`podman build`, `podman login` to the integrated registry, and `podman push`. The multi-stage
split is what keeps the runtime image small and non-root, which is also what lets it run
cleanly under `restricted-v2`. This is the registry the starting-the-cluster chapter noted was
part of what came up; the final project is where it does real work, holding the nine images
the mesh runs.

Podman isn't the only tool for this step; the rest of the Red Hat container toolchain does the
same job and some of it fits even better. **Buildah** builds OCI images from a Containerfile,
and `podman build` in fact delegates to it, so `buildah bud` is a direct substitute when you
want the builder on its own, for example in a CI job with no need for podman's run-time half.
**Skopeo** copies images between registries without pulling them into local storage, which is a
cleaner way to mirror the Postgres and Kafka images into the integrated registry than the
pull-tag-push this chapter uses: `skopeo copy docker://docker.io/library/postgres:18.6-alpine
docker://$REG/datamesh/postgres:18.6-alpine` moves the image registry to registry in one step.
All three are daemonless and rootless, which is why they suit a local workflow and a locked-down
CI runner equally; podman is the one this chapter leads with because it covers build, login, and
push in a single familiar tool.

**Helm, from the Helm chapter.** The chart carries one data-driven `app-deployment.yaml`
template and describes the seven workloads as entries in `values.yaml`, each with its port,
probe, size, and whether it gets a Route. That's the restricted-v2-clean, portable chart
the Helm chapter described, scaled to a real system: one template, seven services, a single
`helm install`.

**Operators, from the Operators chapter.** The platform tier is pure OperatorHub: AMQ
Streams for Kafka, OpenShift Service Mesh for Istio, the Custom Metrics Autoscaler for
scaling, the Red Hat build of OpenTelemetry for observability. Each installs with the
pinned-CSV, manual-approval pattern the Operators chapter established, which is why adding
a capability to the mesh is a known procedure rather than a new one each time.

**Storage, from the storage chapter.** Postgres and Kafka are StatefulSets with their own
PersistentVolumeClaims, so their data survives a Pod restart, and they rely on `fsGroup`
for writes under their assigned group. The storage chapter's stateful pattern is exactly
what keeps the mesh's data durable.

**The mesh, from the Service Mesh chapter.** With the platform tier on, the mesh namespace
is enrolled and every app Pod gains a sidecar, so service-to-service calls are mutually
authenticated and the traffic graph appears in Kiali. The canary and mTLS the mesh chapter
demonstrated on one workload apply here across the whole mesh.

**Autoscaling, from the autoscaling chapter.** Services that vary with load carry a
`ScaledObject`, so the system scales on real demand rather than a fixed replica count. The
autoscaling chapter's HPA-and-KEDA mechanics drive the mesh's elasticity.

## The deploy, at a glance

The reference architecture's appendix has the full sequence; the shape of it's the
through-line of this whole guide:

```bash
# size and start CRC
crc config set memory 32768; crc config set cpus 12; crc config set disk-size 100
crc setup && crc start --pull-secret-file ~/pull-secret.txt
eval "$(crc oc-env)"
# expose the integrated registry and log podman in to it
oc patch configs.imageregistry.operator.openshift.io/cluster \
  --type merge -p '{"spec":{"defaultRoute":true}}'
REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
podman login -u "$(oc whoami)" -p "$(oc whoami -t)" --tls-verify=false "$REG"
oc new-project datamesh
# build the 7 images with podman (multi-stage Containerfiles) and push to the registry,
# mirroring Postgres and Kafka into it too
./openshift/build-and-push.sh -r "$REG" -n datamesh --mirror-infra
# deploy the live core
helm upgrade --install datamesh openshift/helm/datamesh --namespace datamesh
oc get route graphql-gateway -n datamesh      # the gateway's edge-TLS hostname
```

A detail the reference appendix calls out and worth carrying here: on first start the app
Pods can crash-loop briefly while Postgres and Kafka come up, then converge once their
dependencies are ready. That's the expected startup pattern for a system whose services
race their datastores, not a failure, and it settles on its own.

The OpenShift-specific work is concentrated in three places, and they're exactly the
differences this guide spent its chapters on. The app Deployments drop `runAsUser` so
`restricted-v2` can assign one; Postgres and Kafka get the scoped `nonroot-v2` grant for
their pinned UIDs; and the gateway and registry get Routes while everything else stays
internal. Nothing else about the chart is OpenShift-particular. That's the payoff of
learning the platform chapter by chapter: porting a real multi-service system to OpenShift
turns out to be a short, specific list of changes, not a rewrite, because the hard parts
were each a chapter you already worked.

## Why a data mesh is the right final project

A data mesh is a good final project precisely because it exercises every edge of the platform
at once. A single web app would show `restricted-v2` and a Route and little else. A mesh of
services that own their own data forces the whole toolkit into play: many workloads under
the security defaults, stateful infrastructure that needs the scoped SCC and persistent
volumes, internal service-to-service traffic that the mesh secures, a public edge that a
Route exposes, events that flow through an operator-installed Kafka, and load that
autoscaling has to track. It's large enough that the pieces have to cooperate, which is the
thing a sequence of isolated examples can't show. The domain, order through shipment, is
ordinary by design: the interest isn't the business logic but how a realistic system of
services lands on OpenShift.

## Seeing it run

Once the core is up, the system is observable through the same tools the guide built. The
gateway's Route is the front door: a request to `graphql-gateway-datamesh.apps-crc.testing`
over HTTPS reaches the composed API, with TLS terminated at the router exactly as the Routes
chapter showed. A single GraphQL query exercises more than the gateway. Asking for an order
and its stock makes the gateway call the order service over REST and the inventory service
over gRPC, then fold both into one response:

```bash
curl -sk https://graphql-gateway-datamesh.apps-crc.testing/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ order(id:\"<id>\"){ itemSku quantity status stock { sku quantityOnHand available } } }"}'
```

```json
{ "data": { "order": {
  "itemSku": "WIDGET-001", "quantity": 3, "status": "placed",
  "stock": { "sku": "WIDGET-001", "quantityOnHand": 50, "available": true } } } }
```

The `stock` object came back over gRPC while the rest of the order came back over REST, and
the client saw neither boundary. Placing an order shows the same gRPC edge enforcing a rule:
a `POST` for an in-stock item is admitted, and one for an out-of-stock item is rejected with
a `409` carrying the on-hand count the inventory service reported. The protocol choices from
the architecture are now behavior you can watch, not claims in a manifest.

Inside the cluster, `oc get pods -n datamesh` shows the seven services plus
Postgres, Kafka, and Apicurio, and `oc get pvc -n datamesh` shows the claims keeping the
stateful pieces' data. With the platform tier on, Kiali draws the mesh graph, the services
as nodes and their calls as edges, with the mTLS lock on each secured connection, so the
protocol choices become visible as traffic rather than staying abstract in the manifests.

This is where the guide's debugging tools pay off at scale. When a service doesn't come up,
the pairing of `oc get events` and `oc logs` names the cause, and `oc rsh` into a running
service confirms what it sees of its database and its peers. A seven-service system has more
moving parts than any single chapter's example, and the inside-the-cluster tools are what
keep it legible: the same `rsh`, `debug`, and `logs` you met on one Pod, now applied across
a whole mesh.

## What the final project proves

Run end to end, the data mesh shows that the guide's pieces aren't separate tricks but one
toolkit. A single `helm install` brings up seven services that OpenShift admits under
`restricted-v2`, reach each other over the cluster network, expose just the gateway through
an edge-TLS Route, keep their data on PersistentVolumeClaims, and, with the platform tier,
run in a mutually authenticated mesh that scales on load and reports its telemetry. Every
one of those behaviors is a chapter you've already worked. The final project is where they
stop being exercises and become a system.

## For deeper coverage

- [**Data Mesh**](https://www.oreilly.com/library/view/data-mesh/9781492092384/) (Zhamak Dehghani, O'Reilly) is the source for the architecture this project models: data as a product, domain ownership, and the organizational reasons a mesh looks the way it does.
- [**Kubernetes Patterns**](https://www.oreilly.com/library/view/-/9781098131678/) (Ibryam and Huß, O'Reilly) names the structural patterns the deployment relies on, from health probes and predictable demands to the stateful-service and configuration patterns the chart puts to work.
- [**Building Event-Driven Microservices**](https://www.oreilly.com/library/view/building-event-driven-microservices/9798341622180/) (Adam Bellemare, O'Reilly) covers the asynchronous Kafka edges in depth: how services publish and react to domain events without a direct call.
- Official docs: the [OpenShift Container Platform documentation](https://docs.openshift.com/) for Security Context Constraints, Routes, and the integrated image registry; the [Kubernetes documentation](https://kubernetes.io/docs/) for the underlying Deployment, StatefulSet, and Service objects.

## Where this fits

This is the applied end of the guide: everything converging on one cluster. The next part
is the Kubernetes design-patterns appendix, which works the full catalog of patterns
entirely on OpenShift, with `restricted-v2` variants of every manifest, as a reference to
return to once the mesh has shown you the shape of a real deployment.
