---
title: "Kubernetes patterns on OpenShift: start here"
order: 0
part: "Start here"
description: "The map: the six pattern families, how each chapter is built, the two call-outs, and how the set reconciles against the DO280/EX280 exam."
duration: 6 min
---

This appendix is a reference to the design patterns of cloud-native Kubernetes, worked one
pattern at a time on OpenShift against the guide's own shipping services. Where most pattern
material leans on a throwaway demo app, every chapter here uses the same order, inventory,
payment, shipping, and notification services the
[§17 data mesh]({{ '/docs/17-capstone/' | relative_url }}) runs, so a pattern lands on a
system you can place an order against.

It is also a DO280/EX280 companion. Each pattern is tagged to where it sits on the Red Hat
OpenShift Administration course and certification exam, and a closing crosswalk maps the whole
set back to the exam objectives so you can use the appendix as revision.

## What makes this the OpenShift set

The sibling minikube appendix works these same patterns on plain Kubernetes. This set is the
OpenShift corollary, and the difference is not cosmetic. Every manifest here is written to
satisfy `restricted-v2`: no fixed `runAsUser`, no privileged ports, no writing outside a
mounted volume, so the pattern and OpenShift's security default are learned in one pass.
Services face the host through Routes with edge TLS, not NodePorts. The operator and
image-builder patterns use OperatorHub, OLM, and the integrated registry rather than raw
manifests and a local build. Where a pattern needs an exception, like an infrastructure image
with a pinned UID, it is granted narrowly through a scoped SCC binding, the habit the deploying
chapter established.

## How a chapter is built

Every pattern chapter follows the same spine:

- **Learning objectives**: what you can do by the end.
- **Why this matters**: the problem the pattern solves, in the shipping domain.
- **The pattern, worked**: the `restricted-v2` manifests and, where needed, the code, applied
  to a shipping service on OpenShift.
- **🎓 DO280/EX280 exam lens**: the exam objective this pattern touches, the competency it
  exercises, and a short `oc` drill to rehearse it.
- **🤖 Explore with your agent**: a ready-to-run prompt to take the pattern further.
- **Cleanup** and a pointer to the runnable **example** under `examples/appendix-patterns/`.

Each chapter carries at least one diagram, and holds to a pattern-language register: tighter
than the guide chapters, long enough to be complete.

## The six families

The patterns are grouped the way the literature groups them. Read a family at a time; within a
family the chapters stand alone.

- **Foundational**: the contracts every container must honor to be a good OpenShift citizen:
  predictable resource demands, declarative deployment, health probes, a managed lifecycle,
  and letting the scheduler place the Pod, all under `restricted-v2`.
- **Structural**: how containers are composed inside a Pod: init containers, sidecars,
  adapters, and ambassadors.
- **Behavioral**: how workloads behave over time: batch and periodic jobs, daemons,
  singletons, stateless and stateful services, discovery, and self-awareness.
- **Configuration**: how configuration reaches the application: ConfigMaps and Secrets,
  templates, and immutable configuration.
- **Advanced**: extending the platform itself: controllers, an Operator installed through
  OperatorHub, elastic scaling, and in-cluster image builds through the integrated registry.
- **Security**: running safely: access control with RBAC, network segmentation with
  NetworkPolicies, process containment through Security Context Constraints, and secure
  configuration.

The full, always-current list is the card grid on the
[appendix landing page]({{ '/appendix/k8s-patterns/' | relative_url }}).

## The exam reconciliation

The pattern families cover most of the DO280/EX280 curriculum, but not all of it. A short set
of **gap chapters** fills what the patterns leave out: observability and debugging, packaging
with Helm, and project governance (ResourceQuota and LimitRange). A **crosswalk** closes the
set by mapping every pattern to its exam objective with a self-test task list.

## Where it runs

This appendix runs on a pristine CRC cluster. Bring OpenShift up with
[§3]({{ '/docs/03-starting-crc/' | relative_url }}), and if you worked the final project
first, tear it down to empty (`crc delete && crc start`) so the patterns are verified on a
clean cluster. The shipping-service images are built with podman and pushed to the integrated
registry once, the way the final project builds them, and the pattern chapters deploy from
there.

Start with the first family: **foundational patterns**.
