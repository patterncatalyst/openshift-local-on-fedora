---
title: "Installation"
order: 2
description: "Install the crc binary, put it on your PATH, and wire up the oc and kubectl clients the cluster ships with."
---

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

## The oc and kubectl clients

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
it is the recommended path. The one caveat: `crc oc-env` resolves the path inside
`~/.crc`, so the cluster must have been set up at least once for it to
point somewhere real.

### Option B: install standalone oc and kubectl

If you want `oc` and `kubectl` available even when CRC has never been set up,
install them yourself. The download page that carried `crc` also offers the
clients; extract each binary to `~/.local/bin`:

```bash
install -m 0755 /tmp/oc ~/.local/bin/oc
install -m 0755 /tmp/kubectl ~/.local/bin/kubectl
```

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

## Shell completion (optional)

Both clients generate shell completion. For bash:

```bash
crc completion bash | sudo tee /etc/bash_completion.d/crc >/dev/null
oc  completion bash | sudo tee /etc/bash_completion.d/oc  >/dev/null
```

Open a new shell to pick them up. `crc <Tab>` and `oc get <Tab>` will then
complete subcommands and resource types.

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

## Where this fits

The tools are installed. Next, you set the cluster size you chose earlier,
run `crc setup` to prepare the host, and `crc start` to bring OpenShift up for
the first time, then log in and open the web console.
