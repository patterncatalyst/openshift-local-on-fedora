---
title: "Namespace Governance"
order: 32
part: "Operations"
description: "The namespace-level complement to a Pod's own resource declarations: ResourceQuota caps a namespace's total, LimitRange defaults and bounds every container, and OpenShift's ClusterResourceQuota extends the cap across projects."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Cap a namespace's total pod count, requests, and limits with a `ResourceQuota`, and read `oc describe resourcequota` to see used against hard
- Set a `LimitRange`'s `default`, `defaultRequest`, `min`, and `max` so every container gets sane values even when its own manifest doesn't specify any
- Explain the order LimitRange and ResourceQuota admission run in, and why that order lets a `limits.cpu` quota coexist with a container that sets no CPU limit
- Relate ResourceQuota to OpenShift's `ClusterResourceQuota` and the default quota a project template can apply

## Why this matters

The Predictable Demands chapter covers requests, limits, and priority at the level of one Pod. Nothing there stops every team sharing a cluster from each declaring individually reasonable requests that together exceed what the cluster has, or stops one careless manifest from omitting resource declarations and quietly consuming whatever's left. That's a cluster-administrator problem, and it's the gap `ResourceQuota` and `LimitRange` close: the first caps what a namespace can consume in total, the second bounds and defaults what any single container inside it can ask for. On OpenShift this is doubly relevant, because a project created from a customized project template can carry a default quota and limit range from the moment it exists.

The example reuses two shapes from Predictable Demands (`shipping-service`'s requests and limits, and the `patterns-high-priority` PriorityClass) so the contrast with namespace-level governance is concrete: the same Pod, the same numbers, now admitted or rejected against rules nobody wrote into its own Deployment.

## ResourceQuota: capping the namespace total

A `ResourceQuota` caps aggregate consumption across every Pod in the namespace:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: patterns-quota
  namespace: patterns
spec:
  hard:
    pods: "3"
    requests.cpu: "1"
    requests.memory: "1Gi"
    limits.cpu: "2"
    limits.memory: "2Gi"
```

`pods` counts every Pod; the cpu/memory dimensions sum the declared values across every container. This quota sets `pods` tight (3: the disposable Postgres plus two `shipping-service` replicas) and the resource dimensions generously, so the failure that actually bites is the pod count. Scaling to a third replica never reaches `Pending`, because no Pod object is created at all: the ReplicaSet controller's attempt is rejected by quota admission, and the rejection is an **event on the ReplicaSet**, not on any Pod:

```console
$ oc scale deployment/shipping-service -n patterns --replicas=3
$ oc get events -n patterns --field-selector reason=FailedCreate
Error creating: pods "shipping-service-...-995vx" is forbidden: exceeded quota:
patterns-quota, requested: pods=1, used: pods=3, limited: pods=3
```

This is the detail worth carrying out of this section: a quota violation is a different *kind* of failure than the hard-requirement failures Predictable Demands covers. A missing ConfigMap still creates a Pod that sits visibly in `CreateContainerConfigError`, reporting its own problem; a quota violation prevents the Pod object from existing, so there's nothing to `oc describe pod`, and the only trail is the controller's event and `oc describe resourcequota`, which shows `Used` against `Hard` for every dimension.

One consequence surprises people: declaring `requests.cpu` or `limits.cpu` in a quota means every new Pod must specify that dimension, or be rejected. A container with no CPU request is inadmissible the moment a `requests.cpu` quota exists. `shipping-service`'s Deployment, following Predictable Demands, sets no CPU *limit* by design. Reconciling that with a `limits.cpu` quota is exactly what the LimitRange provides.

## LimitRange: defaults, minimums, and maximums

A `LimitRange` operates one level down, on individual containers, doing two jobs: supplying a value a container didn't specify, and rejecting one that falls outside an allowed band.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: patterns-limits
  namespace: patterns
spec:
  limits:
    - type: Container
      defaultRequest: { cpu: 50m, memory: 128Mi }
      default: { cpu: 200m, memory: 256Mi }
      min: { cpu: 25m, memory: 64Mi }
      max: { cpu: 500m, memory: 512Mi }
```

`defaultRequest` and `default` are the mutating half: a container that omits a request or limit gets these stamped in at admission, before the object is stored. A Pod applied with no `resources` block comes back fully populated:

```console
$ oc apply -n patterns -f namespace-governance/06-pod-no-resources.yaml
$ oc get pod inventory-defaults-check -n patterns -o jsonpath='{.spec.containers[0].resources}'
{"limits":{"cpu":"200m","memory":"256Mi"},"requests":{"cpu":"50m","memory":"128Mi"}}
```

Nothing in that Pod's manifest set those numbers. This also answers the question the quota left open: `shipping-service` sets a CPU request but no CPU limit, and the quota requires one. The LimitRange's `default.cpu: 200m` supplies it, and does so **before** quota admission runs, LimitRange is a mutating admission step, ResourceQuota a validating one, and OpenShift always runs mutating admission first. By the time the quota check inspects the Pod, the injected CPU limit is already there to count. Confirmed on the running Deployment:

```console
$ oc get pod -n patterns -l app.kubernetes.io/name=shipping-service \
    -o jsonpath='{.items[0].spec.containers[0].resources.limits.cpu}'
200m
```

`min` and `max` are the validating half, applied to the final spec whether a value was author-chosen or LimitRange-defaulted. A container asking for more than `max` is rejected synchronously, no Pod created:

```console
$ oc apply -n patterns -f namespace-governance/07-pod-over-max.yaml
Error from server (Forbidden): ... maximum cpu usage per Container is 500m, but limit is 600m
```

That rejection happens as part of the `oc apply` call itself, with no controller retry loop, because there's no object for a controller to retry. Compare the quota pod-count rejection above, which surfaced as a *ReplicaSet* event because a Deployment's controller does retry: a bare Pod applied directly against a tight LimitRange fails as synchronously as the quota rejection does when nothing stands between the apply and the admission chain.

![A namespace with a ResourceQuota capping totals and a LimitRange defaulting and bounding each container, with ClusterResourceQuota extending the same idea across projects and PriorityClass deciding order underneath]({{ "/assets/diagrams/appendix-32-namespace-governance.svg" | relative_url }})
*ResourceQuota counts and caps; LimitRange defaults and bounds; PriorityClass decides who wins when either is tight.*

## The OpenShift extensions: ClusterResourceQuota and project defaults

Two OpenShift-specific pieces sit around the standard objects. A **ClusterResourceQuota** caps aggregate consumption across *multiple* projects at once, selected by an annotation or label (for example, every project owned by one team), something a per-namespace `ResourceQuota` can't express. Each selected project sees its share through `oc describe AppliedClusterResourceQuota`, and the cluster-wide total is enforced across all of them together. The second piece is the **project template**: a cluster administrator can customize the template `oc new-project` uses so that every new project is born with a default `ResourceQuota` and `LimitRange` already applied, which is how an organization makes governance the default rather than something each team remembers to add. Neither is installed in this example (both need cluster-admin setup beyond the chapter's scope), but both are the reason namespace governance on OpenShift is usually an administrator's standing policy, not a per-project afterthought.

## PriorityClass, again: what quota and limits don't decide

`ResourceQuota` and `LimitRange` both answer "how much." Neither answers "who first," and that question doesn't go away when a namespace is exactly full. If the quota is full (as `pods: "3"` is, once Postgres and two replicas run) and a higher-priority workload needs to land, quota alone offers no mechanism to make room: it only says yes or no to a new Pod, never which existing one should go. That's still `PriorityClass`'s job, unchanged from Predictable Demands: `patterns-high-priority`'s `value: 1000000` makes the scheduler favor a Pod carrying it and makes the kubelet's node-pressure eviction consider priority before QoS class. A `ResourceQuota` can optionally be scoped to a `PriorityClass` via a `scopeSelector`, granting a generous quota to high-priority workloads and a tighter one to everything else. The three layer cleanly: ResourceQuota caps the namespace, LimitRange bounds and defaults each container, PriorityClass decides order when either runs out of room.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure resource limits and quotas (govern a project's consumption)
> **Competency:** Create and use ResourceQuota and LimitRange, relate them to a Pod's PriorityClass, and know ClusterResourceQuota for multi-project caps
> **Drill:** `oc describe resourcequota patterns-quota -n patterns` (read Used against Hard, then predict whether the next apply succeeds before running it)

> **🤖 Explore with your agent**
>
> "Add a ResourceQuota scopeSelector that applies a separate, tighter quota only to Pods without the patterns-high-priority PriorityClass, then show me a high-priority shipping-service Pod still admitted after the unscoped quota alone would have rejected it."

## Cleanup

```bash
oc delete -n patterns -f namespace-governance/05-deployment.yaml -f namespace-governance/06-pod-no-resources.yaml \
  -f namespace-governance/04-configmap.yaml -f namespace-governance/00-postgres.yaml \
  -f namespace-governance/03-limitrange.yaml -f namespace-governance/02-resourcequota.yaml --ignore-not-found
oc delete -f namespace-governance/01-priorityclass.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/namespace-governance/

The runnable example applies the quota and limit range before any workload, deploys `shipping-service` at two replicas (exactly filling the pod quota alongside Postgres, confirmed `3/3`), shows a third replica rejected with a `FailedCreate` event on the ReplicaSet, then applies one Pod with no resources (LimitRange defaults land: `cpu 200m / memory 256Mi` limits) and one over the max (rejected: `maximum cpu usage per Container is 500m`). The running Deployment's injected `limits.cpu: 200m` confirms LimitRange runs before quota. All confirmed on CRC. Full walkthrough in `examples/appendix-patterns/namespace-governance/README.md`.
