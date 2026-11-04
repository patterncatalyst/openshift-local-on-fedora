---
title: "Packaging: Helm and Kustomize"
order: 31
part: "Operations"
description: "Deploy the same shipping-service two ways: a Helm chart with install/upgrade/rollback, and a Kustomize base with dev and prod overlays, no templating, just patches, both rendered and applied with oc."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Exercise the Helm command surface a chart consumer uses: `install`, `upgrade`, `rollback`, `history`, and `--set`
- Author a Kustomize base of plain manifests plus two overlays that patch it for different environments
- Render a Kustomize overlay without applying it (`oc kustomize`) and preview a change before it lands (`oc diff -k`)
- Explain what Kustomize does that Helm doesn't, and why a real cluster often runs both

## Why this matters

The main tutorial's [Helm chapter]({{ "/docs/07-helm/" | relative_url }}) builds a chart from scratch and walks the full install-upgrade-rollback cycle; that isn't repeated here. What it doesn't cover is **Kustomize**, the other way Kubernetes manifests get parameterized for more than one environment, and production clusters use both, often on the same team for different reasons.

The two tools solve overlapping problems with opposite philosophies. Helm treats a set of manifests as a **template**: `values.yaml` supplies inputs, Go template syntax computes output, and `helm install` tracks the result as a numbered **release** you upgrade and roll back as a unit. Kustomize treats manifests as **data**: no templating language at all, just a base of ordinary YAML and overlays that patch specific fields, with no release object and no history beyond what version control already tracks. Neither is more powerful; they suit different jobs, worked here against the same `shipping-service` so the contrast is concrete.

## Helm, the consumer's command surface

The exam (and day-to-day work) leans on the command surface a chart consumer uses, not chart authoring, so that's the focus. This chapter's chart deploys `shipping-service` under a fixed release name, `shipping-helm`:

```console
$ helm install shipping-helm ./chart --namespace patterns
$ helm list -n patterns
NAME            REVISION   STATUS     CHART
shipping-helm   1          deployed   shipping-helm-0.1.0
```

An upgrade with a changed value moves the release to revision 2 and, because the Deployment template carries a `checksum/configmap` annotation computed from the rendered ConfigMap, rolls the Pods even when the Deployment template itself is otherwise unchanged:

```console
$ helm upgrade shipping-helm ./chart --namespace patterns --set replicaCount=2
$ helm history shipping-helm -n patterns
1   superseded   Install complete
2   deployed     Upgrade complete
```

`helm history` is the "what changed and when" command, independent of `oc rollout history`, because a release can touch more than a Deployment (this one also tracks a ConfigMap and a Service). Rolling back targets a **release revision**, not a Deployment revision, reverting every object the chart manages in one command:

```console
$ helm rollback shipping-helm 1 -n patterns
# replicaCount is back to 1
```

`helm template` (render with no cluster interaction) and `helm lint` both catch a malformed template before it reaches the API server, worth running before any non-trivial `install` or `upgrade`. That command set, plus `helm uninstall`, is the realistic surface: install with overrides, confirm the release, upgrade, recover from a bad upgrade with a rollback.

## Kustomize: patches over plain manifests

A Kustomize base is ordinary Kubernetes YAML plus one `kustomization.yaml` listing which manifests belong together:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: patterns
resources:
  - configmap.yaml
  - deployment.yaml
  - service.yaml
```

There's no `{{ .Values.x }}` anywhere in `deployment.yaml`: it's a complete, valid manifest you could `oc apply -f` directly. The `namespace: patterns` line is a Kustomize **transformer** that stamps every resource with that namespace at build time. An **overlay** references the base and layers changes on top without copying any of it:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: patterns
resources:
  - ../../base
patches:
  - path: deployment-patch.yaml
```

Each patch is a *partial* manifest, just enough of the object (matched by `apiVersion`, `kind`, `metadata.name`) to say what changes. The dev overlay's patch sets one replica and a lean resource profile; the prod overlay's sets two replicas and more headroom. Both patch the same base Deployment by name, as a **strategic merge patch**: Kubernetes-aware merge rules combine the patch with the base, so a `containers` entry matches by `name`, not array index, and a patch doesn't repeat sibling fields just to change one. Kustomize also supports JSON 6902 patches and generators (`configMapGenerator` appends a content hash to a ConfigMap's name, forcing a rollout the way Helm's checksum annotation does); neither is needed here, but both are fair game.

`oc` has Kustomize built in, so no separate binary is needed:

```console
$ oc kustomize kustomize/overlays/dev          # render to stdout, no cluster
$ oc apply -n patterns -k kustomize/overlays/dev
# dev: 1 replica
$ oc diff -n patterns -k kustomize/overlays/prod   # preview the change first
$ oc apply -n patterns -k kustomize/overlays/prod
# prod: 2 replicas
```

`oc kustomize` renders the merged manifests without touching the cluster, the Kustomize equivalent of `helm template`. `oc diff -k` matters more for Kustomize than for Helm, since there's no release object recording what the last apply looked like; the diff is the only preview of what an overlay switch will change.

![Two ways to parameterize the same Deployment: a Helm chart rendering values.yaml into a tracked release, and a Kustomize base patched by dev and prod overlays with no release object]({{ "/assets/diagrams/appendix-31-packaging-helm-and-kustomize.svg" | relative_url }})
*Same shipping-service image, same namespace, two deployment mechanisms that never have to know about each other.*

## Choosing between them

Helm earns its templating the moment a chart serves consumers who shouldn't need to know the underlying manifests: install a community chart for a database and it hides dozens of fields behind `values.yaml` defaults, with real conditional logic deciding which objects even get created. That flexibility costs readability: a Helm template is harder to read than the manifest it produces, because the real manifest only exists after rendering.

Kustomize earns its simplicity the moment every consumer already owns the base manifests and only a bounded set of fields varies between environments: replica counts, resource profiles, a schema name. There's nothing to learn beyond Kubernetes YAML and the small patch vocabulary, and `oc kustomize`'s output is always a real manifest you could have written by hand. That's also its ceiling: no release object, no rollback command of its own (recovering from a bad `apply -k` means re-applying a previous overlay state from git), and no conditional logic beyond what patches express.

The practical answer is "both, in their own lane": a chart distributed to other teams or published publicly is a Helm problem; a service your own team owns with small per-environment differences is often a Kustomize problem. A surprising number of real clusters pair a vendor's Helm chart for a database with Kustomize overlays for the services the team writes, and OpenShift GitOps (Argo CD) reconciles either one natively.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy and manage applications (parameterize deployments across environments)
> **Competency:** Use Helm (install/upgrade/rollback) and Kustomize (bases and overlays) to deploy and parameterize an application
> **Drill:** `oc kustomize kustomize/overlays/prod | oc apply -n patterns -f -` (apply a rendered overlay without `-k`, the way a CI pipeline that pins a rendered manifest might)

> **🤖 Explore with your agent**
>
> "Add a third overlay, staging, that reuses the prod overlay's resource profile but the dev overlay's single replica, and show me how little new YAML that requires on top of the existing base and patches."

## Cleanup

```bash
helm uninstall shipping-helm -n patterns
oc delete -n patterns -k packaging-helm-and-kustomize/kustomize/overlays/prod
oc delete -n patterns -f packaging-helm-and-kustomize/00-postgres.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/packaging-helm-and-kustomize/

The runnable example installs the Helm chart (revision 1), upgrades it to two replicas (revision 2), and rolls it back to one; then renders the Kustomize dev overlay with `oc kustomize`, applies it (1 replica), diffs and switches to prod (2 replicas). All confirmed on CRC with `helm` 4.2.2 and `oc`'s built-in Kustomize. Full walkthrough in `examples/appendix-patterns/packaging-helm-and-kustomize/README.md`.
