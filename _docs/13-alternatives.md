---
title: "Alternatives"
order: 13
description: "Where OpenShift Local fits next to minikube, kind, the Developer Sandbox, and a real remote OpenShift cluster, and when to reach for each."
---

## Learning objectives

By the end of this chapter you can:

- Compare OpenShift Local with minikube, kind, the Developer Sandbox, and a remote cluster
- Weigh the cost of a full OpenShift VM against lighter local options
- Choose the right tool for a given task rather than by habit

## Why this matters

OpenShift Local is one way to get a cluster, and it is not always the right one. This
chapter places it next to the other options a developer on Fedora has, so you can choose
by what you are actually trying to do rather than by habit. The short version: CRC gives
you real OpenShift locally at the cost of a heavy VM, and the alternatives trade one of
those two things away.

## What CRC is good at, and what it costs

CRC's one defining property is that it runs the same OpenShift you would run in
production, on your own machine. Everything that makes OpenShift OpenShift is present:
Routes, security context constraints, the OperatorHub and OLM, the internal registry, the
web console, the build machinery. Code and manifests you develop against CRC behave the
same way on a real cluster, because it is the same software, which is the whole reason to
use it over plain Kubernetes when OpenShift is your target.

The cost is weight. CRC is a full single-node OpenShift cluster in a VM, so it wants
several CPUs and many gigabytes of memory before you deploy anything, and the first start
is slow. If you do not need OpenShift's specific features, that weight buys you nothing,
and a lighter tool is the better choice. The decision almost always comes down to one
question: do you need OpenShift, or do you need Kubernetes?

### Footprint and startup, roughly

The weight difference is concrete. CRC's platform target asks for around a dozen CPUs and
32 GiB of memory to run comfortably, and a first start takes several minutes while the bundle
unpacks and the cluster operators settle. minikube runs a usable cluster in a few gigabytes
and starts in a minute or two. kind is lighter still and starts fastest of all, because a
node is a container rather than a VM, so a fresh cluster can be ready in well under a minute.
Those numbers are approximate and move with versions, but the ordering is stable: kind is
lightest, minikube sits in the middle, CRC is heaviest. The weight is not waste, it is the
cost of running real OpenShift, but it is the first thing to weigh when a host is
constrained, because a tool that will not fit in your memory is no tool at all.

## minikube

minikube is the closest comparison, and the companion guide to this one covers it in
depth. It runs a single-node (or small multi-node) plain Kubernetes cluster in a VM or a
container, and it is lighter than CRC because it is Kubernetes without the OpenShift layer.
For learning Kubernetes itself, for a workload that uses only core Kubernetes objects, or
for a host that cannot spare CRC's memory, minikube is the better fit. Its addon system
turns on an ingress controller, a registry, or a dashboard with one command, which is a
quick way to assemble just the pieces you want.

What minikube does not give you is OpenShift. There are no Routes, no SCCs enforcing an
arbitrary UID, no OperatorHub, no `oc new-app` building from source. If your target is
OpenShift, developing on minikube means discovering those differences later, on the real
cluster, rather than up front. Use minikube when the target is plain Kubernetes; use CRC
when the target is OpenShift. That single distinction decides between them more reliably
than any feature-by-feature comparison.

The two guides are built to be read together for exactly this reason. The minikube guide on
Fedora walks the same host and the same hands-on shape, so a concept you learn in one, a
Deployment, a Service, scaling, storage, carries straight across, and the places they diverge
are precisely the OpenShift-specific features this guide calls out. If you are deciding which
to learn first, start with whichever matches your immediate target, and know that the other is
a short step away rather than a fresh start.

## kind

kind runs Kubernetes inside Docker containers, one container per node, which makes it the
lightest and fastest of these options to start and tear down. Its speed and its clean
multi-node support make it the usual choice for continuous integration: a test job can
create a fresh cluster in under a minute, run against it, and throw it away. For local
development it works too, though its container-per-node model shows through in networking
and storage in ways a VM-based cluster hides.

kind is plain Kubernetes, like minikube, so the same OpenShift caveat applies: it is the
wrong tool when you need OpenShift features, and the right one when you need a disposable
Kubernetes cluster fast. Where minikube leans toward an interactive local cluster with
addons, kind leans toward automation and ephemeral clusters. Neither replaces CRC for
OpenShift work; both beat it for plain Kubernetes when weight and speed matter.

kind's real strength shows in a pipeline. Because a cluster is just containers, a CI job can
create one, deploy into it, run a suite of tests against real Kubernetes, and destroy it, all
in the time a VM-based cluster would still be booting. That throwaway-cluster-per-run model is
hard to match with CRC, whose start time and resource needs make it a poor fit for CI. When
your question is "does this manifest work on a real cluster, in an automated test," kind is
usually the answer, and when it is "does this work on OpenShift specifically," you are back to
CRC or a remote OpenShift, because kind cannot stand in for OpenShift's own behavior.

## What you trade away on plain Kubernetes

"Do you need OpenShift?" is easier to answer with the specific features in view. Developing on
minikube or kind means doing without, or hand-assembling, the things this guide used:

- **Routes and the built-in router.** On plain Kubernetes you install an ingress controller
  and write Ingress objects; OpenShift ships the router and the Route type ready to use.
- **Security context constraints.** The arbitrary-UID, non-root default that shaped every
  workload here is an OpenShift admission layer; plain Kubernetes is more permissive by
  default, so an image that runs on minikube may still fail on a real OpenShift cluster.
- **OperatorHub and OLM.** The one-command pinned operator installs came from OLM; on plain
  Kubernetes you apply an operator's manifests yourself and manage its upgrades by hand.
- **The internal registry and source builds.** `oc new-app` building an image inside the
  cluster, and the ImageStream that tracks it, are OpenShift; plain Kubernetes expects you to
  build and push images from outside.
- **The web console and the developer perspective.** minikube has a dashboard addon, but the
  Administrator and Developer perspectives, with the Topology view and the catalog, are
  OpenShift's.

None of these is impossible to reproduce on plain Kubernetes, but reproducing them is work,
and the result is not quite the same. If your target is OpenShift, developing against the real
thing on CRC is what keeps those differences from surfacing late.

## The Developer Sandbox for Red Hat OpenShift

Not every option is local. The Developer Sandbox is a free, hosted OpenShift environment
Red Hat runs: you sign in with a Red Hat account and get a project on a shared cluster,
with no install and nothing running on your machine. For trying OpenShift features, running
the console, or working from a laptop that cannot host CRC, it is the fastest way to a real
OpenShift without a VM.

Its limits are the flip side of being hosted and shared. You are a tenant with a quota,
not a cluster admin, so the things this guide does that need cluster-admin, installing
Operators cluster-wide, applying SCCs, creating a service mesh, are restricted or
unavailable. The Sandbox is excellent for application-level work on OpenShift and for
learning the console and the developer workflow; it is not where you install platform
Operators or model a whole cluster. CRC and the Sandbox complement each other: the Sandbox
for quick, admin-free access to OpenShift, CRC for the full-control, offline, platform-level
work.

## A real remote cluster

The last alternative is the thing CRC imitates: an actual OpenShift cluster, on a cloud or
on-premises, that you connect to with `oc login`. For anything beyond development, a shared
team environment, a staging cluster, a production deployment, this is the real target, and
CRC is the local stand-in for it. The value of CRC is precisely that it lets you do the
work offline, at no cost, on your own machine, and then move it to the remote cluster with
confidence because the two run the same software.

The remote cluster differs in the ways a single node cannot imitate: real high
availability across nodes, a load balancer with external IPs, shared storage with
`ReadWriteMany`, and the scale to run many workloads at once. Those are the edges this
guide flags where it reaches them. Develop on CRC, then run on the remote cluster, and the
only things that change are the ones that need more than one machine.

## Lighter Kubernetes: k3s, k3d, and Podman Desktop

A few more tools fill out the lightweight end. **k3s** is a single-binary Kubernetes
distribution built for edge and small hosts, stripping out components a small cluster does
not need; **k3d** runs k3s inside Docker, much as kind runs upstream Kubernetes, for a fast
disposable cluster. Both are plain Kubernetes, lighter than minikube, and a fine choice when
you want a small conformant cluster and nothing OpenShift-specific. **Podman Desktop** is a
different kind of tool: a desktop application that manages containers and can stand up or
connect to several of these cluster types, including CRC, from one interface, which suits a
developer who prefers a GUI over the CLI for managing the cluster lifecycle.

There is also **MicroShift**, which the same `crc` binary can run as a preset: a small
OpenShift-derived Kubernetes for edge devices. It shares some OpenShift behavior but not the
full platform this guide relies on, so it is a different target rather than a lighter CRC.
The point of listing these is that the landscape is wider than three names; the triage below
still holds, because every one of them sorts into either "plain Kubernetes, lighter" or "real
OpenShift, heavier."

## Run one at a time

Whichever you choose, run one local cluster at a time. CRC, minikube, kind, and the rest all
want CPU, memory, and often the same container or virtualization subsystem, and two of them
up at once compete in ways that produce failures looking like bugs in whatever you are
running. Stop one before starting another. This guide's scaffold enforces it: `require_crc`
refuses to run while a minikube profile is up, which is a habit worth keeping by hand even
without the check, because a mysterious out-of-memory or scheduling failure is very often two
clusters fighting over one host.

## Choosing, in one pass

Put together, the choice is quick:

- **Need OpenShift, locally, with full control?** CRC. This guide.
- **Need plain Kubernetes, interactively, lighter than CRC?** minikube.
- **Need a disposable Kubernetes cluster fast, especially in CI?** kind.
- **Need OpenShift without installing anything, and admin is not required?** the Developer
  Sandbox.
- **Past development, or need real scale and HA?** a remote OpenShift cluster.

None of these is a wrong tool; each is wrong for the jobs the others fit. CRC earns its
weight when you need OpenShift's own features on your own machine, and the moment you do
not, one of the lighter options will serve you better. It is also normal to use more than one
over a project's life: kind in CI, CRC for local OpenShift work, a remote cluster for staging.
Matching the tool to the task, rather than settling on one for everything, is what keeps both
your machine and your feedback loop fast.

## For deeper coverage

- [**Kubernetes: Up and Running**](https://www.oreilly.com/library/view/-/9781098110192/) (Burns, Beda, Hightower, Evenson, O'Reilly) gives the broader picture of clusters that the local options all approximate.
- Official docs: the [Red Hat OpenShift Local documentation](https://developers.redhat.com/products/openshift-local/overview), the [minikube documentation](https://minikube.sigs.k8s.io/docs/), and the [kind documentation](https://kind.sigs.k8s.io/) for the alternatives this chapter weighs.

## Where this fits

You know where CRC sits among the options. The next chapter answers the questions that come
up most when running it, the common errors and their fixes, as a reference you can return
to.
