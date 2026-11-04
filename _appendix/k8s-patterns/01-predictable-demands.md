---
title: "Predictable Demands"
order: 1
part: "Foundational"
description: "Declare what a container needs to run on OpenShift: CPU and memory requests and limits under restricted-v2, a PriorityClass, and the ConfigMaps and PersistentVolumeClaims it can't start without."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Set CPU and memory requests and limits on a container, and explain what each number bounds
- Write a Deployment that satisfies `restricted-v2` and let OpenShift assign the runtime UID
- Assign a Pod a `PriorityClass` and explain how it changes scheduling and eviction order
- Diagnose a Pod stuck in `Pending` or `CreateContainerConfigError` from a missing ConfigMap or PersistentVolumeClaim

## Why this matters

A container that doesn't say how much CPU and memory it needs is a container the scheduler is guessing about. Pack enough unguessed Pods onto a node and one of two things happens: the node runs out of memory and the kernel's OOM killer picks a victim, or CPU contention turns every Pod's latency unpredictable at once. Neither failure shows up in a code review. Both show up in production.

Predictable Demands is the first pattern because everything else depends on it. A rolling update assumes the scheduler can place a replacement Pod somewhere. Autoscaling assumes a replica's resource footprint is known ahead of time. None of that works if the Pods already running haven't told the scheduler what they cost.

On OpenShift the pattern carries one extra obligation the plain-Kubernetes version doesn't. A Pod has to satisfy the `restricted-v2` Security Context Constraint before it is admitted at all, so declaring demands and declaring a security posture happen in the same manifest. The pattern has three parts: declare CPU and memory requests and limits on every container, use a `PriorityClass` to tell the scheduler and the kubelet's eviction logic which Pods matter more under pressure, and treat ConfigMaps and PersistentVolumeClaims as hard requirements a Pod refuses to start without.

## Requests and limits, under restricted-v2

`shipping-service`, the data mesh's fulfillment data product, ships as a plain FastAPI container with no resource declarations of its own: the manifest adds them. The example's `04-deployment.yaml` sets both the demands and the security context OpenShift requires:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 192Mi
  limits:
    memory: 512Mi
securityContext:
  allowPrivilegeEscalation: false
  runAsNonRoot: true
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

There is no `runAsUser`. That absence is the point. The deploying chapter showed that `restricted-v2` assigns each Pod a UID from the project's range, and an image built to run as an arbitrary non-root user works under whatever it picks. Apply the Deployment and read back the UID OpenShift chose:

```console
$ oc get pod -n patterns -l app.kubernetes.io/name=shipping-service \
    -o jsonpath='{.items[0].spec.containers[0].securityContext.runAsUser}'
1000650000
$ oc get ns patterns -o jsonpath='{.metadata.annotations.openshift\.io/sa\.scc\.uid-range}'
1000650000/10000
```

The injected UID is the low end of the project's `1000650000/10000` range, and the admitting SCC is `restricted-v2` (visible as the `openshift.io/scc` annotation on the Pod). The container never asked for a UID; the platform supplied one.

A **request** is what the scheduler reserves. When the scheduler decides which node has room, it looks at each node's allocatable capacity minus the requests already placed there, never at actual usage. A **limit** is what the kernel enforces once the container is running. Exceed the memory limit and the cgroup controller kills the process with an out-of-memory error, visible as `OOMKilled`. Exceed a CPU limit and the container is throttled, not killed.

The memory limit here is 512Mi, over double the 192Mi request, and there is no CPU limit at all. That combination is deliberate. A CPU limit throttles a container even when the node has idle cores sitting next to it, because CFS bandwidth accounting works per-container, not per-node; a memory limit protects the node from a single leaking process without that downside. Requests close to what the service needs, a memory limit for safety, no CPU limit: a common, well-reasoned production default.

The two numbers also decide the Pod's **Quality of Service class**, which never appears in the manifest but governs eviction order. Requests below limits earns `Burstable`:

```console
$ oc get pod -n patterns -l app.kubernetes.io/name=shipping-service \
    -o jsonpath='{.items[0].status.qosClass}'
Burstable
```

If the node runs short on memory, the kubelet evicts `BestEffort` Pods (no requests or limits) first, then `Burstable`, and only evicts `Guaranteed` Pods (requests equal to limits on every resource) as a last resort.

## PriorityClass

Quality of Service decides eviction order inside a class; `PriorityClass` decides which Pods get first claim on a node at all. The example's `01-priorityclass.yaml` defines one:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: patterns-high-priority
value: 1000000
globalDefault: false
```

`value` is an arbitrary integer; higher wins. The Deployment's Pod template sets `priorityClassName: patterns-high-priority`, and the running Pod carries it:

```console
$ oc get pod -n patterns -l app.kubernetes.io/name=shipping-service \
    -o jsonpath='{.items[0].spec.priority}'
1000000
```

This does two things. If the scheduler can't fit every pending Pod, it schedules higher-priority Pods first. And if a node is critically short on resources, the kubelet's node-pressure eviction considers priority ahead of QoS class: a `Guaranteed` Pod at default priority can be evicted before a `Burstable` Pod at high priority, because priority is checked first. In a fulfillment system that's the right order: a shipping confirmation late by thirty seconds is a worse outage than a batch report late by an hour, and the PriorityClass encodes that judgment once, in one manifest. OpenShift ships its own system priority classes (`system-cluster-critical` and `system-node-critical`) for platform Pods; an application class sits well below those, which is why `value: 1000000` is high among workloads yet never competes with the control plane.

![A ConfigMap and a PersistentVolumeClaim feed a Pod as hard requirements, the scheduler applies its PriorityClass, and restricted-v2 injects the runtime UID]({{ "/assets/diagrams/appendix-01-predictable-demands.svg" | relative_url }})
*A Pod with declared requests and limits, gated on a ConfigMap and a PersistentVolumeClaim, scheduled under a PriorityClass, and admitted under restricted-v2 with an injected UID.*

## Hard requirements: ConfigMap and PersistentVolumeClaim

The third part of the pattern is about sequencing. `shipping-service` reads its Postgres schema name from a `SERVICE_SCHEMA` environment variable wired to a ConfigMap key, and mounts a PersistentVolumeClaim. Apply the Deployment before either exists and the two failures look different, because they are checked at different stages.

The PVC is checked first, during scheduling. Apply the Deployment with no claim and the Pod never schedules:

```console
$ oc get pods -n patterns -l app.kubernetes.io/name=shipping-service
NAME                                READY   STATUS    RESTARTS   AGE
shipping-service-858c857957-mtck6   0/1     Pending   0          6s
$ oc get events -n patterns | grep FailedScheduling
Warning   FailedScheduling   persistentvolumeclaim "shipping-data" not found
```

Create the claim and the Pod schedules, but now the container can't start, because the ConfigMap it references is still missing:

```console
$ oc apply -f 03-pvc.yaml
$ oc get pods -n patterns -l app.kubernetes.io/name=shipping-service
NAME                                READY   STATUS                       RESTARTS   AGE
shipping-service-858c857957-mtck6   0/1     CreateContainerConfigError   0          24s
$ oc describe pod -n patterns -l app.kubernetes.io/name=shipping-service | grep configmap
Error: configmap "shipping-config" not found
```

The kubelet can schedule a Pod whose environment it can't yet populate, but it can't start the container until every `configMapKeyRef` and `secretKeyRef` resolves. Apply the ConfigMap and the container starts, passes its startup probe, and reaches `Ready`.

The PVC also shows a CRC-specific detail. The claim sets no `storageClassName`, so it uses CRC's default class, `crc-csi-hostpath-provisioner`, whose binding mode is `WaitForFirstConsumer`: the claim stays `Pending` until a Pod that mounts it is scheduled, then binds. That is why creating the claim after the Deployment works cleanly, the Pod is the first consumer. The bound volume also reports the provisioner's full backing capacity rather than the 64Mi requested:

```console
$ oc get pvc shipping-data -n patterns
NAME            STATUS   CAPACITY   STORAGECLASS                   AGE
shipping-data   Bound    99Gi       crc-csi-hostpath-provisioner   10s
```

Both failure modes are visible, not silent: a missing ConfigMap or PVC is cluster state the Pod correctly refuses to paper over. The alternative, a container that falls back to a hardcoded schema name or writes to ephemeral storage when the claim isn't bound, hides a misconfiguration until it causes a data problem downstream, harder to trace back.

## Comparing requests against actual usage

Declaring requests is half the job; the other half is checking whether the numbers still match reality once the service has run under load. On most clusters `oc adm top pod` reads live usage from the metrics API and prints it next to each Pod. CRC is different: it disables cluster monitoring by default to save resources, so the `metrics.k8s.io` API is not served and the command reports it:

```console
$ oc adm top pod -n patterns -l app.kubernetes.io/name=shipping-service
error: Metrics API not available
```

Enable monitoring with `crc config set enable-cluster-monitoring true` (then `crc stop && crc start`), budgeting the extra memory it needs, and `oc adm top` works the same as on any cluster. Without it, reason about requests from the limit and the `OOMKilled` signal instead: a container repeatedly `OOMKilled` almost always traces to a memory limit below the process's real working set, shown in `oc describe pod` as `Last State: Terminated, Reason: OOMKilled`. The fix is rarely cleverness in the application; it's raising the limit, and the request with it so the scheduler keeps placing the Pod somewhere that can support it.

Everything here declares demands at the Pod level. A `LimitRange` does the equivalent per project: a default request and limit every container inherits if its own manifest omits one, plus a floor and ceiling any explicit value must stay inside. A `ResourceQuota` caps the project's total consumption. Both are a cluster operator's concern layered on top of the per-workload concern this chapter covers, and both are DO280 objectives in their own right.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for reliability (resource requests and limits, quotas and limit ranges)
> **Competency:** Define a container's resource requirements and reference a ConfigMap or PersistentVolumeClaim as a dependency
> **Drill:** `oc set resources deployment/shipping-service -n patterns --requests=cpu=150m,memory=256Mi --limits=memory=768Mi`

> **🤖 Explore with your agent**
>
> "Add a LimitRange to the patterns project that sets default CPU and memory requests for any container that omits them, then show me a Pod scheduled without explicit resources to confirm the default applied."

## Cleanup

```bash
oc delete -f 04-deployment.yaml -f 03-pvc.yaml -f 02-configmap.yaml -f 00-postgres.yaml -n patterns
oc delete -f 01-priorityclass.yaml
```

## Verification: examples/appendix-patterns/predictable-demands/

The runnable example applies the Deployment in the wrong order first, to surface both the `Pending` scheduling failure and the `CreateContainerConfigError`, then resolves each and confirms the Pod reaches `Ready` with `Burstable` QoS, the declared priority, and an injected `restricted-v2` UID. The shared Postgres runs under a ServiceAccount bound to the `nonroot-v2` SCC, since its image keeps the pinned UID 70. Full walkthrough in `examples/appendix-patterns/predictable-demands/README.md`.
