---
title: "Examples"
order: 10
description: "The runnable examples that accompany the chapters, where they live, and how their verification status is tracked."
---

Every hands-on chapter has a runnable counterpart you can apply to your own
cluster. This chapter indexes them, explains the layout, and describes how each
example's verification status is tracked.

## Where the examples live

Runnable code sits under `examples/`, outside the published site, one directory per
chapter. Each directory carries the YAML, a short `README.md`, and where it helps, a
`demo.sh` that runs the chapter's commands end to end. The larger platform pieces
(the operators, the mesh, Helm charts, Routes) share the `openshift/` scaffold at
the repository root, which the chapters call into rather than duplicating.

| Chapter | Example | What it does |
|---------|---------|--------------|
| 5 Deploying | `examples/05-deploying` | A UBI httpd Deployment and a scale/rollout walk-through |
| 6 Routes | `examples/06-routes` | A Service, an edge-TLS Route, and the ingress-CA verification |
| 7 Helm | `openshift/helm/demo` | A restricted-v2 chart with Postgres and Routes |
| 8 Service Mesh | `openshift/platform/install-mesh.sh` | Sail/Service Mesh 3 + Kiali, mTLS, a canary |
| 9 Operators | `openshift/lib.sh` + `openshift/infra` | The pinned-CSV `install_operator` pattern |

## The openshift/ scaffold

The scaffold is the shared machinery the platform chapters use:

- `lib.sh`: the helpers, including `require_crc` (refuses any cluster that is not
  CRC) and `install_operator` (pin the CSV, approve one InstallPlan).
- `install-infra.sh`, `infra/`: the project and AMQ Streams Kafka.
- `build-images.sh`, `deploy.sh`: in-cluster image builds and the Helm release.
- `platform/`: the mesh, autoscaling, observability, and GitOps installers.
- `capture-evidence.sh`, `teardown.sh`: record what a run produced, then return the
  cluster to empty.

Run order, once your cluster is up:

```bash
source openshift/lib.sh && require_crc
./openshift/install-infra.sh
./openshift/deploy.sh
./openshift/platform/install-platform.sh     # optional: mesh, keda, observability, gitops
./openshift/capture-evidence.sh
./openshift/teardown.sh                        # always: clean, then crc stop
```

## Verification status

Each example is marked `unverified` until it has been run end to end on OpenShift
Local and the result recorded. Verification happens on a live CRC cluster: the
chapter's commands are run against the running cluster, the output is captured into
`openshift/evidence/<date>/` with a secret scrub, and only then is the example
promoted to `verified`. The evidence and the status log live in the repository's
internal plans, not on these pages.

Nothing here is marked verified on the strength of looking correct; a status moves
only after a passing run on a real cluster.

## Where this fits

This closes the first part of the guide. Later iterations add persistent storage,
autoscaling with the Custom Metrics Autoscaler, a data-mesh final project on
OpenShift, and the Kubernetes design-patterns appendix worked entirely on
OpenShift.
