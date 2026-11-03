---
title: "oc and kubectl"
order: 4
description: "The two CLIs side by side: what they share, where oc does more, and how projects relate to namespaces."
---

OpenShift gives you two command-line tools: `kubectl`, the standard Kubernetes
CLI, and `oc`, the OpenShift CLI. They overlap almost completely. This chapter
sets out exactly how they relate, so the chapters that follow can lead with the
portable `kubectl` workflow and point out the OpenShift shortcuts as it goes.

## oc is a superset of kubectl

`oc` is built from the same code as `kubectl` and adds OpenShift-specific verbs on
top. Anything you can do with `kubectl` you can do with `oc` by the same name:

```bash
kubectl get pods          # standard Kubernetes
oc get pods               # identical result
```

So the whole Kubernetes workflow (creating Deployments, inspecting Pods, reading
logs, applying YAML) is written as `kubectl` in this guide and works verbatim as
`oc`. What `oc` adds is a set of commands for things that only exist on OpenShift,
or that OpenShift makes easier:

| Task | `kubectl` | `oc` |
|------|-----------|------|
| Switch working namespace | `kubectl config set-context --current --namespace=x` | `oc project x` |
| Create a namespace | `kubectl create namespace x` | `oc new-project x` |
| Expose a Service to the host | no equivalent (Routes are OpenShift) | `oc expose service x` |
| Build from source in the cluster | no equivalent (S2I is OpenShift) | `oc new-app` / `oc new-build` |
| Project-scoped status summary | no equivalent | `oc status` |
| Cluster-admin operations | limited | `oc adm ...` |
| Who am I / log in | no equivalent | `oc whoami`, `oc login` |

This is why the guide uses a callout rather than rewriting every command twice:

> **⌨️ The `oc` way**
>
> Where a `kubectl` command has a shorter or more capable `oc` form, a callout
> like this shows it. Where the feature is OpenShift-only (Routes, source builds,
> security context constraints, Operators), the chapter uses `oc` directly and
> says so. You never need both tools at once: pick one and the guide reads the
> same.

## Projects are namespaces

OpenShift *projects* are Kubernetes namespaces with a thin wrapper. A project is a
namespace plus some OpenShift metadata (a display name, a description, and the
default role bindings OpenShift adds when you create one through its own commands).

```bash
# These create the same underlying namespace; oc new-project also sets you to it
# and adds OpenShift's default role bindings.
kubectl create namespace demo
oc new-project demo
```

`oc project` both switches your current namespace and, with no argument, reports
which one you are in:

```bash
oc project demo           # switch to demo
oc project                # "Using project demo on server https://api.crc.testing:6443"
oc projects               # list the projects you can see
```

With `kubectl`, the equivalent of "switch namespace" is a context edit:

```bash
kubectl config set-context --current --namespace=demo
kubectl config view --minify -o jsonpath='{..namespace}'   # read it back
```

Both change the same thing: the namespace your next command acts on. `oc project`
is just the shorter path.

## The contexts crc writes

`crc start` writes a kubeconfig with two contexts: `crc-admin` (the `kubeadmin`
cluster administrator, which the guide uses) and `crc-developer` (an unprivileged
`developer` user, useful for seeing the cluster the way a non-admin does). Switch
between them with the standard kubeconfig command, or `oc`:

```bash
oc config get-contexts                 # list contexts; the current one is marked *
oc config use-context crc-admin        # admin for installing Operators, mesh, etc.
oc config use-context crc-developer    # a non-admin view
oc whoami                              # which user the current context is
```

Most of this guide runs as `crc-admin`, because installing Operators and a service
mesh needs cluster-admin. The developer context is worth knowing for the access
chapters, where seeing a permission denied is the point.

## A quick tour of oc extras

A few `oc` commands have no `kubectl` equivalent and are worth meeting now; later
chapters use them in context:

```bash
oc status                 # project summary: Routes, Services, what is not running
oc get routes             # the host-facing URLs (Chapter 6)
oc new-app --help         # build-and-deploy from source or an image
oc adm top nodes          # node CPU/memory, like kubectl top with admin framing
oc explain route.spec     # schema for OpenShift types, same as kubectl explain
```

> **🤖 Explore with your agent**
>
> "List every API resource that exists on this cluster but is not part of upstream
> Kubernetes, and group them by their API group, so I can see what OpenShift adds."

## Build, run, observe

Confirm the two CLIs behave as described:

```bash
oc config use-context crc-admin
oc whoami                              # kubeadmin
oc new-project cli-tour                 # project == namespace
kubectl get namespace cli-tour          # kubectl sees the same namespace
oc project cli-tour                     # switch with the short form
oc status                              # project summary (empty for now)
oc delete project cli-tour              # clean up
```

Creating a project with `oc` and seeing it as a namespace with `kubectl` is the
whole relationship in one exchange: same object, two names, two tools.

## Where this fits

You know how the two CLIs relate and how projects map to namespaces. Chapter 5
deploys a first application with `kubectl`, with `oc` callouts for the OpenShift
shortcuts, and Chapter 6 exposes it to your host with a Route.
