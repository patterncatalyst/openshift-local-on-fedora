---
title: "Singleton Service"
order: 13
part: "Behavioral"
description: "Protect a single-instance service from voluntary disruption on OpenShift with a PodDisruptionBudget, and learn exactly which operations it governs and which it doesn't."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain why a service might run at `replicas: 1` by design instead of being made redundant
- Set `minAvailable` or `maxUnavailable` on a `PodDisruptionBudget` and explain the difference
- Distinguish voluntary disruption (the Eviction API) from a direct Pod delete and from a node crash
- Read a PDB's `ALLOWED DISRUPTIONS` to tell whether it currently has room to give

## Why this matters

Most of this appendix assumes a service should be made redundant: the next chapter treats interchangeable replicas as the default, and Automated Placement spread them across nodes for exactly that reason. Some workloads can't take that shape: a process holding an exclusive lock, a leader-elected controller where one instance may act at a time, a legacy component never built to run more than one copy. For those, `replicas: 1` isn't a temporary state to fix; it's the design, and the cost is that the one Pod is a single point of failure.

Singleton Service protects that one Pod from the category of disruption OpenShift itself might cause: a cluster operator draining a node, an autoscaler shrinking the node pool, a descheduler rebalancing. None are bugs, yet each can remove the one Pod a singleton can't lose without attention. `PodDisruptionBudget` tells those actors "not this one, not right now." The example uses `shipping-service` at `replicas: 1` as the singleton stand-in; the pattern is about the PDB, not the service.

## minAvailable and maxUnavailable

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: shipping-service-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: shipping-service
```

A PDB takes exactly one of two mutually exclusive fields. `minAvailable` is a floor: at least this many matching Pods must remain available through any voluntary disruption, as an absolute number or a percentage. `maxUnavailable` is a ceiling: at most this many may become unavailable at once. For a single-replica singleton the two are identical (`minAvailable: 1` and `maxUnavailable: 0` both mean "this Pod may never be voluntarily removed"); `minAvailable: 1` reads more directly as "this Pod must survive."

For a multi-replica service wanting singleton-adjacent protection (a 5-replica Deployment that tolerates losing one at a time but never two), `maxUnavailable: 1` is more natural, since `minAvailable` would need recalculating as the replica count changed. Neither field loosens on its own as replicas scale: a `maxUnavailable: 0` PDB on a service scaled from 1 to 10 still permits zero voluntary disruptions, because it's an absolute rule, not one that happened to hold at one count.

## Reading ALLOWED DISRUPTIONS

```console
$ oc get pdb shipping-service-pdb -n patterns
NAME                   MIN AVAILABLE   ALLOWED DISRUPTIONS   CURRENT HEALTHY
shipping-service-pdb   1               0                     1
```

`ALLOWED DISRUPTIONS` is the controller's live computation: given the current healthy matching Pods and the budget, how many more could be voluntarily removed right now without violating it. With one healthy replica and `minAvailable: 1`, that's `0`: no room, so any voluntary-disruption request will be refused until the budget changes or more healthy replicas appear. It recalculates continuously; a PDB is a live constraint checked at each request, not evaluated once at creation.

![An Eviction API request against shipping-service's single replica blocked by its PodDisruptionBudget, contrasted with a direct pod delete that bypasses it entirely]({{ "/assets/diagrams/appendix-13-singleton-service.svg" | relative_url }})
*The PDB governs the Eviction API specifically; a direct oc delete pod never consults it.*

## Voluntary disruption: the Eviction API

A PDB's protection is narrower than "nothing can remove this Pod," and the boundary is worth knowing precisely. `oc adm drain`, an autoscaler scaling a node down, and a descheduler rebalancing all go through one path: a `POST` to the Pod's `eviction` subresource, which the API server checks against every matching PDB before honoring. Against the single Pod with `ALLOWED DISRUPTIONS: 0`:

```console
$ oc create --raw "/api/v1/namespaces/patterns/pods/${POD}/eviction" -f - <<EOF
{"apiVersion":"policy/v1","kind":"Eviction","metadata":{"name":"${POD}","namespace":"patterns"}}
EOF
Error from server (TooManyRequests): Cannot evict pod as it would violate the pod's disruption budget.
```

A `429`, naming the budget directly. `oc adm drain` on a node hosting this Pod reports the identical failure, because it issues the same eviction request and respects the same refusal: the drain stalls there specifically, with the error naming the PDB, instead of succeeding and taking the singleton down with the rest of the node. On single-node CRC you don't actually run the drain, draining the only node would evict everything, but the eviction-request refusal above is exactly what a drain hits when it reaches a PDB-protected Pod.

## Direct delete bypasses the budget entirely

```console
$ oc delete pod "$POD" -n patterns
pod "shipping-service-69444ff647-p8tkk" deleted
# ~1s, no 429, and the Deployment immediately starts a replacement
```

`oc delete pod` calls the ordinary delete endpoint, not the eviction subresource, and a PDB only ever intercepts evictions: it was never wired into the plain delete path, because plain delete isn't the disruption a PDB guards against. The distinction is practical: a PDB protects a singleton against automated cluster-maintenance tooling making an independent decision to remove it, not against a human or controller explicitly deleting that specific Pod. The Deployment replacing the deleted Pod is the ordinary reconciliation this appendix has relied on throughout; the PDB has no opinion about that cycle, only about whether the removal came through the Eviction API.

This also means a PDB is not resilience against *involuntary* disruption: a node crash, a kubelet failure, a kernel panic. None go through the eviction path; they take the Pod down regardless, and the PDB can't prevent or delay it. A PDB's whole domain is the one category it was built for: automated, voluntary, API-mediated removal.

## drain --force and when to remove the singleton instead

`oc adm drain` normally respects a PDB, stalling on a node hosting a singleton it can't evict. `--force` (with `--delete-emptydir-data`) is the explicit, human-initiated override for a planned maintenance window: it falls back to a direct delete for any Pod the Eviction API refuses, after trying the polite path first. That's the right way to plan around a singleton's protection on a known schedule, rather than deleting the PDB (which would stop protecting the Pod from every *other* unplanned disruption in the meantime).

When even a planned override's brief outage is unacceptable, the fix isn't protecting the singleton harder, it's removing the singleton: leader election, multiple replicas with one active at a time and the others ready to take over the instant the active one disappears, voluntarily or not. That's a larger undertaking (a coordination mechanism, typically a `Lease`, and application code that takes part in the handover), and the right escalation specifically when "survives an unplanned node failure in seconds" becomes the requirement rather than "protected from planned maintenance." Recognizing which a workload needs, and not reaching for leader election when a PDB's narrower guarantee covers the case, is part of applying this pattern.

A PDB also matches on labels, not a Deployment name: the same selector would apply to a StatefulSet or unmanaged Pods carrying the label, which is why `oc get pdb` never names the workload it protects, only a selector and a count.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for reliability (protect availability during disruption)
> **Competency:** Configure a PodDisruptionBudget and distinguish voluntary from involuntary disruption
> **Drill:** `oc get pdb shipping-service-pdb -n patterns -o jsonpath='{.status.disruptionsAllowed}'`

> **🤖 Explore with your agent**
>
> "Scale shipping-service to 2 replicas without changing the PDB, try the Eviction API against one of them, and show me whether ALLOWED DISRUPTIONS changed and why."

## Cleanup

```bash
oc delete -f singleton-service/02-pdb.yaml -f singleton-service/01-deployment.yaml -n patterns
oc delete -f singleton-service/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/singleton-service/

The runnable example deploys `shipping-service` at `replicas: 1` behind a `minAvailable: 1` PDB, confirms `ALLOWED DISRUPTIONS: 0` and that the Eviction API is refused with `429` naming the budget, then shows a direct `oc delete pod` succeeding immediately against the same Pod (the Deployment replacing it) to make the distinction concrete. Full walkthrough in `examples/appendix-patterns/singleton-service/README.md`.
