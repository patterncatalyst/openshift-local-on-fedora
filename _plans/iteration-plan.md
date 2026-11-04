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
- [~] Ch 06 Routes and edge TLS (verified live on pristine cluster; 1 correction; expand to word target)
- [~] Ch 07 Helm on OpenShift (verified live on pristine cluster; expand to word target)
- [~] Ch 08 OpenShift Service Mesh (verified live on pristine cluster; pins
      bumped, control-plane + native-sidecar + mTLS corrections; expand to word target)
- [~] Ch 09 Operators (OperatorHub + OLM; house set + Cluster Observability,
      Node Tuning/Performance, networking) (verified live; amq-streams pin
      bumped; table channels confirmed; expand to word target)
- [~] Ch 10 examples index (verified: every path it names exists)
- [x] Expand every content chapter (01-10) to the 2k prose floor with genuine
      content (verified facts preserved); all now 2003-2034 prose words, 0 ban-tier
- [x] Voice pass (lgtm-professional-voice, repo root incl. landing pages): example
      READMEs de-numbered + de-footered + em-dashes recast; LICENSE-docs preamble
      em-dashes recast (CC legal text left verbatim)
- [x] Live verification on CRC; evidence banked here (§1-10 all verified)
- [x] Diagrams for new/changed chapters: 6 paired SVG + .excalidraw figures
      (crc-architecture §1, oc-and-kubectl §4, deploy-scc §5, route-edge-tls §6,
      service-mesh §8, operator-olm §9), embedded with captions + alt text,
      gallery rebuilt, spec in `scripts/gen_diagrams.py` (engine vendored)
- [ ] Open the r01 PR

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

### §6-7 verified on a PRISTINE cluster (crc delete && crc start)

Recreated clean before this pass (no `istio-system`, 0 Subscriptions, no
non-system Routes). Note: `crc delete && crc start` clears cross-project state
but the node AGE stays ~49d (baked into the bundle snapshot, not reset by
delete) — age is not a cleanliness signal; namespaces/subs/routes/CRDs are.

- Ch06: `oc new-app` → `oc create route edge --insecure-policy=Redirect` →
  host `web-route-demo.apps-crc.testing`. `--cacert` (ingress CA from configmap
  `default-ingress-cert` in `openshift-config-managed`) makes the HTTPS
  handshake succeed; plain `curl` fails `SSL ... self-signed certificate`.
  HTTP → 302 redirect. Correction: HTTPS status is **403** (empty httpd
  docroot), not the `# 200` the draft claimed — the proof is the trusted-CA
  handshake, not the status code. Fixed.
- Ch07: helm v4.2.2; `helm install ./openshift/helm/demo` (postgres+kafka off)
  deploys `demo-service` (+Service +Route); pod runs `restricted-v2` with an
  OpenShift-assigned `runAsUser` (1000670000); `helm uninstall` clean. No
  chapter fix needed.
- Ch08: mesh operators + control plane installed on the pristine cluster.
  Pins were stale (would hang the install): the catalog now serves
  `servicemeshoperator3.v3.4.4` in `stable-3.4` (was v3.4.3) and
  `kiali-operator.v2.33.1` in `stable` (v2.27.5 gone); bumped both in the two
  Subscriptions, `install-mesh.sh`, and the Istio manifest comment. OSSM 3.4.4
  offers Istio v1.26 to v1.30, so the `v1.30.5` pin is valid and is the newest
  exact release. `IstioCNI` and `Istio` (v1.30.5, revision `default`) reach
  Ready. Enrolled `mesh-demo` with `istio.io/rev=default`: a fresh deploy into
  the labeled namespace comes up `2/2` with the Envoy proxy injected as a
  *native sidecar* (`istio-proxy` is an init container with `istio-validation`,
  not a normal container, so `.spec.containers` lists only `httpd` while the Pod
  reads `2/2`). `PeerAuthentication/default` applies and reads back `STRICT`.
  Chapter corrections: (1) Build/run/observe no longer calls `install-mesh.sh`
  standalone (that script requires the Helm core via `deploy.sh` and enrolls the
  `demo` release, not `mesh-demo`); it now runs the verified standalone path
  (`install_operator` x2 + control plane + enrollment + mTLS) and describes
  `install-mesh.sh` accurately as the Helm-release path; (2) the by-hand control
  plane now shows `IstioCNI` + a version-pinned `Istio` (was a version-less
  `Istio` only); (3) sidecar described as a native sidecar / init container;
  (4) the canary now includes the `DestinationRule` subsets + `version` labels it
  needs, and the Kiali-graph claim is scoped to "once observability is wired";
  (5) added `openshift/platform/mesh/strict-mtls.yaml` so the chapter references
  a real file. Operators left installed for the Ch09 pass; `mesh-demo` deleted.
- Ch09: `install_operator` installs `amq-streams` end to end. Pin was stale
  (`amq-streams-3.2.x` now serves `amqstreams.v3.2.2-5`, was v3.2.1-14, which
  would hang); bumped in `openshift/infra/amq-streams-subscription.yaml` and the
  three spots in the chapter. CSV reached `Succeeded`; the `kafka.strimzi.io`
  CRDs (kafkas, kafkatopics, kafkausers, ...) are present. The other table
  channels were confirmed live in the catalog and are current: KEDA
  `openshift-custom-metrics-autoscaler-operator` `stable`, OTel
  `opentelemetry-product` `stable`, GitOps `openshift-gitops-operator`
  `gitops-1.22` (the table lists channels only, not CSVs, so no CSV edits).
- Ch10: index only, no cluster run. Confirmed every path it names exists:
  `openshift/{lib.sh,install-infra.sh,deploy.sh,build-images.sh,
  capture-evidence.sh,teardown.sh}`, `openshift/platform/install-platform.sh`,
  `openshift/helm/demo`, `openshift/infra`, `examples/05-deploying`,
  `examples/06-routes`. No fix needed.

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
