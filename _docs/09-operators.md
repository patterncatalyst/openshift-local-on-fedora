---
title: "Operators"
order: 9
description: "How OperatorHub and OLM work, how to pin an operator version safely, and the operators this guide relies on, including Cluster Observability, Node Tuning, and networking."
---

An Operator packages the knowledge to run a piece of software on Kubernetes: it
watches custom resources and reconciles the real objects to match. OpenShift ships
the Operator Lifecycle Manager (OLM) and a catalog, OperatorHub, so installing one
is a declarative action rather than a pile of manifests. You already installed two
Operators for the service mesh earlier; this chapter explains the machinery
and the operators this guide builds on.

## OperatorHub and OLM

Four objects do the work:

- **PackageManifest**: a catalog entry OLM reads from OperatorHub. It lists the
  operator's channels and the current ClusterServiceVersion in each.
- **Subscription**: your request to install an operator from a channel. It is the
  object you create.
- **InstallPlan**: OLM's plan to install a specific ClusterServiceVersion, created
  in response to a Subscription.
- **ClusterServiceVersion (CSV)**: the installed operator at an exact version, with
  the CRDs and deployments it owns.

An **OperatorGroup** scopes which namespaces an operator watches. Operators that
watch the whole cluster go into a global group (`openshift-operators`); others get
their own namespace and group.

## Pin the version, approve one install plan

Left to defaults, a Subscription auto-approves every InstallPlan, so an operator can
upgrade itself the moment the catalog publishes a new version. For a tutorial you
want the opposite: a known version that does not move under you. The house pattern
pins the exact CSV and approves only the matching InstallPlan:

```yaml
# A pinned, manually approved Subscription.
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: amq-streams
  namespace: openshift-operators
spec:
  name: amq-streams
  source: redhat-operators
  sourceNamespace: openshift-marketplace
  channel: amq-streams-3.2.x
  startingCSV: amqstreams.v3.2.2-5
  installPlanApproval: Manual
```

With `installPlanApproval: Manual`, OLM creates the InstallPlan but waits. You
approve only the one naming your pinned CSV, so later upgrade plans stay unapproved.
The `install_operator` helper in `openshift/lib.sh` automates this safely: it waits
for OperatorHub to actually *serve* the package (the catalog reports ready about a
minute before it serves packages), applies the Subscription, and approves only the
InstallPlan whose `clusterServiceVersionNames` contains the pinned CSV.

```bash
# install_operator <subscription.yaml> <namespace> <package> <csv>
install_operator openshift/infra/amq-streams-subscription.yaml \
  openshift-operators amq-streams amqstreams.v3.2.2-5
```

Always re-check the current CSV before pinning, because the catalog moves:

```bash
oc get packagemanifest amq-streams -n openshift-marketplace \
  -o jsonpath='{range .status.channels[*]}{.name} {.currentCSV}{"\n"}{end}'
```

## The operators this guide relies on

These are the operators the platform tier installs, each pinned and manually
approved. Treat the versions as a dated snapshot; re-check each on your cluster with
the command above before installing.

| Operator | Package | Namespace | Channel |
|----------|---------|-----------|---------|
| AMQ Streams (Kafka) | `amq-streams` | `openshift-operators` | `amq-streams-3.2.x` |
| OpenShift Service Mesh 3 | `servicemeshoperator3` | `openshift-operators` | `stable-3.4` |
| Kiali | `kiali-ossm` | `openshift-operators` | `stable` |
| Custom Metrics Autoscaler (KEDA) | `openshift-custom-metrics-autoscaler-operator` | `openshift-keda` | `stable` |
| Red Hat build of OpenTelemetry | `opentelemetry-product` | `openshift-opentelemetry-operator` | `stable` |
| OpenShift GitOps (Argo CD) | `openshift-gitops-operator` | `openshift-gitops-operator` | `gitops-1.22` |

Each is the Red Hat equivalent of an upstream project the examples use directly:
Strimzi, Istio, KEDA, OpenTelemetry, and Argo CD. The application code and images do
not depend on the Red Hat packaging; the operator is the OpenShift delivery path.

## Operators Red Hat adds beyond the stack

Beyond the stack above, OpenShift offers operators that make a cluster easier to run
and observe. These are not yet used elsewhere in this family of projects, so treat
the pins as ones to establish on your own cluster; confirm each package and its
current CSV with `oc get packagemanifest <pkg> -n openshift-marketplace` before
installing.

### Cluster Observability Operator

The Cluster Observability Operator (package `cluster-observability-operator`)
deploys and manages monitoring stacks on the cluster: it reconciles a
`MonitoringStack` custom resource into a Prometheus and Alertmanager setup you own,
separate from the cluster's built-in platform monitoring. It is the OpenShift-native
way to stand up metrics for your own workloads without hand-rolling Prometheus.

```bash
oc get packagemanifest cluster-observability-operator -n openshift-marketplace \
  -o jsonpath='{range .status.channels[*]}{.name} {.currentCSV}{"\n"}{end}'
```

### Node Tuning and performance

The Node Tuning Operator ships with OpenShift and applies sysctl and kernel tuning
to nodes through a `Tuned` custom resource; the Performance Profile it manages is how
you pin CPUs, set huge pages, and enable low-latency features on a node. On a
single-node CRC the tuning you can meaningfully apply is limited, but it is worth
seeing what a `Tuned` resource looks like and how the operator rolls it out, because
the mechanism is identical on a real cluster.

### Networking

OpenShift's SDN is built in, so a networking operator adds a specific capability on
top. Two are worth knowing: the **MetalLB Operator**, which hands out
`LoadBalancer` service IPs on bare metal, and the **Kubernetes NMState Operator**,
which configures node network interfaces through a `NodeNetworkConfigurationPolicy`.
On single-node CRC their practical use is narrow (there is one node and no external
IP pool), so this section is about recognizing what each does; which one to install
depends on what you are modeling.

## Where CRC fits across the project family

Several sibling projects already run on OpenShift Local with this same operator
pattern, and are worth reading next to this chapter for fuller, application-driven
examples:

- The data-mesh reference architectures (Quarkus and Python) each end with an
  OpenShift chapter that installs this operator set and runs a multi-service system.
- The API Patterns and Practices sites (REST, gRPC, GraphQL, WebSockets) each carry
  an OpenShift Local appendix.
- The server-side WebAssembly site runs its examples on CRC with the wasmCloud
  operator.

## Build, run, observe

```bash
source openshift/lib.sh
require_crc                                          # refuse any non-CRC cluster
# Re-check and install one operator end to end:
oc get packagemanifest amq-streams -n openshift-marketplace \
  -o jsonpath='{range .status.channels[*]}{.name} {.currentCSV}{"\n"}{end}'
install_operator openshift/infra/amq-streams-subscription.yaml \
  openshift-operators amq-streams amqstreams.v3.2.2-5
oc get csv -n openshift-operators | grep amqstreams   # Succeeded
oc get crd | grep kafka.strimzi.io                    # CRDs the operator owns
```

A CSV in `Succeeded` and the operator's CRDs present confirm the install. The
`teardown.sh` script removes operators in reverse, reading each CSV's owned CRDs
before deleting, so the cluster returns to empty.

## Where this fits

You can install any operator safely with a pinned version. The next chapter indexes the
runnable examples and their verification status, closing the first part of the
guide.
