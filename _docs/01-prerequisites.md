---
title: "Prerequisites and getting CRC"
order: 1
description: "Prepare the Fedora host, create a free Red Hat Developer account, download OpenShift Local and the pull secret, and plan the cluster size."
---

## Learning objectives

By the end of this chapter you can:

- Confirm your Fedora host has the CPU, memory, disk, and virtualization support CRC needs
- Create a free Red Hat Developer account and download the pull secret
- Download the OpenShift Local release and place the `crc` binary
- Choose the core or platform cluster size that fits your host

## Why this matters

OpenShift Local (the command is `crc`, short for CodeReady Containers) runs a
single-node OpenShift 4 cluster inside a local virtual machine. Before you start
the cluster, you need three things: a host that can run the VM, a
free Red Hat Developer account, and two downloads: the `crc` release and a *pull
secret*. This chapter gets all of that in place. It installs nothing from the
cluster yet; that begins in the next chapter.

{% include excalidraw.html
   file="crc-architecture"
   alt="On a Fedora host, the crc daemon and KVM with libvirt and qemu run a single virtual machine of Red Hat Enterprise Linux CoreOS. Inside the VM are the control plane, the worker, the internal registry, the router, and OLM with OperatorHub. The cluster's names resolve to 127.0.0.1 through user-mode networking."
   caption="Figure 1.1: OpenShift Local runs a full single-node OpenShift cluster inside one local VM, reached from the host over user-mode networking." %}

## What a single-node OpenShift gives you

It helps to know what you are about to run, because it explains why the sizing is
larger than a container runtime or a bare Kubernetes node. OpenShift Local is not a
trimmed-down Kubernetes. It is a real OpenShift 4 release collapsed onto one machine
that plays control-plane, worker, and infrastructure roles at once. That one node
runs the API server, etcd, the scheduler, and the controller managers, and on top of
them the pieces that make it OpenShift rather than plain Kubernetes:

- the **Operator Lifecycle Manager** and the **OperatorHub** catalog, so you install
  software by subscribing to it rather than applying a pile of manifests;
- an **internal image registry** and the **image-stream** and build machinery that
  let the cluster build container images for you;
- the **router**, an ingress controller that serves **Routes** at real hostnames
  under `apps-crc.testing`;
- **security context constraints** (SCCs), the admission layer that decides which
  UID and capabilities a Pod may run with, which is why workloads here behave
  differently from a permissive local cluster;
- the **web console** and a built-in monitoring stack.

All of that runs before your first workload, which is why the memory and CPU figures
below start where they do. The payoff is that everything you build here behaves the
way it will on a production OpenShift cluster, because it is the same software.

The single limit is that it is one node. The control plane and the worker
are the same machine, so there is no high availability, and features that exist
to spread work across nodes have nothing to spread it over: Pod anti-affinity,
multi-zone scheduling, and a `LoadBalancer` service with an external IP pool are all
things you can read and model here but not exercise. Everything else, the
API, Operators, Routes, builds, SCCs, and the console, is complete, so the gap is
narrow and always in the same direction. Where a later chapter reaches one of those
single-node edges, it says so.

> This guide uses the default `openshift` preset. CRC also ships a `microshift`
> preset, a much smaller single-binary Kubernetes for edge devices. The two share
> the `crc` command but almost nothing else; the Operators, Routes, and SCC behavior
> this guide relies on are OpenShift features, so stay on the `openshift` preset.

## What the cluster needs from your host

The cluster is a real OpenShift control plane and worker on one node, so it asks
for more than a container does. OpenShift Local's own minimum for the OpenShift
preset is 4 physical CPU cores, 10.5 GiB of free memory, and 35 GB of free disk.
Those minimums boot the cluster, but leave almost nothing for your own
workloads. This guide installs Operators, a service mesh, and observability, so
plan for more. The sizing section below gives two concrete targets.

Your host must be able to run a KVM virtual machine:

- **Fedora** (this guide targets Fedora; RHEL works the same way). A desktop or
  server install is fine.
- **Hardware virtualization** enabled in firmware (Intel VT-x or AMD-V) and the
  KVM kernel modules available. If Fedora is itself a VM, the hypervisor must
  expose *nested* virtualization.
- `libvirt` and `NetworkManager`, which OpenShift Local drives to create the VM
  and its network. The `crc setup` step checks these and sets up what it can;
  you do not configure libvirt by hand.

Confirm virtualization is live before going further:

```bash
# A non-zero count means the CPU advertises virtualization extensions.
grep -Ec '(vmx|svm)' /proc/cpuinfo

# KVM modules loaded (kvm_intel or kvm_amd under the kvm module).
lsmod | grep kvm
```

If the first command prints `0`, enable virtualization in your firmware setup.
If you are on a cloud or nested VM, enable nested virtualization on the outer
hypervisor and confirm the guest sees it:

```bash
# "Y" means nested virtualization is available to this guest (Intel; use
# kvm_amd on AMD hosts).
cat /sys/module/kvm_intel/parameters/nested 2>/dev/null
```

Check that the host actually has the free memory and disk the VM will claim. These
are a point-in-time snapshot, so close heavy applications before you read them:

```bash
free -h            # look at the "available" column, not "free"
df -h ~/.crc       # the VM image lives under your home directory
```

The VM image grows as the cluster writes to it, up to the disk cap you set later, so
give `~/.crc` real headroom rather than the bare minimum.

### If virtualization is not available

A `0` from the `vmx`/`svm` check almost always means virtualization is turned off in
firmware rather than missing from the CPU. The setting hides under different names
depending on the vendor: "Intel Virtualization Technology" or "VT-x" on Intel boards,
"SVM Mode" or "AMD-V" on AMD. Enable it, save, and reboot, then run the check again.
Secure Boot does not need to be disabled for KVM.

If the modules are present but `crc` later cannot talk to libvirt, the usual cause is
group membership: `crc setup` adds your user to the `libvirt` group, but a group
change only takes effect in a new login session, so log out and back in once after
setup. You run `crc` as your normal user, never with `sudo`; running it as root
creates a separate root-owned cluster under `/root/.crc` that will confuse later
commands.

## How CRC reaches the cluster: user-mode networking

On Linux, OpenShift Local defaults to *user-mode networking*: the VM's traffic is
tunneled through a user-space process rather than a bridged libvirt network. The
practical effect is that the cluster's addresses point back at your own machine.
`api.crc.testing` (the API server) and every `*.apps-crc.testing` host (the Routes)
resolve to `127.0.0.1`:

```bash
getent hosts api.crc.testing        # 127.0.0.1
getent hosts console-openshift-console.apps-crc.testing   # 127.0.0.1
```

`crc setup` is what makes those names resolve, by installing a small
NetworkManager/dnsmasq dispatch rule on the host. Because the traffic loops back
locally, you do not open inbound firewall ports and you do not need a tunnel to reach
a Route. This also means the cluster is reachable only from this machine, which is
exactly what you want for local development. User-mode networking works with SELinux
left enforcing; you do not disable it. If you ever need the VM on a routable address
instead (to reach it from another host), that is the `system` network mode, set with
`crc config set network-mode system` while the cluster is stopped, but the default
suits everything in this guide.

## A free Red Hat Developer account

OpenShift Local and its pull secret are free, and you get both by registering for
a Red Hat Developer account at no cost. Create one at
[developers.redhat.com](https://developers.redhat.com/). The account is also what
you would use later for the Red Hat Ecosystem Catalog and `registry.redhat.io`,
which some of the images in this guide are pulled from.

## Download OpenShift Local

Get the latest `crc` release from the product page:

- [Red Hat OpenShift Local (download)](https://console.redhat.com/openshift/create/local)
- Product overview: [developers.redhat.com/products/openshift-local/overview](https://developers.redhat.com/products/openshift-local/overview)

The download page offers the Linux archive and, on the same page, a **Download
pull secret** button. Get both. This guide was written against CRC 2.64, which
bundles OpenShift 4.22; a newer release is fine, and the commands are the same.

Each `crc` release bundles one specific OpenShift version, downloaded as a *bundle*
the first time you run `crc setup` or `crc start`. That first pull is several
gigabytes, so the initial start is slow; later starts reuse the cached bundle under
`~/.crc`. Upgrading CRC means a new bundle, so expect another download when you move
to a newer release.

Installing the binary itself comes next. For now, save the archive and the pull
secret somewhere you will remember. Keep the pull secret as a file: you pass its
path to `crc` once, and the cluster stores it. You never need to open it, print
it, or paste its contents.

> **⌨️ The `oc` way**
>
> The download page also carries the matching `oc` and `kubectl` clients, but you
> do not need to fetch them separately. `crc` ships a bundled `oc`, and installing
> CRC puts it on your `PATH` with `crc oc-env`. Install a standalone `oc` only if you
> want it available when the cluster is stopped.

### Keep the pull secret private

The pull secret is a credential: a JSON document holding authentication tokens for
the registries the cluster pulls from, including `registry.redhat.io`, `quay.io`,
and `registry.connect.redhat.com`. The cluster needs it to pull its own release
images and the Operator catalog content, which is why `crc start` asks for it once.
Treat it like a password:

- Save it as a file (for example `~/.crc/pull-secret.json`) and leave it there.
- Do not commit it to a repository. If your project has a `.gitignore`, add a
  `pull-secret*.json` rule so it cannot be staged by accident.
- Do not paste its contents into a terminal, a script, or a chat. Every command
  in this guide takes the *path* to the file, never its text.

If a pull secret is ever exposed, rotate it: the download page issues a fresh one,
and the old token can be revoked from your Red Hat account.

## Where CRC keeps its files

Everything OpenShift Local manages lives under `~/.crc`, and it helps to know the
layout before you start:

- `crc.json` and the `crc config` store: your sizing and other settings.
- `machines/crc/`: the VM disk image and libvirt definition. This is the directory
  that grows, so it is the one to watch with `df -h ~/.crc`.
- `bin/oc/oc`: the bundled `oc` client that matches the cluster exactly, the one
  `crc oc-env` puts on your `PATH`.
- `cache/`: the downloaded bundle for each OpenShift version, reused across starts.
- the pull secret, if you saved it here.

Nothing in this tree needs manual editing. When you later run `crc delete`, it clears
`machines/` but keeps the cached bundle, so a fresh `crc start` re-provisions without
downloading again.

> CRC asks once whether to send anonymous usage telemetry. You can answer at the
> prompt, or decide ahead of time with `crc config set consent-telemetry no` (or
> `yes`). It does not affect how the cluster runs.

## Plan the cluster size

OpenShift Local reads its size from `crc config`, and the size only takes effect
while the cluster is stopped. The CPU count is physical cores the VM pins, so on a
machine with hyperthreading, budget against real cores, not the logical-processor
count your system monitor shows. Decide now which target you want so you can
start the cluster once at the right size.

| Target | CPUs | Memory | Disk | Use it for |
|--------|------|--------|------|------------|
| Core | 6 | 20 GiB | 80 GB | Chapters on deploying, Routes, Helm: a cluster plus a small app |
| Platform | 12 | 32 GiB | 80 GB | Adding the service mesh, Operators, and observability on top |

This guide reaches the service mesh and the Operators chapters, so the **platform**
target is the one to plan for if your host has the headroom. On a smaller host,
start with the core target and raise it later; the setting is a one-line change
followed by a restart.

The jump to 32 GiB is not arbitrary. The idle control plane and the built-in
components already hold several gigabytes before you deploy anything, and each
Operator you add (the service mesh control plane, Kiali, the autoscaler, the
observability stack) brings its own Pods. The platform target leaves room for all of
them plus a workload; the core target does not.

You set these right before the first start, with:

```bash
crc config set cpus 12
crc config set memory 32768   # MiB
crc config set disk-size 80   # GB
```

Memory is in mebibytes, so 32 GiB is `32768`. Leave headroom for the host
itself: the numbers above are what the VM takes, not what your machine has. The disk
figure is a cap, not a reservation: the image starts small and grows toward it as the
cluster writes, so a larger cap costs nothing until you use it but saves you a
stop-and-resize later.

## Where this fits

You now have a host that can run the VM, an account, the `crc` download, and the
pull secret, and you have chosen a cluster size. Next, you install the `crc`
binary and wire up the `oc` and `kubectl` clients, then run `crc setup` and
`crc start` to bring the cluster up for the first time.

## For deeper coverage

- [**Kubernetes: Up and Running**](https://www.oreilly.com/library/view/-/9781098110192/) (Burns, Beda, Hightower, Evenson, O'Reilly) grounds you in the cluster objects CRC will run, useful to read alongside the first chapters.
- Official docs: the [Red Hat OpenShift Local documentation](https://developers.redhat.com/products/openshift-local/overview) for the authoritative install, sizing, and pull-secret steps, and the [OpenShift Container Platform documentation](https://docs.openshift.com/) for the platform CRC brings up locally.

## Checklist

- [ ] Virtualization is enabled (`grep -Ec '(vmx|svm)' /proc/cpuinfo` is non-zero).
- [ ] The host has enough free memory and disk for the target you chose.
- [ ] You have a free Red Hat Developer account.
- [ ] The `crc` archive is downloaded.
- [ ] The pull secret is saved as a file and is git-ignored.
- [ ] You have chosen the core or platform cluster size for your host.
