---
title: "Batch Job"
order: 10
part: "Behavioral"
description: "Run work to completion instead of forever on OpenShift with a Job's completions and parallelism, then partition a dataset deterministically with an Indexed Job."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain how a `Job` differs from a `Deployment`: running to completion instead of indefinitely
- Tune `completions` and `parallelism` to control how many Pods must succeed and how many run at once
- Use `completionMode: Indexed` and `JOB_COMPLETION_INDEX` to partition a dataset across Pods with no coordination service
- Read `oc get jobs` and a Job's Pod statuses to tell a retry in progress from an outright failure

## Why this matters

Every workload so far in this appendix runs forever by design: a Deployment's contract is "keep this many Pods running," and a Pod that exits is a Pod that failed. A batch report, a data migration, a one-off cleanup, none of those are supposed to run forever; they're supposed to finish, and a controller built around "keep this running" has no vocabulary for "run this until it's done, then stop." That's a `Job`: a controller whose success condition is a count of completed Pods, not running ones.

The distinction matters beyond semantics. A Deployment that crash-loops is an incident; a Job's Pod that exits non-zero is an expected outcome the controller retries, up to a bound you set. Reach for a Deployment when failing to be running is the problem; reach for a Job when failing to finish is the problem. This chapter works `shipping-report`, a small `uv`-managed CLI (net-new, not a data-mesh service) that reads rows from its own `shipping.shipment_events` table and writes a CSV to a PersistentVolumeClaim. It's built with podman and pushed to the integrated registry like every other image here.

## completions and parallelism

A plain, non-indexed Job declares two independent numbers:

```yaml
spec:
  completions: 3
  parallelism: 3
  backoffLimit: 2
```

`completions` is how many Pods must exit `0` before the Job is `Complete`; `parallelism` is how many may run at once. They aren't one knob with two names: set `completions: 5` with `parallelism: 2` and the controller runs two at a time, starting a third as each finishes, until five have succeeded, a bounded worker pool working through fixed work. Set them equal, as here, and all three start together.

`backoffLimit` caps retries of a failed Pod before the Job gives up, with exponential backoff (10s, 20s, 40s, capped at six minutes) so a transient failure doesn't hammer whatever it fails against. A Job that exhausts it reports `BackoffLimitExceeded` and stops; nothing retries it without a human or a CronJob creating a new one.

This plain Job's three Pods run the same `report` command with `PARTITION_COUNT=1`, so each sees every row, and each would collide on the same filename if it didn't distinguish itself. The manifest tags each report with its Pod name through the Downward API:

```yaml
env:
  - name: REPORT_TAG
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
```

Three Pods, three identical full reports (300 rows each), three different filenames. `completions`/`parallelism` describe how many and how concurrent, not how the work divides. For redundant runs of one task, that's the whole story. For three Pods that should split one dataset into disjoint pieces, it isn't enough, which the next mechanism fixes.

![A Job partitions shipment_events across three Pods by completion index, each writing its own CSV to a shared PVC]({{ "/assets/diagrams/appendix-10-batch-job.svg" | relative_url }})
*completions and parallelism control how many Pods run and succeed; completionMode: Indexed divides the data between them.*

## Indexed Jobs: cooperative partitioning

`completionMode: Indexed` changes what each Pod knows about itself:

```yaml
spec:
  completionMode: Indexed
  completions: 3
  parallelism: 3
```

With it set, OpenShift injects a `JOB_COMPLETION_INDEX` environment variable into every Pod, a distinct integer from `0` to `completions - 1`, unique for the Job's life. `shipping-report` reads it and partitions `shipment_events` by `id % partition_count`. Three Pods produce three disjoint slices, verified through a viewer Pod on the same volume:

```console
$ oc exec shipping-report-viewer -n patterns -- ls /var/lib/shipping-reports/
report-0.csv
report-1.csv
report-2.csv
# each: 100 data rows -> 300 total, every row exactly once
```

No Pod talks to another to agree who takes which slice; the index itself is the coordination, assigned by OpenShift and guaranteed not to repeat within the Job. That's the value of an Indexed Job: partitioning a known-size dataset across a fixed number of workers needs no external queue, no leader election, no locking, because the one piece of shared state that matters, which worker owns which slice, is a field the platform already tracks per Pod.

The indexed Job uses `restartPolicy: Never` rather than `OnFailure`. With `OnFailure` a failed container restarts in the same Pod, same index; with `Never` the failed Pod is left for inspection and the controller creates a fresh Pod carrying the same index, still bounded by `backoffLimit`. Either preserves the one-index-per-Pod guarantee the partitioning depends on; the choice is whether you want the failed attempt's logs left behind (`Never`) or the local restart (`OnFailure`).

## Why seed is its own Job

Both report Jobs need `shipment_events` populated, so a third, simpler Job runs first: `shipping-report seed`, `completions: 1`. It's idempotent, checking the row count before inserting, so it's safe to re-run after a transient failure without duplicating data (the live run reported `seeded 300 shipment_events rows`). A one-completion setup Job and a multi-completion work Job are two shapes of one primitive, not two primitives, and splitting them keeps each one's numbers meaning exactly one thing.

## ttlSecondsAfterFinished and bounding run time

Left alone, a completed Job and its Pods stick around indefinitely, useful until a namespace accumulates hundreds from a recurring workload. `ttlSecondsAfterFinished: 300` tells the TTL controller to delete the whole Job 300 seconds after it reaches a terminal state, success or failure. This is distinct from `backoffLimit`, which governs retries *before* a terminal state; the TTL only counts once the Job is done. A Job whose logs you need after a failure should set this generously (or not at all); a Job firing every few minutes from a CronJob wants it short so runs don't pile up.

`backoffLimit` bounds retry count but says nothing about wall-clock time. A Pod that hangs instead of failing never trips it. `activeDeadlineSeconds` closes that gap: once a Job has been active that many seconds (from the first Pod's start), the controller terminates every Pod and marks the Job `Failed` with reason `DeadlineExceeded`, regardless of `backoffLimit`. One governs retries, the other wall-clock time; a Job needing both bounds sets both. Neither example sets it here, because these partitions are small enough that a hang signals a bug rather than a slow workload, but it's the knob to reach for when a batch job's duration becomes unpredictable.

## When a retried Pod can't pull its image

A Job's retried Pod (from `backoffLimit`, or the Indexed Job's `restartPolicy: Never` creating a fresh Pod per retry) re-evaluates its image reference exactly like any new Pod. On OpenShift the image comes from the integrated registry, so if the `shipping-report:v1` tag was never pushed, or was pushed to a different namespace's registry path, every retry fails identically with `ImagePullBackOff`, which reads at first glance like an application bug rather than an image-availability problem. `oc get istag -n patterns shipping-report:v1` before chasing a Job failure into the logs is the faster diagnostic, because a Job stuck retrying looks identical regardless of which cause is responsible.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy applications (run work-to-completion with Jobs and CronJobs)
> **Competency:** Configure `completions`, `parallelism`, and indexed completion mode on a Job
> **Drill:** `oc get job -n patterns -l app.kubernetes.io/name=shipping-report-indexed -o jsonpath='{.items[0].spec.completionMode}'`

> **🤖 Explore with your agent**
>
> "Change the indexed Job's completions and the shipping-report PARTITION_COUNT from 3 to 5, rerun it, and show me the five output files still cover every row exactly once with no overlap."

## Cleanup

```bash
oc delete jobs -n patterns -l app.kubernetes.io/name=shipping-report-plain
oc delete jobs -n patterns -l app.kubernetes.io/name=shipping-report-indexed
oc delete pod/shipping-report-viewer -n patterns
oc delete -f batch-job/02-seed-job.yaml -f batch-job/01-pvc.yaml -f batch-job/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/batch-job/

The runnable example builds the `shipping-report` image to the integrated registry, seeds 300 demo rows, then runs a plain Job (three redundant 300-row reports, each tagged by Pod name) and an Indexed Job (three disjoint 100-row partitions, `report-0/1/2.csv`) against one PVC, confirming through a viewer Pod that the file sets differ exactly as the pattern predicts. Full walkthrough in `examples/appendix-patterns/batch-job/README.md`.
