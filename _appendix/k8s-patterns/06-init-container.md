---
title: "Init Container"
order: 6
part: "Structural"
description: "Run ordered pre-start setup in a container that must finish before the main container starts, worked on OpenShift against notification-service's real Alembic migration under restricted-v2."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain why a Pod's main container never starts until every init container has exited successfully
- Read `oc get pods` and `oc describe pod` to tell `Init:Error`, `Init:CrashLoopBackOff`, and `PodInitializing` apart
- Wire a real database migration into an init container using the same image as the application it prepares
- Describe the second use of the pattern: a shared `emptyDir` an init container populates for the main container to read

## Why this matters

Some setup work has to happen exactly once, finish before anything else runs, and has no sensible place inside the application's own startup code. A database migration is the clearest case: `notification-service`'s FastAPI process shouldn't be what decides whether to run `alembic upgrade head`, because that decision has nothing to do with serving HTTP, and running it from inside the app risks two replicas racing to apply the same migration. An init container gives that work its own container, its own lifecycle, and a hard guarantee: the kubelet runs every init container to completion, in order, before it starts a single main container.

Structural patterns are about how containers are composed inside one Pod. Init Container is the simplest composition: two containers that never run at the same time, where the second's existence is conditional on the first succeeding. That's a stronger guarantee than retries or health checks in application code, because the kubelet enforces it, not code that could have a bug. On OpenShift the init container runs under the same `restricted-v2` constraint as the main one, so it carries the same security context and the same injected UID.

## Ordering: the Alembic migration gate

`notification-service`'s Containerfile bakes `alembic.ini` and the `alembic/` migrations into the same image that runs the FastAPI app. The example's `01-deployment.yaml` adds one `initContainers` entry that runs the migration using that image, before the main container:

```yaml
initContainers:
  - name: migrate
    image: image-registry.openshift-image-registry.svc:5000/patterns/notification-service:v1
    workingDir: /opt/app-root/src
    command: ["alembic", "upgrade", "head"]
    env:
      - name: PG_HOST
        value: patterns-postgres.patterns.svc.cluster.local
      # ...PG_USER, PG_PASSWORD, PG_DATABASE, SERVICE_SCHEMA
    securityContext:
      allowPrivilegeEscalation: false
      runAsNonRoot: true
      capabilities: { drop: ["ALL"] }
      seccompProfile: { type: RuntimeDefault }
```

Same image, same database settings as the app container that follows. The command differs (`alembic upgrade head` instead of `uvicorn`), but there's no separate migration image to build or keep in sync: whatever schema the service's models declare today is what this migration brings the database to, because they compile into one artifact.

Alembic's runner has no retry loop: `env.py` opens a connection and runs the migration immediately, and if Postgres isn't reachable the process exits non-zero at once. Deploy before the database exists and the Pod shows it:

```console
$ oc get pod $POD -n patterns
NAME                                    READY   STATUS       RESTARTS   AGE
notification-service-554fc49f7b-6xqng   0/1     Init:Error   2          40s
$ oc logs $POD -n patterns -c migrate
socket.gaierror: [Errno -2] Name or service not known
```

`Init:Error` is the init container's most recent attempt failing; a few seconds later it reads `Init:CrashLoopBackOff` as the kubelet backs off between retries, the same backoff a crashing main container gets, scoped to the init phase. The main container's status stays `PodInitializing` the whole time: it hasn't been created, so there's nothing to probe or log. Apply Postgres and the next retry of `migrate` succeeds:

```console
$ oc logs $POD -n patterns -c migrate
INFO  [alembic.runtime.migration] Running upgrade  -> 0001_create_notifications, create notifications table
$ oc get pod $POD -n patterns
NAME                                    READY   STATUS    RESTARTS   AGE
notification-service-...                1/1     Running   0          15s
```

The migration applied, the `notifications` schema and its `alembic_version` table now exist, and the main container reached `Ready`.

![An init container gating the main container's start, with a nonzero exit leaving the Pod PodInitializing]({{ "/assets/diagrams/appendix-06-init-container.svg" | relative_url }})
*The init container's exit code is the only gate: zero unblocks the main container, nonzero leaves it waiting.*

## Why a migration instead of create-all

Most of this appendix's other services create their schema with `Base.metadata.create_all` from their own startup: create-if-not-exists, fine for a table whose shape never changes. `notification-service` graduated off that shortcut because its table *does* change over time, and `create_all` has no concept of changing an existing table; it only adds what's missing, leaving a column that needs a type change or a dropped constraint untouched. Alembic migrations are different in kind: `0001_create_notifications.py` defines both `upgrade()` and `downgrade()`, so the schema has a version history a team can move forward or roll back, and a later migration composes on top through its `down_revision` pointer.

That history needs somewhere to live, and `notification-service`'s `env.py` puts it in the service's own schema (`version_table_schema="notifications"`), not Postgres's default `public`. The data mesh's Postgres is shared across several services, each with its own schema; if every service kept its version table in `public` they'd collide and corrupt each other's migration history. Scoping the version table to the schema it targets keeps each service's upgrade history isolated, with no coordination between services that share one database.

## What blocks and what doesn't

An ordinary init container's effective policy is "retry on failure, forever, with backoff," because it's expected to eventually succeed; there's no concept of one that's allowed to permanently fail while the Pod still becomes `Ready`. (An init container with its own `restartPolicy: Always`, the native-sidecar mechanism, is a different pattern, covered next.)

Resource requests and limits on an init container are real: the kubelet reserves the init container's own CPU and memory while it runs, released once it exits, before the main container's requests are reserved. A heavy one-time migration can legitimately need more memory than the steady-state app, and an init container is where that request belongs, since it's never charged against the Pod once the main container is up.

Multiple init containers run strictly in listed order, each gating the next. A common structure chains a "wait for dependency" init container ahead of a "run migration" one, so a slow-starting Postgres isn't misdiagnosed as a migration failure. This example skips the wait step because Alembic's own failure is legible enough, but a service with an opaque connection-refused failure benefits from splitting the two concerns.

## Every new Pod runs it again

An init container isn't a one-time cluster action; it's per-Pod. Scale `notification-service` to three replicas and `migrate` runs three times, once per Pod, against the same database and the same already-applied migration. `alembic upgrade head` is idempotent: if the version table already records this migration, the command does nothing and exits zero, which is why it's safe in every Pod's startup path rather than a separate manual operation. A rolling update behaves the same: each new-revision Pod reruns it, which matters the day a second migration has real work: the first Pod to start applies it, and every other Pod racing the same `alembic upgrade head` finds the work done. Postgres's row-level locking inside Alembic's transaction keeps two simultaneous first-Pods from corrupting each other.

## The other half: a shared volume

Not every init container talks to a database. The other canonical use hands the main container something it needs that the init container is better positioned to produce: rendering a config file from a template, fetching a TLS certificate, cloning static assets. The mechanism is a shared `emptyDir` mounted by both: the init container writes into it and exits, the main container mounts the same volume and reads. A service generating a per-replica TLS certificate before starting its listener would use exactly this shape, an init container writing `/etc/tls/cert.pem` into an `emptyDir` and the main container mounting it read-only. The gating guarantee is identical: the main container doesn't start until the write is already on disk, because the init container has exited by the time the main filesystem is assembled.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy multi-container applications (init containers and the Pod startup sequence)
> **Competency:** Configure an init container that must complete before the main container starts
> **Drill:** `oc get pod $POD -n patterns -o jsonpath='{.status.initContainerStatuses[0].state}'`

> **🤖 Explore with your agent**
>
> "Add a second init container ahead of migrate that only checks Postgres is accepting connections, with its own retry loop, and show me both init containers' statuses once the Pod is Running."

## Cleanup

```bash
oc delete -f init-container/01-deployment.yaml -n patterns
oc delete -f init-container/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/init-container/

The runnable example applies `notification-service`'s Deployment before its Postgres exists, to surface `Init:Error` and `Init:CrashLoopBackOff` on the `migrate` init container while the main container sits `PodInitializing`, then supplies Postgres and confirms the migration runs (`0001_create_notifications`), the `notifications` schema and `alembic_version` table exist, and the main container reaches `Ready`. Full walkthrough in `examples/appendix-patterns/init-container/README.md`.
