---
title: "Bibliography"
layout: plan
permalink: /bibliography/
description: "The primary references this tutorial follows for OpenShift Local (CRC), OpenShift, and the platform tools it deploys."
---

This is a hands-on tutorial built around official tool documentation rather
than a reading list. The references below are the authoritative sources it
follows; check them for current flags, versions, and behavior. Nothing in these
chapters or the runnable examples copies text from them.

## Primary references

- [OpenShift Local (CRC) documentation](https://crc.dev/docs/): the single-node OpenShift cluster this tutorial runs on, including sizing, `crc setup`, and `crc start`.
- [Red Hat OpenShift Local (product page)](https://developers.redhat.com/products/openshift-local/overview): the download and the pull secret, both free with a Red Hat Developer account.
- [OpenShift documentation](https://docs.redhat.com/en/documentation/openshift_container_platform/): the platform, the `oc` CLI, Routes, security context constraints, and Operators.
- [Kubernetes documentation](https://kubernetes.io/docs/): the API objects, `kubectl`, and the workload, service, and storage concepts the examples deploy.
- [Helm documentation](https://helm.sh/docs/): the chart model and release lifecycle used in the Helm chapter.
- [Operator Lifecycle Manager (OLM)](https://olm.operatorframework.io/docs/): the mechanism behind OperatorHub installs and Subscriptions.
- [OpenShift Service Mesh](https://docs.redhat.com/en/documentation/red_hat_openshift_service_mesh/): the Istio-based mesh installed in the service-mesh chapter.
- [Fedora documentation](https://docs.fedoraproject.org/): the host platform the tutorial targets.

## Further reading

For the related local-cluster guide on plain Kubernetes, see the companion
[Minikube Tutorial on Fedora](https://patterncatalyst.github.io/minikube-on-fedora/),
and the [cloud-native tutorials and workshops hub](https://patterncatalyst.github.io/patterncatalyst-workshops-tutorials-list/),
which collects the related sites and their reading lists.
