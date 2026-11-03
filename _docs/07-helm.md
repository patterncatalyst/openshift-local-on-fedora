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

Install a chart the usual way. Helm renders the templates and applies the result
into the current project:

```bash
helm install web ./charts/web        # a local chart directory
helm list                            # the release and its revision
helm upgrade web ./charts/web --set replicaCount=3
helm uninstall web
```

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

> **⌨️ The `oc` way**
>
> Helm is a client-side tool, so there is no `oc` verb that replaces it. What `oc`
> adds is visibility: `oc get all -l app.kubernetes.io/managed-by=Helm` shows
> everything a release created, and the console's **Helm** tab lists releases with
> their revision history and a rollback button.

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
the chart is OpenShift-ready.

## Where this fits

You can package and deploy with Helm, and you have met OpenShift's native Helm
integration. The next chapter installs the OpenShift Service Mesh, the first thing in this
guide delivered as an Operator, which leads into the Operators chapter that
follows.
