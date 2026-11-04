---
title: "Sidecar"
order: 7
part: "Structural"
description: "Run a helper container beside the app in one Pod on OpenShift, sharing its network and a volume, using the native sidecar mechanism for a correct startup and shutdown order."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what two containers in one Pod share automatically: a network namespace and, when declared, a volume
- Declare a native sidecar with `restartPolicy: Always` on an `initContainers` entry, and say why that differs from a plain second container
- Trace the startup and shutdown order a native sidecar gets, and why that order matters
- Decide when a helper belongs in its own container instead of inside the application's process

## Why this matters

A Pod is one scheduling unit, but not one process. Two containers in the same Pod share a network namespace, so one reaches the other at `localhost` with no Service, no DNS, no network policy in between; they can share a volume, so one writes a file the other reads. Sidecar is the pattern for putting a second, independent container in that Pod to do something alongside the main application, rather than folding it into the application's code.

The case for a separate container over a library the app imports is isolation: a helper in a different language, on a different release cadence, or with different resource needs doesn't become a dependency of the application's build, and a bug in it can't corrupt the application's memory. The cost is real too: another container to schedule, patch, and watch fail. Structural patterns are worth it only when the helper doesn't belong inside the app at all. On OpenShift both containers run under `restricted-v2`, so the sidecar carries the same security context as the app.

## A probe-tailing sidecar

`shipping-service`'s example adds a second container, `probe-tailer`, that polls the app's `/health` and `/healthz` over `127.0.0.1` every five seconds and appends a timestamped line to a shared `emptyDir`:

```python
def probe(path):
    with urllib.request.urlopen(f"http://127.0.0.1:8080{path}", timeout=2) as resp:
        return resp.status
```

Nothing about `shipping-service` changes. The sidecar reaches it the way any client would, over HTTP, except the address is `localhost`, because the two containers share one network namespace by definition: every container in a Pod sees the same loopback interface and port space. Tail the shared file through the sidecar:

```console
$ oc exec -n patterns $POD -c probe-tailer -- tail -n 4 /var/log/shipping-service/probe-tail.log
2026-11-04T13:39:45+00:00 health=error:URLError ready=error:URLError
2026-11-04T13:39:50+00:00 health=200 ready=200
2026-11-04T13:39:55+00:00 health=200 ready=200
```

That first line is the whole startup story in one log entry: the sidecar was already running and polling before `shipping-service` could answer, so its first probe failed. A production log sidecar does something weightier (Fluent Bit or Vector tailing a log file and forwarding each line to an aggregator, so the app never knows where its logs go), but the mechanism is the same: poll or tail, write to a shared volume, read from the other container. The payload is kept trivial so the lifecycle mechanics stay the visible thing.

## The native sidecar: an initContainer with restartPolicy: Always

Before native sidecars, "sidecar" meant an ordinary second entry under `containers:`, with a real problem: OpenShift starts every container in that list together, with no ordering, so a main container that depends on its sidecar being ready first (a mesh proxy that must program routes before the app's first outbound call) had no clean way to wait. Shutdown had the opposite problem: every container got `SIGTERM` at once, so a sidecar could vanish while the main container was still mid-request.

The native sidecar mechanism, `restartPolicy: Always` on an `initContainers` entry, fixes both ends:

```yaml
initContainers:
  - name: probe-tailer
    restartPolicy: Always
    image: registry.access.redhat.com/ubi10/python-314-minimal:latest
```

An init container with `restartPolicy: Always` starts in init-container order, before the main container, but never blocks the Pod the way an ordinary init container does: once it's considered started, the kubelet moves straight on to the main container without waiting for it to exit, because it isn't supposed to exit. Native sidecars are stable since Kubernetes 1.33; CRC's 1.35 is well past that. The running Pod reads `2/2`, not `1/1`: the sidecar counts toward the ready container total.

That ordering is the value. The probe log above already showed the sidecar running before the app answered. Shutdown is the mirror image, and the terminated timestamps prove it:

```console
# after deleting the Pod:
main (shipping-service) finishedAt: 2026-11-04T13:42:53Z
sidecar (probe-tailer)  finishedAt: 2026-11-04T13:43:23Z
```

The main container stopped first; the sidecar outlived it and only stopped thirty seconds later. `probe-tailer` has no `SIGTERM` handler, so once the kubelet sent it `SIGTERM` (which it does only after the main container has already exited) it ran until `SIGKILL` at its grace deadline. The ordering is the point: the sidecar brackets the app's whole lifetime instead of merely running alongside it.

![A native sidecar starting before the app and stopping after it, the reverse of an ordinary second container]({{ "/assets/diagrams/appendix-07-sidecar.svg" | relative_url }})
*restartPolicy: Always on an init-container entry inverts the usual race: the sidecar brackets the app's lifetime.*

## Resource accounting is different too

An ordinary init container's requests are reserved only while it runs and released when it exits, which is why a heavy one-time setup can ask for more than the steady-state app. A native sidecar breaks that by design: `restartPolicy: Always` keeps it running for the Pod's whole life, so its requests stay reserved the whole time, stacked on top of every ordinary container's. `probe-tailer`'s requests (20 millicores, 32Mi) stay modest specifically because they're paid for the Pod's entire lifetime. A heavier native sidecar, a full mesh proxy, has to account for that when sizing the node pool, since every Pod running the mesh now costs its proxy's requests on top of its own.

A native sidecar can carry its own readiness probe, and if it does, that probe becomes part of the Pod's aggregate `Ready` condition exactly as an ordinary container's does: a sidecar that's `Running` but failing readiness holds the whole Pod out of `Ready`. Worth knowing before adding one with a flaky health check.

## Why the reversal matters

The startup half protects a main container that depends on its sidecar: a mesh proxy that must finish programming routes before the app's first outbound call has somewhere to use that guarantee, because the app container is created only once the proxy is up. The shutdown half protects the opposite dependency: a logging or metrics sidecar that must flush whatever the main container produced in its last moments has to still be alive when that last burst is emitted, which simultaneous `SIGTERM` can't promise.

`probe-tailer` needs neither guarantee; a dropped probe is harmless. The chapter uses it anyway because the lifecycle contract, not the payload, is the clearest thing to show, and a toy sidecar makes the start/stop ordering legible. A sidecar doing something a dropped operation would cost, shipping a final log line, releasing a distributed lock, deregistering from a mesh, is where this mechanism pays for its complexity.

One distinction matters for later families: a native sidecar counts toward the Pod's `READY` column (`2/2`) but does **not** count as a regular container for Job completion. A Job's main container finishing is what the Job considers done, independent of whether its native sidecars still run. That's a direct consequence of this same mechanism, and it returns in the Batch Job pattern.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy multi-container applications (sidecar containers and their lifecycle)
> **Competency:** Add a sidecar container and reason about its startup and shutdown order relative to the main container
> **Drill:** `oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.spec.initContainers[0].restartPolicy}'`

> **🤖 Explore with your agent**
>
> "Remove the restartPolicy: Always field from probe-tailer so it becomes a plain init container, and show me what happens to the Pod on the next rollout: does the main container ever reach Running, and why."

## Cleanup

```bash
oc delete -f sidecar/01-deployment.yaml -n patterns
oc delete -f sidecar/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/sidecar/

The runnable example deploys `shipping-service` with `probe-tailer` as a native sidecar, confirms the Pod reads `2/2` with the sidecar's `restartPolicy: Always`, reads the tailed health log (whose first line failed because the sidecar started before the app was ready), and deletes the Pod while capturing both containers' terminated timestamps to confirm the sidecar stops after the main container, not alongside it. Full walkthrough in `examples/appendix-patterns/sidecar/README.md`.
