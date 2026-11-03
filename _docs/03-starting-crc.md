---
title: "Starting the cluster"
order: 3
description: "Set the cluster size, run crc setup, start OpenShift with your pull secret, and log in with oc and the web console."
---

This is the chapter where OpenShift comes up. You set the cluster size you chose
earlier, prepare the host with `crc setup`, start the cluster with your pull
secret, and then log in two ways: with `oc` on the command line and with the web
console in a browser.

## One cluster at a time

OpenShift Local runs one VM and expects the host to itself. If you also run
minikube or another local cluster, stop it first so the two do not compete for
CPU, memory, and the KVM subsystem:

```bash
minikube stop            # if you have minikube running
crc status               # should report "Stopped" before you start
```

## Set the cluster size

The size takes effect only while the cluster is stopped, so set it before the
first start. Use the target you picked earlier. For the platform target this
guide builds toward:

```bash
crc config set cpus 12
crc config set memory 32768    # MiB (32 GiB)
crc config set disk-size 80    # GB
```

For the smaller core target, use `cpus 6` and `memory 20480`. You can change
these later; each change needs a `crc stop` and `crc start` to apply. Review what
is set with:

```bash
crc config view | grep -E 'cpus|memory|disk-size'
```

## Prepare the host

`crc setup` does the one-time host preparation: it checks virtualization, sets up
the libvirt network, and unpacks the OpenShift bundle into `~/.crc`. Run it once
per CRC version:

```bash
crc setup
```

It prints each check as it runs and fixes what it can. If a check fails, it tells
you what to do (enable virtualization, add your user to a group, free disk space)
and you re-run it. Nothing starts yet.

## Start OpenShift

Start the cluster, pointing `crc` at the pull-secret file you saved earlier.
Pass the *path*; `crc` reads it once and stores it in the VM. You never print its
contents:

```bash
crc start --pull-secret-file ~/.crc/pull-secret.json
```

The first start takes several minutes: the VM boots, the control plane comes up,
and the cluster operators settle. When it finishes, `crc` prints how to log in,
including the `oc` login command and the kubeadmin credentials.

> **Never paste the kubeadmin password or a token.** When you need the console
> login, run `crc console --credentials` yourself to see it. Keep it out of
> scripts, commits, and anything you share. The command-line login below uses the
> admin *context* that `crc start` writes, so you do not need to handle the
> password at all for `oc` work.

## Log in with oc

`crc start` writes a kubeconfig context for the cluster. Put the bundled client on
your `PATH` and switch to the admin context:

```bash
eval "$(crc oc-env)"
oc config use-context crc-admin
oc whoami                      # kubeadmin
oc cluster-info
```

Confirm the cluster is healthy before you deploy anything to it:

```bash
# Every cluster operator should be Available=True, Progressing=False, Degraded=False.
oc get clusteroperators

# The single node should be Ready.
oc get nodes
```

> **⌨️ The `oc` way**
>
> `oc status` gives a project-scoped summary that `kubectl` has no equivalent for:
> the current project, its Routes, the Services behind them, and anything not yet
> running. Run it after any deploy to see what the project looks like at a glance.

## Open the web console

OpenShift ships a full web console. Open it with:

```bash
crc console
```

That launches your browser at `https://console-openshift-console.apps-crc.testing`.
Log in as `kubeadmin`; retrieve the password with `crc console --credentials` if
you do not have it. The console gives you the Developer and Administrator
perspectives, the Operator catalog you will use in later chapters, and a YAML
editor for any resource.

## Stopping and starting again

Stop the cluster when you are done for the day; do not delete it. A stop keeps the
VM and its state so the next start is quick:

```bash
crc stop
```

Avoid `crc delete`: it discards the VM, and the next start repeats the full
first-boot. Reserve it for when you want a clean slate or are changing
to a new CRC bundle.

## Build, run, observe

A quick end-to-end check that the cluster is live and you are the admin:

```bash
crc status                                   # Running, OpenShift: Running
oc config use-context crc-admin
oc whoami                                    # kubeadmin
oc get nodes                                 # one node, Ready
oc get clusteroperators | grep -vE 'True .*False .*False' | head   # any unhealthy operators
oc new-project hello                          # create a scratch project
oc delete project hello                       # clean it up
```

If the node is `Ready`, every cluster operator is healthy, and you can create and
delete a project, the cluster is ready for the chapters that follow.

## Where this fits

OpenShift is running and you are logged in. The next chapter looks at `oc` and `kubectl`
side by side: what they share, where `oc` does more, and how projects relate to
namespaces, so the deploying chapters that follow read cleanly in either CLI.
