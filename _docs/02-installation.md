---
title: "Installation"
order: 2
description: "Install the crc binary, put it on your PATH, and wire up the oc and kubectl clients the cluster ships with."
---

## Learning objectives

By the end of this chapter you can:

- Install the `crc` binary and put it on your PATH
- Verify the installed release with `crc version`
- Wire up the bundled `oc` and `kubectl` clients the cluster ships with
- Confirm the cluster reports `Stopped` before the first start

## Why this matters

You now have the `crc` archive and a pull secret on disk. This chapter
installs the `crc` binary and sets up the two clients you drive the cluster with:
`oc`, the OpenShift CLI, and `kubectl`, the Kubernetes CLI. It still does not
start anything; `crc setup` and `crc start` come next.

## Install the crc binary

The download is a compressed archive with a single `crc` executable inside.
Extract it and put the binary on your `PATH`. A per-user location like
`~/.local/bin` keeps it out of the system directories and needs no `sudo`:

```bash
# Adjust the archive name to the version you downloaded.
tar -xf ~/Downloads/crc-linux-amd64.tar.xz -C /tmp

mkdir -p ~/.local/bin
install -m 0755 /tmp/crc-linux-*-amd64/crc ~/.local/bin/crc
```

A per-user install is the path this guide uses throughout. It needs no root, it keeps
one binary per user rather than a system-wide one that every account shares, and
upgrading later is a single `install` command over the top. Nothing about `crc`
requires it to live in `/usr/bin` or `/usr/local/bin`, and keeping it out of those
directories avoids a collision with any `crc` or `oc` a package manager might place
there.

### Verify the download

The download page lists a SHA-256 checksum next to the archive. Check it before you
extract, so a truncated or tampered download fails loudly rather than part way through
a cluster start:

```bash
sha256sum ~/Downloads/crc-linux-amd64.tar.xz
# compare the printed digest to the one on the download page
```

A matching digest tells you the archive arrived intact and unaltered. A mismatch means
the file is corrupt or has been changed in transit, so download it again rather than
extracting it; a half-good `crc` binary tends to fail in ways that look like cluster
problems, which wastes a good deal of time chasing the wrong layer of the stack.

Make sure `~/.local/bin` is on your `PATH`. On Fedora it usually is; if `which
crc` comes up empty, add it to your shell profile:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
# then open a new shell, or: source ~/.bashrc
```

Confirm the binary runs and reports the versions it will install:

```bash
crc version
```

```
CRC version: 2.64.0+...
OpenShift version: 4.22.14
MicroShift version: 4.22.13
```

The OpenShift version is baked into the CRC release as a *bundle*; you do not
download it separately. The first `crc setup` unpacks that bundle
into `~/.crc`.

The third line, the MicroShift version, is there because the same `crc` binary can run
a MicroShift preset instead of full OpenShift. This guide stays on the `openshift`
preset, so the MicroShift line is informational: it tells you which MicroShift build
this release would run if you switched presets, and nothing in these chapters uses it.
The `+...` suffix on the CRC version is the build's commit hash, handy only when you
report an issue and need to say exactly which build you are on.

### Upgrading CRC later

When a newer CRC comes out, install the new binary the same way, over the old one.
A new release carries a new OpenShift bundle, so the first `crc start` after an
upgrade pulls that bundle, and a major version jump usually wants a clean slate: stop
the cluster, run `crc delete` to discard the old VM, then `crc setup` and `crc start`
on the new version. Your `crc config` settings survive a binary upgrade, so you do not
re-enter the sizing. This matches the house habit of staying on current tool
versions rather than pinning an old one: upgrade `crc`, do not hold it back.

## How CRC runs the cluster

The `crc` binary you just installed is a manager, not the cluster itself. When you
start the cluster, `crc` drives three layers on your host. At the bottom is KVM, the
Linux kernel's own hypervisor, which is why the virtualization check in the previous
chapter mattered. On top of KVM, `libvirt` and its `qemu` process define and run the
virtual machine: one VM, named `crc`, that holds the whole single-node cluster. And
alongside them `crc` runs a small background daemon that owns the VM's lifecycle and,
in the default user-mode networking, the tunnel that carries cluster traffic back to
your host.

That tunnel is the reason `api.crc.testing` and the Routes resolve to `127.0.0.1`
without any bridge or route on your network: a user-space process forwards the VM's
ports to the loopback address, so the cluster is reachable locally and nowhere else.
Knowing these layers makes the failure modes legible. A start that fails on
"virtualization" is a KVM or firmware problem; one that fails creating the network is
libvirt; one where the API never answers after a clean start is usually the daemon or
the tunnel, not the cluster. You do not manage any of these by hand. `crc` creates,
starts, and tears them down for you; the point is only to recognize which layer a
message is about.

## The oc and kubectl clients

OpenShift is Kubernetes with an enterprise layer on top, and `oc` is the client that
speaks both. Everything `kubectl` knows about (Pods, Deployments, Services, the whole
core API) is present unchanged, and OpenShift adds its own API groups for the features
that make it OpenShift: `route.openshift.io` for Routes, `security.openshift.io` for
SCCs, `project.openshift.io` for Projects, and the Operator APIs. `oc` carries verbs
for those groups that `kubectl` has no equivalent for, which is why the chapters that
reach a Route or an Operator switch to `oc`.

Every CRC release bundles a matching `oc`, so you do not fetch the client
separately. There are two ways to reach it.

### Option A: use the bundled client (recommended)

`crc oc-env` prints the shell commands that put the bundled `oc` on your `PATH`.
Evaluate it in your current shell:

```bash
eval "$(crc oc-env)"
oc version --client
```

To have it in every shell, add the same line to your profile:

```bash
echo 'eval "$(crc oc-env)"' >> ~/.bashrc
```

The bundled client is always version-matched to the cluster bundle, which is why
it is the recommended path. `crc oc-env` prepends the client's directory inside
`~/.crc` to your `PATH`, so the bundled `oc` wins over any other `oc` already
installed. The one caveat: it resolves the path inside `~/.crc`, so the cluster must
have been set up at least once for it to point somewhere real.

### Option B: install standalone oc and kubectl

If you want `oc` and `kubectl` available even when CRC has never been set up,
install them yourself. The download page that carried `crc` also offers the
clients; extract each binary to `~/.local/bin`:

```bash
install -m 0755 /tmp/oc ~/.local/bin/oc
install -m 0755 /tmp/kubectl ~/.local/bin/kubectl
```

Keep a standalone `oc` in step with the cluster. A client more than one minor version
off from the API server still works for everyday verbs but can warn or misbehave on
newer resources, so when you upgrade CRC, refresh a standalone `oc` too. The bundled
client in Option A avoids this by construction, which is the other reason to prefer
it.

> **⌨️ The `oc` way**
>
> `oc` is a superset of `kubectl`: every `kubectl` command works unchanged as
> `oc`, and `oc` adds OpenShift-only verbs (`oc new-app`, `oc expose` for Routes,
> `oc project`, `oc status`, `oc adm`). This guide writes the portable Kubernetes
> workflow as `kubectl` and flags the OpenShift shortcuts in callouts like this
> one. If you prefer, run every `kubectl` command in the guide as `oc` instead;
> the output is the same.

If you want both and do not want to install a second binary, a symlink makes
`kubectl` resolve to `oc`:

```bash
ln -s ~/.local/bin/oc ~/.local/bin/kubectl   # oc answers to the kubectl name
```

### When more than one oc is on your PATH

This is worth settling now, because it causes confusing failures later. A host can
easily end up with several things named `oc`: the bundled client from `crc oc-env`, a
standalone one you installed, and sometimes a wrapper a different tool dropped into
`/usr/local/bin` that only runs `oc` inside a container. The container wrapper is the
dangerous one here, because it cannot reach `api.crc.testing`: the name resolves to
`127.0.0.1`, which inside the wrapper's container is the container itself, not your
host, so every call fails with a connection refused.

Check which `oc` you are actually running, and make sure it is a plain binary:

```bash
command -v oc            # should resolve into ~/.crc/... after crc oc-env
file "$(command -v oc)"  # "ELF ... executable", not a shell script wrapper
```

If `command -v oc` points at a wrapper, run `eval "$(crc oc-env)"` so the bundled
client takes precedence, or call the bundled binary by its full path. The bundled
client talks to the cluster directly and is the one every command in this guide
assumes.

## Shell completion (optional)

Both clients generate shell completion. For bash:

```bash
crc completion bash | sudo tee /etc/bash_completion.d/crc >/dev/null
oc  completion bash | sudo tee /etc/bash_completion.d/oc  >/dev/null
```

For zsh, write the completion onto a directory in your `fpath` and reload:

```bash
oc completion zsh > "${fpath[1]}/_oc"
```

For fish, write to its completions directory:

```bash
oc completion fish > ~/.config/fish/completions/oc.fish
```

Open a new shell to pick these up. `crc <Tab>` and `oc get <Tab>` will then
complete subcommands and resource types, which saves a lot of typing against the long
OpenShift resource names. OpenShift adds dozens of custom resource types beyond the
core Kubernetes set, and each Operator you install adds more, so tab-completion is the
quickest way to recall an exact name. When completion is not enough, `oc api-resources`
lists every type the cluster currently serves along with its short name and API group,
which is the authoritative reference once the cluster is up.

## Behind a proxy

If the host reaches the internet through a corporate proxy, tell `crc` about it so the
bundle download and the in-cluster pulls succeed. You can set it in the environment or
in `crc config`:

```bash
crc config set http-proxy  http://proxy.example.com:3128
crc config set https-proxy http://proxy.example.com:3128
crc config set no-proxy    .crc.testing,127.0.0.1
```

Keep `.crc.testing` and `127.0.0.1` in `no-proxy` so cluster-local traffic does not
bounce off the proxy. On a home or lab network with direct access, skip this section.

## Verify

Before moving on, confirm all three commands resolve:

```bash
crc version          # CRC and the bundled OpenShift version
command -v oc         # path to the oc client
command -v kubectl    # path to kubectl (or the oc symlink)
```

If `oc` or `kubectl` is missing, you either skipped Option A's `eval` line or have
not added `~/.local/bin` to `PATH`. Fix that now; starting the cluster assumes all
three resolve.

### If the PATH change does not take

A `command not found` right after you edited a profile is almost always a shell
mismatch rather than a bad install. The line you added runs only when that particular
profile is read, and which file a shell reads depends on how it starts. Fedora's
default shell is bash, which reads `~/.bashrc` for interactive shells; if your shell
is zsh, the same line belongs in `~/.zshrc` instead. A fresh terminal tab reads the
profile; a shell you already had open does not, until you `source` the file or open a
new one.

Two quick checks settle it:

```bash
echo "$PATH" | tr ':' '\n' | grep -n local/bin   # is ~/.local/bin actually present?
hash -r                                           # forget cached command paths
```

`hash -r` matters after you move a binary: the shell caches the location of each
command it has run, so a stale cache can keep pointing at an old path even once `PATH`
is right. Clearing it, or opening a new shell, makes the next `oc` resolve freshly.

## Removing CRC or starting over

It is worth knowing the reverse of installation before you need it, because the two
cleanup commands do different things and the difference matters. `crc delete` throws
away the VM and its cluster state but keeps the cached bundle and your host setup, so
a later `crc start` re-provisions a fresh cluster quickly without a download. This is
the command you reach for when you want a clean cluster, and a later chapter leans on
exactly that habit: starting from a known-empty cluster rather than one carrying
leftovers from earlier work.

`crc cleanup` goes further and reverses what `crc setup` did to the host: it removes
the libvirt network and the DNS rule. Run it only when you are uninstalling CRC for
good. After it, removing the `~/.local/bin/crc` binary and the `~/.crc` directory
leaves the machine as it was. For normal day-to-day use you never run `crc cleanup`;
`crc stop` and `crc delete` are the two you actually use.

## What crc setup will prepare

The next chapter runs `crc setup`, which is the one-time host preparation step before
the first start. It is worth knowing in advance what it touches, so none of it is a
surprise: it validates the host (virtualization, libvirt, free resources), unpacks the
OpenShift bundle into `~/.crc`, creates the libvirt network the VM uses, installs the
host DNS rule that makes `api.crc.testing` and `*.apps-crc.testing` resolve, and adds
your user to the `libvirt` group. It does not start the cluster. You run it once per
machine, and again after a CRC upgrade.

Each of those steps is why `crc setup` needs to run before the first start rather than
as part of it. The host validation fails fast if virtualization is off, so you find
out before a long bundle unpack. The network and DNS changes are host-level and
persist across cluster restarts, so they are done once rather than on every start. And
the group change is the one with a delayed effect, since a new group membership only
applies to login sessions that start after it, which is the reason the previous
chapter suggested logging out and back in once.

## Confirm your configuration

Before the next chapter, it is useful to see the settings `crc` will start with. Two
read-only commands show the whole picture:

```bash
crc config view      # every value you have set (cpus, memory, disk-size, proxy)
crc status           # whether the cluster is running, and its disk usage
```

`crc config view` lists only values you have changed from their defaults, so an empty
or short list early on is expected. `crc status` reports `Stopped` until you start the
cluster, which is the state you should be in at the end of this chapter.

## For deeper coverage

- [**Kubernetes: Up and Running**](https://www.oreilly.com/library/view/-/9781098110192/) (Burns, Beda, Hightower, Evenson, O'Reilly) covers the two clients you just installed and the API they drive.
- Official docs: the [Red Hat OpenShift Local documentation](https://developers.redhat.com/products/openshift-local/overview) for installation details, and the [Kubernetes documentation](https://kubernetes.io/docs/reference/kubectl/) for the `kubectl` reference.

## Where this fits

The tools are installed. Next, you set the cluster size you chose earlier,
run `crc setup` to prepare the host, and `crc start` to bring OpenShift up for
the first time, then log in and open the web console.
