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
- [~] Ch 01 prerequisites + CRC download/pull secret/sizing (first draft; expand to word target + verify in relay pass)
- [~] Ch 02 installation (crc, oc, kubectl) (first draft)
- [~] Ch 03 starting the cluster (crc start, admin context, console) (first draft)
- [~] Ch 04 oc and kubectl (the `⌨️ The oc way` callout convention) (first draft)
- [~] Ch 05 deploying applications (first draft)
- [~] Ch 06 Routes and edge TLS (first draft)
- [~] Ch 07 Helm on OpenShift (first draft)
- [~] Ch 08 OpenShift Service Mesh (first draft)
- [~] Ch 09 Operators (OperatorHub + OLM; house set + Cluster Observability,
      Node Tuning/Performance, networking) (first draft)
- [~] Ch 10 examples index (first draft)
- [ ] Diagrams for new/changed chapters
- [ ] Live verification on CRC; evidence banked here
- [ ] Voice pass (lgtm-professional-voice, repo root incl. landing pages)

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
