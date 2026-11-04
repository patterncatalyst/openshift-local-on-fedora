---
title: "Examples"
order: 16
description: "The runnable examples that accompany the chapters, where they live, and how their verification status is tracked."
---

Every hands-on chapter has a runnable counterpart you can apply to your own
cluster. This chapter indexes them, explains the layout, and describes how each
example's verification status is tracked. The aim is that no chapter is only something to read:
each one has code you can run on your own cluster and watch produce the result the prose
describes, which is the surest way to learn a platform rather than take its behavior on faith.

## Where the examples live

Runnable code sits under `examples/`, outside the published site, one directory per
chapter. Each directory carries the YAML, a short `README.md`, and where it helps, a
`demo.sh` that runs the chapter's commands end to end. The larger platform pieces
(the operators, the mesh, Helm charts, Routes) share the `openshift/` scaffold at
the repository root, which the chapters call into rather than duplicating.

The split is a matter of scale. A chapter about deploying a single Deployment needs only a
manifest and a few commands, so it gets a self-contained `examples/` directory you can read and
run on its own. A chapter about the service mesh or the operators drives machinery that spans
namespaces, pins versions, and tears down cleanly, which is shared infrastructure rather than a
per-chapter snippet, so it lives in the `openshift/` scaffold that every platform chapter calls.
Keeping the two apart means the simple examples stay simple and the shared scaffold has one
copy to maintain, rather than the same operator-install logic pasted into several chapters.

| Chapter | Example | What it does |
|---------|---------|--------------|
| 5 Deploying | `examples/05-deploying` | A UBI httpd Deployment and a scale/rollout walk-through |
| 6 Routes | `examples/06-routes` | A Service, an edge-TLS Route, and the ingress-CA verification |
| 7 Helm | `openshift/helm/demo` | A restricted-v2 chart with Postgres and Routes |
| 8 Service Mesh | `openshift/platform/install-mesh.sh` | Sail/Service Mesh 3 + Kiali, mTLS, a canary |
| 9 Operators | `openshift/lib.sh` + `openshift/infra` | The pinned-CSV `install_operator` pattern |

## What each example demonstrates

The examples are not interchangeable; each one isolates a specific thing OpenShift does
differently from plain Kubernetes, so reading the list is a map of what the first part of the
guide covers:

- **Deploying** shows the security model in action: a UBI workload comes up under
  `restricted-v2` with an arbitrary, project-assigned UID, and the example reads that UID back
  from the running Pod so you see it is real.
- **Routes** shows edge-terminated TLS: a Service is exposed at a hostname under
  `apps-crc.testing`, and the example verifies it over HTTPS by trusting the cluster's ingress
  CA, the correct way rather than skipping verification.
- **Helm** shows a chart that satisfies `restricted-v2` without an exception, deploying under an
  OpenShift-assigned UID and uninstalling cleanly, which is what makes one chart portable across
  OpenShift and plain Kubernetes.
- **Service Mesh** shows the operator-delivered platform tier: the mesh operators and control
  plane install, a namespace is enrolled so its Pods gain a sidecar, and STRICT mTLS is enforced.
- **Operators** shows the install pattern itself: a pinned CSV, a single approved InstallPlan,
  and the CRDs the operator owns, which is the mechanism every platform piece is built on.

Taken together they move from a single Pod to a full operator-managed platform, each step adding
one OpenShift-specific capability on top of the last.

## Running an example

Each `examples/` directory is self-contained, so running one is the same two steps every time:
have a cluster up on the `crc-admin` context, then run the directory's `demo.sh`, or copy the
commands from its `README.md` if you would rather step through them. A `demo.sh` applies the
manifest, shows the result the chapter describes, and cleans up after itself, so it leaves the
cluster as it found it. Reading the script before you run it is worth the minute: it is short,
it names every object it creates, and it is the fastest way to see the chapter's commands as one
sequence rather than scattered through the prose. A `demo.sh` follows the same arc as the chapter's
Build, run, observe block, so the script and the prose reinforce each other: the block shows the
commands in context, and the script runs them end to end so you can confirm the result on your own
cluster rather than taking the chapter's word for it.

The platform pieces run through the scaffold instead, which expects the same starting point: a
cluster up, the `crc-admin` context current, and the bundled `oc` on your `PATH`. Every scaffold
script begins by calling `require_crc`, which refuses to run against anything that is not
OpenShift Local, so a script can never touch the wrong cluster by accident.

The platform tier is opt-in and sized for the platform target. `install-platform.sh` is the single
entry point that brings up the optional capabilities together, and each one also has its own
installer you can run alone when you want just the mesh, or just autoscaling, rather than the whole
tier. Because every installer pins its operator version and approves one InstallPlan, running the
tier twice is safe: an operator already at the pinned version is left as it is rather than
reinstalled. The matching `teardown.sh` removes the tier in reverse, so you can stand it up to work
through a chapter and tear it back down to a bare cluster afterward without hunting for stray
objects. On a host that cannot spare the platform target's memory, run the individual installers
for the one capability a chapter needs instead of the full tier.

## The openshift/ scaffold

The scaffold is the shared machinery the platform chapters use. Each script owns one step and can
be read on its own:

- `lib.sh`: the helpers every other script sources, including `require_crc` (refuses any cluster
  that is not CRC) and `install_operator` (pin the CSV, approve one InstallPlan, wait for it to
  succeed).
- `install-infra.sh`, `infra/`: the project and AMQ Streams Kafka, the base an application needs.
- `build-images.sh`, `deploy.sh`: in-cluster image builds and the Helm release that deploys them.
- `platform/`: the opt-in platform tier, with one installer per capability for the mesh,
  autoscaling, observability, and GitOps, plus the Istio and Kiali custom resources they apply.
- `capture-evidence.sh`, `teardown.sh`: record what a run produced, then return the
  cluster to empty.

Reading the scripts in that order is a tour of how a full OpenShift deployment fits together, from
an empty cluster to a running system and back to empty. Each is small enough to follow, and
because they all build on `lib.sh`, the patterns you learn in one carry to the rest.

Run order, once your cluster is up:

```bash
source openshift/lib.sh && require_crc
./openshift/install-infra.sh
./openshift/deploy.sh
./openshift/platform/install-platform.sh     # optional: mesh, keda, observability, gitops
./openshift/capture-evidence.sh
./openshift/teardown.sh                        # always: clean, then crc stop
```

## Conventions the examples follow

Every example is written to the same conventions, so once you have read one the rest are
predictable:

- **`kubectl` in the bodies, `oc` where it must be.** The portable Kubernetes workflow is written
  as `kubectl`, and the `⌨️ The oc way` callouts mark the OpenShift shortcuts. Where a feature is
  OpenShift-only, such as a Route or an operator, the example uses `oc` directly.
- **A Build, run, observe block.** Each hands-on chapter ends with one copy-pasteable sequence that
  stands the thing up, shows the result, and cleans up, so you can run the whole chapter at once.
- **`restricted-v2` throughout.** No example asks for a security exception. Every workload runs
  under the default security context, which is what keeps them accurate about how OpenShift
  actually behaves.
- **Cleanup at the end.** Examples delete the project or release they created, so running them
  leaves no residue, which matters on a single cluster reused across chapters.

These are not arbitrary house style; each one keeps the examples runnable, portable, and safe to
run back to back on the same cluster.

## Reproducing a verification run

Nothing about verification is private to the author. The commands are in the chapters and the
scaffold, so you can reproduce a run and check the result yourself, which is the point of writing
them to be runnable. The shape of a run is always the same: bring up a cluster, ideally a clean
one, run the chapter's commands or its `demo.sh`, and compare what the cluster does to what the
chapter says. Where they agree, the chapter holds; where they differ, the difference is the thing
to report or fix.

For a run meant to prove a chapter from a known state, start from a clean cluster rather than one
carrying earlier work, because leftover namespaces, operators, or CRDs can make an install step
appear to pass when it only found something already there. Recreating the cluster before such a
run removes that ambiguity. For ordinary iteration on one project, a plain stop and start is
faster and fine; the clean start is for when the result has to mean something on its own. This is
the same discipline the platform scripts assume, and it is why each begins by refusing any cluster
that is not OpenShift Local.

## Verification status

Each example is marked `unverified` until it has been run end to end on OpenShift
Local and the result recorded. Verification happens on a live CRC cluster: the
chapter's commands are run against the running cluster, the output is captured into
`openshift/evidence/<date>/` with a secret scrub, and only then is the example
promoted to `verified`. The evidence and the status log live in the repository's
internal plans, not on these pages. That collection is kept unrendered, so the planning notes and
the captured evidence never appear as published pages even though they live in the same
repository. The reader-facing site links only to reader content: the outline, the chapters, the
examples, and the bibliography. The reason to keep status off the pages is that a verification
state is a point-in-time fact about one run on one cluster, which belongs in the internal record
rather than in prose a reader takes as a permanent claim. What belongs on the page is the
technique, written so it holds regardless of when you run it.

Nothing here is marked verified on the strength of looking correct; a status moves
only after a passing run on a real cluster.

This matters more than it might seem, because cluster commands fail in ways that reading alone
does not catch. A manifest that looks right can be rejected by an SCC at admission, a pinned
operator version can vanish from the catalog, an image tag can move, a Route can return a status
the prose did not expect. The only way to know a command works on this release of OpenShift Local
is to run it there, which is why verification is a live step rather than a review. When a live run
turns up a difference, the chapter is corrected to match what the cluster actually did, so the
commands you read are the commands that ran.

The evidence capture is deliberate about secrets. `capture-evidence.sh` records what a run
produced into a dated directory, and it scrubs anything sensitive first, so the kubeadmin password,
tokens, and the pull secret never land in a file. That is the same discipline the earlier chapters
follow at the command line: the cluster is driven through the `crc-admin` context, and no secret is
printed, logged, or committed. Verification and secret hygiene are the two standards every example
here is held to.

## Where this fits

This closes the first part of the guide, which takes you from an empty host to a cluster running
an operator-managed platform, with a runnable example behind every chapter. What you have at this
point is the core: install and start OpenShift Local, deploy under its security model, expose a
service over TLS, package with Helm, and add platform capabilities through operators.

Later parts build on that core in the same example-first, verified-live way. Persistent storage
gives workloads durable volumes that survive a restart. Autoscaling with the Custom Metrics
Autoscaler scales on real signals rather than a fixed replica count. A data-mesh final project
assembles the pieces into a multi-service system running end to end on OpenShift. And a Kubernetes
design-patterns appendix works the full catalog of patterns entirely on OpenShift, with
`restricted-v2` variants of every manifest, reframed from the generic Kubernetes certifications to
OpenShift's own. Each of those will arrive as the earlier chapters did: drafted, then run against a
real cluster, then corrected to match what the cluster did, so the commands you read stay the
commands that work.
