---
title: "Prerequisites and getting CRC"
order: 1
description: "Prepare the Fedora host, create a free Red Hat Developer account, download OpenShift Local and the pull secret, and plan the cluster size."
---

OpenShift Local (the command is `crc`, short for CodeReady Containers) runs a
single-node OpenShift 4 cluster inside a local virtual machine. Before you start
the cluster, you need three things: a host that can run the VM, a
free Red Hat Developer account, and two downloads: the `crc` release and a *pull
secret*. This chapter gets all of that in place. It installs nothing from the
cluster yet; that begins in the next chapter.

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
hypervisor.

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

The pull secret is a credential. Treat it like a password:

- Save it as a file (for example `~/.crc/pull-secret.json`) and leave it there.
- Do not commit it to a repository. If your project has a `.gitignore`, add a
  `pull-secret*.json` rule so it cannot be staged by accident.
- Do not paste its contents into a terminal, a script, or a chat. Every command
  in this guide takes the *path* to the file, never its text.

## Plan the cluster size

OpenShift Local reads its size from `crc config`, and the size only takes effect
while the cluster is stopped. Decide now which target you want so you can
start the cluster once at the right size.

| Target | CPUs | Memory | Disk | Use it for |
|--------|------|--------|------|------------|
| Core | 6 | 20 GiB | 80 GB | Chapters on deploying, Routes, Helm: a cluster plus a small app |
| Platform | 12 | 32 GiB | 80 GB | Adding the service mesh, Operators, and observability on top |

This guide reaches the service mesh and the Operators chapters, so the **platform**
target is the one to plan for if your host has the headroom. On a smaller host,
start with the core target and raise it later; the setting is a one-line change
followed by a restart.

You set these right before the first start, with:

```bash
crc config set cpus 12
crc config set memory 32768   # MiB
crc config set disk-size 80   # GB
```

Memory is in mebibytes, so 32 GiB is `32768`. Leave headroom for the host
itself: the numbers above are what the VM takes, not what your machine has.

## Where this fits

You now have a host that can run the VM, an account, the `crc` download, and the
pull secret, and you have chosen a cluster size. Next, you install the `crc`
binary and wire up the `oc` and `kubectl` clients, then run `crc setup` and
`crc start` to bring the cluster up for the first time.

## Checklist

- [ ] Virtualization is enabled (`grep -Ec '(vmx|svm)' /proc/cpuinfo` is non-zero).
- [ ] You have a free Red Hat Developer account.
- [ ] The `crc` archive is downloaded.
- [ ] The pull secret is saved as a file and is git-ignored.
- [ ] You have chosen the core or platform cluster size for your host.
