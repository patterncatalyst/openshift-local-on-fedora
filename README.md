# OpenShift Local (CRC) on Fedora

A hands-on tutorial for installing and running **OpenShift Local (CRC)** on
Fedora: a single-node OpenShift 4 cluster in a local VM, for development and
learning on your own machine.

It is the OpenShift counterpart to the
[Minikube Tutorial on Fedora](https://github.com/patterncatalyst/minikube-on-fedora):
same host, same hands-on shape, a full OpenShift cluster instead of plain
Kubernetes. The chapters use `kubectl` for the shared Kubernetes workflow and
add an **oc way** callout wherever OpenShift gives you a shorter or more capable
path.

## Site

The guide is published with GitHub Pages:
<https://patterncatalyst.github.io/openshift-local-on-fedora/>

## What's covered (Phase 1)

- Prerequisites, getting CRC from a free Red Hat Developer account, the pull
  secret, and cluster sizing
- Installing `crc`, `oc`, and `kubectl`; starting the cluster
- `oc` and `kubectl` side by side
- Deploying applications; exposing them with Routes and edge TLS
- Helm on OpenShift
- OpenShift Service Mesh
- Installing Operators from OperatorHub

Later iterations add persistent storage, autoscaling, a data-mesh final project
on OpenShift, and the Kubernetes design-patterns appendix worked on OpenShift.

## Building the site locally

```bash
bundle install
bundle exec jekyll serve --baseurl ""
```

## Running the cluster

The runnable scaffold under `openshift/` targets OpenShift Local (CRC). See
Chapter 1 for sizing, the pull secret, and `crc start`.

## License

Code is licensed under Apache 2.0 (`LICENSE`); the prose and figures under
`LICENSE-docs.md`.
