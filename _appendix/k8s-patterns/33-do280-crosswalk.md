---
title: "DO280/EX280 Crosswalk"
order: 33
part: "Crosswalk"
description: "The closing reference: every chapter in this appendix mapped to its DO280/EX280 objective area, a per-objective coverage summary, and a timed self-test against the shipping services on CRC."
duration: "reference"
---

This is a reference chapter, not a pattern chapter: no new manifests, no runnable example of its own. It closes the appendix by mapping every chapter to the exam it reconciles against, so the set doubles as revision for Red Hat's DO280 course and the EX280 exam (Red Hat Certified Specialist in OpenShift Administration). Where the minikube sibling maps to CKAD's five developer domains, this one maps to EX280's administrator-leaning objective areas, because that's the exam an OpenShift practitioner actually sits.

Two framing notes. First, EX280 doesn't publish fixed percentage weights the way CKAD does, so this crosswalk counts chapters per objective rather than inventing weights. Second, a few patterns sit at the edge of the objectives: custom controllers and CRD-based operators map cleanly to "manage Operators," while DaemonSets and node scheduling lean toward the broader cluster-operations material EX280 assumes rather than tests head-on. The rows say so where it matters.

## The DO280/EX280 objective areas this appendix covers

![The DO280/EX280 objective areas this appendix maps to, each labeled with how many chapters land in it, with security and configuration carrying the largest clusters]({{ "/assets/diagrams/appendix-33-do280-crosswalk.svg" | relative_url }})
*Security and application configuration carry the largest clusters of chapters, matching where restricted-v2, RBAC, and the configuration family concentrate.*

| Objective area | Chapters |
|---|---|
| Deploy and manage applications | 8 |
| Manage application builds | 1 |
| Configure applications for reliability | 6 |
| Manage storage and configuration | 7 |
| Configure networking | 2 |
| Configure security | 3 |
| Manage Operators | 2 |
| Troubleshoot applications | 2 |

## The full crosswalk

| # | Chapter | Family | DO280/EX280 objective | Competency |
|---|---|---|---|---|
| 01 | [Predictable Demands]({{ '/appendix/k8s-patterns/01-predictable-demands/' | relative_url }}) | Foundational | Reliability & resources | Define resource requests/limits and reference a ConfigMap or PVC |
| 02 | [Declarative Deployment]({{ '/appendix/k8s-patterns/02-declarative-deployment/' | relative_url }}) | Foundational | Deploy and manage applications | Apply rolling and recreate strategies and manage rollouts with oc |
| 03 | [Health Probe]({{ '/appendix/k8s-patterns/03-health-probe/' | relative_url }}) | Foundational | Reliability | Configure liveness, readiness, and startup probes |
| 04 | [Managed Lifecycle]({{ '/appendix/k8s-patterns/04-managed-lifecycle/' | relative_url }}) | Foundational | Deploy and manage applications | Multi-container Pod design and the container lifecycle hooks |
| 05 | [Automated Placement]({{ '/appendix/k8s-patterns/05-automated-placement/' | relative_url }}) | Foundational | Deploy and manage applications (scheduling) | Node selectors, affinity, taints/tolerations (single-node reframe) |
| 06 | [Init Container]({{ '/appendix/k8s-patterns/06-init-container/' | relative_url }}) | Structural | Deploy and manage applications | An init container that must complete before the main container starts |
| 07 | [Sidecar]({{ '/appendix/k8s-patterns/07-sidecar/' | relative_url }}) | Structural | Deploy and manage applications | A native sidecar container and its startup/shutdown ordering |
| 08 | [Adapter]({{ '/appendix/k8s-patterns/08-adapter/' | relative_url }}) | Structural | Reliability (observability) | A sidecar that exposes metrics in a standard format |
| 09 | [Ambassador]({{ '/appendix/k8s-patterns/09-ambassador/' | relative_url }}) | Structural | Deploy and manage applications | A proxy sidecar brokering the main container's outbound connection |
| 10 | [Batch Job]({{ '/appendix/k8s-patterns/10-batch-job/' | relative_url }}) | Behavioral | Deploy and manage applications | Jobs, including completions, parallelism, and indexed mode |
| 11 | [Periodic Job]({{ '/appendix/k8s-patterns/11-periodic-job/' | relative_url }}) | Behavioral | Deploy and manage applications | CronJobs, including schedule, concurrencyPolicy, and manual runs |
| 12 | [Daemon Service]({{ '/appendix/k8s-patterns/12-daemon-service/' | relative_url }}) | Behavioral | Deploy and manage applications (leans cluster-ops) | DaemonSets, node placement, and the SCC a hostPath daemon needs |
| 13 | [Singleton Service]({{ '/appendix/k8s-patterns/13-singleton-service/' | relative_url }}) | Behavioral | Reliability | PodDisruptionBudget and voluntary vs involuntary disruption |
| 14 | [Stateless Service]({{ '/appendix/k8s-patterns/14-stateless-service/' | relative_url }}) | Behavioral | Manage storage and configuration | Recognize a workload with no persistent state, and what distinguishes one that has it |
| 15 | [Stateful Service]({{ '/appendix/k8s-patterns/15-stateful-service/' | relative_url }}) | Behavioral | Manage storage and configuration | StatefulSets, headless Services, and volumeClaimTemplates |
| 16 | [Service Discovery]({{ '/appendix/k8s-patterns/16-service-discovery/' | relative_url }}) | Behavioral | Configure networking | Services, cluster DNS, Routes, and why LoadBalancer stays pending on CRC |
| 17 | [Self Awareness]({{ '/appendix/k8s-patterns/17-self-awareness/' | relative_url }}) | Behavioral | Manage storage and configuration | The Downward API via fieldRef, resourceFieldRef, and the volume form |
| 18 | [Env Var Configuration]({{ '/appendix/k8s-patterns/18-env-var-configuration/' | relative_url }}) | Configuration | Manage storage and configuration | A Pod's environment from literals, ConfigMap keys, and Secret keys |
| 19 | [Configuration Resource]({{ '/appendix/k8s-patterns/19-configuration-resource/' | relative_url }}) | Configuration | Manage storage and configuration | Bulk envFrom and the same resource mounted as a volume |
| 20 | [Configuration Template]({{ '/appendix/k8s-patterns/20-configuration-template/' | relative_url }}) | Configuration | Manage storage and configuration | An init container rendering config into a shared volume |
| 21 | [Immutable Configuration]({{ '/appendix/k8s-patterns/21-immutable-configuration/' | relative_url }}) | Configuration | Manage storage and configuration | An immutable ConfigMap/Secret and rolling a change through a Deployment |
| 22 | [Controller]({{ '/appendix/k8s-patterns/22-controller/' | relative_url }}) | Advanced | Manage Operators | A custom controller's watch-and-reconcile loop extending the API |
| 23 | [Elastic Scale]({{ '/appendix/k8s-patterns/23-elastic-scale/' | relative_url }}) | Advanced | Reliability (scaling) | HPA, VPA, and the Custom Metrics Autoscaler for scale-to-zero |
| 24 | [Image Builder]({{ '/appendix/k8s-patterns/24-image-builder/' | relative_url }}) | Advanced | Manage application builds | In-cluster BuildConfig (Docker and Source/S2I strategies) |
| 25 | [Operator]({{ '/appendix/k8s-patterns/25-operator/' | relative_url }}) | Advanced | Manage Operators | A CRD-based operator packaging operational knowledge as an API |
| 26 | [Access Control]({{ '/appendix/k8s-patterns/26-access-control/' | relative_url }}) | Security | Configure security | ServiceAccount, Role, and RoleBinding scoped by resourceNames |
| 27 | [Network Segmentation]({{ '/appendix/k8s-patterns/27-network-segmentation/' | relative_url }}) | Security | Configure networking | Default-deny NetworkPolicy on OVN-Kubernetes, ingress and egress |
| 28 | [Process Containment]({{ '/appendix/k8s-patterns/28-process-containment/' | relative_url }}) | Security | Configure security | securityContext under the restricted-v2 SCC, with Pod Security Admission |
| 29 | [Secure Configuration]({{ '/appendix/k8s-patterns/29-secure-configuration/' | relative_url }}) | Security | Configure security | Manage Secrets, what base64 is not, and least-privilege RBAC on them |
| 30 | [Observability and Debugging]({{ '/appendix/k8s-patterns/30-observability-and-debugging/' | relative_url }}) | Operations | Troubleshoot applications | oc logs, exec, port-forward, describe, events, and both debuggers |
| 31 | [Packaging: Helm and Kustomize]({{ '/appendix/k8s-patterns/31-packaging-helm-and-kustomize/' | relative_url }}) | Operations | Deploy and manage applications | Helm install/upgrade/rollback and Kustomize bases and overlays |
| 32 | [Namespace Governance]({{ '/appendix/k8s-patterns/32-namespace-governance/' | relative_url }}) | Operations | Reliability & resources | ResourceQuota, LimitRange, and OpenShift's ClusterResourceQuota |

## Coverage by objective

Counting the table by its objective column:

| Objective area | Chapters |
|---|---|
| Deploy and manage applications | 8 (02, 04, 05, 06, 07, 09, 10, 11, 12, 31) |
| Manage application builds | 1 (24) |
| Configure applications for reliability | 6 (01, 03, 08, 13, 23, 32) |
| Manage storage and configuration | 7 (14, 15, 17, 18, 19, 20, 21) |
| Configure networking | 2 (16, 27) |
| Configure security | 3 (26, 28, 29) |
| Manage Operators | 2 (22, 25) |
| Troubleshoot applications | 2 (08 observability side, 30) |

Every objective has direct coverage; the distribution is uneven, and that's expected. Application configuration and security carry the largest clusters, matching where the Configuration family, RBAC, SCC, and Secret handling concentrate. "Manage application builds" has a single dedicated chapter (Image Builder), because OpenShift folds most of the build story into one BuildConfig mechanism rather than spreading it across patterns. The counts above list a chapter under its primary objective; several brush others (Ambassador and Adapter touch networking; Stateful Service touches reliability) and are tagged by what they actually teach.

## Self-test: a timed pass against the shipping services on CRC

Fifteen tasks, each naming the chapter that teaches it. Budget about five minutes per task and don't look at the answer chapter until you've attempted it cold. Everything targets the `patterns` namespace on CRC; bring up the cluster and confirm the service imagestreams exist before starting the clock.

1. Without editing any YAML, set `shipping-service`'s CPU request to 150m and its memory limit to 768Mi with a single `oc` command. (chapter 01)
2. Roll out a new `shipping-service` image with zero dropped requests during the rollout, then undo it and confirm the previous image is back. (chapter 02)
3. Add a startup probe to `inventory-service` generous enough that a slow cold start is never mistaken for a liveness failure. (chapter 03)
4. Add an init container to `shipping-service` that blocks until `patterns-postgres` accepts connections before the main container starts. (chapter 06)
5. Put an ambassador sidecar in front of `order-service`'s outbound call to `inventory-service` so the main container always dials `localhost`. (chapter 09)
6. Run a one-shot Job (not a Deployment) with 3 completions and parallelism 1 against the shipping schema. (chapter 10)
7. Set a PodDisruptionBudget on `payment-service` so a voluntary node drain can never take down its only replica. (chapter 13)
8. Expose `shipping-service` with a ClusterIP Service, reach it by its in-cluster DNS name from another Pod, then publish it externally with an edge-TLS Route. (chapter 16)
9. Inject a Pod's own namespace into `notification-service` as an environment variable via the Downward API, with no hardcoded string. (chapter 17)
10. Source `payment-service`'s database password from a Secret key rather than a ConfigMap key, and be ready to explain the RBAC difference. (chapter 18)
11. Scope a ServiceAccount for `payment-service` to `get` on exactly one named ConfigMap and one named Secret, and prove with `oc auth can-i` that a decoy read and a `list` are denied. (chapter 26)
12. Write a NetworkPolicy that lets only `graphql-gateway` reach `inventory-service` on its gRPC port, and confirm every other Pod is blocked. (chapter 27)
13. Harden `inventory-service` to restricted-v2 (non-root, dropped capabilities, read-only root), confirm its admitting SCC and injected UID, then show a privileged Pod rejected in a labeled namespace. (chapter 28)
14. Build `shipping-report` inside the cluster from a git commit with a Docker-strategy BuildConfig, and pull the result into a Pod from the integrated registry. (chapter 24)
15. Cap the `patterns` namespace to 3 pods total and watch a fourth `shipping-service` replica rejected before any Pod object for it exists. (chapter 32)

## 🤖 Explore with your agent

> "Generate five more EX280-style practice tasks against the shipping services that this appendix hasn't covered in its self-test, each naming the crosswalk chapter that teaches the skill, and weight them toward whichever objective area in the coverage table has the fewest chapters."

## Verification

This chapter's self-test is its verification: there's no separate runnable example, since every task reuses a prior chapter's own deployment. Work through all fifteen against a live CRC cluster before treating the appendix as complete revision.
