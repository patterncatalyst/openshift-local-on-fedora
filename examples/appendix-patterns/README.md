# Kubernetes patterns on OpenShift: runnable examples

The runnable code for the [Kubernetes patterns on OpenShift
appendix](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/).
One directory per pattern, each self-contained, each worked against the guide's
shipping services rather than a throwaway demo app.

This tree is excluded from the Jekyll build (like all of `examples/`): it is
runnable code, not site content.

## The cluster

Every example runs on a pristine CRC cluster. Bring OpenShift up with
[§3](https://patterncatalyst.github.io/openshift-local-on-fedora/docs/03-starting-crc/),
and if you worked the §17 final project first, reset to empty so the patterns
run on a clean cluster:

```bash
crc delete && crc start
eval "$(crc oc-env)"
```

## Build the service images once

The pattern manifests deploy from the integrated registry, the CRC build path
from §17. Build and push the shipping-service images once, then every pattern
chapter applies against them:

```bash
cd examples/appendix-patterns
./scripts/build-and-push.sh
```

The script exposes the integrated registry, creates the `patterns` project,
logs podman in, and builds the three services the foundational family needs
(shipping-service, inventory-service, notification-service) from the
[data-mesh reference architecture](https://github.com/patterncatalyst/datamesh-reference-arch-python).
Point it at a different checkout with `DATAMESH_DIR=/path/to/lgtm-datamesh`, or
name specific services as arguments.

## What makes these the OpenShift examples

Every Deployment here satisfies `restricted-v2`: no fixed `runAsUser`, no added
capabilities, `seccompProfile: RuntimeDefault`. Where a workload needs a pinned
UID (the Postgres image owns its data as UID 70), it runs under a ServiceAccount
bound to the `nonroot-v2` SCC rather than loosening the default for everything.
Services face the host through Routes, not NodePorts. The commands use `oc`; each
also works as `kubectl`.

## Prerequisites

The same Fedora host as
[§1](https://patterncatalyst.github.io/openshift-local-on-fedora/docs/01-prerequisites/),
plus `podman` for the image builds. Use the bundled `oc` from `crc oc-env`.
