---
title: "Stateful Service"
order: 15
part: "Behavioral"
description: "Give a workload stable per-Pod identity and sticky storage on OpenShift with a StatefulSet and a headless Service, under the nonroot-v2 SCC its database image needs."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what a headless Service (`clusterIP: None`) provides: per-Pod DNS records instead of one load-balanced address
- Use `volumeClaimTemplates` to give each replica its own PersistentVolumeClaim, created once and reused across restarts
- Explain why a StatefulSet creates and deletes Pods in strict ordinal order
- Confirm that a Pod's storage and name both survive a delete, which is the point of the pattern

## Why this matters

Stateless Service named the default shape and the three properties that make it safe. This chapter is the explicit exception: a workload where at least one of those doesn't hold, because it needs something a stateless Deployment structurally can't provide, a stable identity that a specific piece of storage is tied to, reattached after every restart rather than handed to whichever replacement comes up next.

The example runs `shipment-archive`, three independent, non-replicating `postgres:17-alpine` instances standing in for a per-zone archive. It isn't a real multi-node database (the instances don't replicate); it's an unavoidably stateful workload to demonstrate StatefulSet mechanics against. On OpenShift there's one addition the minikube version doesn't need: the Postgres image owns its data as UID 70, which `restricted-v2` forbids, so the StatefulSet runs under a ServiceAccount bound to the `nonroot-v2` SCC, with `fsGroup: 70` for volume writes, the same scoped exception the other Postgres instances in this appendix use.

## The headless Service: identity over load balancing

Every Service so far had a load-balanced `ClusterIP` that picks one Pod per connection, with no way to address a specific one. A stateful workload needs the opposite:

```yaml
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: shipment-archive
  ports:
    - name: postgres
      port: 5432
```

`clusterIP: None` makes the Service headless: DNS stops returning one load-balanced address and instead returns an A record for *each* Pod, at `<pod-name>.<service-name>.<namespace>.svc.cluster.local`. Confirmed live:

```console
$ oc exec shipment-archive-0 -n patterns -- getent hosts \
    shipment-archive-1.shipment-archive.patterns.svc.cluster.local
10.217.0.154   shipment-archive-1.shipment-archive.patterns.svc.cluster.local
```

Three distinct, individually addressable names, not three equally-valid answers behind one. A client or peer that needs *that specific instance* has a name for it, resolvable like any Service name, with no extra discovery layer.

## StatefulSet: ordinal identity and sticky storage

```yaml
spec:
  serviceName: shipment-archive
  replicas: 3
  volumeClaimTemplates:
    - metadata:
        name: archive-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 128Mi
```

`serviceName` ties the StatefulSet to its headless Service, a field a Deployment has no equivalent of. Where a Deployment generates random-suffixed names, a StatefulSet assigns strictly ordinal ones, created in order, each with its own PVC:

```console
$ oc get pods -n patterns -l app.kubernetes.io/name=shipment-archive
shipment-archive-0   Running
shipment-archive-1   Running
shipment-archive-2   Running
$ oc get pvc -n patterns -l app.kubernetes.io/name=shipment-archive
archive-data-shipment-archive-0   Bound
archive-data-shipment-archive-1   Bound
archive-data-shipment-archive-2   Bound
```

`shipment-archive-0` reaches `Ready` before `-1` is created, and `-1` before `-2`, the opposite of a Deployment's parallel default; scale-down reverses it. This ordering exists because many stateful workloads need it (a primary before its replicas, a cluster bootstrapping from its first member). These three independent instances don't, but the controller applies the discipline regardless, because it can't know a workload doesn't need it. A Deployment's Pod template sharing one PVC name shares the *same* claim; `volumeClaimTemplates` instead templates the claim per ordinal, created the first time that Pod appears and reattached on every restart.

On CRC the per-ordinal claims use the default `crc-csi-hostpath-provisioner` storage class, whose `WaitForFirstConsumer` binding mode dovetails with the ordered startup: each ordinal's PVC stays `Pending` until that ordinal's Pod is scheduled, then binds, so the claims bind one at a time in the same order the Pods come up rather than all at once. The `fsGroup: 70` in the Pod's security context is what makes each freshly bound volume writable by the Postgres process: OpenShift applies the group to the volume at mount time, so UID 70 in group 70 can write its `PGDATA` without the volume having been pre-chowned.

![A headless Service providing per-Pod DNS names for three ordinal StatefulSet Pods, each bound to its own PersistentVolumeClaim]({{ "/assets/diagrams/appendix-15-stateful-service.svg" | relative_url }})
*Each ordinal gets a stable DNS name and its own sticky storage, created in order and reattached to the same claim on every restart.*

## What deleting an ordinal proves

Write a row, delete the Pod, and watch both its name and its data return:

```console
$ oc exec shipment-archive-1 -n patterns -- psql -U archive_app -d archive \
    -c "CREATE TABLE t(id int); INSERT INTO t VALUES (42);"
$ oc delete pod shipment-archive-1 -n patterns
$ oc exec shipment-archive-1 -n patterns -- psql -U archive_app -d archive -tc "SELECT id FROM t;"
 42
```

The replacement came back as `shipment-archive-1`, not a new name, and mounted the exact same PVC, so `id=42` is still there. This is the clearest contrast against Stateless Service's delete-and-replace: there, a new identity meant nothing carried forward, by design; here, the identical ordinal identity is precisely what guarantees the storage carries forward too.

That stickiness outlives the StatefulSet. Deleting the StatefulSet object does not delete its PVCs; they stay bound, so recreating it (same name, same templates) reattaches every ordinal to its data. Removing the data takes an explicit `oc delete pvc`, a separate action rather than a side effect of removing the workload, the same asymmetry a database administrator expects from any real storage.

## podManagementPolicy and partitioned rollouts

The ordered create-and-delete is the default (`OrderedReady`). `podManagementPolicy: Parallel` relaxes it for workloads whose replicas don't depend on each other's startup, creating and deleting every ordinal at once while keeping every other guarantee (stable names, per-ordinal PVCs, headless DNS). These independent instances are a reasonable candidate; the example keeps `OrderedReady` because watching ordinals come up one at a time is what makes the ordering visible.

A StatefulSet's `updateStrategy` applies the same ordinal discipline to updates, rolling from the *highest* ordinal down. Raising `partition` above zero is the StatefulSet-specific trick: `partition: 2` updates only `shipment-archive-2`, holding `-0` and `-1` on the old template, a built-in canary for validating a change against one ordinal before committing, with no separate canary Deployment.

## Why this example doesn't attempt real replication

Three `postgres:17-alpine` containers under one StatefulSet is not a replicated database, and nothing here wires one up: each ordinal starts with its own empty database and no awareness of the others. A database that actually replicates on Kubernetes delegates that to a purpose-built operator, CloudNativePG (which the data mesh's production database runs under) or Patroni, because correct failover and split-brain avoidance are a substantial distributed-systems problem layered on top of StatefulSet mechanics, not a replacement for them. The StatefulSet is the right foundation either way: stable identity and sticky storage are exactly what an operator-managed replicated database still needs underneath, and understanding the mechanics directly is useful even for a reader whose production Postgres always runs through an operator.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for persistent storage (stateful workloads with stable identity)
> **Competency:** Deploy a StatefulSet with a headless Service and per-Pod `volumeClaimTemplates`
> **Drill:** `oc get pvc -n patterns -l app.kubernetes.io/name=shipment-archive -o custom-columns=NAME:.metadata.name,STATUS:.status.phase`

> **🤖 Explore with your agent**
>
> "Scale shipment-archive from 3 replicas down to 1, then back to 3, and show me whether the PVCs for the removed-and-re-added ordinals still have their original data or start fresh."

## Cleanup

```bash
oc delete -f stateful-service/02-statefulset.yaml -f stateful-service/01-service.yaml -n patterns
oc delete -f stateful-service/00-setup.yaml -n patterns
oc delete pvc -n patterns -l app.kubernetes.io/name=shipment-archive   # PVCs are not auto-deleted
```

## Verification: examples/appendix-patterns/stateful-service/

The runnable example brings up `shipment-archive` at three replicas under `nonroot-v2`, confirms their ordered creation, per-ordinal PVCs, and per-Pod headless DNS names, writes a row to one ordinal, deletes that Pod, and confirms both its name (`shipment-archive-1`) and its data (`id=42`) return intact. Full walkthrough in `examples/appendix-patterns/stateful-service/README.md`.
