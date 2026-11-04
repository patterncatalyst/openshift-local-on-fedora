---
title: "Image Builder"
order: 24
part: "Advanced"
description: "Build a container image with no Docker Engine on the host and no privileged container in the cluster: OpenShift Builds run Buildah inside a Pod, from a local directory or straight from a git commit, and push to the integrated registry a Deployment pulls from."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Run an OpenShift Docker-strategy build that compiles a Containerfile inside the cluster, with no Docker daemon anywhere and no privileged container
- Trigger the same build from a local directory and from a git commit, and explain what each produces
- Explain why an in-cluster build pushes to, and a Deployment pulls from, the integrated registry's in-cluster address, while the host uses a different one
- State what a `Build` object gives a CI pipeline that a host-side `podman build` does not

## Why this matters

Every other chapter in this appendix got its images the same way: `podman build` on the host, then `podman push` to the integrated registry's external route. That works for a local tutorial, and it's also not how a deployment pipeline usually runs: a CI runner building an image for a cluster rarely has (or should have) a privileged container engine sitting next to it, and the point of **in-cluster** image building is removing that dependency, building with the compute the cluster itself provides.

OpenShift builds are a first-class part of the API: a `BuildConfig` is a template, and each `Build` it spawns is an object the API server schedules, runs in a Pod, and reports status on, the same `oc get`, `oc logs`, and status-condition machinery as any workload. The build itself runs **Buildah**, which assembles an OCI image in user space with no Docker daemon, no `/var/run/docker.sock`, and no privileged container. Mounting the host's Docker socket into a build Pod, the historical way to build inside Kubernetes, hands that Pod root-equivalent control of the node, exactly the hole the Process Containment pattern exists to close. OpenShift's build strategy removes the need for it by construction.

This chapter runs the same Containerfile two ways, chosen because they differ in where the source comes from and therefore in what they're good for. Both produce an image in the integrated registry; both are real `Build` objects. The example image is `shipping-report`, the small `uv`-managed CLI the Batch Job pattern already builds, because it has a committed Containerfile and no external dependencies to stand up just to build it.

## Part 1: a binary build from a local directory

The quickest path uploads a local directory straight to a build Pod:

```bash
oc new-build --binary --strategy=docker --name=shipping-report-local -n patterns
oc patch bc shipping-report-local -n patterns --type merge \
  -p '{"spec":{"strategy":{"dockerStrategy":{"dockerfilePath":"Containerfile"}}}}'
oc start-build shipping-report-local --from-dir=batch-job -n patterns -F
```

`oc new-build --binary` creates a `BuildConfig` whose source is whatever a later `oc start-build --from-dir` uploads, and an imagestream to receive the result. The `patch` handles the one OpenShift-specific snag here: a Docker-strategy build looks for a file named `Dockerfile` by default, and this project follows the `Containerfile` convention, so the first build fails fast with `ManageDockerfileFailed` until `dockerfilePath` points at the real name. After the patch, the build runs Buildah through the Containerfile's stages and pushes the result:

```
Pushing image image-registry.openshift-image-registry.svc:5000/patterns/shipping-report-local:latest ...
Push successful
```

Unlike a host-side `podman build`, there's a durable object behind this: `oc get builds` lists `shipping-report-local-2` with a `Complete` status, `oc logs build/shipping-report-local-2` replays exactly what ran, and the binary upload is recorded as `Binary@<commit>`. What it lacks is a reproducible source reference: "the directory as it happened to be on disk when I ran `start-build`" is precisely the ambiguity the second path removes.

## Part 2: a build from a git commit

A `BuildConfig` with a git source is the shape a CI pipeline actually uses. Because `oc new-build` refuses to create a Docker-strategy config when it can't find a `Dockerfile` in the repository, this one is written declaratively so `dockerfilePath` is set from the start:

```yaml
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata:
  name: shipping-report-git
  namespace: patterns
spec:
  source:
    type: Git
    git:
      uri: https://github.com/patterncatalyst/openshift-local-on-fedora
      ref: main
    contextDir: examples/appendix-patterns/batch-job
  strategy:
    type: Docker
    dockerStrategy:
      dockerfilePath: Containerfile
  output:
    to:
      kind: ImageStreamTag
      name: shipping-report-git:latest
```

`oc start-build shipping-report-git -F` clones the repository at `main`, builds the Containerfile under `contextDir`, and pushes to the imagestream. The payoff is traceability: the finished image carries the exact commit it was built from, stamped into its own labels by the builder:

```console
$ oc get build shipping-report-git-1 -n patterns
NAME                    TYPE     FROM            STATUS     DURATION
shipping-report-git-1   Docker   Git@c910386     Complete   16s
```

`Git@c910386` is not cosmetic: a build that fails or ships a regression traces back to a named commit, not whatever was sitting uncommitted on a developer's laptop. That's the discipline a real pipeline enforces by construction, and it's the reason a `Build` is an API object rather than a shell command: a CI system that can create one can trigger a build by commit, watch its `status`, read its logs, and know unambiguously when it finished and whether it passed. A git webhook can trigger it with no human at a terminal at all.

![A Docker-strategy Build runs Buildah in a Pod, from a local directory or a git commit, and pushes to the integrated registry at its in-cluster address; a Deployment on the same cluster pulls from that same address, while the host uses the external route]({{ "/assets/diagrams/appendix-24-image-builder.svg" | relative_url }})
*Both builds are real API objects; the registry address differs by whether the client is inside the cluster or outside it.*

## Two addresses, one registry

There's one integrated registry, reachable at two addresses depending on who's asking. Everything inside the cluster, a build pushing its result and a kubelet pulling an image to run, uses the in-cluster Service address:

```
image-registry.openshift-image-registry.svc:5000/patterns/shipping-report-git:latest
```

That's the address the build logs print on push, and the address a Deployment names to pull. A Pod created from the git-built image is served from it directly, confirmed in the Pod's own events:

```console
$ oc run report-pull -n patterns \
    --image=image-registry.openshift-image-registry.svc:5000/patterns/shipping-report-git:latest \
    --restart=Never --command -- python -c "print('pulled from the internal registry and ran')"
$ oc logs report-pull -n patterns
pulled from the internal registry and ran
```

The only time this appendix used a *different* address was the host side: the other chapters' `podman push` from a laptop went to `default-route-openshift-image-registry.apps-crc.testing`, the registry's external Route, because the host isn't inside the cluster's network and can't resolve the `.svc` name. Same registry, same stored layers, two front doors: the in-cluster Service for anything running on the cluster, the external Route for anything that isn't. Getting this backwards (naming the external Route in a Deployment, say) usually still works on CRC but routes in-cluster pull traffic out through the Route and back, where the `.svc` address is the direct path. OpenShift's imagestreams make the common case simpler still: a Deployment can reference a bare `shipping-report-git:latest` imagestream tag and let the cluster resolve it to the registry digest, with no address typed at all.

## The Source strategy, in one paragraph

This chapter used the Docker strategy because the project already has a Containerfile. OpenShift's other build strategy, Source-to-Image (S2I), needs none: given a git repository of plain source and a language builder image (`oc new-app python~<git-url>` picks one), S2I injects the source into the builder, runs the builder's assemble script, and produces a runnable image, no Containerfile authored or maintained anywhere. S2I is the more opinionated, lower-ceremony path for a standard application in a supported language; the Docker strategy is the one to reach for when a build needs a Containerfile's exact control, which is why this project, with a multi-stage `uv` build, uses it. Both run the same Buildah-in-a-Pod machinery underneath and push to the same registry the same way; they differ only in whether you bring the build recipe or let the builder image supply it.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Build and deploy applications (produce images from source inside the cluster)
> **Competency:** Create and run a BuildConfig (Docker and Source strategies) and reference the resulting image through the integrated registry
> **Drill:** `oc get builds -n patterns -o custom-columns=NAME:.metadata.name,FROM:.spec.source.type,STATUS:.status.phase`

> **🤖 Explore with your agent**
>
> "Change shipping-report-git's contextDir to examples/appendix-patterns/batch-job and its ref to a specific commit instead of main, start the build, and show me the io.openshift.build.commit.id label the resulting image carries."

## Cleanup

```bash
oc delete pod report-pull -n patterns --ignore-not-found
oc delete bc shipping-report-local shipping-report-git -n patterns --ignore-not-found
oc delete is shipping-report-local shipping-report-git -n patterns --ignore-not-found
oc delete build --all -n patterns
```

## Verification: examples/appendix-patterns/image-builder/

The runnable example builds `shipping-report` twice inside the cluster with the Docker strategy: once from a local directory (a binary build, `Complete` after fixing `dockerfilePath` to `Containerfile`) and once from the public git repository at `main` (the image stamped `Git@c910386` with the commit in its labels). Both push to the integrated registry's in-cluster address; a Pod then pulls the git-built image from that same address and runs it. Full walkthrough in `examples/appendix-patterns/image-builder/README.md`.
