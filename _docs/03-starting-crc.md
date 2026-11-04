---
title: "Starting the cluster"
order: 3
description: "Set the cluster size, run crc setup, start OpenShift with your pull secret, and log in with oc and the web console."
---

## Learning objectives

By the end of this chapter you can:

- Set the cluster size with `crc config` before starting
- Run `crc setup` to prepare the host and `crc start` with your pull secret
- Log in from the command line with `oc` using the `crc-admin` context
- Reach the web console and confirm the node is `Ready` and every cluster operator is healthy

## Why this matters

This is the chapter where OpenShift comes up. You set the cluster size you chose
earlier, prepare the host with `crc setup`, start the cluster with your pull
secret, and then log in two ways: with `oc` on the command line and with the web
console in a browser.

## One cluster at a time

OpenShift Local runs one VM and expects the host to itself. If you also run
minikube or another local cluster, stop it first so the two don't compete for
CPU, memory, and the KVM subsystem:

```bash
minikube stop            # if you have minikube running
crc status               # should report "Stopped" before you start
```

Two clusters sharing one host don't fail cleanly. They fail with symptoms that look
like bugs in whatever you're running: Pods that stay Pending for want of memory, an
API server that times out under CPU pressure, a disk that fills mid-build. Stopping the
other cluster first removes a whole category of confusing failures before it starts, so
it's worth making a habit rather than a thing you check only once something breaks.

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

Err on the side of more memory than you think you need. An undersized cluster doesn't
refuse to start; it starts and then struggles, with cluster operators flapping between
healthy and degraded as they compete for memory. That's a far harder state to diagnose
than a clean "not enough memory" message, so if your host can spare it, the platform
target is the safer choice even for the early chapters.

## Prepare the host

`crc setup` does the one-time host preparation: it checks virtualization, sets up
the libvirt network, installs the host DNS rule, and unpacks the OpenShift bundle into
`~/.crc`. Run it once per CRC version:

```bash
crc setup
```

It prints each check as it runs and fixes what it can. If a check fails, it tells
you what to do (enable virtualization, add your user to a group, free disk space)
and you re-run it. Nothing starts yet. The bundle unpack is the slow part of this
step, because the bundle is several gigabytes; once it's in `~/.crc`, later starts on
the same CRC version reuse it. You run `crc setup` again only after you upgrade CRC to a
new release, or if a later check reports the host configuration has drifted.

## Start OpenShift

Start the cluster, pointing `crc` at the pull-secret file you saved earlier.
Pass the *path*; `crc` reads it once and stores it in the VM. You never print its
contents:

```bash
crc start --pull-secret-file ~/.crc/pull-secret.json
```

The first start takes several minutes, and it's doing real work the whole time. The
VM boots Red Hat Enterprise Linux CoreOS, the immutable OS OpenShift nodes run. The
kubelet starts and brings up the control plane as static Pods: etcd, the API server,
the scheduler, and the controller managers. Once the API answers, the *cluster
operators* take over, each reconciling one part of the platform (the ingress router,
the image registry, the console, authentication, monitoring) until all of them report
healthy. That settling is why `crc start` doesn't return the instant the API is up,
and why a cluster can need another minute or two after the command finishes before
every operator is ready.

When it finishes, `crc` prints how to log in, including the `oc` login command and the
kubeadmin credentials.

> **Never paste the kubeadmin password or a token.** When you need the console
> login, run `crc console --credentials` yourself to see it. Keep it out of
> scripts, commits, and anything you share. The command-line login below uses the
> admin *context* that `crc start` writes, so you don't need to handle the
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

The admin context is the reason this guide handles no passwords. `crc start` writes a
`crc-admin` context whose credentials are already baked into your kubeconfig, so
switching to it logs you in as `kubeadmin` without a prompt. It also writes a
`crc-developer` context for the unprivileged `developer` user, which is useful when you
want to see the cluster the way a non-admin would, for example to check that an SCC or
an RBAC rule actually restricts what you think it does. This guide stays on `crc-admin`
unless a chapter says otherwise.

## What came up: the cluster operators

A *cluster operator* is OpenShift's own unit of platform management: one controller
that owns one platform capability and reports its health through three conditions.
Checking them is how you confirm the cluster is actually ready, not just booted:

```bash
# Every cluster operator should be Available=True, Progressing=False, Degraded=False.
oc get clusteroperators

# The single node should be Ready.
oc get nodes
```

Read the three condition columns together. `Available=True` means the capability is
serving. `Progressing=True` means it's still rolling out a change, normal right after
a start and expected to clear on its own. `Degraded=True` is the one to act on: it
means the operator can't reach its desired state, and on CRC the usual cause is
resource pressure from an undersized VM. Wait for `Progressing` to clear across the
board before you deploy anything, because an operator still settling can make an
unrelated deploy look like it failed.

> **⌨️ The `oc` way**
>
> `oc status` gives a project-scoped summary that `kubectl` has no equivalent for:
> the current project, its Routes, the Services behind them, and anything not yet
> running. Run it after any deploy to see what the project looks like at a glance.

## One node, every role

Look closely at the node and you see what makes this a single-node cluster:

```bash
oc get nodes -o wide
# NAME   STATUS   ROLES                         AGE   VERSION
# crc    Ready    control-plane,master,worker   ...   v1.35.6
```

The one node carries all three roles at once. On a multi-node cluster the control-plane
nodes usually carry a taint that keeps ordinary workloads off them, so your Pods land on
dedicated worker nodes. CRC removes that taint, because there's nowhere else for a Pod
to go: the same node has to run both the control plane and your application. That's why
every Deployment you create here schedules without any tolerations, and it's the one
place where local behavior differs from a production cluster in a way you'll notice.
The Kubernetes version the node reports is the one inside this OpenShift release, which
matters when a tool or chart pins a minimum Kubernetes version.

## Open the web console

OpenShift ships a full web console. Open it with:

```bash
crc console
```

That launches your browser at `https://console-openshift-console.apps-crc.testing`.
Log in as `kubeadmin`; retrieve the password with `crc console --credentials` if
you don't have it. The console has two perspectives, and the switcher between them is
worth knowing from the start. The **Administrator** perspective is where you manage the
cluster: nodes, cluster operators, the OperatorHub catalog later chapters install from,
and a YAML editor for any resource. The **Developer** perspective is application-centric,
built around a Topology view that draws your Deployments, the Services wiring them
together, and the Routes exposing them, which is a fast way to see the shape of what you
have deployed without reading YAML.

Two console areas come up repeatedly in later chapters. **OperatorHub**, under the
Administrator perspective, is the catalog you install the service mesh and the other
Operators from, and it's also where you watch an install progress and approve it. The
**Observe** area carries the cluster's built-in monitoring: dashboards for node and
workload resource use, and a metrics query page. On an undersized cluster those
dashboards are the quickest way to confirm that memory pressure, rather than a bug, is
behind a Pod that won't schedule.

## The internal image registry

OpenShift ships an internal image registry, and it's already running on your cluster.
It matters here because later chapters build container images inside the cluster rather
than on your host: a build produces an image, pushes it to the internal registry, and a
Deployment pulls it back, all without a container engine on your machine. You don't
configure any of this now. It's enough to know the registry is part of what came up
during the start, which is one more reason the cluster asks for the memory it does. When
a build chapter refers to pushing an image "to the cluster," this registry is where it
lands.

## When a start goes wrong

Most failed starts come down to one of a few causes, and each has a clear fix:

- **An expired or wrong pull secret.** If the cluster can't pull its release images,
  download a fresh pull secret and start again. Pass the new file with
  `--pull-secret-file`.
- **Not enough memory or disk.** A start that boots but leaves operators `Degraded`, or
  Pods stuck `Pending`, is usually undersized. Stop the cluster, raise `memory` or
  `disk-size`, and start again.
- **Clock skew after sleep or resume.** The cluster's internal certificates are
  time-sensitive, so if the host slept and the VM's clock drifted, the API can start
  rejecting its own certificates. A `crc stop` followed by `crc start` resynchronizes
  the clock and clears it.
- **A stale bundle.** The certificates in a CRC bundle have a limited lifetime. A
  cluster left unstarted for a long time, or a CRC release that has aged, can fail to
  start on expired certificates. Upgrading to a current CRC release, which carries a
  fresh bundle, is the fix.
- **A start that hangs waiting for the API.** If `crc start` sits for a long time on a
  message about waiting for the kube-apiserver, the control plane is coming up slowly
  under resource pressure rather than hung. Give it a few minutes; if it never
  completes, stop the cluster, raise the memory, and start again. When it's stuck
  rather than slow, the cause almost always traces back to the VM being too small.

When a start fails, `crc start --log-level debug` prints what it was doing when it
stopped, which almost always points at one of the causes above. If nothing in the log
is clear, the reliable reset is `crc stop`, then `crc delete`, then `crc start`: it
discards a half-built VM and provisions a fresh one from the cached bundle, without a
re-download. That's slower than a plain start, but it clears a corrupted VM state that
no amount of restarting will fix, and it leaves you on a known-clean cluster to
continue from.

## Reaching the cluster from the host

Because of user-mode networking, you reach both the API and the Routes through
`127.0.0.1` on names that `crc setup` taught the host to resolve. Two commands orient
you:

```bash
crc console --url      # the console address, console-openshift-console.apps-crc.testing
oc whoami --show-server # the API server, api.crc.testing:6443
```

Both names resolve to the loopback address, which is correct and not a misconfiguration.
A tool that refuses to trust a loopback API endpoint is the thing to reconfigure, not
the cluster.
If a Route ever fails to resolve on the host, the cause is almost always the DNS rule
`crc setup` installs: a NetworkManager dispatcher entry that points `.apps-crc.testing`
and `.crc.testing` at the cluster. Re-running `crc setup` restores it. You don't edit
`/etc/hosts` for individual Routes; the wildcard rule covers every hostname the cluster
will ever serve under `apps-crc.testing`, which is what makes a freshly created Route
reachable the moment it exists.

## Stopping and starting again

Stop the cluster when you're done for the day; don't delete it. A stop keeps the
VM and its state so the next start is quick:

```bash
crc stop
```

Avoid `crc delete`: it discards the VM, and the next start repeats the full
first-boot. Reserve it for when you want a clean slate or are changing
to a new CRC bundle. The distinction matters later in this guide, where starting a
verification run against a known-empty cluster is worth the slower `crc delete` start,
while day-to-day iteration on one project wants the fast `crc stop` and `crc start`.

## Build, run, observe

A quick end-to-end check that the cluster is live and you're the admin:

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

## For deeper coverage

- [**Kubernetes: Up and Running**](https://www.oreilly.com/library/view/-/9781098110192/) (Burns, Beda, Hightower, Evenson, O'Reilly) explains the control plane and cluster operators that come up when the cluster starts.
- Official docs: the [Red Hat OpenShift Local documentation](https://developers.redhat.com/products/openshift-local/overview) for start-up and troubleshooting, and the [OpenShift Container Platform documentation](https://docs.openshift.com/) for cluster operators and the web console.

## Where this fits

OpenShift is running and you're logged in. The next chapter looks at `oc` and `kubectl`
side by side: what they share, where `oc` does more, and how projects relate to
namespaces, so the deploying chapters that follow read cleanly in either CLI.
