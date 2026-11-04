---
title: "Editor and shell"
order: 12
description: "Work inside the cluster: a shell in a running Pod with oc rsh, a throwaway debug Pod with oc debug, file copies, port-forwards, and the web terminal."
---

Most of this guide drives the cluster from outside, with `oc` and `kubectl` against the
API. Sometimes you need to be inside it: a shell in a running container to see what it
sees, a throwaway Pod to debug an image that will not start, a file copied in or out, a
port forwarded to your host. This chapter collects the tools for working inside the
cluster, from the `oc` verbs that need nothing installed to the browser-based web terminal.
Most of them are everyday debugging tools you will reach for constantly once a workload does
something you did not expect, so they are worth meeting before you need them in a hurry.

## A shell in a running Pod

`oc rsh` opens an interactive shell inside a running container, the fastest way to see a
workload from the inside:

```bash
oc rsh deploy/web            # a shell in one of the Deployment's Pods
# then, inside the container:
curl -s http://localhost:8080 | head
env | grep -i service
exit
```

Targeting `deploy/web` rather than a Pod name is the habit to build: `oc` picks a current
Pod of the Deployment, so you do not copy a generated Pod name that changes on every
rollout. From inside, you see exactly the filesystem, environment, and network the
container has, which settles questions that guessing from outside cannot. When you only
need to run one command rather than a whole session, `oc exec` does it without the
interactive shell:

```bash
oc exec deploy/web -- cat /etc/os-release
```

The `--` separates `oc`'s own flags from the command to run in the container, so
everything after it is passed through untouched.

A caution that saves confusion: a shell opened with `oc rsh` lives only as long as the Pod. If
the Pod is replaced by a rollout, scaled away, or restarted while you are inside, your session
ends, because it was attached to that one container. This is correct behavior, not a dropped
connection: the container you were in no longer exists. For anything you want to keep across a
Pod's life, work from your host with `oc` against the Deployment, and treat a shell inside a
Pod as a look at one instance at one moment, not a place to leave work running.

## A throwaway debug Pod

`oc rsh` needs a running Pod, which is no help when the problem is that the Pod will not
stay running. `oc debug` solves that: it starts a fresh copy of the workload's Pod with the
entrypoint replaced by a shell, so you can inspect the image and its environment even when
the real Pod is crash-looping:

```bash
oc debug deploy/web          # a debug Pod from the Deployment's template, shell instead of the app
```

Because the debug Pod uses the same image, volumes, and service account as the real one but
does not run the failing command, it is the tool for "why does this container die on
start." You can look at the files the entrypoint expects, run the start command by hand to
see its error, and check what the image actually contains. The debug Pod is deleted when
you exit, so it leaves nothing behind.

`oc debug` also works against a node, which is how you get a shell on the CRC VM itself when
you need to look below the cluster:

```bash
oc debug node/crc           # a privileged Pod on the node; chroot /host for the node filesystem
```

Node debug is a cluster-admin tool, used sparingly, but on a single-node cluster it is the
way to inspect the host when a problem looks like it is below Kubernetes.

`oc debug` takes options that cover the awkward cases. Passing `--as-root` runs the debug
Pod as root, when you need to inspect something the restricted UID cannot read, which works
because debug Pods are a cluster-admin tool exempt from the usual SCC. Passing a different
image debugs with a richer toolset than the application image carries, so you can bring
`curl`, `ps`, and `dig` to an image built without them:

```bash
oc debug deploy/web --image=registry.access.redhat.com/ubi9/ubi -- sleep infinity
```

That starts a debug Pod from the workload's spec but with a general-purpose image, giving you
the tools to probe the environment the real image runs in. Between the default debug Pod and
these options, almost any "I cannot see what is wrong" situation has a way in.

## Copy files and forward ports

Two more `oc` verbs round out working with a Pod from your host. `oc cp` copies files in
or out of a container, for pulling a log the application wrote to disk or pushing a config
to test:

```bash
oc cp ./local.conf web-pod:/tmp/local.conf      # host -> Pod
oc cp web-pod:/var/log/app.log ./app.log        # Pod -> host
```

`oc port-forward` tunnels a Service or Pod port to your host, which reaches a workload that
has no Route without exposing it:

```bash
oc port-forward svc/web 8080:8080      # http://localhost:8080 now reaches the Service
```

Port-forward is the right tool for a service that should stay internal: a database you want
to connect a local client to, an admin endpoint you do not want on a Route. It lasts only
while the command runs, so it exposes nothing permanently, which is the difference from a
Route and the reason to prefer it for anything that is not meant to face the host. The
forward is also local to your machine, reachable only from `localhost`, so it opens nothing
to the network even while it runs. That makes it the safe default for one-off access to an
internal service during development: connect a client, do the work, stop the command, and the
path is gone.

One practical note on `oc cp`: it copies by streaming a tar archive through the container, so
the container must have `tar` on its path. Most base images do, but a minimal or distroless
image may not, and `oc cp` then fails with a confusing error. When that happens, `oc exec`
with a redirect is the fallback for a single file, or you debug with an image that has `tar`.
Knowing the mechanism turns that error from a mystery into a one-line explanation.

## The console's built-in terminal

The web console gives every running Pod a terminal without any of the commands above. Open
a Pod in the console, choose the Terminal tab, and you get an interactive shell in the
container, the same thing `oc rsh` provides, from the browser. For a quick look while you
are already in the console watching a workload, it is the fastest path, and it needs
nothing installed on your machine at all, since the terminal runs in the cluster and reaches
you through the browser you already have open. The console also shows a Pod's logs and events alongside the terminal,
so you can watch output and shell in from one place.

## The web terminal

For a shell with `oc` itself preloaded, rather than a shell inside one Pod, OpenShift offers
the **web terminal**: a browser terminal, launched from the console's toolbar, that runs in
a short-lived Pod with `oc` and `kubectl` already authenticated as you. It is a full
command line against the cluster without installing anything on your machine, which suits a
quick task from a browser or a shared machine where you would rather not set up the CLI.

The web terminal comes from an Operator, so it is installed the same way as the others:

```bash
oc get packagemanifest web-terminal -n openshift-marketplace \
  -o jsonpath='{range .status.channels[*]}{.name} {.currentCSV}{"\n"}{end}'
```

Once the Operator is installed, a terminal icon appears in the console's top toolbar, and
clicking it opens a session. The session's Pod is removed when it times out, so it leaves
nothing running. On a resource-tight single-node cluster the web terminal is optional, since
the bundled `oc` on your host does the same job without a Pod; install it when a
browser-only workflow is worth the memory.

The web terminal runs as you, with your permissions, which is the point to understand about
it. The session's Pod carries your identity, so it can do exactly what your account can do and
no more, and anything you run in it is subject to the same RBAC as the CLI on your host. On a
single-user CRC cluster that means full admin, the same as everywhere else in this guide; on a
shared cluster it is why the web terminal is a safe way to give someone a command line without
handing out a kubeconfig. The credentials never leave the cluster, and the session ends when
you close it.

## Editing from your own IDE

Working inside the cluster does not mean giving up your editor. Because `oc` uses your
kubeconfig, any tool that reads the same kubeconfig works against CRC with no extra setup,
and the editors you already use have OpenShift integration. The **OpenShift Toolkit**
extension for VS Code (and a matching plugin for the JetBrains IDEs) browses the cluster,
streams Pod logs, opens a terminal into a Pod, and deploys from a local project, all from the
editor window. It is the local counterpart to the console: the console runs in the browser,
the toolkit runs in your IDE, and both talk to the same cluster through the same credentials.

For a fully browser-based IDE, OpenShift offers **Dev Spaces**, its build of Eclipse Che: a
containerized development environment per project, with the editor, the tools, and the
runtime all running in the cluster, reached from a browser. It is powerful for onboarding and
for a consistent team environment, and it is heavy: it wants the platform-tier resources and
then some, so on a single-node CRC it is more a thing to know exists than to run alongside
other workloads. For local development on your own machine, the toolkit extension plus the
bundled `oc` is the lighter and more practical pairing.

> **⌨️ The `oc` way**
>
> This whole chapter is the `oc` way: `rsh`, `debug`, `cp`, `port-forward`, and `exec` have
> no plainer Kubernetes equivalents that are as direct. `kubectl` has `exec`, `cp`, and
> `port-forward` too, but `oc debug` and the `deploy/NAME` targeting are OpenShift
> conveniences that save reconstructing a Pod name or a debug Pod by hand.

## A debugging workflow

The tools are most useful in sequence. When a workload misbehaves, a reliable order
answers most problems without guessing:

1. `oc get events --sort-by=.lastTimestamp` and `oc describe pod` to see what the cluster
   tried and where it stopped: scheduling, image pull, admission, a failing probe.
2. `oc logs` (add `--previous` for a crashed container's last run) to read what the
   application itself said before it stopped.
3. `oc rsh` into a running Pod, or `oc debug` if it will not stay up, to look from the
   inside: the files, the environment, the network the container actually has.

Each step narrows the problem. Events and `describe` catch the cluster-level failures, logs
catch the application-level ones, and a shell catches the "it should work but does not"
cases where you have to see what the container sees. Reaching for a shell first, before
reading events and logs, is the common mistake: it skips the two steps that name most
failures outright. Going in order turns debugging from poking around into a short
checklist.

### Picking a container in a multi-container Pod

A Pod in the mesh, or any Pod with a sidecar, has more than one container, and the shell and
log commands need to know which. Add `-c` to name it:

```bash
oc logs deploy/web -c istio-proxy        # the sidecar's logs, not the app's
oc rsh -c httpd deploy/web               # a shell in the named container
```

Without `-c`, `oc` picks the first container, which is usually the app and usually what you
want, but when you are debugging the sidecar or an init container, naming it is how you reach
the right one.

## When to reach for which

The tools overlap, so a quick guide to which fits:

- **`oc rsh` / console terminal**: look inside a Pod that is running.
- **`oc exec`**: run one command in a running Pod, no session.
- **`oc debug`**: inspect a Pod or image that will not run, or get a node shell.
- **`oc cp`**: move a file in or out.
- **`oc port-forward`**: reach an internal port from your host, temporarily.
- **web terminal**: a full `oc` session from the browser, nothing installed.

The first instinct for "what is this container actually doing" is `oc rsh` or the console
terminal; for "why will it not start" it is `oc debug`. Those two cover most of the time you
need to be inside the cluster rather than outside it. The rest are for the narrower cases: a
file to move, a port to reach, a browser-only session. Keeping the list short in your head,
two main tools and a handful of specific ones, is what makes reaching for the right one quick
when something breaks and you want an answer rather than a search.

## Build, run, observe

```bash
oc new-project shell-demo 2>/dev/null || oc project shell-demo
oc apply -f httpd-deployment.yaml
oc rollout status deployment/web
oc exec deploy/web -- cat /etc/os-release | head -1    # run one command in the Pod
oc rsh deploy/web curl -s http://localhost:8080 | head -c 60   # a shell command inside
oc cp deploy/web:/etc/os-release ./os-release          # copy a file out
oc delete project shell-demo
```

Running a command inside the container, reaching its port from within, and copying a file
out confirm the inside-the-cluster tools are working.

## Where this fits

You can work inside the cluster as fluently as outside it. The next chapter steps back to
compare OpenShift Local with the other local options, minikube, kind, and a remote cluster,
so you know when CRC is the right tool and when it is not.
