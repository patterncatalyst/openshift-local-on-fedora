---
title: "Declarative Deployment"
order: 2
part: "Foundational"
description: "Roll a new version out on OpenShift with a Deployment's RollingUpdate and Recreate strategies, verified against a Route with a live curl loop, then compare them with oc rollout status, history, and undo."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what a `Deployment` manages, and why you update the Deployment rather than the Pods
- Tune `maxSurge` and `maxUnavailable` to trade extra capacity against guaranteed availability
- Compare `RollingUpdate` against `Recreate` and state which workloads need the latter
- Use `oc rollout status`, `oc rollout history`, and `oc rollout undo` to drive and reverse a rollout

## Why this matters

A Deployment is a declaration, not a one-time instruction. You don't tell OpenShift "start three Pods now"; you tell it "three Pods matching this template should always exist," and a controller spends the lifetime of that Deployment reconciling reality toward that statement. Change the template, a new image tag, a new environment variable, anything in `spec.template`, and the same controller treats the difference between old and new as work to do.

That reconciliation loop is what makes a rollout safe to automate. `oc set image` doesn't restart Pods directly; it edits the Deployment's desired state, and the controller works out how to get there. Which strategy it uses for "how" is the subject of this chapter, and it's the difference between a release nobody notices and a release that pages someone.

The pattern itself is identical to plain Kubernetes, which is the point worth making: a Deployment is a Deployment on OpenShift, same API, same strategies. What changes is how you watch it, and one thing the manifest has to add. OpenShift gives the Service a Route, so the live curl loop that proves zero-downtime runs through the cluster's own router, and that router needs the Pod to shut down gracefully for the guarantee to actually hold.

## Deployment, ReplicaSet, Pod

A Deployment never manages Pods directly. It manages a `ReplicaSet`, and the ReplicaSet owns the Pods. Every distinct Pod template gets its own ReplicaSet, created fresh and scaled up as the rollout proceeds; the previous template's ReplicaSet isn't deleted when the rollout finishes, it's scaled to zero and kept. After a rollout and an undo, both are visible:

```console
$ oc get rs -n patterns -l app.kubernetes.io/name=shipping-service
NAME                          DESIRED   CURRENT
shipping-service-7bf795f476   0         0
shipping-service-bdc695cb7    3         3
```

That retired ReplicaSet at zero replicas is the entire mechanism behind `oc rollout undo`: a rollback is nothing more than scaling the old ReplicaSet back up and the current one down, using the exact same strategy logic that drove the forward rollout. `revisionHistoryLimit` caps how many of these retired ReplicaSets stick around.

This layering is also why a Deployment's `spec.selector` is immutable after creation: the selector is how the Deployment finds its own ReplicaSets, and changing it under a running rollout would orphan everything already running. Changing the Pod *template* triggers a new ReplicaSet and a new rollout; changing the *selector* is a different operation OpenShift refuses outright.

## RollingUpdate: replace without a gap

The example deploys `shipping-service` at three replicas with an explicit strategy:

```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

`maxSurge` caps how many Pods above the replica count the controller may create at once; `maxUnavailable` caps how many may be missing at once. With `maxSurge: 1` and `maxUnavailable: 0`, a rollout of three replicas can briefly run four Pods but never fewer than three. Two more fields finish the job on OpenShift:

```yaml
spec:
  replicas: 3
  minReadySeconds: 5          # pace the rollout; one step settles before the next
  # ...
      terminationGracePeriodSeconds: 30
      containers:
        - name: shipping-service
          # ...
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "5"]
```

`maxUnavailable: 0` guarantees ready *endpoints*, but it doesn't guarantee that a Pod on its way out stops cleanly. When a Pod is deleted, two things happen roughly at once: it's removed from the Service's endpoints, and it's sent `SIGTERM`. The router is HAProxy, and it reloads its configuration on every endpoint change; if the Pod stops accepting connections before that reload propagates, a client connecting at that instant gets a reset. That is the gap `preStop` closes: the hook runs *after* endpoint removal starts and *before* `SIGTERM`, holding the container open and serving for five seconds while the router converges. `minReadySeconds` spaces the three rolling steps apart so the reloads don't stack.

With those in place, bump the image and run a curl loop against the Route the whole time:

```bash
oc set image deployment/shipping-service -n patterns \
  shipping-service=image-registry.openshift-image-registry.svc:5000/patterns/shipping-service:v2
# in the loop, against https://shipping-service-patterns.apps-crc.testing/health
```

The controller creates one new Pod, waits for it to pass its readiness probe, drains and terminates one old Pod, and repeats. Across 100 requests spanning the rollout, 100 returned `200`, and a second rollout back to `v1` did the same: zero failed requests, zero resets. Drop the `preStop` hook and the same test loses a request or two to connection resets at each endpoint change, which is the difference between "mostly works" and a guarantee.

That readiness wait is the other half of the guarantee. A `RollingUpdate` with no readiness probe isn't safe, because the controller has no signal to wait on and routes traffic to a Pod still initializing. The `readinessProbe` against `/healthz` holds new traffic until a Pod is ready; the `preStop` drain holds old traffic until the router lets go. Together they make `maxUnavailable: 0` a real guarantee rather than a hopeful one.

`oc rollout status` blocks until the rollout finishes, which is what a CI pipeline calls after a deploy. `oc rollout history` lists every revision as an audit trail:

```console
$ oc rollout history deployment/shipping-service -n patterns
REVISION  CHANGE-CAUSE
2         <none>
3         <none>
```

And `oc rollout undo deployment/shipping-service -n patterns` rolls back to the previous revision using the same mechanism, zero-downtime guarantees included, because undo is just another declared-state change to reconcile toward.

![RollingUpdate keeps at least three Pods serving by surging one extra; Recreate drops to zero Pods before the replacement starts]({{ "/assets/diagrams/appendix-02-declarative-deployment.svg" | relative_url }})
*RollingUpdate overlaps old and new Pods to avoid a gap; Recreate tears every replica down before any replacement starts.*

## Recreate: when overlap isn't safe

`RollingUpdate` assumes old and new Pods can coexist. Most stateless HTTP services satisfy that trivially; a few don't, usually because two versions holding an exclusive lock, writing the same non-shared volume, or speaking an incompatible wire protocol would corrupt something. For those, `Recreate` is the correct alternative:

```yaml
spec:
  replicas: 3
  strategy:
    type: Recreate
```

`Recreate` terminates every existing Pod before creating any replacement. There's no `maxSurge` or `maxUnavailable` to tune, because there's no overlap to bound: three old Pods to zero Pods to three new Pods, in that order, and the "zero" step holds until every old Pod has terminated.

Switch the running Deployment to `Recreate` and trigger another rollout, with the same curl loop running. The contrast is immediate and measured: across 100 requests, 75 returned `200` and 25 failed, and the 25 were contiguous, a single unbroken window of about ten seconds where every request failed because there were zero ready Pods behind the Service. The `preStop` drain that made the rolling update seamless can't help here: it only slows how fast each Pod leaves, and `Recreate` tears every Pod down before starting a replacement, so there is nothing left to serve during the gap. That gap isn't a bug in `Recreate`; it's the strategy doing exactly what it promises. The decision to use it belongs to whoever understands the workload's constraint, not to whichever default the manifest inherited.

## Choosing between them

The decision is almost always made by the workload. A stateless HTTP service with a correct readiness probe defaults to `RollingUpdate`: it costs a moment of extra capacity and buys continuous availability. A workload where two versions actively conflict, non-backward-compatible schema migrations, exclusive file locks, singleton processes, needs `Recreate`, and attempting a rolling update anyway just delays the conflict until production instead of catching it at deploy time. There's no scenario where `Recreate` is strictly safer for a stateless service; it only trades downtime for correctness on workloads that need the trade.

## Reading a Deployment's own conditions

`oc rollout status` is convenient, but the signal it reads is already on the Deployment object, as a pair of conditions in `oc describe deployment`. `Progressing` reports whether the rollout is making forward progress and flips to `False` with reason `ProgressDeadlineExceeded` if nothing changes within `spec.progressDeadlineSeconds` (ten minutes by default): a new Pod stuck in `ImagePullBackOff` surfaces here even if nobody is watching. `Available` reports whether enough replicas have been continuously ready for `minReadySeconds` to count as satisfying the availability target; a Pod that flaps resets that clock, which is why a flaky readiness probe is worse than a strict one that just takes longer to pass.

Two more knobs shape a rollout without changing the strategy. `oc rollout pause deployment/shipping-service -n patterns` freezes a `RollingUpdate` mid-flight, useful for holding at one new Pod while watching its metrics; `oc rollout resume` picks it up where it stopped. And `oc rollout undo` accepts `--to-revision=N`: undoing twice doesn't walk two steps back, it alternates between the two most recent revisions, since each undo is itself a new revision. Reaching revision three from revision five needs `--to-revision=3` explicitly.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy and manage applications (update a deployed application, roll back a change)
> **Competency:** Apply rolling and non-rolling update strategies and drive rollouts with `oc`
> **Drill:** `oc rollout history deployment/shipping-service -n patterns --revision=2`

> **🤖 Explore with your agent**
>
> "Add a minReadySeconds of 10 to the shipping-service Deployment, trigger another rolling update, and show me how it changes the pace of the rollout compared to the default of 0."

## Cleanup

```bash
oc delete deployment/shipping-service service/shipping-service route/shipping-service -n patterns
oc delete -f declarative-deployment/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/declarative-deployment/

The runnable example rolls `shipping-service` from `v1` to `v2` under `RollingUpdate` with a `preStop` drain, while a curl loop against the Route records the result (100 of 100 requests succeeded, both directions), checks `rollout history` and `rollout undo`, then switches to `Recreate` and repeats to show the contrast directly (75 of 100, with a contiguous outage while the replica count hit zero). Full walkthrough in `examples/appendix-patterns/declarative-deployment/README.md`.
