---
title: "Periodic Job"
order: 11
part: "Behavioral"
description: "Wrap a Job in a CronJob to run it on a schedule on OpenShift, and reason about concurrencyPolicy, startingDeadlineSeconds, suspend, and history limits instead of a crontab on a server."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what a `CronJob` manages: a template for Jobs, not a Job itself
- Set a `schedule` and reason about which time zone it runs in
- Choose a `concurrencyPolicy` and say what happens when a firing overlaps a still-running previous one
- Trigger an on-demand run with `oc create job --from=cronjob` and pause a schedule with `suspend`

## Why this matters

A recurring batch task used to mean a crontab entry on a server somewhere: a line in `/etc/cron.d`, a script with its own logging and retry logic, and its own assumption that the server stays up. None of that travels into a cluster where any node can disappear and workloads move around it. `CronJob` is the Kubernetes-native answer: the same scheduling syntax crontab popularized, producing an ordinary `Job` object each time it fires, with every Job guarantee from the previous chapter intact.

The relationship is direct. Periodic Job isn't a different mechanism from Batch Job; it's Batch Job with a scheduler in front, generating a fresh `shipping-report` Job on a timer instead of a human running `oc create` by hand. Everything the previous chapter said about `completions`, `backoffLimit`, and `ttlSecondsAfterFinished` applies unchanged to the Job template a CronJob wraps, including the `restricted-v2` security context on its Pods. This chapter is the layer of control specific to doing it repeatedly, unattended.

## The schedule and the CronJob controller

The example's `03-cronjob.yaml` wraps the same `shipping-report` runner:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: shipping-report
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: shipping-report
              image: image-registry.openshift-image-registry.svc:5000/patterns/shipping-report:v1
              args: ["report"]
```

```console
$ oc get cronjob shipping-report -n patterns
NAME              SCHEDULE      CONCURRENCY   SUSPEND
shipping-report   */5 * * * *   Forbid        false
```

`schedule` uses standard five-field crontab syntax, evaluated in the control plane's configured time zone by default (UTC on most clusters). A per-CronJob `timeZone` field (stable since Kubernetes 1.27) overrides that for one CronJob without touching cluster config, worth knowing the moment a schedule needs to track a business time zone rather than whatever the control plane runs in.

The controller's job is narrow: at each tick, create a Job from `jobTemplate`, and otherwise stay out of the way. It runs nothing itself and tracks no application success beyond what the Job already reports. Everything about *how* the work runs belongs to the nested Job spec; everything about *when* belongs to the CronJob. That's why `oc get cronjob` and `oc get jobs` show two layers: the CronJob shows the schedule and last firing, each Job shows up separately with its own Pods and lifecycle.

![A CronJob firing on schedule to create successive Jobs, each writing its own report, with history limited to the most recent few]({{ "/assets/diagrams/appendix-11-periodic-job.svg" | relative_url }})
*The CronJob controller creates one Job per tick; successfulJobsHistoryLimit bounds how many completed ones stick around.*

## concurrencyPolicy: what happens on overlap

A report that normally finishes in seconds can, under load, still be running when the next tick arrives. `concurrencyPolicy` decides what the controller does:

```yaml
spec:
  concurrencyPolicy: Forbid
```

`Forbid` (set here) skips the new firing entirely if the previous Job hasn't finished, logging the skip as an event rather than queuing it. `Allow` (the default) lets them run side by side, safe only if concurrent runs don't conflict. For `shipping-report`, concurrent firings would duplicate work against the same data, so `Forbid` is deliberate. `Replace` is the third option: cancel the still-running previous Job and start the new one, appropriate only when the newer run's data should supersede a stale one.

`oc create job --from=cronjob/shipping-report <name>` bypasses `concurrencyPolicy`: it talks to the Job API directly, not through the controller's scheduling loop, so an on-demand Job can run alongside a scheduled one even under `Forbid`. That's a deliberate asymmetry: `concurrencyPolicy` governs the controller's own decisions, and a manually created Job was never one of them. Useful for testing against the live schedule, which is exactly how this example verifies the CronJob without waiting out a five-minute interval:

```console
$ oc create job --from=cronjob/shipping-report shipping-report-manual-1 -n patterns
$ oc wait --for=condition=complete job/shipping-report-manual-1 -n patterns
job.batch/shipping-report-manual-1 condition met
```

## startingDeadlineSeconds and missed firings

If the controller is down, or the cluster can't create Jobs, a tick can be missed. `startingDeadlineSeconds: 60` bounds how late a missed firing may still start: within 60 seconds the controller creates the Job as soon as it can; past that it gives up on that tick, records a `MissedSchedule` event, and waits for the next. Leaving it unset means no deadline: a controller back online after an extended outage would attempt every missed firing it can account for, rarely what a report schedule wants.

## suspend, and history limits

A CronJob is often the first thing to pause during an incident, when a report querying an already-loaded database is one more load source worth removing. Deleting it is the wrong tool (it also deletes the schedule and history); `suspend` is the right one:

```console
$ oc patch cronjob shipping-report -n patterns -p '{"spec":{"suspend":true}}'
$ oc get cronjob shipping-report -n patterns -o jsonpath='{.spec.suspend}'
true
```

A suspended CronJob stops creating Jobs, but its `jobTemplate` and every completed Job remain. Flipping it back to `false` resumes from the next natural tick; it does not retroactively run ticks missed while suspended, the same logic `startingDeadlineSeconds` applies to any missed firing: a CronJob fires going forward, never reconciling a backlog.

`successfulJobsHistoryLimit: 3` keeps the last three successful runs and garbage-collects older ones; `failedJobsHistoryLimit: 1` keeps even less, on the reasonable assumption that one recent failure is enough to start debugging. Each firing's Job name is auto-generated from the CronJob name plus an encoded scheduled time (`shipping-report-28545360`), which is what guarantees two ticks never collide on a name even if the controller is briefly behind. A manually created Job sidesteps that scheme, needing an explicit name, one more small distinction between a scheduled firing and a manual one.

## Why a CronJob and not a scheduler in the app

A service could schedule its own recurring work with an in-process scheduler, APScheduler in Python, Quartz on the JVM, a `setInterval` in Node. On a single instance that works. The moment the service runs as a Deployment with more than one replica, every replica's scheduler fires on the same tick, and the recurring task runs once per replica instead of once per cluster. Avoiding that means adding leader election or a distributed lock so only one replica acts, which is real infrastructure to build and get right. A CronJob sidesteps the whole problem: the control plane fires it exactly once per tick regardless of how many replicas of anything are running, because the schedule lives in one cluster-level object, not in N copies of an application. For work that must happen once on a timer rather than once per instance, moving the schedule out of the application and into a CronJob is the move that removes a class of duplicate-execution bugs entirely.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy applications (schedule recurring work with CronJobs)
> **Competency:** Configure a schedule, concurrency policy, and history limits, and trigger a Job from a CronJob template
> **Drill:** `oc create job --from=cronjob/shipping-report -n patterns shipping-report-drill-1`

> **🤖 Explore with your agent**
>
> "Change concurrencyPolicy from Forbid to Replace, trigger two manual Jobs from the CronJob template back to back, and show me what happens to the first once the second starts."

## Cleanup

```bash
oc delete -f periodic-job/03-cronjob.yaml -n patterns
oc delete jobs -n patterns -l app.kubernetes.io/name=shipping-report
oc delete job/shipping-report-manual-1 pod/shipping-report-viewer -n patterns --ignore-not-found
oc delete -f periodic-job/02-seed-job.yaml -f periodic-job/01-pvc.yaml -f periodic-job/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/periodic-job/

The runnable example wraps the Batch Job chapter's runner in a CronJob (`*/5`, `concurrencyPolicy: Forbid`), triggers an on-demand run with `oc create job --from=cronjob` and confirms it completes and writes its Pod-tagged report, then suspends and resumes the schedule. Full walkthrough in `examples/appendix-patterns/periodic-job/README.md`.
