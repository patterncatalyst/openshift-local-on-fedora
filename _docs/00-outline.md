---
title: "Tutorial outline"
order: 0
description: "What this guide covers, who it is for, and how the chapters fit together."
---

This guide installs and runs **OpenShift Local (CRC)** on Fedora: a single-node
OpenShift 4 cluster in a local VM, for development and learning on your own
machine. It is the OpenShift counterpart to the
[Minikube Tutorial on Fedora](https://patterncatalyst.github.io/minikube-on-fedora/):
same host, same hands-on shape, but a full OpenShift cluster instead of plain
Kubernetes.

## Who this is for

Developers on Fedora who want a real OpenShift cluster locally, without a cloud
subscription or a remote cluster. You should be comfortable at a terminal and
know the basics of containers. Kubernetes experience helps but is not required:
each chapter introduces the objects it uses.

## How to read it

Read top to bottom the first time through. Once the cluster is up, each chapter
stands on its own. Hands-on chapters end with a **Build, run, observe** section
you can run against your cluster.

### The `oc` way

The chapters use `kubectl` for the Kubernetes workflow that OpenShift shares
with every other cluster, so the commands transfer directly. Wherever OpenShift
gives you a shorter or more capable path, a callout shows it:

> **⌨️ The `oc` way**
>
> OpenShift ships the `oc` CLI, a superset of `kubectl`. Every `kubectl` command
> here also works as `oc`. The callouts flag the places where `oc` does more:
> `oc new-app`, `oc expose` for Routes, `oc project`, `oc status`, `oc adm`.

### Explore with your agent

Some chapters add an agent prompt you can hand to an AI coding assistant to go
further on your own cluster:

> **🤖 Explore with your agent**
>
> "Show me every Route in the cluster, the Service each one targets, and whether
> it terminates TLS at the edge."

## Chapters

| # | Chapter | What it covers |
|---|---------|----------------|
| 1 | Prerequisites and getting CRC | Fedora host, a free Red Hat Developer account, the CRC download, the pull secret, and cluster sizing |
| 2 | Installation | Installing `crc`, `oc`, and `kubectl` |
| 3 | Starting the cluster | `crc setup`, `crc start`, the admin context, `oc login`, and the web console |
| 4 | oc and kubectl | The two CLIs side by side; projects and namespaces; the OpenShift conveniences |
| 5 | Deploying applications | Deployments and Pods with `kubectl`, the OpenShift way with `oc` |
| 6 | Routes and edge TLS | Exposing a Service to the host with a Route instead of a NodePort |
| 7 | Helm on OpenShift | The bundled `helm` CLI, restricted-v2-ready charts, and OpenShift's native Helm integration |
| 8 | OpenShift Service Mesh | Installing the mesh (the Sail/Service Mesh 3 operator) and Kiali, with mTLS |
| 9 | Operators | OperatorHub and OLM: installing Operators with pinned versions |
| 10 | Persistent storage | PersistentVolumeClaims and dynamic provisioning on CRC |
| 11 | Autoscaling | Scaling on load with the Custom Metrics Autoscaler (KEDA) |
| 12 | Editor and shell | The web terminal, `oc rsh`, and `oc debug` for working inside the cluster |
| 13 | Alternatives | Where CRC fits next to minikube, kind, and a remote cluster |
| 14 | FAQ | Common questions and fixes for OpenShift Local |
| 15 | Where to go next | Paths onward: certifications, a remote cluster, and the sibling guides |
| 16 | Examples | Index of the runnable examples and their verification status |
| 17 | Final project | A seven-service data mesh converging the whole guide on one CRC cluster |

## What you need

- Fedora, with virtualization enabled.
- A free [Red Hat Developer account](https://developers.redhat.com/) for the CRC
  download and the pull secret.
- Enough headroom for the cluster VM: the sizing is covered in Chapter 1.

Everything else is installed as you go.
