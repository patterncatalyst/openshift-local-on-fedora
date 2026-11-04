---
title: "Self Awareness"
order: 17
part: "Behavioral"
description: "Let a container read its own Pod's metadata, identity, and declared resources on OpenShift through the Downward API, as environment variables and as a volume that updates in place."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Inject a Pod's own `metadata`/`status`/`spec` fields into a container with `fieldRef`
- Read a container's own declared requests and limits with `resourceFieldRef`
- Explain why labels and annotations are exposed through a `downwardAPI` volume rather than environment variables
- State what the Downward API exposes and what it leaves out

## Why this matters

A container has no inherent way to know its own Pod's name, which node it landed on, or what CPU limit the scheduler placed it under. None of that is in the image. Every prior chapter passed application configuration explicitly, through `env` and `configMapKeyRef`/`secretKeyRef`, which works for config a human chose. Self Awareness covers a different category: facts the API server already holds about this exact Pod, which a human would otherwise duplicate into a ConfigMap that drifts out of sync the moment the Pod changes.

The Downward API closes that gap: a container reads facts about its own Pod from the Pod object, with no call to the API server and no credential. The mechanism is identical on OpenShift; the one detail to watch is how CPU values are formatted, shown below. This pattern has already appeared in this appendix without being named: the Batch Job chapter's plain Job tagged each report file with `REPORT_TAG` sourced from `metadata.name`, exactly a `fieldRef`, so three concurrent writers never collided on a filename. That was Self Awareness doing real work before the chapter that names it.

## fieldRef: Pod fields as environment variables

```yaml
env:
  - name: POD_NAME
    valueFrom: { fieldRef: { fieldPath: metadata.name } }
  - name: POD_IP
    valueFrom: { fieldRef: { fieldPath: status.podIP } }
  - name: NODE_NAME
    valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
```

Each `fieldPath` names a field on the Pod object: `metadata.name` from its identity, `status.podIP` from a field the kubelet populates once networking is set up, `spec.nodeName` from what the scheduler writes when it places the Pod. The kubelet resolves each once, at container start, and injects it as a plain environment variable:

```console
$ oc exec $POD -n patterns -- env | grep -E 'POD_|NODE_'
POD_NAME=shipping-service-6d9f4fbf7-jpb2k
POD_NAMESPACE=patterns
POD_IP=10.217.0.159
NODE_NAME=crc
```

They sit beside the application's own `PG_HOST` and `SERVICE_SCHEMA`, indistinguishable in form though entirely different in origin. Because they resolve once at start, none update if the field changes later; `status.podIP` never changes for a running Pod, so that's a non-issue here, but it's why a field that *can* change (a label, an annotation) needs the volume form. Only a documented subset of `metadata`, `spec`, and `status` is exposed, and fields of *other* objects (a Node's labels, another Pod's status) are never reachable: the Downward API describes this Pod to itself, not the cluster to anything that asks.

## resourceFieldRef, and a CPU-formatting detail

```yaml
env:
  - name: CPU_REQUEST
    valueFrom:
      resourceFieldRef: { containerName: shipping-service, resource: requests.cpu }
  - name: MEMORY_LIMIT
    valueFrom:
      resourceFieldRef: { containerName: shipping-service, resource: limits.memory }
```

This reads the container's own declared `resources` back out, which matters for an application sizing a thread pool or connection-pool ceiling to what the scheduler promised rather than a hardcoded guess. The formatting has one trap:

```console
$ oc exec $POD -n patterns -- env | grep -E 'CPU_REQUEST|MEMORY_LIMIT'
CPU_REQUEST=1
MEMORY_LIMIT=536870912
```

`MEMORY_LIMIT` is `512Mi` in bytes, as expected. But `CPU_REQUEST=1`, not the `100m` the manifest declared: without a `divisor`, `resourceFieldRef` expresses CPU in whole cores and rounds *up*, so `100m` becomes `1`. To read millicores, set a divisor, which the volume form below does (`divisor: 1m` yields `500` for a `500m` limit). An application reading `CPU_REQUEST` and believing it has a full core when it was allotted a tenth of one is a real, quiet bug; the divisor is how you avoid it.

![A Pod's own metadata, status, spec, and resources flowing into a container as Downward API environment variables and a mounted volume]({{ "/assets/diagrams/appendix-17-self-awareness.svg" | relative_url }})
*fieldRef and resourceFieldRef resolve once into environment variables at start; a downwardAPI volume is the form that keeps updating afterward.*

## The downwardAPI volume: the form that updates

Labels and annotations can change on a running Pod (`oc label`, `oc annotate`) without a restart, and an environment variable fixed at start can't reflect that. The volume form covers it:

```yaml
volumes:
  - name: podinfo
    downwardAPI:
      items:
        - path: labels
          fieldRef: { fieldPath: metadata.labels }
        - path: annotations
          fieldRef: { fieldPath: metadata.annotations }
        - path: cpu_limit
          resourceFieldRef:
            containerName: shipping-service
            resource: limits.cpu
            divisor: 1m
```

Mounted at `/etc/podinfo`, this gives one file per item. `/etc/podinfo/cpu_limit` reads `500` (millicores, from `divisor: 1m`), and the kubelet keeps the files current. Patch an annotation and the file updates in place, with no restart:

```console
$ oc exec $POD -n patterns -- grep owner /etc/podinfo/annotations
patterns.example.com/owner="fulfillment-team"
$ oc annotate pod $POD -n patterns patterns.example.com/owner=logistics-team --overwrite
$ oc exec $POD -n patterns -- grep owner /etc/podinfo/annotations
patterns.example.com/owner="logistics-team"
$ oc get pod $POD -n patterns -o jsonpath='{.status.containerStatuses[0].restartCount}'
0
```

The value changed, zero restarts. It's the one piece of Downward API behavior that keeps updating after the container starts, and the reason labels and annotations are only ever exposed this way rather than as environment variables.

## Why this isn't just another environment variable

`POD_NAME` through the Downward API is categorically different from `SERVICE_SCHEMA` or a `secretKeyRef` value, even though both look identical in the container. The latter are values a human chose and wrote down somewhere, and keeping them accurate is a human's or a GitOps pipeline's job. A Downward API value can't drift out of sync, because it isn't a copy of a fact recorded elsewhere: it's read from the one place the fact lives, when the kubelet constructs the container's environment. There's no stale-ConfigMap equivalent for `POD_IP`, because there's nothing to go stale.

## What the Downward API doesn't do, and projected volumes

The boundary matters, since this is often credited with more than it does. It exposes read-only facts about *this one Pod*; it grants no ability to call the Kubernetes API, list other Pods, or watch anything beyond this Pod's fields. An application that needs broader cluster state needs the API client and a `ServiceAccount` token instead, a different mechanism with different security implications, covered in the Security family. Self Awareness is the smallest, lowest-privilege way to answer "what do I know about myself."

The standalone `downwardAPI` volume here is the clearest introduction, but it's a special case of a `projected` volume, which can combine `downwardAPI`, `configMap`, `secret`, and `serviceAccountToken` sources under one mount. A container reading both `/etc/combined/labels` and `/etc/combined/schema` from one directory never needs to know one came from the Pod's metadata and the other from a ConfigMap; both are just files that update when their source changes. Reach for a projected volume the moment a Pod needs several of these sources under one coherent layout.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications (expose Pod metadata and resources to the container)
> **Competency:** Use the Downward API via `fieldRef`, `resourceFieldRef`, and the volume form
> **Drill:** `oc exec -n patterns $POD -- cat /etc/podinfo/annotations` before and after `oc annotate --overwrite`

> **🤖 Explore with your agent**
>
> "Add a new label to shipping-service's Pod template, redeploy, and show me the difference in /etc/podinfo/labels compared to patching the same label onto an already-running Pod instead."

## Cleanup

```bash
oc delete -f self-awareness/01-deployment.yaml -f self-awareness/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/self-awareness/

The runnable example deploys `shipping-service` with both the environment-variable and volume forms of the Downward API, confirms every `fieldRef`/`resourceFieldRef` value against the manifest (including the `CPU_REQUEST=1` rounding versus the volume's `cpu_limit=500`), then patches a running Pod's annotation to show `/etc/podinfo/annotations` update in place with zero restarts. Full walkthrough in `examples/appendix-patterns/self-awareness/README.md`.
