# Image Builder

Runnable example for the [Image Builder chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/24-image-builder/).

Build the `shipping-report` image **inside the cluster** two ways, with no
Docker Engine on the host and no privileged container: a Docker-strategy build
runs Buildah in a Pod, from a local directory or straight from a git commit,
and pushes to the integrated registry. The source is reused from
[`../batch-job`](../batch-job) (its committed `Containerfile`).

## Part 1: binary build from a local directory

```bash
cd examples/appendix-patterns
oc new-build --binary --strategy=docker --name=shipping-report-local -n patterns
# Docker builds look for "Dockerfile" by default; this project uses "Containerfile":
oc patch bc shipping-report-local -n patterns --type merge \
  -p '{"spec":{"strategy":{"dockerStrategy":{"dockerfilePath":"Containerfile"}}}}'
oc start-build shipping-report-local --from-dir=batch-job -n patterns -F
```

The build streams to completion and pushes to
`image-registry.openshift-image-registry.svc:5000/patterns/shipping-report-local:latest`.
It's a real API object:

```bash
oc get builds -n patterns
oc logs build/shipping-report-local-2 -n patterns | tail
```

## Part 2: build from a git commit

```bash
oc apply -f image-builder/01-git-buildconfig.yaml
oc start-build shipping-report-git -n patterns -F
oc get build shipping-report-git-1 -n patterns      # FROM shows Git@<commit>
```

The resulting image carries the commit it was built from:

```bash
oc get istag shipping-report-git:latest -n patterns \
  -o jsonpath='{.image.dockerImageMetadata.Config.Labels.io\.openshift\.build\.commit\.id}{"\n"}'
```

## Pull the built image (the in-cluster address)

A Pod on the cluster pulls from the same in-cluster registry address the build
pushed to:

```bash
oc -n patterns run report-pull \
  --image=image-registry.openshift-image-registry.svc:5000/patterns/shipping-report-git:latest \
  --restart=Never --command -- python -c "print('pulled from the internal registry and ran')"
oc logs report-pull -n patterns
oc describe pod report-pull -n patterns | grep -i image-registry
```

The host side (the other chapters' `podman push`) used the registry's external
Route, `default-route-openshift-image-registry.apps-crc.testing`, because the
host isn't inside the cluster network. Same registry, two addresses.

## Cleanup

```bash
oc delete pod report-pull -n patterns --ignore-not-found
oc delete bc shipping-report-local shipping-report-git -n patterns --ignore-not-found
oc delete is shipping-report-local shipping-report-git -n patterns --ignore-not-found
oc delete build --all -n patterns
```
