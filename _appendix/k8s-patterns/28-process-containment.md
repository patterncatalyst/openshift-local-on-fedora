---
title: "Process Containment"
order: 28
part: "Security"
description: "Drop every Linux capability a container doesn't name, make its root filesystem read-only, run it non-root, and let OpenShift's restricted-v2 SCC inject the UID and enforce the floor, with Pod Security Admission as a second layer."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what a Security Context Constraint (SCC) is, and why restricted-v2 injects an arbitrary UID instead of trusting the one a manifest asks for
- Set the container `securityContext` fields restricted-v2 requires, and read which SCC admitted a running Pod
- Drop every Linux capability, make the root filesystem read-only, and mount a writable volume for the one path that still needs to write
- Explain how an SCC and a namespace's Pod Security Standard are two separate admission layers, and watch a privileged Pod rejected by one of them

## Why this matters

A container is not a virtual machine: it's a Linux process on the same kernel as every other container on the node, isolated by namespaces and cgroups rather than a hypervisor boundary. That isolation is real but narrower than it looks, and every control in this chapter narrows it further for the case where an attacker already has code execution inside a container and is looking for a way out of it or further into the node. A container running as root, holding its default Linux capabilities, with a writable root filesystem, gives that attacker meaningfully more to work with than the same container hardened against those three things.

On OpenShift the hardening isn't only something each Deployment's author remembers to write: it's enforced by a **Security Context Constraint**, a cluster resource that decides what a Pod is allowed to request before it's admitted. Every Pod in this appendix has been admitted by one already, `restricted-v2`, the default SCC bound to every authenticated user's workloads. This chapter is where that mechanism is finally the subject rather than the backdrop. `inventory-service` is the worked example: hardened with a full `securityContext`, verified from inside the running container, and set against a disposable namespace that rejects a privileged Pod outright.

## The restricted-v2 SCC and the injected UID

The single biggest difference from plain Kubernetes is what OpenShift does with a container's UID. A plain Kubernetes `securityContext` pins `runAsUser: 1001` to force a non-root UID. restricted-v2 takes that decision away from the manifest: it allocates each namespace a block of high UIDs (visible in the `openshift.io/sa.scc.uid-range` annotation) and injects one, so a workload runs as an arbitrary UID no manifest chose and no image baked in. The point is that an image can't assume a UID: it must tolerate running as whatever restricted-v2 assigns, which is exactly what a well-built image already does. So the OpenShift-correct `securityContext` sets `runAsNonRoot: true` and omits `runAsUser`:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: inventory-service
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
        seccompProfile:
          type: RuntimeDefault
```

`runAsNonRoot: true` is a check the kubelet runs against whatever UID the container would otherwise run as, refusing to start it if that UID resolves to 0. `seccompProfile.type: RuntimeDefault` turns on the runtime's default seccomp filter, blocking a long list of rarely-needed, historically exploit-prone syscalls. Pinning a `runAsUser` here would add nothing and could be rejected outright if the value fell outside the namespace's assigned range. Which SCC admitted a Pod is recorded on the Pod itself, and the injected identity is visible from inside it:

```console
$ oc get pod "$POD" -n patterns -o jsonpath='{.metadata.annotations.openshift\.io/scc}'
restricted-v2
$ oc exec -n patterns "$POD" -c inventory-service -- id
uid=1000650000(1000650000) gid=0(root) groups=0(root),1000650000
```

The UID is arbitrary (1000650000, from this namespace's range); the GID is 0, the UBI convention that lets an image grant group-read to specific paths without a privileged UID.

## Dropping capabilities instead of granting them

Linux capabilities split root's all-or-nothing power into about forty separate privileges, and a container's default set (fixed by the runtime) grants a double-digit subset whether the process uses one or not. `inventory-service` binds a port above 1024, talks to Postgres over a normal socket, and does nothing needing elevated Linux privilege, a clean case for dropping everything and adding nothing back. `capabilities.drop: ["ALL"]` removes the entire default set; a workload needing one back (binding a port below 1024 needs `NET_BIND_SERVICE`) would list it under a sibling `add`. `allowPrivilegeEscalation: false` closes a separate door: without it, a `setuid` binary can still gain more privilege than it started with, independent of dropped capabilities. The effect is visible in the kernel's own accounting for the container's PID 1:

```console
$ oc exec -n patterns "$POD" -c inventory-service -- grep CapEff /proc/1/status
CapEff:	0000000000000000
```

An all-zero effective capability mask confirms the drop took effect at the kernel level, not just in the manifest.

## Read-only root filesystem, and the one path that still writes

`readOnlyRootFilesystem: true` mounts the container's own image layers read-only at the kernel level, so a process handed arbitrary code execution still can't write a second-stage payload to disk, modify a binary on the image, or persist anything past the container's lifetime. It also means any path that still needs to be writable needs an explicit volume, because the read-only root doesn't carve out exceptions on its own:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

Python's standard library and several of FastAPI's dependencies assume a writable `/tmp` even when the application never calls `tempfile` directly, so `/tmp` is the one path worth mounting. An `emptyDir` is the right shape: ephemeral by design, gone the moment the Pod is. Both facts are checkable from inside the running container:

```console
$ oc exec -n patterns "$POD" -c inventory-service -- touch /opt/app-root/src/x
touch: cannot touch '/opt/app-root/src/x': Read-only file system
$ oc exec -n patterns "$POD" -c inventory-service -- sh -c 'touch /tmp/x && echo ok'
ok
```

![A Pod's securityContext (non-root, dropped capabilities, read-only root) admitted by the restricted-v2 SCC which injects a UID, alongside a namespace's baseline Pod Security Standard rejecting a privileged Pod]({{ "/assets/diagrams/appendix-28-process-containment.svg" | relative_url }})
*inventory-service runs hardened in patterns, admitted by restricted-v2; a separate namespace shows the baseline standard admitting a compliant Pod and rejecting a privileged one outright.*

## Two admission layers: SCC and Pod Security Admission

OpenShift runs two independent admission layers for Pod security, and it helps to keep them straight. The **SCC** is the older, OpenShift-native one: it decides, per identity, what a Pod may request, and mutates the Pod (injecting the UID, for one) to fit. **Pod Security Admission** (PSA) is the upstream Kubernetes mechanism, three fixed standards (`privileged`, `baseline`, `restricted`) applied with namespace labels, checking a Pod against the standard without mutating it. OpenShift keeps the two roughly in sync automatically, labeling namespaces for PSA based on the SCCs available in them. A Pod has to satisfy both to be admitted.

This example uses a disposable namespace, separate from `patterns`, labeled with the baseline standard:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: patterns-pss-demo
  labels:
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

A Pod built to this chapter's `securityContext` (no `runAsUser`, the SCC injects one) is admitted cleanly, with `restricted-v2` recorded on it:

```console
$ oc apply -f process-containment/03-compliant-pod.yaml
pod/compliant-demo created
$ oc get pod compliant-demo -n patterns-pss-demo -o jsonpath='{.metadata.annotations.openshift\.io/scc}'
restricted-v2
```

A Pod that sets `privileged: true` is rejected at admission, before the object is ever created. On this cluster the PSA baseline layer caught it first and named the exact field:

```console
$ oc apply -f process-containment/04-privileged-pod-rejected.yaml
Error from server (Forbidden): error when creating "...": pods "privileged-demo" is forbidden:
violates PodSecurity "baseline:latest": privileged (container "demo" must not set
securityContext.privileged=true)
```

The SCC layer would refuse it too, for the same reason: the default `ServiceAccount` has no SCC that permits `privileged: true`. Either way the rejection happens at admission, before the scheduler or kubelet ever sees the Pod, which is the entire value of enforcing a floor at the namespace and cluster level rather than hoping a reviewer catches a dangerous manifest in a pull request.

## fsGroup and volume ownership

`runAsUser` and the injected UID decide which identity the process runs as; they say nothing about which UID and GID a mounted volume's files are owned by. restricted-v2 also injects an `fsGroup` from the namespace range and sets it on mounted volumes, so a volume the arbitrary-UID process needs to write to is group-owned by a GID the process belongs to. This is why the Secret-mounted file in the Secure Configuration chapter ends up group-readable rather than strictly owner-only: the file is owned by `root`, and the container reads it through the injected group, not as the owner. Letting the SCC manage `fsGroup` is the OpenShift default; pinning one by hand is the exception, needed only when a specific external volume demands a specific GID.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure security (manage SCCs and harden workloads)
> **Competency:** Set a restricted-v2-compliant securityContext, read a Pod's admitting SCC, and understand SCC and Pod Security Admission as two layers
> **Drill:** `oc get pod "$POD" -n patterns -o jsonpath='{.metadata.annotations.openshift\.io/scc}'` (expect `restricted-v2`)

> **🤖 Explore with your agent**
>
> "Change inventory-service's container securityContext to add back NET_BIND_SERVICE instead of dropping all capabilities, apply it, and show me whether /proc/1/status still reports an all-zero CapEff or a nonzero one that includes it."

## Cleanup

```bash
oc delete namespace patterns-pss-demo --ignore-not-found
oc delete -n patterns -f process-containment/01-deployment.yaml -f process-containment/00-postgres.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/process-containment/

The runnable example deploys a hardened `inventory-service`, confirms the admitting SCC (`restricted-v2`), the injected UID (`1000650000`, gid 0), an all-zero effective capability mask, and a read-only root filesystem with `/tmp` as the one writable exception, all from inside the running container. It then creates a disposable namespace labeled with the baseline Pod Security Standard and shows it admitting a compliant Pod (`restricted-v2`) while rejecting a privileged one outright (`violates PodSecurity "baseline:latest"`). All confirmed on CRC. Full walkthrough in `examples/appendix-patterns/process-containment/README.md`.
