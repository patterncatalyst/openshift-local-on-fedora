---
title: "Persistent storage"
order: 10
description: "Give a workload storage that survives a Pod restart with a PersistentVolumeClaim and OpenShift's dynamic provisioning on CRC."
---

## Learning objectives

By the end of this chapter you can:

- Request durable storage with a PersistentVolumeClaim
- Explain how OpenShift dynamically provisions a volume on CRC
- Identify the `crc-csi-hostpath-provisioner` StorageClass and its binding mode
- Prove that data survives the Pod that wrote it

## Why this matters

A Pod's own filesystem is temporary. Delete the Pod, and anything it wrote is gone,
which is correct for a stateless web server but wrong for a database or anything that
has to remember. This chapter gives a workload durable storage with a
*PersistentVolumeClaim*, shows how OpenShift provisions the volume for you on CRC, and
proves the data survives the Pod that wrote it. Storage is where a cluster stops being a
place to run throwaway processes and starts being able to run a database, a queue, or
anything else that has to hold state between restarts.

{% include excalidraw.html
   file="persistent-storage"
   alt="A Pod mounts a PersistentVolumeClaim, which binds to a PersistentVolume backed by a directory on the CRC node's disk. The default hostpath StorageClass provisions the volume, and the claim binds when the first Pod mounts it."
   caption="Figure 10.1: A Pod mounts a claim; the default StorageClass provisions a volume on the node's disk, and the claim binds when the first Pod mounts it." %}

## Volumes, claims, and classes

Three Kubernetes objects work together, and the names are easy to confuse:

- A **PersistentVolume** (PV) is a piece of real storage in the cluster, backed by a
  disk, a cloud volume, or, on CRC, a directory on the node.
- A **PersistentVolumeClaim** (PVC) is a workload's request for storage: how much, and
  which access mode. A Pod mounts the claim, not the volume directly.
- A **StorageClass** names a way to provision volumes. A claim that names a class, or
  uses the default, gets a volume created for it automatically.

The split matters because it keeps workloads portable. A Pod asks for "10 GiB that I
can read and write" through a PVC, and the cluster satisfies it however it can: a
hostpath directory on CRC, a block volume on a cloud. The manifest does not change
between them, which is the portability this guide favors throughout.

## The default StorageClass on CRC

CRC ships one StorageClass, set as the default, so a claim that names no class still
gets a volume:

```bash
oc get storageclass
# crc-csi-hostpath-provisioner (default)   kubevirt.io.hostpath-provisioner   Retain   WaitForFirstConsumer
```

Two of its settings shape how storage behaves here, and both are worth understanding
before you create a claim. The volume binding mode is `WaitForFirstConsumer`, which
means a PVC is not provisioned the moment you create it; the cluster waits until a Pod
that uses the claim is scheduled, then provisions the volume on that Pod's node. On a
single-node cluster the node is never in doubt, but the effect is visible: a fresh PVC
sits in `Pending` until a Pod mounts it, which is expected rather than a fault. The
reclaim policy is `Retain`, so deleting a PVC leaves its underlying PV and data in
place rather than erasing them, which protects data from an accidental `oc delete` at
the cost of leaving volumes to clean up by hand.

The provisioner is a hostpath provisioner: a PV is a directory on the CRC node's disk.
That has one consequence to keep in mind. The data lives inside the CRC VM, so it
survives Pod restarts, deployments, and `crc stop`, but a `crc delete` discards the VM
and everything on it. For local development that is the right trade, as long as you do
not treat the cluster as a place to keep anything you cannot recreate.

### How dynamic provisioning happens

Dynamic provisioning is why you never create a PV by hand here. The StorageClass names a
provisioner, a controller that watches for claims it is responsible for. When a PVC that
uses the class needs a volume, the provisioner creates the backing storage and a matching
PV, then binds the two. On a cloud that step calls an API to carve out a block device; on
CRC it creates a directory on the node. Either way the workload sees the same result: a
claim that was `Pending` becomes `Bound`, and the Pod mounts it. The alternative, static
provisioning, where an administrator pre-creates PVs for claims to find, still exists and
is worth knowing, but you rarely need it when a provisioner can make volumes on demand.

### Where the storage actually lives

Because the provisioner writes to the node's disk, persistent volumes consume the CRC
VM's disk, the same space the `disk-size` setting caps. A workload that writes a lot can
fill it, and when it does, new Pods and builds fail for want of space rather than for any
application reason. Keep an eye on it when you run storage-heavy workloads:

```bash
oc get pv                       # the volumes that exist and their capacity
crc status                      # disk usage of the VM overall
```

If you expect to keep several stateful workloads, size the VM's disk up front, while CRC
is stopped, rather than hitting the cap mid-run. The disk figure is a cap the image grows
into, so a larger one costs nothing until the volumes actually use it. A cluster that runs
out of disk fails in confusing ways, with Pods evicted and builds aborted for reasons that
look unrelated, so watching the figure is cheaper than diagnosing the symptoms.

## Claim a volume and mount it

Write a PVC that asks for a small volume, and a Deployment that mounts it. The claim
names no StorageClass, so it uses the default:

```yaml
# pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
```

```yaml
# a Deployment that writes to the claim
apiVersion: apps/v1
kind: Deployment
metadata:
  name: writer
spec:
  replicas: 1
  selector:
    matchLabels: { app: writer }
  template:
    metadata:
      labels: { app: writer }
    spec:
      containers:
        - name: app
          image: registry.access.redhat.com/ubi9/ubi-minimal
          command: ["sh", "-c", "sleep infinity"]
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: data
```

```bash
oc new-project storage-demo
oc apply -f pvc.yaml
oc get pvc data            # Pending until a Pod mounts it (WaitForFirstConsumer)
oc apply -f writer-deployment.yaml
oc rollout status deployment/writer
oc get pvc data            # now Bound
```

The claim moves from `Pending` to `Bound` only after the writer Pod is scheduled. That
is the binding mode in action, not a delay to worry about.

`ReadWriteOnce` is the access mode the hostpath provisioner supports: the volume mounts
read-write on a single node. That fits CRC, where there is one node. The other modes
(`ReadWriteMany` for many nodes writing at once) need a provisioner that supports them,
which a real cluster with shared storage provides and a single-node hostpath does not.

### Choosing an access mode

Three access modes cover the cases, and picking the right one is part of designing a
stateful workload. `ReadWriteOnce` (RWO) mounts the volume read-write on one node, which
suits a database or any single writer, and is what CRC offers. `ReadOnlyMany` (ROX)
mounts read-only on many nodes, for sharing static content that no Pod writes.
`ReadWriteMany` (RWX) mounts read-write on many nodes at once, which a shared filesystem
provides and which workloads reach for when several replicas must write the same volume.
On CRC, with one node and a hostpath provisioner, RWO is the realistic choice, and it is
also the mode most stateful workloads want: a database that let two replicas write the
same files would corrupt itself, so RWO is a feature, not a limitation. When you port a
manifest to a cluster with shared storage, the access mode is one of the few fields worth
revisiting, because a workload that assumed RWX on a cluster that only offers RWO will
leave its extra replicas stuck.

## Prove the data persists

The point of a PVC is that the data outlives the Pod. Write a file, delete the Pod, and
read it back from the replacement:

```bash
# write a file onto the volume
oc exec deploy/writer -- sh -c 'echo "survives a restart" > /data/note.txt'
oc exec deploy/writer -- cat /data/note.txt

# delete the Pod; the Deployment makes a new one, which mounts the same claim
oc delete pod -l app=writer
oc rollout status deployment/writer
oc exec deploy/writer -- cat /data/note.txt   # still "survives a restart"
```

The replacement Pod is a different Pod with a fresh container filesystem, yet
`/data/note.txt` is still there, because `/data` is the PVC, not the container. That is
the whole idea: the Pod is disposable, the claim is not. The same holds across a
`rollout restart` or a new image: as long as the Deployment keeps mounting the same claim,
the data carries forward, which is what lets you update a stateful workload without losing
what it stored.

## Writing as a non-root UID

The storage chapter meets the security model again. The writer runs under
`restricted-v2` with an arbitrary UID, so it must be able to write to the mounted volume
as that UID. OpenShift handles this with the Pod's `fsGroup`: it sets the volume's group
ownership to a GID the assigned UID belongs to, so the process can write without running
as a fixed user. For the UBI image here it works out of the box. For an image that
writes to its volume as a specific user, set an `fsGroup` in the Pod's security context
so the mount is group-writable by the UID OpenShift assigns:

```yaml
      securityContext:
        fsGroup: 1000
```

The rule is the same as it was for the deploying and Helm chapters: rely on group
ownership rather than a fixed user, and the volume is writable regardless of which UID
the project hands out. When a stateful image fails on OpenShift with a permission error
writing to its data directory, the `fsGroup` is almost always the missing piece: the image
expected to own its files as a fixed user, and the arbitrary UID cannot write until the
mount is made group-writable. Setting `fsGroup` to the group the image writes as resolves
it without granting the image any extra privilege.

## Stateful workloads and volumeClaimTemplates

A Deployment with one PVC is fine for a single writer, but a replicated stateful
workload, where each replica needs its own volume, uses a StatefulSet with a
`volumeClaimTemplate` instead. The StatefulSet creates one PVC per replica from the
template, each bound to its own PV, and gives each Pod a stable name and identity:

```yaml
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
```

This is how a database chart runs on OpenShift: each replica keeps its own data on its
own claim, and the stable identity means a restarted replica reattaches to the volume it
had before. The Helm chapter's Postgres piece is a StatefulSet for exactly this reason.

A StatefulSet differs from a Deployment in two ways that matter for storage. Its Pods are
named in order (`web-0`, `web-1`) and keep those names across restarts, so each Pod maps
to one claim for its whole life. And it scales in order, bringing Pods up and down one at a
time, which lets a clustered database join and leave members cleanly rather than all at
once. The claims a StatefulSet creates stay in place when you scale it down
or delete it, so a replica that comes back finds its data intact; removing that data is a
separate, explicit step. For a single-replica database on CRC the difference is small, but
the moment a workload has real state, the StatefulSet is the object that treats that state
as first class.

> **⌨️ The `oc` way**
>
> There is no OpenShift-only verb for storage; PVCs are standard Kubernetes. What `oc`
> adds is the console view: under Storage you see every PersistentVolumeClaim, its bound
> volume, its capacity, and which Pods mount it, which is the fastest way to spot a claim
> stuck `Pending` for want of a consumer.

## Cleaning up and the Retain policy

Because the StorageClass uses the `Retain` reclaim policy, deleting the project does not
erase the volume's data. The PVC goes with the namespace, but the PV it was bound to is
kept, now `Released` rather than deleted. On CRC the storage is small and local, so this
rarely matters, but it is worth knowing when you expect a deleted claim to free space:

```bash
oc delete project storage-demo
oc get pv | grep Released      # the old volume lingers until you remove it
```

To reclaim the space, delete the released PV by hand, or recreate the cluster with
`crc delete` for a clean slate. On a production cluster the reclaim policy is a
deliberate data-safety choice; on CRC it mostly means a periodic look at released
volumes.

## When a claim stays Pending

A PVC stuck in `Pending` is the most common storage snag, and on CRC it usually has one
of two causes. The ordinary one is the binding mode: a claim with no consumer waits by
design, so a `Pending` claim that has no Pod yet is not broken, it is waiting for one.
Create or schedule a Pod that mounts it and it binds. The real failure is a provisioner
that cannot satisfy the claim, for example a request larger than the node's free disk, or
an access mode the hostpath provisioner does not support. The reason is in the claim's
events:

```bash
oc describe pvc data        # the Events section names why it is not bound
```

Reading those events first saves guessing. A claim that asks for `ReadWriteMany` on
CRC's hostpath, for instance, stays `Pending` because the provisioner offers only
`ReadWriteOnce`, and the event names that mismatch directly.

## Resizing is not available here

The CRC StorageClass sets `allowVolumeExpansion` to false, so you cannot grow a bound
volume in place by editing the claim. On a cluster whose StorageClass allows expansion,
raising a PVC's `storage` request resizes the volume online; on CRC you instead create a
larger claim, copy the data across, and switch the workload to the new claim. For local
development this is rarely a problem, because the volumes are small and easy to recreate,
but it is the kind of difference from a production cluster that is better known in advance
than discovered when a resize silently does nothing.

## Build, run, observe

```bash
oc new-project storage-demo 2>/dev/null || oc project storage-demo
oc apply -f pvc.yaml
oc get pvc data                                   # Pending (WaitForFirstConsumer)
oc apply -f writer-deployment.yaml
oc rollout status deployment/writer
oc get pvc data                                   # Bound
oc exec deploy/writer -- sh -c 'echo persisted > /data/note.txt'
oc delete pod -l app=writer
oc rollout status deployment/writer
oc exec deploy/writer -- cat /data/note.txt       # persisted
oc delete project storage-demo
```

A claim that binds once a Pod mounts it, and a file that outlives the Pod that wrote it,
confirm persistent storage is working.

## For deeper coverage

- [**Kubernetes Patterns**](https://www.oreilly.com/library/view/-/9781098131678/) (Ibryam and Huß, O'Reilly) covers the Stateful Service pattern and how persistent storage attaches to a workload.
- [**Kubernetes: Up and Running**](https://www.oreilly.com/library/view/-/9781098110192/) (Burns, Beda, Hightower, Evenson, O'Reilly) explains volumes, PersistentVolumes, and storage classes from the ground up.
- Official docs: the [OpenShift Container Platform documentation](https://docs.openshift.com/) for storage and dynamic provisioning, and the [Kubernetes documentation](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) for PersistentVolumes and claims.

## Where this fits

Your workloads can keep data now. The next chapter adds the other half of running a real
service: scaling it on load, with the Custom Metrics Autoscaler reacting to demand
rather than a fixed replica count.
