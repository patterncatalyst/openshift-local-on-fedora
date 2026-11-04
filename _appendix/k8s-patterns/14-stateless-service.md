---
title: "Stateless Service"
order: 14
part: "Behavioral"
description: "Name the default shape most services should take on OpenShift: interchangeable Pods with no stable identity and no per-Pod storage, scaled horizontally through an ordinary Deployment."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- State the three properties that make a service fully stateless
- Explain why a stateless service's Pods can be deleted and replaced with no coordination
- Scale a stateless Deployment horizontally and explain why that needs nothing beyond a replica count
- Recognize when a service that looks stateless isn't, and what breaks first

## Why this matters

Earlier chapters already built and scaled Deployments; this one names a property they assumed without stating. Every Deployment so far rested on the same unstated assumption: that any replica can handle any request, that losing one and getting a new one back changes nothing a client depends on, and that scaling the replica count is purely a capacity decision with no data to reconcile. That assumption has a name, and the next chapter (Stateful Service) is the pattern for workloads where it doesn't hold.

Statelessness isn't something OpenShift enforces. It's a property of the application code, and a Deployment manifest identical to a stateless one can just as easily front a service writing to local disk or holding a client's session in memory, breaking the moment that Pod disappears. The pattern matters because the guarantee only holds when the application honors it. The example uses `payment-service`, built to satisfy all three properties.

## The three properties

```yaml
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: payment-service
          image: image-registry.openshift-image-registry.svc:5000/patterns/payment-service:v1
```

**No per-Pod storage.** No `volumeClaimTemplates`, no Pod-specific `volumeMounts`, nothing a replacement would inherit. Whatever `payment-service` persists goes to Postgres, external to every replica. A Pod writing meaningful data to its own container layer or an `emptyDir` has already broken this, even if the manifest looks identical.

**No stable network identity.** Every replica answers the same Service and selector; nothing addresses the *second* replica specifically. Compare the headless Service and ordinal names the next chapter builds, where a stateful workload's whole mechanism depends on the identity this pattern has none of.

**No in-memory state a client depends on.** A client's second request needn't land on the same replica. This is the easiest to violate by accident (an in-process cache that drifts across replicas, a session held in memory, a rate limiter counting in one Pod's RAM) and the hardest to catch from YAML, because nothing there distinguishes a replica that honors statelessness from one that only looks that way until two clients hit two Pods and get two answers.

![payment-service's Service fronting three interchangeable Pods; one is deleted and replaced with a new identity while the Service keeps answering]({{ "/assets/diagrams/appendix-14-stateless-service.svg" | relative_url }})
*No Pod owns storage or a name the Service depends on, so deleting one and getting a brand-new replacement changes nothing visible from outside.*

## What deleting a replica proves

The cleanest confirmation is to delete a replica and watch the names:

```console
$ oc get pod -l app.kubernetes.io/name=payment-service -n patterns -o name
payment-service-fbb855954-cb77p
payment-service-fbb855954-kd5jb
payment-service-fbb855954-l5bgn
$ oc delete pod payment-service-fbb855954-cb77p -n patterns
$ oc get pod -l app.kubernetes.io/name=payment-service -n patterns -o name
payment-service-fbb855954-gggn2   # new name, new IP
payment-service-fbb855954-kd5jb
payment-service-fbb855954-l5bgn
```

The ReplicaSet notices it's one short and creates a replacement with a new name and IP. Nothing about the deleted Pod's identity transfers, because a ReplicaSet never tracked identity, only a count. A client polling the Service throughout sees only the ordinary momentary dip any rolling change produces: the two survivors keep answering, the new one joins when its readiness probe passes. No coordination between old and new, because there was nothing to coordinate. The new Pod isn't resuming the old one's work; it's one more interchangeable instance of the same template.

## Horizontal scale needs nothing but a number

```console
$ oc scale deployment/payment-service -n patterns --replicas=5
$ oc get pods -n patterns -l app.kubernetes.io/name=payment-service   # 5 Running
$ oc scale deployment/payment-service -n patterns --replicas=3
```

Scaling a stateless Deployment is the operation that most directly earns the pattern its name. No data migration, no rebalancing across the new count, no question of which replica owns which slice: the ReplicaSet creates or deletes Pods from the identical template until the count matches. Compare that to scaling a StatefulSet's per-Pod storage, or Automated Placement's `podAntiAffinity` needing to account for the node count. Statelessness is what turns horizontal scaling into a one-line operation, which is why it's the default to reach for unless a requirement rules it out.

The converse holds: if a workload needs per-replica storage, a stable per-replica identity, or in-memory state a client depends on, reaching for StatefulSet instead of forcing this shape isn't a failure. The two patterns divide a real distinction; neither is strictly better.

## sessionAffinity: an escape hatch, not a contradiction

A Service's default load-balancing picks a different backend per connection, which is what statelessness assumes. `sessionAffinity: ClientIP` routes all traffic from one client IP to the same backend for a window (three hours by default). It's easy to mistake for evidence that a service needs stateful treatment. It's usually reached for to smooth an in-process cache's warm/cold inconsistency or to ease debugging, not because the application requires it. A service that would break with `sessionAffinity` off, a client's second request landing elsewhere and failing, was never stateless; it was relying on affinity to paper over state it should have put somewhere shared. `payment-service` runs with the default (`None`), so the delete-and-replace above proves the claim rather than assuming it.

## Readiness probes matter more here than almost anywhere

The property most likely to be wrong without anyone noticing is the readiness probe. A Service routes only to `Ready` Pods, and a Deployment scaling up five replicas at once relies entirely on each one's readiness probe to hold traffic back until it can serve correctly. That's also what makes `maxUnavailable: 0` rolling updates a real guarantee for this workload. A readiness probe that returns `200` the instant the process accepts connections, before the app finished establishing its connection pool, breaks the "any replica can serve any request" promise, not because the Deployment did anything wrong, but because the one signal meant to gate traffic lied. `startupProbe` is the tool for separating one-time startup cost from ongoing readiness: statelessness is why horizontal scale is cheap, correct probes are why it's also safe.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy and scale applications (horizontal scaling of a stateless workload)
> **Competency:** Recognize a workload with no per-Pod state and scale it with a replica count
> **Drill:** `oc get pod -n patterns -l app.kubernetes.io/name=payment-service -o jsonpath='{.items[*].metadata.name}'` before and after a delete, to compare the name sets

> **🤖 Explore with your agent**
>
> "Add an emptyDir volume to payment-service that writes a per-Pod counter file, delete a replica, and show me what happens to that counter in the replacement compared to what a fully stateless service should look like."

## Cleanup

```bash
oc delete -f stateless-service/01-deployment.yaml -n patterns
oc delete -f stateless-service/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/stateless-service/

The runnable example deploys `payment-service` at three replicas, deletes one to confirm the replacement gets an entirely new identity while the Service keeps answering, then scales to five and back to three with no manifest change beyond the replica count. Full walkthrough in `examples/appendix-patterns/stateless-service/README.md`.
