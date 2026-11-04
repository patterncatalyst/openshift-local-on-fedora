---
title: "Where to go next"
order: 15
description: "Paths onward from a local OpenShift: certifications, moving to a remote cluster, deeper platform topics, and the sibling guides."
---

## Learning objectives

By the end of this chapter you can:

- Map OpenShift's certification path (DO180, DO280, EX280) to the chapters you worked
- Plan the move from a local CRC workflow to a remote cluster
- Identify deeper platform topics worth pursuing next
- Find the sibling guides that go further

## Why this matters

You can install, run, and work a real OpenShift cluster on your own machine: deploy under
its security model, expose services with Routes, package with Helm, install Operators, add
a service mesh, give workloads storage, and scale them on load. This chapter points at where
to take that next, whether toward a certification, a real cluster, or a deeper slice of the
platform. None of the paths below starts over; each one builds on the cluster you already have
running and the commands you already know, so pick the one that matches what you want to do next
and the rest will keep.

## Toward a certification

A local OpenShift is a strong way to prepare for Red Hat's OpenShift certifications,
because the exams are hands-on and CRC gives you the same environment to practice in. The
natural path runs through a few credentials. The **DO180** course and its exam cover
OpenShift application development: deploying, Routes, builds, the things the early chapters
here exercised. The **DO280** course leads to the **EX280**, the Red Hat Certified OpenShift
Administrator exam, which covers the cluster-level work this guide reached: Operators,
security context constraints, storage, and the platform. Everything EX280 tests, you can
rehearse on CRC, which is why a local cluster is the cheapest practice environment there is. The
map from this guide to the exam is close: the deploying, Routes, and Helm chapters cover the
application side DO180 asks about, and the Operators, storage, and security material lines up with
the administrator topics in DO280. Working each chapter's Build, run, observe block until you can
reproduce it without the text is a direct rehearsal for the kind of task the exam sets.

If your interest is Kubernetes rather than OpenShift specifically, the CNCF certifications
map across. The **CKAD** (Certified Kubernetes Application Developer) and **CKA** (Certified
Kubernetes Administrator) test the upstream objects, the ones this guide wrote as `kubectl`.
The companion minikube guide is the better rehearsal environment for those, since they test
plain Kubernetes without the OpenShift layer. The one thing to watch is that OpenShift's
defaults differ from a permissive Kubernetes: a workload that runs under `restricted-v2` here may
need adjustment to run on a bare CKAD cluster, and the reverse is more often the problem, a
manifest that passes on plain Kubernetes being rejected by OpenShift's SCCs. Practising on both
clusters, rather than one, is what surfaces those differences before an exam does. Either way, the habit this guide built, run the
command against a real cluster and read what it does, is the habit the hands-on exams reward.

The hands-on format is the reason a local cluster matters so much for these. The exams do not
ask you to recall facts; they put you at a terminal with tasks to complete against a real
cluster under time, so the skill they test is exactly the one you build by doing the work
rather than reading about it. Practising on CRC means practising in the same shape as the exam:
create the project, apply the manifest, fix what the cluster rejects, verify the result. Set
yourself a task, give it a time limit, and do it without notes, and you are rehearsing both the
material and the pace.

## Moving to a remote cluster

CRC is the local stand-in for a real cluster, and moving to one is mostly a change of
address. You authenticate to a remote OpenShift with `oc login` against its API URL, and the
same `oc` and `kubectl` commands, the same manifests, and the same Helm charts work there,
because it is the same software. What changes are the things a single node cannot imitate:
real high availability across nodes, a load balancer with external IP addresses, shared
storage that supports `ReadWriteMany`, and the scale to run many workloads at once. Those are
the edges this guide flagged where it reached them, so you already know where to expect a
difference.

Several remote options suit different needs. The **Developer Sandbox** is a free hosted
OpenShift for application-level work without admin, covered in the alternatives chapter. The
managed cloud offerings, **ROSA** on AWS, **ARO** on Azure, and **OpenShift Dedicated**, run
OpenShift as a service, so you get a full cluster without operating the control plane
yourself. And a self-managed cluster, on a cloud or on-premises, is the full-control option.
The through-line is that your local work transfers: develop on CRC, then point `oc login` at
whichever remote cluster you move to.

The mechanics use the same `oc` you already know. You log in
to a remote cluster with its API URL and a token or credentials, and `oc` writes a new context
into your kubeconfig alongside `crc-admin`:

```bash
oc login --token=<token> --server=https://api.example.com:6443
oc config get-contexts        # the remote context now sits next to crc-admin
oc config use-context crc-admin    # switch back to the local cluster
```

From then on, switching between your local CRC and the remote cluster is an `oc config
use-context`, and `oc config current-context` tells you which one a command will act on, worth a
glance before anything destructive. Developing locally and deploying remotely becomes a matter of
which context is current, which is the payoff of CRC running the same software: the commands do
not change, only the cluster they point at does.

## Going deeper on the platform

OpenShift carries more than this guide covered, and each area is a natural next step built on
the Operator pattern you already know:

- **GitOps with Argo CD**, delivered by the OpenShift GitOps operator, manages cluster state
  from a Git repository, so a deployment is a commit rather than a command. The scaffold in
  this repository includes a GitOps installer to build on.
- **Pipelines with Tekton**, the OpenShift Pipelines operator, runs CI/CD as Kubernetes
  resources, which pairs naturally with the in-cluster builds this guide introduced.
- **Serverless with Knative**, the OpenShift Serverless operator, adds scale-to-zero
  request-driven workloads, extending the autoscaling chapter's ideas to an event-driven
  model.
- **Observability**, the Red Hat build of OpenTelemetry with a metrics and tracing stack, is
  what lights up the service mesh's Kiali graph and gives your own workloads telemetry. The
  scaffold includes an observability installer.

Each of these is an operator install and a custom resource or two, the exact shape of the
Operators and Service Mesh chapters, so none of them starts from scratch. Pick the one that
matches a problem you actually have, install it from OperatorHub with a pinned version, and
apply its custom resources.

A useful way to see how they fit together is to follow one workload through them. A service you
build with in-cluster builds is deployed by a Tekton pipeline on each commit, its desired state
is held in Git and reconciled by Argo CD, it runs in the mesh with mutual TLS, it scales on load
through the Custom Metrics Autoscaler, and its metrics and traces flow to the observability
stack that also feeds Kiali's graph. Every one of those is an operator you install the same way,
and together they are what people mean by a platform rather than a cluster. You do not need all
of them, and on a single-node CRC you cannot run all of them at once, but each is a small,
familiar step from where this guide leaves you, and you can add whichever one your next project
actually calls for.

## A plan for your next sessions on CRC

Skills set when you use them on something of your own, so here is a concrete progression that
reuses what this guide built, each step a short project on your running cluster:

- **Deploy an app you know** under `restricted-v2`: take a container image you already use and
  get it running here. If it needs root or a fixed UID, that is the lesson, and fixing it,
  usually by choosing a UBI-based image or setting an `fsGroup`, is the exercise.
- **Put it behind an edge Route** and reach it over HTTPS with the ingress CA trusted, so the
  Routes chapter becomes muscle memory rather than a recipe.
- **Give it state**: add a PersistentVolumeClaim, write data, delete the Pod, and confirm the
  data survives, then make it a StatefulSet if it has more than one replica.
- **Package it as a Helm chart** that passes `restricted-v2`, so you can install and uninstall
  it cleanly, which is the shape every reusable deployment takes.
- **Install one Operator** you have a use for, pinned, from OperatorHub, and drive it with a
  custom resource, which is the pattern the whole platform is built on.

Each builds on the last, and by the end you have taken one real application from a bare image to
an operator-managed, stateful, TLS-exposed deployment, entirely on your own machine.

## The sibling guides

This guide is one of a family built on the same host and the same hands-on shape, and the
others go further in directions this one only points at. The **minikube on Fedora** guide is
the plain-Kubernetes counterpart, the right next step if you want to see how the same concepts
look without the OpenShift layer. The **data mesh** reference architectures, in Quarkus and in
Python, each end with an OpenShift chapter that installs this operator set and runs a
multi-service system end to end, which is the applied version of everything here. And the
**API Patterns and Practices** sites, across REST, gRPC, GraphQL, and WebSockets, each carry
an OpenShift Local appendix, so you can see the same CRC workflow applied to real API designs.

Reading across the family is the fastest way to turn "I can run OpenShift locally" into "I can
build a real system on it," because each sibling takes the same cluster and puts a different
kind of workload on it.

The data-mesh guides are the closest to a full application on OpenShift, and they are the
recommended next read if you want to see the operator set from this guide carrying a real,
multi-service system: a mesh wiring the services together, Kafka from an operator, storage for
the stateful pieces, and observability watching the whole thing. The API Patterns sites are the
better read if your interest is the API layer itself, since each shows a different protocol
deployed the same way on CRC. Between them, they turn the mechanics this guide taught into
patterns you can apply to your own designs, which is the point of learning the cluster in the
first place.

## Keeping your cluster current

One habit carries all of this forward: keep the tools current. Upgrade `crc` when a new
release comes out, which brings a fresh OpenShift bundle, and re-check an operator's catalog
version before you pin it, because the catalog moves. Staying current is less work than
catching up later, and it keeps your local cluster close to the remote ones you will deploy to.
A local OpenShift that tracks the real releases is the most useful kind.

There is a practical rhythm to it. When a new CRC release appears, install the binary over the
old one and let the next start pull the fresh bundle; a major jump wants a `crc delete` first for
a clean slate. Before you pin an operator for a new project, run the `oc get packagemanifest`
check and take the version the channel serves today rather than one a document named months ago,
which is the single habit that prevents the most common install failure. And keep a standalone
`oc`, if you installed one, in step with the cluster, or lean on the bundled client that is
version-matched by construction. None of this is much work spread out, and all of it is painful
if left until a cluster is several releases behind.

## For deeper coverage

- [**Certified Kubernetes Application Developer (CKAD) Study Guide**](https://www.oreilly.com/library/view/-/9781098152857/) (Benjamin Muschko, O'Reilly) is strong hands-on preparation whose skills carry into the OpenShift exams.
- [**Kubernetes Patterns**](https://www.oreilly.com/library/view/-/9781098131678/) (Ibryam and Huß, O'Reilly) is the catalog the next part of this guide works through on OpenShift.
- Official docs: [Red Hat Training and Certification](https://www.redhat.com/en/services/training-and-certification) for the DO180, DO280, and EX280 paths, and the [OpenShift Container Platform documentation](https://docs.openshift.com/) for the platform topics beyond this guide.

## Where this fits

This is the last of the core chapters. The examples index gathers the runnable code behind
them, the final project then converges the whole guide into a data mesh running on OpenShift,
and a later part adds the Kubernetes design patterns worked entirely on CRC, each arriving the
same way the chapters here did: drafted, run against a real cluster, and corrected to match. You have a real OpenShift cluster on your own machine
and the grounding to take it anywhere, whether that is a certification, a remote cluster, or a
platform built one operator at a time on the foundation this guide laid.
