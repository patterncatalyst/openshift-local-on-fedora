---
title: "FAQ"
order: 14
description: "Common questions and fixes for OpenShift Local: slow starts, resource pressure, networking, the oc client, security defaults, and credentials."
---

## Learning objectives

By the end of this chapter you can:

- Diagnose a slow or failing `crc start`
- Resolve resource-pressure symptoms on the host
- Fix common networking and `oc` client problems
- Find CRC credentials and resize the cluster safely

## Why this matters

This chapter is a reference for the questions that come up most when running OpenShift
Local, grouped by what you are trying to do. Each answer is short and points back to the
chapter that covers it in full. Read it start to finish once, then return to it when
something behaves unexpectedly.

## Starting and stopping

**Why is the first start so slow?** The first `crc start` downloads and unpacks a
multi-gigabyte bundle, boots the VM, and waits for every cluster operator to settle. Later
starts on the same CRC version reuse the cached bundle and are much faster. A slow first
start is expected, not a fault; a slow every start points at resource pressure.

**Should I stop or delete the cluster when I am done?** Stop it. `crc stop` keeps the VM and
its state so the next start is quick, while `crc delete` discards the VM and forces a full
first-boot next time. Reserve `crc delete` for when you want a clean slate, which a
verification run from a known-empty cluster wants, or when moving to a new CRC bundle.

**My start hangs waiting for the API server.** Under resource pressure the control plane
comes up slowly rather than hanging. Give it a few minutes; if it never completes, stop the
cluster, raise the memory, and start again. A stall that never clears almost always traces
back to an undersized VM.

**A start fails right after my laptop resumed from sleep.** The cluster's internal
certificates are time-sensitive, so a clock that drifted while the host slept can make the
API reject its own certificates. A `crc stop` followed by `crc start` resynchronizes the
clock and clears it.

**Nothing in the start log is clear and it keeps failing.** The reliable reset is `crc stop`,
then `crc delete`, then `crc start`. It discards a half-built VM and provisions a fresh one
from the cached bundle, without a re-download, so it is slower than a plain start but clears a
corrupted VM state that restarting alone will not. Add `--log-level debug` to a start to see
what it was doing when it stopped.

**Can I run CRC and minikube at the same time?** No. Run one local cluster at a time; two
compete for CPU, memory, and the virtualization subsystem, and the failures look like unrelated
bugs. Stop the other cluster first. The scaffold's `require_crc` refuses to run while a minikube
profile is up, for exactly this reason.

**How do I confirm the cluster is actually healthy, not just started?** Run `oc get
clusteroperators`: every operator should read `Available=True`, `Progressing=False`,
`Degraded=False`, and the node should be `Ready`. A cluster that booted but has operators still
`Progressing` is not finished settling, so wait for them to clear before deploying, and treat any
`Degraded` as the signal to act, usually on memory.

**Where are the logs for a Pod that already crashed?** `oc logs <pod> --previous` shows the
output of the container's last run, which is where a crash's cause usually is. Pair it with `oc
describe pod` and `oc get events` to see whether the failure was the application or the cluster
around it.

## Resources and sizing

**How much memory and CPU does CRC need?** The core target is 6 CPUs and 20 GiB; the
platform target this guide builds toward, with the mesh, Operators, and observability, is 12
CPUs and 32 GiB. Size the VM before the first start, because the setting only takes effect
while CRC is stopped. Err toward more memory: an undersized cluster starts and then struggles
rather than failing cleanly.

**Cluster operators show `Degraded`, or Pods stay `Pending`.** This is almost always the VM
being too small for what is running on it. Stop the cluster, raise `memory`, and start again,
or scale down and remove workloads you are not using. On a single node everything competes for
one machine's memory.

**The cluster ran out of disk.** Persistent volumes and image builds consume the VM's disk,
capped by `disk-size`. Check usage with `crc status` and `oc get pv`, remove workloads or
released volumes you no longer need, or recreate the cluster with a larger `disk-size` set
while stopped. The disk figure is a cap the image grows into, so sizing it up front costs
nothing until you use it.

**How do I see what is using the memory?** `oc adm top pods -A` lists Pods by CPU and memory
across all namespaces, and `oc adm top nodes` shows the node's totals. Sorting the Pod list by
memory finds the workload to scale down or remove when the cluster is tight. These read the same
metrics the autoscalers use, so they work out of the box.

**The console and the cluster feel sluggish.** Slowness, as opposed to failure, is usually
memory pressure short of the point where Pods are evicted. Check `oc adm top nodes`; if memory is
near the limit, scale down or remove workloads, or raise the VM's memory while stopped. Platform
tiers like the mesh and observability are the heaviest tenants, so removing ones you are not
using frees the most.

## Networking and access

**`api.crc.testing` or a Route will not resolve on the host.** `crc setup` installs the host
DNS rule that points `.crc.testing` and `.apps-crc.testing` at the cluster. Re-running `crc
setup` restores it. Both names resolving to `127.0.0.1` is correct, not a misconfiguration:
CRC uses user-mode networking, so cluster traffic loops back to your machine.

**A Route returns 503.** The Route resolved but found no healthy Pods behind its Service, so
the problem is the workload or the Service selector, not the Route. Check the Deployment's
Pods and the Service's endpoints.

**How do I reach a Service that has no Route?** Use `oc port-forward svc/<name> 8080:8080` to
tunnel its port to `localhost` while the command runs, which reaches an internal service without
exposing it. That keeps internal traffic internal and is the right tool for a database or admin
endpoint you do not want on a Route.

**A console page shows a certificate warning in the browser.** The console is served with the
cluster's self-signed ingress certificate, so a browser warns unless you trust the CA. For local
use you can proceed past it, or import the ingress CA into your browser's trust store to make the
warning go away. It is the same self-signed certificate the Routes chapter trusted with
`--cacert`.

**HTTPS to a Route fails with a certificate error.** The CRC ingress certificate is signed by
the cluster's own CA, which no public trust store knows. Trust that CA with `curl --cacert`
using the ingress CA bundle, rather than skipping verification with `--insecure`.

## The oc client

**`oc` cannot reach the cluster, or `api.crc.testing` is refused.** The most common cause is
the wrong `oc`. A host may have several: the bundled client from `crc oc-env`, a standalone
one, or a wrapper that only runs `oc` inside a container and cannot reach `api.crc.testing`.
Run `eval "$(crc oc-env)"` so the bundled client wins, and confirm with `command -v oc` that
it resolves into `~/.crc`.

**`oc` says my token or context is wrong.** `crc start` writes a `crc-admin` context; switch
to it with `oc config use-context crc-admin`, and you are logged in as `kubeadmin` with no
password. You rarely need `oc login` on CRC.

**`kubectl` and `oc` disagree on a resource.** A standalone `kubectl` or `oc` that is more
than a minor version off the cluster can misbehave on newer types. Use the bundled client,
which is version-matched to the cluster bundle, or refresh your standalone client after a CRC
upgrade.

## Security defaults

**My container will not start; it wants to run as root or bind a low port.** OpenShift's
default `restricted-v2` SCC refuses root and assigns an arbitrary non-root UID. Prefer an
image built to run as any UID, such as the Red Hat UBI images, which listen on a high port and
do not hard-code a user. Granting a more permissive SCC is possible but should be a deliberate
exception with a reason.

**A workload cannot write to its mounted volume.** Under the arbitrary UID, the volume must be
group-writable. Set an `fsGroup` in the Pod's security context so OpenShift makes the mount
group-owned by a GID the assigned UID belongs to. This is the storage counterpart to running
as a non-root UID.

**A PVC is stuck `Pending`.** On CRC's default StorageClass, a claim is provisioned only when
a Pod that uses it is scheduled, so a claim with no consumer waits by design. A claim that
stays `Pending` with a Pod attached is a real problem; `oc describe pvc` names the reason,
often a size or access-mode the hostpath provisioner cannot satisfy.

## Credentials

**How do I get the web console login?** Run `crc console --credentials` yourself to see the
kubeadmin password, and `crc console` to open the console in a browser. Keep the password out
of scripts, commits, and anything you share; the command-line work in this guide uses the
admin context and needs no password at all.

**Where is the pull secret, and do I need to protect it?** It is a credential. Keep it as a
file, pass its path to `crc start --pull-secret-file` once, and never print or commit its
contents. If it is ever exposed, download a fresh one from the Red Hat console and the old one
can be revoked.

**Do I need to handle the kubeadmin password for anything?** No. Everything in this guide uses
the `crc-admin` context, whose credentials are already in your kubeconfig, so `oc` and `kubectl`
work without a password. The only time you need the password is to log into the web console as
kubeadmin, and `crc console --credentials` shows it when you do.

## Upgrading and catalogs

**How do I upgrade CRC?** Install the new `crc` binary over the old one. A new release carries
a new OpenShift bundle, so the first start after an upgrade pulls it, and a major version jump
usually wants `crc delete` first for a clean slate. Your `crc config` settings survive the
upgrade.

**An operator install hangs and never gets an InstallPlan.** The pinned CSV is probably no
longer in the catalog. Re-check the current CSV with `oc get packagemanifest <pkg> -n
openshift-marketplace` and update the Subscription's `startingCSV` to a version the channel
still serves. A pin to a vanished version waits forever.

**How do I upgrade an operator I pinned?** Because the Subscription uses manual approval,
nothing moves on its own. Edit the Subscription's `startingCSV` to the newer version, then
approve the InstallPlan that names it. The pattern is the same as the first install: pin the
version you want, approve the one matching InstallPlan, and the operator moves only when you
decide.

**Can I use CRC offline?** Mostly, once the bundle is cached. The first start and any image
pulls need the network, but after the bundle and your workloads' images are local, the cluster
itself runs without connectivity. An operator install needs the catalog, which needs the network,
so plan those while online. For offline development against already-pulled images, CRC is
comfortable.

**An image pull from `registry.redhat.io` fails with an authentication error.** Unlike the
public `registry.access.redhat.com`, that registry requires authentication. The cluster's own
pulls use the pull secret you gave `crc start`, but a workload pulling from `registry.redhat.io`
in its own namespace needs a pull secret there too. For everything in this guide the public
registry and UBI images are enough, which is why the workloads need no extra secret.

**Which operators are those that I did not install?** A fresh cluster already runs the platform
operators that make it OpenShift: the ingress, registry, console, authentication, and monitoring
operators, all in `openshift-*` namespaces. They are part of the cluster, not something you added,
and you leave them alone. The operators you install from OperatorHub are separate and sit
alongside them.

## Cleanup and removal

**How do I free space without reinstalling?** Delete workloads and projects you are done with,
and remove released PersistentVolumes that the `Retain` policy left behind (`oc get pv | grep
Released`). For a full reset, `crc delete` discards the VM and its contents while keeping the
cached bundle, so the next start is still fast.

**How do I remove CRC completely?** Stop the cluster, then `crc delete` to discard the VM, then
`crc cleanup` to reverse what `crc setup` did to the host (the libvirt network and the DNS rule).
Removing the `crc` binary and the `~/.crc` directory afterward leaves the machine as it was.
`crc cleanup` is only for a full uninstall; day to day you use `crc stop` and `crc delete`.

**Can I change the cluster size while it is running?** No. Sizing takes effect only while CRC is
stopped: `crc stop`, then `crc config set cpus`/`memory`/`disk-size`, then `crc start`. A change
made while the cluster runs is stored but does not apply until the next stop and start.

## For deeper coverage

- Official docs: the [Red Hat OpenShift Local documentation](https://developers.redhat.com/products/openshift-local/overview) is the authoritative troubleshooting reference for start-up, networking, and resource issues, and the [OpenShift Container Platform documentation](https://docs.openshift.com/) covers the cluster behavior behind these answers.

## Where this fits

With the common questions answered, the final chapter points onward: certifications a local
OpenShift prepares you for, moving to a remote cluster, and the sibling guides that go
further.
