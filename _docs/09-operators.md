---
title: "Operators"
order: 9
description: "How OperatorHub and OLM work, how to pin an operator version safely, and the operators this guide relies on, including Cluster Observability, Node Tuning, and networking."
---

## Learning objectives

By the end of this chapter you can:

- Explain how OperatorHub and OLM install and reconcile software
- Read the objects OLM creates: Subscription, InstallPlan, and CSV
- Pin an operator to a specific version with manual approval
- Identify the operators this guide relies on and why

## Why this matters

An Operator packages the knowledge to run a piece of software on Kubernetes: it
watches custom resources and reconciles the real objects to match. OpenShift ships
the Operator Lifecycle Manager (OLM) and a catalog, OperatorHub, so installing one
is a declarative action rather than a pile of manifests. You already installed two
Operators for the service mesh earlier; this chapter explains the machinery
and the operators this guide builds on. The payoff of understanding it is practical: once you
can read the objects OLM creates, an install that hangs or an upgrade that surprises you becomes
a specific thing to look at rather than a black box to restart and hope.

{% include excalidraw.html
   file="operator-olm"
   alt="A pinned Subscription leads to an InstallPlan that OLM creates, which you approve, which installs a CSV that reaches Succeeded. The CSV provides the installed operator: its controller and the CRDs it owns, such as kafkas.kafka.strimzi.io. The content comes from the redhat-operators catalog."
   caption="Figure 9.1: A pinned Subscription produces one InstallPlan you approve, which installs the CSV; a Succeeded CSV and its CRDs confirm the operator." %}

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

Behind those objects sits one more: the **CatalogSource**. A CatalogSource is a Pod,
running in `openshift-marketplace`, that serves a catalog of operators to OLM. OpenShift
ships several by default, and `redhat-operators` is the one the Subscriptions in this guide
pull from. When you query a PackageManifest, you are reading what a CatalogSource advertises,
which is why the list of available versions reflects the catalog as it stands today rather than
a fixed set. The catalog Pod also explains a timing quirk worth knowing: just after a cluster
start, the marketplace reports ready a short while before it actually serves packages, so a
Subscription applied in that window can sit waiting. The `install_operator` helper handles this
by waiting for the package to be served, not just for the catalog to report ready.

### Install modes and the OperatorGroup

An operator declares which *install modes* it supports, and the OperatorGroup chooses one. The
modes are AllNamespaces (watch the whole cluster), SingleNamespace and OwnNamespace (watch one),
and MultiNamespace (watch a listed set). An operator installed into `openshift-operators` uses
the global OperatorGroup already there and runs in AllNamespaces mode, which is why the mesh and
Kafka operators in this guide need no OperatorGroup of their own. An operator that supports only
SingleNamespace, by contrast, needs its own namespace with an OperatorGroup naming the target,
and installing it without one leaves the Subscription stuck. Checking an operator's supported
modes before you subscribe, visible on its PackageManifest, saves that dead end.

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

This is not a formality. A CSV that was current when a guide was written is often gone from the
catalog months later, replaced by a newer patch, and a Subscription pinned to a CSV the catalog
no longer serves never gets an InstallPlan: it waits forever. Re-checking and pinning the CSV
the channel serves today is what keeps an install from hanging. The pins in this repository were
refreshed against the live catalog for exactly this reason, and yours will need the same check.

### Channels, the upgrade graph, and why pinning matters

A channel is a named track of releases, like `amq-streams-3.2.x` or `stable`, and within a
channel the operator's CSVs form an upgrade graph: each CSV records which earlier version it
`replaces`, and sometimes versions it may `skip`. With automatic approval, OLM walks that graph
to the channel head the moment the catalog publishes a new CSV, so an operator can upgrade itself
overnight. For production that can be the right choice; for a tutorial it is the opposite of what
you want, because the version underneath you would change and the commands might not match. Manual
approval plus a pinned `startingCSV` freezes the operator at a known version: OLM proposes the
upgrade InstallPlans but leaves them unapproved, so nothing moves until you edit the pin and
approve the next one yourself. That is the whole point of the house pattern, a version that
holds still until you choose to move it.

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

What the Red Hat packaging adds is lifecycle and support: a tested operator on a defined
channel, with a supported upgrade path and images that carry Red Hat's security maintenance.
On OpenShift that is the delivery mechanism you reach for, because it integrates with OLM and the
console. The point for this guide is that your workloads stay portable: an application that talks
to Kafka does not know whether Kafka arrived via Strimzi on plain Kubernetes or AMQ Streams on
OpenShift, so the same code and manifests move between the two with only the install path
changing. Choosing the Red Hat operator is an operational decision about support and lifecycle,
not a change to what you build.

Every one of these installs through the same `install_operator` helper, with the same safety
properties, so adding a new operator to a project is a matter of pinning its CSV and calling the
helper rather than learning a new procedure each time. That uniformity is the point: one pattern,
applied to every operator, is far easier to review and to tear down cleanly than a handful of
separate install scripts.

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
way to stand up metrics for your own workloads without hand-rolling Prometheus. It matters here
because the service mesh chapter noted that Kiali's traffic graph needs a metrics source: a
`MonitoringStack`, or the OpenTelemetry stack the observability chapter installs, is what fills
that role, so this operator is one way to light up the parts of the mesh that depend on metrics.
On a single-node cluster the stack it deploys is modest, but the resource it reconciles and the
Prometheus it produces are the same ones a production cluster would run.

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
depends on what you are modeling. The value of knowing they exist is that a networking need on a
real cluster, a load-balancer IP or a specific interface configuration, has a named operator
answer rather than a hand-built one, and the resource you would create to drive it looks the same
whether you try it here or apply it on a cluster where it has real effect.

## Checking an operator is healthy

After a Subscription is approved, the thing to watch is the ClusterServiceVersion. Its
`status.phase` moves through `Installing` to `Succeeded`, and `Succeeded` with the operator's
CRDs present is what confirms the install:

```bash
oc get csv -n openshift-operators                 # phase per installed operator
oc get csv <csv-name> -n openshift-operators -o jsonpath='{.status.phase}{"\n"}'
oc get crd | grep <operator-domain>               # the CRDs the operator owns
```

A CSV stuck short of `Succeeded` points at the install, not the workload: a missing
OperatorGroup for a SingleNamespace operator, an unapproved InstallPlan, or a dependency the
operator needs and cannot find. Reading the CSV's status conditions, with `oc describe csv`,
names the reason. The pattern to internalize is that an operator install has two gates, the CSV
reaching `Succeeded` and its CRDs appearing, and both should be checked rather than assuming the
Subscription alone did the job.

An operator differs from a plain Deployment in what it then does. A Deployment runs a process;
an operator runs a controller that watches custom resources and reconciles real objects to
match them. Installing the operator only puts that controller in place and registers its CRDs.
Nothing happens to your cluster until you create one of its custom resources, which is the step
that tells the operator what to build. That is why the mesh chapter installed the operators and
then applied an `Istio` resource: the operator was watching, and the CR was the instruction.

## Uninstalling an operator cleanly

Removing an operator is more than deleting its Subscription, because OLM separates the
subscription, the installed CSV, the CRDs, and the custom resources you created. A clean removal
works inward:

```bash
oc delete <custom-resources>                       # first, the CRs the operator manages
oc delete subscription <name> -n openshift-operators
oc delete csv <csv-name> -n openshift-operators
```

Delete the custom resources first, so the operator tears down what it created while it is still
running to do so. Then remove the Subscription and the CSV. This sequence leaves the operator's CRDs
in place, because deleting a CRD deletes every object of that type across the
cluster, so you remove CRDs only when you are sure nothing depends on them. A custom resource that
will not delete is usually held by a finalizer the operator clears, which is the reason for
ordering CR deletion before the operator goes away. The repository's `teardown.sh` follows exactly
this order, reading each CSV's owned CRDs before removing anything, so the cluster returns to
empty without orphaned objects.

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

## For deeper coverage

- [**Kubernetes Patterns**](https://www.oreilly.com/library/view/-/9781098131678/) (Ibryam and Huß, O'Reilly) describes the Operator and Controller patterns that OLM automates.
- [**GitOps and Kubernetes**](https://www.manning.com/books/gitops-and-kubernetes) (Yuen, Matyushentsev, Ekenstam, Suen, Manning) covers declarative delivery, the mindset behind operator-driven installs.
- Official docs: the [OpenShift Container Platform documentation](https://docs.openshift.com/) for OLM and OperatorHub, and the [Kubernetes documentation](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) for the operator pattern and custom resources.

## Where this fits

You can install any operator safely with a pinned version. The next chapter turns to
state: persistent storage, so a workload's data survives a Pod restart, with
OpenShift's dynamic provisioning on CRC.
