---
title: "Autoscaling"
order: 11
description: "Scale a workload on load with the Horizontal Pod Autoscaler and the Custom Metrics Autoscaler (KEDA), including scale-to-zero."
---

A fixed replica count is a guess. Set it too low and the service struggles under load;
too high and it wastes the node's memory while idle. Autoscaling replaces the guess with
a rule the cluster enforces for you: run as many Pods as the current demand needs, within
the bounds you set. This chapter
starts with the built-in Horizontal Pod Autoscaler, then installs the Custom Metrics
Autoscaler, OpenShift's packaging of KEDA, which scales on far more than CPU and can scale
all the way to zero. The two are not rivals: the HPA is the floor every cluster gives you,
and the Custom Metrics Autoscaler builds on it to reach the signals the HPA alone cannot
read.

{% include excalidraw.html
   file="autoscaling"
   alt="A load signal (CPU, a queue, or a cron schedule) is read by an autoscaler (an HPA or a KEDA ScaledObject) that compares a target to the actual value and sets the Deployment's replica count between a minimum and a maximum."
   caption="Figure 11.1: An autoscaler reads a load signal and sets the Deployment's replica count within a min and a max, so the Pod count tracks demand." %}

## The Horizontal Pod Autoscaler

The Horizontal Pod Autoscaler (HPA) ships with every Kubernetes cluster. It watches a
Deployment's resource use and adjusts the replica count to hold a target, most often CPU:

```bash
oc new-project scale-demo
oc apply -f httpd-deployment.yaml          # the web Deployment from the deploying chapter
oc autoscale deployment/web --min=1 --max=5 --cpu-percent=70
oc get hpa web
```

That creates an HPA that keeps average CPU near 70%, adding Pods up to five under load and
removing them down to one when idle. The HPA reads CPU from the cluster's metrics API,
which OpenShift provides out of the box, so nothing extra is needed for CPU-based scaling.
For this to mean anything, the Deployment must declare a CPU `request`, because the HPA
measures use as a percentage of the request; without one it has no baseline to scale
against. That is the same resource request the deploying chapter recommended, now earning
its keep. A Deployment with no CPU request and an HPA attached is a common mistake: the HPA
reports an unknown metric and never scales, because it has no request to measure against.
Setting the request is the fix, and it is the first thing to check when an HPA sits at its
minimum under obvious load.

The HPA covers the common case well, and for a service whose load tracks CPU it may be all
you need. Its limit is in the name of what it reads: CPU and memory. A service whose real
pressure is a queue depth, a request rate, or a scheduled spike needs a signal the HPA
cannot see on its own.

### Three kinds of autoscaling

It helps to separate the three things people mean by autoscaling, because they operate at
different levels. The Horizontal Pod Autoscaler changes the *number of Pods* in a workload.
The Vertical Pod Autoscaler changes the *resources a Pod requests*, growing or shrinking a
single Pod rather than adding more. The Cluster Autoscaler changes the *number of nodes*,
adding machines when Pods cannot be scheduled. This chapter is about the first kind,
horizontal Pod scaling, which is the one that matters most for a service under variable
load. The Cluster Autoscaler has nothing to do on CRC, because there is one node and no way
to add another, so it is worth knowing it exists and knowing it does not apply here. On a
real cluster the two combine: the HPA adds Pods until the nodes are full, and the Cluster
Autoscaler then adds a node.

## The Custom Metrics Autoscaler

The Custom Metrics Autoscaler is OpenShift's supported build of KEDA, and it closes that
gap. It scales a workload on *events* and *custom metrics*: the length of a Kafka topic,
a Prometheus query, a cron schedule, a queue in a broker, dozens of sources. It also does
something the plain HPA cannot: scale a workload to zero when there is no work, and back up
when work arrives. You install it as an Operator, the pattern from the Operators chapter:

```bash
source openshift/lib.sh
require_crc
install_operator openshift/platform/subscriptions/custom-metrics-autoscaler.yaml \
  openshift-keda openshift-custom-metrics-autoscaler-operator \
  custom-metrics-autoscaler.v2.19.0-4
```

Installing the Operator puts the controller's machinery in place but does not start it.
As with the service mesh, you then create a custom resource that tells the Operator to
deploy its controller, a `KedaController` in the `openshift-keda` namespace:

```yaml
# openshift/platform/keda/kedacontroller.yaml (abridged)
apiVersion: keda.sh/v1alpha1
kind: KedaController
metadata:
  name: keda
  namespace: openshift-keda
spec:
  watchNamespace: ""        # empty: watch every namespace
```

```bash
oc apply -f openshift/platform/keda/kedacontroller.yaml
oc get pods -n openshift-keda          # the KEDA operator, metrics adapter, and admission Pods
```

Re-check the current CSV before pinning, as always, because the catalog moves:

```bash
oc get packagemanifest openshift-custom-metrics-autoscaler-operator \
  -n openshift-marketplace -o jsonpath='{range .status.channels[*]}{.name} {.currentCSV}{"\n"}{end}'
```

### How KEDA reads a custom metric

KEDA works by extending the same metrics machinery the HPA already uses. It runs a
*metrics adapter* that serves Kubernetes' external-metrics API, and a *controller* that
turns each `ScaledObject` into an HPA pointed at those external metrics. So when the HPA
asks "what is the current value of this metric," the answer comes from KEDA's adapter,
which in turn queries the real source: a Kafka broker, a Prometheus server, a cloud queue.
This design is why KEDA can scale on almost anything without the HPA needing to understand
each source. It also explains the Pods you saw in `openshift-keda` after creating the
`KedaController`: the operator, the metrics adapter that serves the values, and an
admission webhook that validates `ScaledObject`s. You do not interact with those directly;
they are the plumbing that makes a one-line trigger work.

## Triggers worth knowing

A `ScaledObject` can list one or more triggers, and the trigger type is where KEDA earns
its place over the plain HPA. The ones that come up most:

- **cpu** and **memory**: the resource triggers, equivalent to what the HPA does, useful as
  a baseline or a floor alongside an event trigger.
- **cron**: scale between two replica counts on a schedule, with no external system, which
  is the easiest to demonstrate and a real fit for predictable daily load.
- **kafka**: scale on a topic's consumer-group lag, so a backlog of messages brings up more
  consumers and a drained topic scales them back down.
- **prometheus**: scale on any PromQL query, which covers request rate, error rate, or any
  metric your monitoring already records.
- **rabbitmq**, **amqp**, and the cloud-queue triggers: scale on the depth of a message
  queue, the classic case for a worker pool.

Mixing triggers is allowed, and KEDA scales to satisfy the most demanding one, so a worker
can hold a CPU floor while also reacting to queue depth. The catalog of triggers is long;
the point is that adopting KEDA once lets you scale on whatever signal actually reflects a
workload's load, rather than forcing everything through CPU.

## Scale on a trigger with a ScaledObject

KEDA scales a workload through a `ScaledObject`, which points at a Deployment and lists
the triggers that drive its replica count. The simplest trigger is CPU, which lets you see
the mechanism without wiring up an external source:

```yaml
# scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: web
  namespace: scale-demo
spec:
  scaleTargetRef:
    name: web
  minReplicaCount: 1
  maxReplicaCount: 5
  triggers:
    - type: cpu
      metricType: Utilization
      metadata:
        value: "70"
```

```bash
oc apply -f scaledobject.yaml
oc get scaledobject web -n scale-demo
oc get hpa keda-hpa-web -n scale-demo  # KEDA creates and manages this HPA under the hood
```

A detail worth knowing: KEDA does not replace the HPA, it drives one. A `ScaledObject`
creates an HPA, named `keda-hpa-<workload>` and owned by the `ScaledObject`, that KEDA keeps
in sync with the triggers, so the CPU case above ends up looking much like the plain HPA, with
KEDA in charge of it. Because of that, a workload can be managed by a standalone HPA or by a
`ScaledObject`, but not both: KEDA's admission webhook rejects a `ScaledObject` whose target
already has an HPA, with a message saying the workload is already managed. Remove the plain HPA
before handing a workload to KEDA. The payoff is that the same
`ScaledObject` can swap the CPU trigger for a Kafka or Prometheus or cron trigger without
any change to how the workload is scaled, which is what makes KEDA worth installing over
the bare HPA.

## Scale to zero

The feature the HPA cannot offer is scaling to zero. Set `minReplicaCount: 0` and the
workload drops to no Pods when its trigger reports no work, then starts a Pod again when
work appears:

```yaml
spec:
  minReplicaCount: 0
  maxReplicaCount: 5
  triggers:
    - type: cron
      metadata:
        timezone: UTC
        start: "0 8 * * *"      # scale up at 08:00
        end:   "0 18 * * *"     # scale down at 18:00
        desiredReplicas: "2"
```

Scale-to-zero suits work that is bursty or scheduled: a batch consumer that only runs when
its queue has messages, a service that is busy during the day and idle at night. On a
single-node CRC cluster, where every idle Pod is memory you could use elsewhere, scaling an
unused workload to zero is a direct win. The cron trigger above is the easiest to watch,
because it does not depend on an external system: the workload scales up and down on the
clock.

> **⌨️ The `oc` way**
>
> The autoscalers are standard custom resources, so there is no special `oc` verb. The
> console helps you watch them: the workload's **Details** page shows the current and
> desired replica counts moving, and the Topology view redraws the Pod count live as the
> autoscaler reacts, which makes a scale event easy to see without polling `oc get pods`.

Scale-to-zero turns on a distinction between *activating* a
workload and *scaling* it. The trigger's activation threshold decides when to move from
zero to one Pod, while the trigger value decides how many Pods to run above that. KEDA
separates them because the step from nothing to something is special: you want a single
message, or any work at all, to wake a scaled-to-zero workload, even if that one message
would not by itself justify a second Pod. The default activation threshold handles the
common case, and you adjust it only when a workload should stay at zero until the backlog
passes some floor.

## Tuning how it scales

Autoscaling that reacts too fast flaps, adding and removing Pods on every blip; too slow and
it lags the load it is meant to track. A `ScaledObject` exposes the knobs that set the pace.
`pollingInterval` is how often KEDA checks the trigger, and `cooldownPeriod` is how long it
waits, after the trigger goes quiet, before scaling back toward the minimum. The underlying
HPA also has a stabilization window that smooths scale-down so a brief dip does not drop
Pods you will need again in a moment. The defaults are sensible for most workloads, and the
right instinct is to leave them until you see flapping or lag, then adjust the one that
matches the symptom: a shorter interval to react faster, a longer cooldown to stop
thrashing. Tuning these without a symptom to fix usually makes scaling worse, not better.

## Autoscaling on a single node

CRC's single node bounds what autoscaling can actually do, and that limit is best known up
front. Adding Pods only helps while the node has room; once the node's memory is
committed, a higher `maxReplicaCount` just leaves the extra Pods `Pending`. So the mechanics
of autoscaling, the HPA holding a target, a `ScaledObject` reacting to a trigger, scale-to-
zero freeing memory, all demonstrate faithfully here, but the ceiling is low. Keep
`maxReplicaCount` modest, and lean on the examples that show the behavior without needing
many Pods: the cron trigger moving a workload between one and two replicas, or scale-to-zero
reclaiming an idle Pod's memory. Everything you configure here applies unchanged on a
multi-node cluster, where the ceiling is the sum of the nodes rather than one; the node count
is the only thing that changes.

## A ScaledJob for batch work

For work that is a finite task rather than a long-running service, KEDA offers a
`ScaledJob` instead of a `ScaledObject`: it creates a Kubernetes Job per unit of work when
a trigger fires, rather than scaling a Deployment's replicas. A queue consumer that should
spin up one Job per batch of messages, run to completion, and exit is the canonical case.
The choice between them follows the workload: a `ScaledObject` for a service that stays up
and varies its replica count, a `ScaledJob` for discrete tasks that start, finish, and go
away.

The distinction matters because the two handle in-flight work differently. Scaling a
`ScaledObject` down can interrupt a long request unless the Pods shut down gracefully, so it
suits work that is safe to cut short or quick to redo. A `ScaledJob` runs each task to
completion in its own Job, so a half-processed batch is never left behind: KEDA starts a Job,
the Job finishes its unit of work, and only then does it exit. For a consumer that must not
drop a message mid-process, that completion guarantee is the reason to choose a `ScaledJob`
over scaling a long-running consumer Deployment. Picking the wrong one shows up as either
dropped work or idle Pods, so matching the object to the shape of the work is worth getting
right at the start.

## Build, run, observe

```bash
oc new-project scale-demo 2>/dev/null || oc project scale-demo
oc apply -f httpd-deployment.yaml
oc set resources deployment/web --requests=cpu=50m   # the HPA scales against a CPU request
oc rollout status deployment/web
# Approach 1: the built-in HPA on CPU
oc autoscale deployment/web --min=1 --max=5 --cpu-percent=70
oc get hpa web
oc delete hpa web                        # remove it before handing the workload to KEDA
# Approach 2: a KEDA ScaledObject manages its own HPA (KEDA installed once, cluster-wide)
oc apply -f scaledobject.yaml
oc get scaledobject web                  # READY=True once reconciled
oc get hpa keda-hpa-web                  # the HPA KEDA created and owns
oc delete scaledobject web
oc delete project scale-demo
```

An HPA that holds a CPU target, and a `ScaledObject` that, once the plain HPA is removed, takes
over and creates its own `keda-hpa-web`, confirm both autoscalers are working. The two are
alternatives on one workload, not a stack; driving the replica count from an external trigger
is the same `ScaledObject` with its trigger swapped, which is the whole reason to install the
Custom Metrics Autoscaler rather than stop at the built-in HPA.

## Where this fits

Your workloads keep their data and scale with load. The next chapter turns to working
inside the cluster directly: the web terminal and the `oc` commands that open a shell in a
running Pod or a throwaway debug copy of one.
