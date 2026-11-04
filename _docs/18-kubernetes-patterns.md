---
title: "Appendix: Kubernetes patterns on OpenShift (EX280/DO280)"
order: 18
description: "A pattern-per-chapter reference to cloud-native Kubernetes design patterns, worked on OpenShift with restricted-v2 manifests and the tutorial's shipping services, and reconciled against the DO280/EX280 exam. Organized as its own set."
duration: reference
---

## Learning objectives

By the end of this appendix you can:

- Name the cloud-native Kubernetes design patterns and recognize them in a real system
- Work each pattern on OpenShift with manifests that satisfy `restricted-v2`
- Expose workloads with Routes and install platform capabilities through OperatorHub, the OpenShift way
- Map each pattern to its DO280/EX280 exam objective and rehearse it with `oc`

## Why this matters

The guide up to here is a path: install OpenShift Local, deploy under `restricted-v2`,
expose services with Routes, package with Helm, install Operators, and converge everything
into the §17 data-mesh final project. This appendix is the other half of the picture. Rather
than *how to operate the cluster*, it names the **design patterns** that the deployments,
services, jobs, and operators in this guide are instances of, and works each one on its own,
on OpenShift.

It is the OpenShift corollary to the Kubernetes patterns appendix in the
[Minikube Tutorial on Fedora](https://patterncatalyst.github.io/minikube-on-fedora/). That
set stays on plain Kubernetes with `kubectl`; this one works every pattern on OpenShift, with
the platform differences the guide spent its chapters on: Security Context Constraints instead
of unrestricted Pods, Routes instead of NodePorts, OperatorHub and OLM instead of raw
operator manifests, and the integrated registry instead of a local image load.

Like the final project, it is large enough to be its own set with its own reading order, so it
lives on its own pages rather than stretching this chapter.

## What's in it

One chapter per pattern, across the six families the literature uses: foundational,
structural, behavioral, configuration, advanced, and security. Each chapter works the pattern
against the guide's own shipping services, the same order, inventory, payment, shipping, and
notification services the final project runs, so the pattern lands on a system you can place
an order against rather than a throwaway demo. Every manifest is written to pass
`restricted-v2`, so the pattern and the platform's security model are learned together.

The advanced family includes a real **Operator** installed through OperatorHub, and an
in-cluster image build through the integrated registry, in place of the shell-script
controllers and local builds most pattern catalogs use to sketch the idea.

## Two lenses on every chapter

Each pattern chapter carries two recurring call-outs:

- **🎓 DO280/EX280 exam lens**: maps the pattern to its Red Hat OpenShift Administration
  (DO280) and certification (EX280) exam objective, names the competency it exercises, and
  gives a short `oc` drill. A closing crosswalk chapter maps the whole appendix back to the
  exam objectives, with a self-test task list, so the set doubles as exam revision.
- **🤖 Explore with your agent**: a ready-to-run prompt for taking the pattern further with
  an AI coding assistant on your own cluster.

A few **gap chapters** cover the parts of the curriculum the patterns don't reach on their
own: observability and debugging, packaging with Helm, and project governance with quotas
and limits.

## Where it runs

The appendix examples run on a pristine CRC cluster, brought up with
[§3]({{ '/docs/03-starting-crc/' | relative_url }}) and torn down to empty between the
final project and this set, so the patterns are verified on a clean cluster rather than one
carrying the mesh's leftovers. Each chapter arrives the way the guide's chapters did: drafted,
run against a real cluster, and corrected to match what the cluster did.

<p><a class="btn btn--primary" href="{{ '/appendix/k8s-patterns/' | relative_url }}">Open the Kubernetes patterns on OpenShift appendix →</a></p>
