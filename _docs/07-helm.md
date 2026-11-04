---
title: "Helm on OpenShift"
order: 7
description: "Deploy with the Helm CLI, write charts that satisfy restricted-v2, and use OpenShift's native Helm integration and the Helm-based operator pattern."
---

Helm is the package manager for Kubernetes, and it works on OpenShift the same way
it works anywhere: a chart templates a set of objects, and `helm install` renders
and applies them. OpenShift adds two things on top: a built-in Helm integration in
the console and the API, and the option to wrap a chart as an Operator. This
chapter covers all three, with the one adjustment OpenShift asks of a chart: its
Pods must satisfy the restricted-v2 security standard.

## The Helm CLI

`helm` is a separate binary from `oc`; install it from the Helm releases if you do
not have it, then point it at the cluster your current kubeconfig context selects.
No extra configuration is needed: Helm talks to whatever `oc`/`kubectl` talk to.

```bash
helm version
oc project helm-demo 2>/dev/null || oc new-project helm-demo
```

Use a current Helm, 3.18 or later, or Helm 4; the charts here work with both, and staying on
a recent release keeps you clear of behavior that has changed across versions. Because Helm
reads your kubeconfig, the cluster it acts on is whatever your current context points at, so
confirm the context is `crc-admin` before an install, exactly as you would check it before any
command that changes the cluster. There is no separate "connect Helm to the cluster" step;
the connection is the one `oc` already uses.

Before installing a chart you are authoring, lint it:

```bash
helm lint ./charts/web     # structural and values problems, before anything is applied
```

`helm lint` checks the chart's structure and catches common mistakes in `Chart.yaml` and the
templates without touching the cluster. Together with `helm template` and `--dry-run`, it is
how you validate a chart entirely offline before the first install.

Install a chart the usual way. Helm renders the templates and applies the result
into the current project:

```bash
helm install web ./charts/web        # a local chart directory
helm list                            # the release and its revision
helm upgrade web ./charts/web --set replicaCount=3
helm uninstall web
```

### What a chart is made of

A chart is a directory with a fixed shape, and knowing it makes every `helm` command
legible. Three parts carry the weight. `Chart.yaml` is the chart's own metadata: its name,
its version, and any charts it depends on. `values.yaml` holds the default configuration, a
tree of settings the templates read. And `templates/` holds the Kubernetes manifests written
as Go templates, with `{{ ... }}` placeholders that Helm fills from the values at install
time. A `_helpers.tpl` file in `templates/` defines named snippets, such as a standard label
block, that the other templates reuse so the chart stays consistent.

The model is simple once you see it: Helm merges your values over the defaults, renders the
templates with the merged result, and applies the rendered objects. Everything a chart does
comes from that one substitution step, which is why the same chart produces different
deployments from different values without any change to its templates.

### How Helm tracks a release

Helm 3 and the current Helm 4 are entirely client-side. There is no server component in the
cluster, no Tiller, which is what earlier Helm needed and what made it a security concern.
Instead, each time you install or upgrade, Helm records the release state as a Secret in the
same namespace, one per revision:

```bash
oc get secret -l owner=helm           # one sh.helm.release secret per revision
```

Because the state lives in the namespace as ordinary Secrets, a release is visible to anyone
with access to that project, and `helm list` simply reads them back. This is also why
deleting a namespace cleanly removes its releases: the record goes with it. The practical
upshot is that Helm adds no cluster-side install and no privileged component; it is a client
that reads and writes objects your context can already reach.

### Render before you apply

Two flags make a chart safe to work with before it touches the cluster. `helm template`
renders the chart to stdout without applying anything, so you can read exactly what would be
created, and `--dry-run` on an install does the same through the cluster's validation:

```bash
helm template web ./charts/web | less          # see the rendered YAML
helm install web ./charts/web --dry-run        # validate against the cluster, apply nothing
```

Rendering first is the fastest way to catch a values mistake or a restricted-v2 problem,
because you see the real manifest rather than guessing what the template produced. It is the
habit that turns a chart from a black box into something you can review.

## Charts that satisfy restricted-v2

The one thing a chart needs for OpenShift is Pods that run under the default
`restricted-v2` security context constraint: no fixed UID, no privilege
escalation, all capabilities dropped. A chart that hard-codes `runAsUser: 1000`
or expects root will be rejected. Set only what restricted-v2 requires and let
OpenShift assign the UID:

```yaml
# templates/deployment.yaml (securityContext excerpt)
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

A chart written this way runs unchanged on plain Kubernetes too, so the same chart
serves both clusters. The `openshift/helm/` directory in this repository is a
worked example: a chart with a `services:` map, a Postgres StatefulSet, and
edge-TLS Routes, all restricted-v2 clean.

The key move is what the excerpt leaves out. It sets `runAsNonRoot: true` to refuse root,
but it does not set `runAsUser`, because on OpenShift the project assigns the UID and a
hard-coded one would be rejected. For files the process needs to write, the chart relies on
group ownership rather than a fixed user: OpenShift adds the arbitrary UID to group 0, so a
container whose writable paths are group-owned by root works regardless of which UID it draws.
That is the whole trick to a portable, restricted-v2-clean chart: declare the constraints
(non-root, no escalation, capabilities dropped) and leave identity to the cluster.

A workload with persistent storage, like the chart's Postgres, needs one more consideration:
the files on its volume must be writable by the arbitrary UID. OpenShift handles this through
the Pod's `fsGroup`, which it sets so the mounted volume is group-owned by a GID the assigned
UID belongs to. A chart that relies on `fsGroup` rather than a fixed owner keeps working no
matter which UID the project hands out. The repository's Postgres piece is written this way,
which is why it runs under `restricted-v2` without any SCC exception, and it is the pattern to
copy for any stateful workload you add.

### Values that drive the chart

The repository chart is configured through its `values.yaml`, and the `--set` flags in this
chapter override individual values at install time. The `services:` map is the chart's main
input: each entry names a workload and its settings, and the templates loop over the map to
render a Deployment, a Service, and a Route for each. Toggles like `postgres.enabled` and
`kafka.enabled` switch optional dependencies on or off. Two ways to supply values cover every
case:

```bash
helm install web ./openshift/helm/demo -f my-values.yaml          # a whole values file
helm install web ./openshift/helm/demo --set postgres.enabled=false  # one value inline
```

A values file is the right choice once you are changing more than a setting or two, because it
is reviewable and repeatable; `--set` is for a quick override. Helm layers them, with `--set`
winning over a file and a file winning over the chart's defaults, so you keep a base file and
override just what differs for a given install.

> **⌨️ The `oc` way**
>
> Helm is a client-side tool, so there is no `oc` verb that replaces it. What `oc`
> adds is visibility: `oc get all -l app.kubernetes.io/managed-by=Helm` shows
> everything a release created, and the console's **Helm** tab lists releases with
> their revision history and a rollback button.

## Upgrades, revisions, and rollback

Every install and upgrade creates a numbered *revision*, and Helm keeps the history so a bad
change is one command to reverse. This is the same safety net the Deployment gives a single
workload, raised to the whole release:

```bash
helm upgrade web ./charts/web --set replicaCount=3   # revision 2
helm history web                                     # every revision and its status
helm rollback web 1                                  # back to revision 1
```

An upgrade re-renders the chart with the new values and applies the difference, so Helm
changes only the objects that actually changed. A rollback re-applies a previous revision's
rendered manifests, which is why it is reliable: Helm is not reconstructing the old state by
hand, it stored the exact rendered objects and puts them back. Keeping the default history
means you can always step back a revision, so an upgrade on a live release carries little risk.

### Dependencies and subcharts

A chart can declare other charts as dependencies in `Chart.yaml`, and Helm pulls them into a
`charts/` subdirectory so one `helm install` deploys the whole set. This is how an application
chart bundles its database or its message broker: the subchart's values nest under the
dependency's name, so `postgres.enabled` in the repository chart reaches into the Postgres
piece. Subcharts keep a multi-component install to a single release with a single history,
rather than a handful of charts you have to install and upgrade in lockstep by hand.

## OpenShift's native Helm integration

OpenShift knows about Helm as a first-class concept, not just as a CLI you happen
to run. Two cluster resources register chart repositories so their charts appear in
the console's Developer Catalog, ready to install from the web UI:

- **`HelmChartRepository`** (cluster-scoped): a chart repository available in every
  project.
- **`ProjectHelmChartRepository`** (namespace-scoped): a chart repository available
  only in one project.

```yaml
# A cluster-wide chart repository in the Developer Catalog.
apiVersion: helm.openshift.io/v1beta1
kind: HelmChartRepository
metadata:
  name: openshift-helm-charts
spec:
  connectionConfig:
    url: https://charts.openshift.io/
```

```bash
oc apply -f helm-repo.yaml
oc get helmchartrepositories
```

Once registered, a developer opens the console's **+Add → Helm Chart** view, picks
a chart, fills in values through a form, and installs it: the same mechanism as
`helm install`, driven from the UI and governed by cluster RBAC.

The form is generated from the chart's values schema, so a chart that ships a
`values.schema.json` gets typed fields and validation in the console rather than a raw YAML
box. This is what makes the native integration more than a convenience: an administrator
registers a vetted set of charts once, and developers install them through a governed UI,
with RBAC deciding who may install into which project. The CLI and the console install the
same release in the same way, so a chart you test with `helm install` behaves identically
when a teammate installs it from the catalog.

### When a chart violates restricted-v2

Because the SCC check happens at admission, a chart that is not restricted-v2 clean does not
fail when Helm renders it; it fails when the cluster tries to admit the Pod. The symptom is a
release that installs but whose Deployment never produces a running Pod, with the reason in
the ReplicaSet's events:

```bash
oc get events --field-selector reason=FailedCreate   # SCC rejection shows here
```

When you see a `FailedCreate` naming an SCC, the fix is in the chart, not the cluster: remove
the hard-coded `runAsUser` or the privileged setting the Pod asked for. Rendering the chart
with `helm template` first and reading the `securityContext` blocks catches this before you
install.

## The Helm-based operator pattern

A chart can also be wrapped as an Operator. The Operator SDK builds a *Helm-based
operator*: it takes a chart and a custom resource definition, and reconciles the
chart whenever a matching custom resource changes. This turns "run `helm upgrade`
by hand" into "edit a CR and let the operator converge the release," which is how
you package a chart for others to consume declaratively.

You build a Helm-based operator rather than install a single "Helm operator"; the
catalog entry you install is the specific operator someone built this way, each
reconciling its own chart. Installing operators from OperatorHub is covered later;
whether a given Helm-based operator is published there is something to check on the
live cluster with `oc get packagemanifests -n openshift-marketplace | grep -i helm`.

### Helm or an Operator?

The two overlap, so it helps to know when each fits. Reach for the Helm CLI when you are the
one deploying: it is direct, it needs nothing installed in the cluster, and `helm upgrade`
is a fine way to manage a release you own. Wrap a chart as an Operator when the deployment is
something others consume and should manage declaratively, by editing a custom resource rather
than running a command, and when you want continuous reconciliation that corrects drift
instead of a one-time apply. A chart is a push; an Operator is a control loop. For everything
in this guide the CLI is the right tool, and the Operator pattern is here so you recognize it
when a piece of software you install turns out to be a chart someone wrapped this way.

> **🤖 Explore with your agent**
>
> "Register the openshift-helm-charts repository, then show me which charts it
> makes available in the Developer Catalog and the values schema of one of them."

## Build, run, observe

```bash
oc new-project helm-demo 2>/dev/null || oc project helm-demo
helm install web ./openshift/helm/demo --set postgres.enabled=false,kafka.enabled=false
helm list                                              # web, deployed
oc get all -l app.kubernetes.io/managed-by=Helm        # objects the release created
oc get pods -o jsonpath='{.items[*].spec.securityContext}{"\n"}'  # no fixed runAsUser
helm uninstall web
oc delete project helm-demo
```

A release that deploys, Pods with no hard-coded UID, and a clean uninstall confirm
the chart is OpenShift-ready. The `--set postgres.enabled=false,kafka.enabled=false` turns off
the optional dependencies so the check exercises the core services alone; drop those flags to
bring the full stack up once you have confirmed the basics.

## Where this fits

You can package and deploy with Helm, and you have met OpenShift's native Helm
integration. The next chapter installs the OpenShift Service Mesh, the first thing in this
guide delivered as an Operator, which leads into the Operators chapter that
follows.
