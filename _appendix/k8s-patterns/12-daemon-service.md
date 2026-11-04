---
title: "Daemon Service"
order: 12
part: "Behavioral"
description: "Run exactly one infrastructure Pod per node with a DaemonSet on OpenShift, and work through the two layers (SCC and SELinux) that gate reading a node's own filesystem."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain why a `DaemonSet` has no `replicas` field and what guarantee it provides instead
- Mount a node's filesystem with `hostPath` and name the two OpenShift layers that gate reading it
- Grant a node-access daemon the SCC and SELinux context it needs, scoped to its own ServiceAccount
- Compare a DaemonSet's `RollingUpdate` and `OnDelete` update strategies

## Why this matters

Every workload so far answers "how many Pods" with a number: a Deployment's `replicas`, a Job's `completions`. Daemon Service answers a different question: not how many, but *where*. It places exactly one Pod per node, automatically, regardless of how many nodes exist. That fits a narrow category: infrastructure that has to see one node's state rather than the cluster's, a log collector, a metrics exporter, a node security agent.

A Deployment could be scaled to the node count by hand, but that number changes as nodes come and go, and the scheduler has no "one per node" rule. A DaemonSet encodes it as the controller's reconciliation target, which is why it has no `replicas` field: the answer is always "however many schedulable nodes qualify." On OpenShift this pattern also surfaces something minikube's version never does: reading the node itself runs into two separate security layers, and working through them is most of this chapter.

## No replicas, just a template

The example's `node-collector` DaemonSet reads the node's `/var/log` through a `hostPath` volume and logs a per-node summary. CRC is single-node, so there's one Pod:

```console
$ oc get daemonset node-collector -n patterns
NAME             DESIRED   CURRENT   READY
node-collector   1         1         1
$ oc get pod -l app.kubernetes.io/name=node-collector -n patterns -o wide
# one Pod, on node crc
```

`DESIRED`, `CURRENT`, and `READY` all track the schedulable node count. On a multi-node cluster, adding a node makes a new `node-collector` Pod appear on it within one reconciliation pass, with no manifest change and no `oc scale`, because there was never a count to scale. On single-node CRC the "one per node" guarantee holds at its minimum: one node, one Pod. This is the same single-node view as the Automated Placement chapter, the manifest is identical to production, only the node count differs.

## hostPath, and the two layers that gate it

`node-collector` mounts the node's own `/var/log` read-only:

```yaml
volumeMounts:
  - name: varlog
    mountPath: /host-var-log
    readOnly: true
volumes:
  - name: varlog
    hostPath:
      path: /var/log
      type: Directory
```

A `hostPath` volume is a direct bind-mount of a path on whichever node the Pod lands on, with no portability and no cluster-level tracking, a liability for an ordinary app and the right tool for a DaemonSet whose job is to see *this node's* state. `type: Directory` makes the kubelet fail Pod creation if the path doesn't already exist, rather than creating an empty one a collector would read as real-but-empty data.

On OpenShift, getting that mount to actually work takes two grants, discovered in order by watching it fail. First, the default `restricted-v2` SCC forbids `hostPath` volumes outright: the DaemonSet's Pods never get created, and `oc describe daemonset` shows `hostPath volumes are not allowed to be used`. Granting the `hostmount-anyuid` SCC clears that, and the Pod starts, but its collector reads zero log directories:

```console
$ oc exec $POD -n patterns -- sh -c 'ls -ld /host-var-log/pods'
drwxr-x---. 70 root root 20480 ... /host-var-log/pods
# pod-log-dirs=0
```

`/var/log/pods` is owned `root:root` at mode `0750`, and RHCOS runs SELinux in enforcing mode, which confines an ordinary container's SELinux type away from the node's `var_log_t` files regardless of the Unix UID. Even running the collector as UID 0 reads nothing, because SELinux, not file ownership, is the barrier. Reading the node's logs needs the `privileged` SCC and the `spc_t` (super-privileged container) SELinux type, which is exactly how OpenShift's own cluster log collector runs:

```yaml
securityContext:
  runAsUser: 0
  seLinuxOptions:
    type: spc_t
```

With the `privileged` SCC granted to `node-collector`'s ServiceAccount and `spc_t` set, the collector reads the node's logs:

```console
$ oc exec $POD -n patterns -- cat /dev/stdin   # (its own log line)
node=crc pod-log-dirs=69
$ oc get pod $POD -n patterns -o jsonpath='{.metadata.annotations.openshift\.io/scc}'
privileged
```

That access is granted to this one daemon's ServiceAccount through a RoleBinding, not to the namespace. The lesson is the one the deploying chapter set up and this chapter takes to its limit: an ordinary application has no business reading every Pod's node-local logs, so it stays under `restricted-v2`; an infrastructure daemon that must is the documented exception, and it gets exactly the privilege it needs, scoped to itself.

![A DaemonSet places one Pod per node; on OpenShift, reading the node's hostPath logs needs the privileged SCC and the spc_t SELinux type]({{ "/assets/diagrams/appendix-12-daemon-service.svg" | relative_url }})
*A DaemonSet runs one Pod per node; hostPath mounts the node, and the SCC plus SELinux type decide whether it can actually read it.*

## Tolerating a tainted control-plane node

A control-plane node normally carries a `NoSchedule` taint that repels ordinary Pods. A DaemonSet is not automatically exempt, so a collector that should cover every node tolerates it explicitly:

```yaml
tolerations:
  - key: node-role.kubernetes.io/control-plane
    operator: Exists
    effect: NoSchedule
```

`operator: Exists` with no value tolerates the taint whatever its value. On CRC the single node is schedulable and untainted, so this is a no-op here, but it's correct on a multi-node cluster where a log collector has a real reason to run on control-plane nodes too, while `shipping-service` has none.

## RollingUpdate versus OnDelete

A DaemonSet's `updateStrategy` governs how a changed template rolls across nodes:

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

`RollingUpdate` (the default) updates nodes `maxUnavailable` at a time: delete the old Pod on a node, wait for its replacement to be `Ready`, move on. `OnDelete` does nothing on a template change until something deletes each node's Pod manually, trading automation for control when an update must be sequenced against node maintenance. There's no `maxSurge`: a DaemonSet can't run two Pods per node, so there's no extra capacity to surge into; the old Pod goes before the new one exists.

A DaemonSet's Pod template also accepts `nodeSelector` and node affinity, restricting it to a subset of nodes, the right shape for a GPU driver that has no business on a CPU-only node. And its resource requests compete for the same node capacity as everything else, on every node it runs, so under-provisioning a collector that then OOMKills on every node at once is a worse surprise than one Deployment replica failing in isolation.

## DaemonSet versus a static Pod

A static Pod, a manifest placed directly in a node's kubelet manifest directory, also runs "something on a node," and a kubeadm cluster's own control-plane components run this way. But a static Pod is tied to the one node whose kubelet holds the file and needs host access to change; a DaemonSet is one cluster-wide object the API server reconciles against every qualifying node, managed through `oc` like any resource. For infrastructure that runs everywhere and is managed centrally, the DaemonSet is the choice; the static Pod's niche is bootstrapping the pieces that must run before there's an API server to schedule through.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for node-level operations (DaemonSets, tolerations, host access)
> **Competency:** Run a per-node workload and grant it the SCC its host access requires
> **Drill:** `oc get daemonset node-collector -n patterns -o jsonpath='{.status.desiredNumberScheduled}{" "}{.status.numberReady}'`

> **🤖 Explore with your agent**
>
> "Switch node-collector's updateStrategy to OnDelete, change its image tag, and show me that nothing happens on the node until I delete the Pod. Then explain which SCC a non-root version of this collector would need and why."

## Cleanup

```bash
oc delete -f daemon-service/00-daemonset.yaml -n patterns
```

## Verification: examples/appendix-patterns/daemon-service/

The runnable example deploys `node-collector`, confirms one Pod on CRC's single node with `DESIRED`/`READY` tracking the node count, and works through the two access layers: `restricted-v2` refusing the `hostPath` volume, then the `privileged` SCC with `spc_t` letting the collector actually read the node's `/var/log/pods` (`pod-log-dirs=69`). Full walkthrough in `examples/appendix-patterns/daemon-service/README.md`.
