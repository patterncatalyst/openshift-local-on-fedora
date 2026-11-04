---
title: "Automated Placement"
order: 5
part: "Foundational"
description: "Steer the scheduler on OpenShift with nodeSelector, node and pod affinity, and taints and tolerations, and understand how replica spreading works on a single-node CRC cluster."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Constrain a Pod to nodes carrying a given label with `nodeSelector`
- Write a `nodeAffinity` rule that distinguishes a hard requirement from a soft preference
- Explain what `podAntiAffinity` does, and why it can't fully demonstrate on a single node
- Taint a node to repel Pods by default, and grant a specific Pod a `toleration` to schedule there anyway

## Why this matters

The default scheduler already does real work without help: it ranks every schedulable node by fit, enough CPU and memory, no conflicting port, satisfied node selectors, and picks a good one. For interchangeable replicas of one service on a homogeneous cluster, that default is often enough. Real clusters are rarely that homogeneous. Some nodes have local SSDs and some don't; some sit in one availability zone and some in another; some are reserved for a specific workload tier. Automated Placement is the set of primitives that let a Pod spec describe which of those differences matter to it, instead of leaving every placement decision to chance.

Two motivations run through the four mechanisms. `nodeSelector` and `nodeAffinity` answer "does this node have what I need:" a label, a zone, a hardware feature. `podAntiAffinity` answers a different question: "should I avoid running near another instance of myself," the foundation of spreading replicas for availability. Taints and tolerations flip the direction of control: a node declares that it repels Pods by default, and only Pods that explicitly tolerate the taint may land there.

CRC is single-node: one machine, named `crc`, that is control plane and worker at once. That shapes this chapter. Three of the four mechanisms demonstrate fully against one node, because they're about whether a Pod may land on a given node at all. The fourth, `podAntiAffinity`, is about spreading across nodes, and with only one node its effect is visible but its payoff is not; this chapter shows what it does here and explains what it would do on a cluster with room to spread. Placement is independent of what a container runs, so the examples use a minimal UBI placeholder that just sleeps; the scheduling outcome is identical to a real workload's.

## nodeSelector

The simplest constraint is a direct label match. A placeholder standing in for `shipping-service` requests a node labeled for a fulfillment zone:

```yaml
spec:
  nodeSelector:
    zone: warehouse-a
```

Apply it before any node carries that label and the Pod goes `Pending`. Label the `crc` node and the next scheduling attempt succeeds, with no change to the Pod spec:

```console
$ oc get pods -n patterns -l app.kubernetes.io/name=shipping-placeholder
NAME                                    READY   STATUS    AGE
shipping-placeholder-545495f89c-8nzdb   0/1     Pending   5s
$ oc label node crc zone=warehouse-a
$ oc get pods -n patterns -l app.kubernetes.io/name=shipping-placeholder
NAME                                    READY   STATUS    AGE
shipping-placeholder-545495f89c-8nzdb   1/1     Running   8s
```

`nodeSelector` supports only exact key/value matches, combined with implicit AND. For ranges, set membership, or a mix of required and preferred conditions, the next mechanism has that vocabulary.

## Node affinity: required versus preferred

A placeholder for `order-service` requires a node labeled for its tier, and softly prefers a node with SSD storage:

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: tier
              operator: In
              values: ["fulfillment"]
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 10
        preference:
          matchExpressions:
            - key: disktype
              operator: In
              values: ["ssd"]
```

The required rule behaves like `nodeSelector` with a richer expression language (`In`, `NotIn`, `Exists`, `Gt`, `Lt`): unsatisfied, the Pod stays `Pending`. Label the node `tier=fulfillment` and it schedules. The preferred rule is different in kind: a scoring hint. The scheduler adds `weight` to a node's score for each preference it satisfies, then picks the best-scoring node among those meeting every required rule. A preference nothing can satisfy, like `disktype=ssd` on a node without that label, doesn't block scheduling at all; it just has no effect. On a single node the preference has nothing to choose between, which is exactly why it never blocks: it's advisory by design.

The `IgnoredDuringExecution` suffix on both rules means neither is re-evaluated once the Pod is running: relabel a node out of compliance afterward and OpenShift won't evict the Pod to fix the mismatch. Affinity governs placement, not continuous enforcement.

![nodeSelector and nodeAffinity place a Pod on a labeled node; podAntiAffinity needs a second node to spread; a taint repels Pods that lack a matching toleration]({{ "/assets/diagrams/appendix-05-automated-placement.svg" | relative_url }})
*On single-node CRC: label matches place Pods on the one node, a taint repels Pods without a toleration, and podAntiAffinity leaves a second replica Pending for lack of a second node.*

## Pod anti-affinity: spreading replicas, and the single-node limit

Node affinity steers a Pod toward hardware. Pod anti-affinity steers a Pod relative to *other Pods*, the mechanism behind a common production requirement: don't put every replica of a service on the same node, so a single node failure can't take the whole service down. A two-replica Deployment sets a required rule against its own label:

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app.kubernetes.io/name: shipping-ha-placeholder
        topologyKey: kubernetes.io/hostname
```

`topologyKey: kubernetes.io/hostname` makes the node the unit of separation: no two matching Pods may share a node. On a multi-node cluster the two replicas land one per node. On single-node CRC, the rule can only be satisfied once:

```console
$ oc get pods -n patterns -l app.kubernetes.io/name=shipping-ha-placeholder \
    -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName
NAME                                       STATUS    NODE
shipping-ha-placeholder-5555c4f8dc-m2cgm   Running   crc
shipping-ha-placeholder-5555c4f8dc-mlnbw   Pending   <none>
# FailedScheduling: 1 node(s) didn't match pod anti-affinity rules
```

The second replica stays `Pending`, and that's the rule working, not failing: with `requiredDuringSchedulingIgnoredDuringExecution` the scheduler won't bend it, and there's no second node to occupy without breaking it. Swap in `preferredDuringSchedulingIgnoredDuringExecution` and the second replica would schedule on `crc` anyway, doubling up rather than waiting, trading a strict guarantee for best effort. Which is correct depends on whether a replica `Pending` is worse than two replicas sharing a node; for availability-sensitive services on a real multi-node cluster, the required rule is almost always right. This is the one pattern in the family whose benefit a single-node cluster can describe but not deliver: the manifest is identical to what you'd run in production, and the only thing missing is a second node.

## Taints and tolerations

Every mechanism so far has a Pod pulling itself toward a node. Taints work the opposite way: a node repels Pods by default, and only a Pod with a matching toleration is allowed back. Taint the one node, carefully, since it's the only one:

```bash
oc adm taint node crc dedicated=fulfillment:NoSchedule
```

Two otherwise-identical placeholders, both with `nodeSelector: {zone: warehouse-a}`, differ only in that one tolerates the taint:

```yaml
tolerations:
  - key: dedicated
    operator: Equal
    value: fulfillment
    effect: NoSchedule
```

The result is immediate: the tolerating Pod runs, the intolerant one stays `Pending`. The taint overrides the node-selector match entirely, because `NoSchedule` repels every Pod by default regardless of what else matches. That asymmetry is the design: a selector or affinity rule only says what a Pod wants, and many Pods might want the same node; a taint says what a node refuses, and only an explicit toleration is an exception. Dedicating a node to one tier is a property of the node, enforced regardless of how many Pods come looking.

On single-node CRC there's an operational caution: tainting the only node with `NoSchedule` repels every new Pod that doesn't tolerate it, so untaint it the moment the demonstration is done, or the next workload you deploy sits `Pending` for a reason that has nothing to do with its own manifest:

```bash
oc adm taint node crc dedicated=fulfillment:NoSchedule-
```

`NoSchedule` only blocks new scheduling; it doesn't evict running Pods. `NoExecute`, the strictest of the three effects, evicts already-running Pods that don't tolerate it. A toleration can carry `tolerationSeconds` against a `NoExecute` taint to stay for a bounded grace period, useful for riding out the automatic taints OpenShift applies to a node that's gone unreachable without an immediate reschedule.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Control pod scheduling (node selectors, affinity, taints and tolerations)
> **Competency:** Direct where Pods run and keep specific Pods off, or on, specific nodes
> **Drill:** `oc get pods -n patterns -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName`

> **🤖 Explore with your agent**
>
> "Explain how this chapter's podAntiAffinity Deployment would schedule on a three-node cluster, and rewrite it using topologySpreadConstraints with maxSkew 1 across a zone label instead."

## Cleanup

```bash
oc delete deployment -n patterns -l app.kubernetes.io/name=shipping-placeholder
oc delete -n patterns -f automated-placement/02-node-affinity.yaml \
  -f automated-placement/03-pod-anti-affinity.yaml -f automated-placement/04-toleration.yaml
oc adm taint node crc dedicated=fulfillment:NoSchedule-   # if still applied
oc label node crc zone- tier-
```

## Verification: examples/appendix-patterns/automated-placement/

The runnable example works all four mechanisms against the single `crc` node: `nodeSelector` and `nodeAffinity` go `Pending` until the matching label is added, `podAntiAffinity` leaves the second replica `Pending` for lack of a second node (the single-node view of replica spreading), and a taint keeps the intolerant placeholder `Pending` while the tolerating one runs. Full walkthrough, including the node labels and the untaint step, in `examples/appendix-patterns/automated-placement/README.md`.
