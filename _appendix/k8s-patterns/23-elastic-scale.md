---
title: "Elastic Scale"
order: 23
part: "Advanced"
description: "Three ways to change a workload's replica count without a human running oc scale: an HPA and a VPA reading the Pods themselves, and the Custom Metrics Autoscaler reading an external signal instead, which is the only path to zero."
duration: "30 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what a HorizontalPodAutoscaler reads, and why it can never legitimately scale a workload to zero
- Explain why running a VerticalPodAutoscaler in `Auto` mode alongside an HPA on the same resource is a real conflict, and how `Off` mode avoids it
- Define a Custom Metrics Autoscaler `ScaledObject`, and explain how an external trigger answers "should this run" without the workload running to be measured
- State why scale-to-zero requires an external signal, and can never come from resource metrics alone

## Why this matters

Every autoscaler in this chapter answers the same question, "how many replicas should this workload have right now," but they disagree sharply about where the answer comes from, and that disagreement has a hard floor built into it. A HorizontalPodAutoscaler and a VerticalPodAutoscaler both read the Pods themselves: CPU and memory usage reported by the kubelet through the resource metrics API. That's a structural limitation, not a configuration choice: a metric computed from a running Pod's own usage cannot exist until a Pod is running, which means neither autoscaler can ever justify a replica count of zero. There's nothing to measure.

The Custom Metrics Autoscaler, Red Hat's supported build of KEDA (the Kubernetes Event-driven Autoscaler), answers the same question from outside the Pods entirely: a cron schedule, Kafka consumer lag, a Prometheus query, any of dozens of external signals a workload's own absence doesn't prevent from existing. A schedule still says "business hours" when the Deployment it governs has zero replicas; a Kafka topic still has a lag number when its consumer is scaled to zero. That independence from a running Pod is the entire mechanism behind scale-to-zero.

This chapter works through resource-based scaling on `shipping-service` first, then switches to event-based scaling on `graphql-gateway` for the scale-to-zero half. A note on scope: installing and operating autoscaling infrastructure sits closer to the DO280/EX280 administration boundary than to day-to-day application work; the application-level competency is understanding what each autoscaler reads and does to a workload, not building the autoscaling stack from scratch.

## The CRC prerequisite: a metrics API

OpenShift's resource metrics (`oc adm top`, an HPA's CPU percentage, a VPA's recommendation) are all served by the metrics API, `metrics.k8s.io`. A full cluster gets that from the monitoring stack, which CRC ships disabled by default to save memory. On a stock CRC instance the API simply isn't registered:

```console
$ oc get apiservices v1beta1.metrics.k8s.io
Error from server (NotFound): apiservices "v1beta1.metrics.k8s.io" not found
```

Without it an HPA reads `cpu: <unknown>/50%` forever and a VPA never produces a recommendation. The lightweight fix, short of turning on the whole monitoring stack, is the upstream metrics-server, one Deployment that registers the API and nothing else. The example's `metrics-server.yaml` is the stock manifest with two CRC-specific edits: `--kubelet-insecure-tls` (CRC's single node serves kubelet metrics with a cert the server doesn't chain to by default) and the removal of the manifest's pinned `runAsUser: 1000`, which is outside the namespace's assigned UID range and so forbidden by restricted-v2. With it running, `oc adm top pod` returns real numbers and the HPA's target resolves.

## HorizontalPodAutoscaler: replicas from CPU

An HPA needs one thing from its target Deployment that nothing else in this chapter requires: an explicit CPU request, because utilization is always computed as a percentage of that request, never of a limit or of absolute cores.

```yaml
spec:
  scaleTargetRef:
    kind: Deployment
    name: shipping-service
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
```

`averageUtilization: 50` means the HPA controller (the identical observe-diff-act loop the Controller pattern describes, running inside `kube-controller-manager` against the metrics API) tries to keep average CPU across every Pod at 50% of each Pod's own 100m request. Drive usage above that and it computes a higher replica count and patches the Deployment's `spec.replicas` directly, no different in mechanism from a human running `oc scale`. Generating load against `shipping-service`'s `/health` endpoint from an in-cluster Pod pushes the observed percentage up fast; watching `oc get hpa` shows the climb and the replica count following it:

```console
$ oc get hpa shipping-service -n patterns
NAME               TARGETS         MINPODS   MAXPODS   REPLICAS
shipping-service   cpu: 455%/50%   1         5         5
```

`minReplicas: 1` is the floor this autoscaler can't cross on its own: there is no CPU percentage computable from zero running Pods, so the lowest `minReplicas` that means anything is one. Once the load stops, the controller scales back toward one after a stabilization window meant to avoid flapping on a brief spike.

## VerticalPodAutoscaler: a second axis, carefully scoped

Where an HPA changes *how many* Pods exist, a VerticalPodAutoscaler changes *how big* each one is, computing a recommended CPU and memory request from a Pod's own historical usage. On OpenShift the VPA components come from the VerticalPodAutoscaler operator (OperatorHub), not a built-in; once installed, this example runs it in the one mode that can't conflict with anything else:

```yaml
spec:
  targetRef:
    kind: Deployment
    name: shipping-service
  updatePolicy:
    updateMode: "Off"
```

`updateMode: "Off"` means the recommender still watches actual usage and still computes a recommendation, visible directly with `oc describe vpa`, but nothing acts on it automatically: no Pod is evicted, no Deployment patched. On this cluster the recommendation reads:

```console
$ oc describe vpa shipping-service -n patterns
  Target:
    Cpu:     25m
    Memory:  250Mi
```

`Auto` mode would act on that number, evicting a Pod whose request has drifted too far from the current recommendation so its replacement is created with the updated value. That's precisely the behavior that can't safely coexist with an HPA scaling the same resource on the same Deployment: VPA rewriting the CPU request changes the denominator the HPA's utilization percentage is computed against, mid-flight, with neither controller aware the other is reacting to a number it just changed. `Off` mode sidesteps the conflict entirely: a human (or a separate, intentional automation) reads the recommendation and decides whether to act, keeping VPA's useful signal (this workload's real footprint, measured rather than guessed) without a second controller silently fighting the first over the same field.

![An HPA and an Off-mode VPA on shipping-service reading the Pods themselves, contrasted with a KEDA ScaledObject on graphql-gateway reading a cron schedule from outside the Pods entirely, which is what lets it scale to zero]({{ "/assets/diagrams/appendix-23-elastic-scale.svg" | relative_url }})
*Resource-based scaling needs a running Pod to measure; event-based scaling measures something outside the Pod instead, and that's the entire difference.*

## Custom Metrics Autoscaler: scaling a gateway from zero

`graphql-gateway` starts at `replicas: 0` and is governed by a KEDA `ScaledObject`. The Custom Metrics Autoscaler ships the core `ScaledObject` CRD but not the separate HTTP add-on upstream KEDA offers, so this chapter demonstrates scale-to-zero with the cron trigger, which needs no external system to measure:

```yaml
spec:
  scaleTargetRef:
    name: graphql-gateway
  minReplicaCount: 0
  maxReplicaCount: 3
  pollingInterval: 15
  cooldownPeriod: 30
  triggers:
    - type: cron
      metadata:
        timezone: UTC
        start: "0 0 * * *"
        end: "59 23 * * *"
        desiredReplicas: "2"
```

Applying this while the window is active scales the gateway from zero: KEDA generates an ordinary HPA (`keda-hpa-graphql-gateway`), wired to its own external-metrics adapter rather than the metrics API, and that HPA drives the Deployment to `desiredReplicas`. Narrow the window to a span that excludes the current time, and within one `pollingInterval` KEDA reports the trigger inactive, deletes the generated HPA, and holds the Deployment at zero:

```console
$ oc patch scaledobject graphql-gateway -n patterns --type merge \
    -p '{"spec":{"triggers":[{"type":"cron","metadata":{"timezone":"UTC","start":"0 3 * * *","end":"1 3 * * *","desiredReplicas":"2"}}]}}'
$ oc get deploy graphql-gateway -n patterns    # replicas drop to 0 within ~30s
NAME              READY   AVAILABLE
graphql-gateway   0/0     0
```

`minReplicaCount: 0` is the capability a plain HPA can't express: an HPA object always assumes at least one replica exists to measure, and has no mechanism to delete itself and hold a workload at zero. That's the one new thing KEDA adds; everything else it does, it does by generating an HPA and letting it scale the ordinary way.

## The Kafka consumer-lag shape, shown but not run

The other canonical KEDA trigger measures a queue's backlog rather than a schedule, and the §17 data mesh runs it in production against `notification-service`, a real Kafka consumer. This appendix's `shipping-service` is a REST-only skeleton, and the pristine `patterns` cluster runs no broker, so `06-shipping-kafka-scaledobject.yaml` is included as a reference only, explicitly not applied: its `bootstrapServers` trigger would have nothing to poll against. Reading it alongside the cron trigger still pays off: `lagThreshold: "5"` means one replica per five messages of unprocessed backlog, computed by KEDA polling Kafka's committed-offset-versus-log-end-offset gap for that consumer group, entirely independent of whether a consumer is running to report it. That independence is exactly what lets it, like the cron trigger, legitimately set `minReplicaCount: 0` where a CPU-based HPA never could.

## Why the families don't compete, and one hard rule

KEDA doesn't replace the HPA; the moment a `ScaledObject` is created, KEDA generates an ordinary HPA behind the scenes. From that generated HPA's own perspective, cron state or Kafka lag is just another external metric, scaled the identical way a CPU percentage would be. This produces one rule the admission webhook enforces: a workload may have a standalone HPA *or* a `ScaledObject`, never both on the same target. `shipping-service` carries the hand-written HPA; `graphql-gateway` carries the `ScaledObject` and lets KEDA own its generated `keda-hpa-graphql-gateway`. Pointing a second hand-written HPA at a KEDA-managed Deployment is rejected outright. Treat the HPA and VPA as the baseline every resource-backed workload should have, and reach for the Custom Metrics Autoscaler for the subset of workloads, scheduled or bursty or queue-driven, where the correct answer to "how many replicas right now" is sometimes legitimately zero.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for scalability (autoscale workloads horizontally)
> **Competency:** Create a HorizontalPodAutoscaler and understand event-driven scale-to-zero via the Custom Metrics Autoscaler, including the metrics prerequisite
> **Drill:** `oc get hpa,scaledobject -n patterns`

> **🤖 Explore with your agent**
>
> "Change graphql-gateway's cron trigger desiredReplicas from 2 to 3, reapply it inside an active window, and show me the generated keda-hpa object's new target replica count."

## Cleanup

```bash
oc delete -n patterns -f elastic-scale/05-gateway-scaledobject.yaml --ignore-not-found
oc delete -n patterns -f elastic-scale/04-gateway-deployment.yaml --ignore-not-found
oc delete -n patterns -f elastic-scale/03-vpa.yaml --ignore-not-found
oc delete -n patterns -f elastic-scale/02-hpa.yaml --ignore-not-found
oc delete -n patterns -f elastic-scale/01-deployment.yaml --ignore-not-found
oc delete -n patterns -f elastic-scale/00-postgres.yaml --ignore-not-found
# metrics-server, the Custom Metrics Autoscaler, and the VPA operator are
# shared infrastructure; leave them, or see README.md to remove them.
```

## Verification: examples/appendix-patterns/elastic-scale/

The runnable example installs metrics-server (confirmed: `oc adm top pod` returns live numbers), puts an HPA and an Off-mode VPA on `shipping-service`, confirms the HPA climbs under generated load (observed `455%/50%`, replicas 1 to 5) and the VPA produces a recommendation (`Cpu: 25m`), then switches to `graphql-gateway` behind a Custom Metrics Autoscaler cron `ScaledObject` to confirm the full zero-to-N-to-zero lifecycle (0 to 2 inside the window, back to 0 outside it). A reference-only Kafka consumer-lag `ScaledObject` rounds out the manifest set without being applied. Full walkthrough, including the CMA and VPA operator installs, in `examples/appendix-patterns/elastic-scale/README.md`.
