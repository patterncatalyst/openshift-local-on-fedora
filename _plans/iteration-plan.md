---
title: "Iteration plan"
layout: plan
---

Internal planning notes (not published; the `plans` collection is
`output: false`).

## Phase 1 — CRC core (current)

Scaffold + the genuinely-new CRC content and a first slice of mirrored core
chapters, live-verified on CRC.

- [x] Repo + site scaffold (layouts, includes, css, config, Pages workflow)
- [x] Hub card on patterncatalyst-workshops-tutorials-list (next to minikube) — merged
- [x] `openshift/` scaffold from the lgtm-crc skill
- [x] Ch 00 outline
- [~] Ch 01 prerequisites + CRC download/pull secret/sizing (commands verified live; expand to word target)
- [~] Ch 02 installation (crc, oc, kubectl) (commands verified live; expand to word target)
- [~] Ch 03 starting the cluster (crc start, admin context, console) (verified live; expand to word target)
- [~] Ch 04 oc and kubectl (the `⌨️ The oc way` callout convention) (verified live; expand to word target)
- [~] Ch 05 deploying applications (verified live; 3 corrections applied; expand to word target)
- [~] Ch 06 Routes and edge TLS (first draft)
- [~] Ch 07 Helm on OpenShift (first draft)
- [~] Ch 08 OpenShift Service Mesh (first draft)
- [~] Ch 09 Operators (OperatorHub + OLM; house set + Cluster Observability,
      Node Tuning/Performance, networking) (first draft)
- [~] Ch 10 examples index (first draft)
- [ ] Diagrams for new/changed chapters
- [ ] Live verification on CRC; evidence banked here
- [ ] Voice pass (lgtm-professional-voice, repo root incl. landing pages)

## Evidence — live CRC run (CRC 2.64.0, OpenShift 4.22.14, k8s v1.35.6)

Verified against a running CRC cluster using the bundled `oc`
(`~/.crc/bin/oc/oc`) and the `crc-admin` kubeconfig context. Note: the
host-installed `/usr/local/bin/oc` is a `podman run origin-cli` wrapper and
cannot reach `api.crc.testing` (127.0.0.1); chapters must use the bundled
client. `api.crc.testing` resolves to 127.0.0.1 (CRC user-mode networking).

- Ch01: `grep -Ec '(vmx|svm)' /proc/cpuinfo` non-zero, `kvm_intel` loaded,
  NetworkManager active. Node `crc` Ready; all cluster operators Available.
- Ch02: bundled `oc version --client` = 4.22.14 (matches cluster); `crc version`
  reports OpenShift 4.22.14.
- Ch03: `crc console --url` = https://console-openshift-console.apps-crc.testing.
- Ch04: `oc whoami` = kubeadmin (crc-admin), `get nodes` Ready, kubectl verbs
  answer through `oc`.
- Ch05: Deployment `ubi9/httpd-24` → 2 Pods Running under `restricted-v2`.
  Corrections applied from the live run:
  1. example manifest now also declares the `web` Service (the Build/run/observe
     `curl http://web:8080` had no Service to resolve);
  2. injected UID is at the *container* securityContext (`runAsUser` 1000650000,
     range annotation `1000650000/10000`), not where `describe | grep` looked;
  3. a bare httpd on an empty docroot answers `HTTP 403` (proves reachability),
     so the curl asserts the status code and the prose says so.

## Later phases

- Remaining core chapters: persistent storage, editor/shell, autoscaling
  (KEDA → Custom Metrics Autoscaler), alternatives, FAQ, where-to-next.
- Capstone: a data mesh on OpenShift (mirror the 10-page set).
- Appendix: the Kubernetes design-patterns set worked entirely on OpenShift,
  reframed to EX280/DO280, restricted-v2 variants of every manifest.
- Companion decks (authored last).

## Conventions

- Branch → PR → squash-merge for every change; `rNN.x` tags; notes-only releases.
- `kubectl` in chapter bodies; `⌨️ The oc way` callout for OpenShift-native paths;
  `oc`-native where there is no kubectl equivalent (Routes, SCCs, Operators).
- Verification status defaults to unverified; promote to verified only on a
  passing live CRC run, with evidence banked here.
