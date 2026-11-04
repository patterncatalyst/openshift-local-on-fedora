---
title: "Managed Lifecycle"
order: 4
part: "Foundational"
description: "Honor the container lifecycle contract on OpenShift: postStart and preStop hooks, SIGTERM to PID 1, and a terminationGracePeriodSeconds that backstops a graceful shutdown."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain the sequence OpenShift runs when it starts and stops a container
- Use `postStart` and `preStop` hooks, and say what each is and isn't guaranteed to do
- Ensure your process is PID 1 so it actually receives `SIGTERM`
- Set `terminationGracePeriodSeconds` to cover a graceful shutdown, and know what happens when it doesn't

## Why this matters

A container that's killed without warning loses whatever it was doing: an in-flight request dropped, a connection pool abandoned, a half-written record left behind. OpenShift doesn't kill a healthy container that way by default. It runs a defined sequence on the way down, and the Managed Lifecycle pattern is about writing a container that cooperates with that sequence instead of being surprised by it.

The sequence on termination is: the Pod is removed from every Service's endpoints, the `preStop` hook runs to completion, `SIGTERM` is sent to the container's PID 1, and then a clock, `terminationGracePeriodSeconds`, starts. If the process exits before the clock runs out, all is well. If it doesn't, `SIGKILL` ends it regardless. Each of those steps is a lever, and this chapter works all of them.

The example uses `shipping-service`, whose shutdown is a clean dispose of its database connection pool with no external dependency, so the graceful path completes in full and the pattern is visible end to end.

## postStart and preStop

The two lifecycle hooks bracket the container's useful life. `postStart` runs immediately after the container is created, concurrently with the entrypoint, and the kubelet holds the container's probes until it returns. `preStop` runs when termination begins, before `SIGTERM`. The example sets both:

```yaml
lifecycle:
  postStart:
    exec:
      command: ["sh", "-c", "date > /tmp/managed-lifecycle-ready"]
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

The `postStart` marker is visible in the running container:

```console
$ oc exec $POD -n patterns -- cat /tmp/managed-lifecycle-ready
Wed Nov  4 05:30:09 AM UTC 2026
```

`postStart` comes with weaker guarantees than it first looks. It runs concurrently with the entrypoint, with no ordering between the two, so it can't assume the application has finished starting; the example keeps it to touching a file, which is safe under that uncertainty. It runs at least once, not exactly once. And if it exits non-zero, the kubelet kills and restarts the container, which turns a flaky `postStart` into a self-inflicted crash loop. For setup the application actually depends on, an init container (its own pattern later in this set) or the application's own startup code is the right home; `postStart` suits a side effect that's cheap, idempotent, and independent of the main process, which is why nothing heavier than a marker file goes here.

`preStop` is the more consequential of the two. Endpoint removal across a cluster isn't instantaneous: the Service's endpoint list, the router's backend set, and any client's cached connection all need a moment to notice a Pod is leaving. Without a deliberate pause, a Pod can receive `SIGTERM` while the router still has a connection open to it. The fixed `sleep 10` covers that gap: the container keeps serving for ten seconds after termination begins, long enough for the endpoint removal to propagate, and only then does `SIGTERM` arrive. This is the same `preStop` drain that made the rolling update zero-downtime, here shown on its own.

On OpenShift the propagation this bridges has one more hop than on plain Kubernetes. When the Pod leaves the Service's endpoints, the ingress router has to notice and reload its own backend list before it stops routing to the departing Pod. The `preStop` window has to outlast that reload, not just the endpoint update, which is why ten seconds is a safer default here than the two or three that might suffice on a cluster with no router in front. A shorter pause risks the exact reset the drain exists to prevent.

## SIGTERM and PID 1

Once `preStop` finishes, the kubelet sends `SIGTERM`, and it sends it to PID 1 only. Which process is PID 1 depends on how the image's command is written. `shipping-service`'s Containerfile runs `uvicorn` directly in exec form (`CMD ["uvicorn", "app.main:app", ...]`), so `uvicorn` is PID 1 and receives the signal:

```console
$ oc exec $POD -n patterns -- cat /proc/1/comm
uvicorn
```

Wrap that same command in a shell (`CMD uvicorn app.main:app ...`, the shell form) and the shell becomes PID 1 instead, swallowing `SIGTERM` by default unless the script explicitly traps and forwards it. A graceful shutdown handler is only as good as its ability to receive the signal it's written to handle, and the exec form is what guarantees that.

With `uvicorn` as PID 1, `SIGTERM` reaches FastAPI's lifespan shutdown, which disposes the SQLAlchemy engine's connection pool. Delete the Pod and watch the whole sequence in the logs:

```console
INFO:     10.217.0.2:48934 - "GET /healthz HTTP/1.1" 200 OK   # still serving during preStop
INFO:     Shutting down
INFO:     Waiting for application shutdown.
INFO:     Application shutdown complete.
INFO:     Finished server process [1]
```

The readiness checks keep returning `200` right up to the `preStop` window's end, then the graceful shutdown runs cleanly. Timed end to end, the Pod took ten seconds to terminate: the `preStop` sleep plus a near-instant pool dispose, well inside the grace period.

![On termination OpenShift removes the Pod from endpoints, runs preStop, sends SIGTERM to PID 1, and SIGKILLs only if the grace period expires first]({{ "/assets/diagrams/appendix-04-managed-lifecycle.svg" | relative_url }})
*The termination sequence: endpoint removal, preStop, SIGTERM to PID 1, graceful exit, with SIGKILL as the backstop if terminationGracePeriodSeconds runs out.*

## terminationGracePeriodSeconds as a deadline

The grace period is a hard ceiling, not a target:

```yaml
terminationGracePeriodSeconds: 30
```

The clock starts when `SIGTERM` is sent, and the `preStop` hook runs inside it, not before it, so the budget has to cover both the hook and the application's own shutdown. Here, `sleep 10` plus a sub-second dispose leaves ample margin under thirty seconds. Size it too low and the opposite happens: a `preStop` of ten seconds under a grace period of five would be cut off, and a shutdown handler that needs fifteen seconds to drain in-flight work under a grace period of ten gets `SIGKILL`ed mid-drain, losing exactly the work the handler was written to protect.

That `SIGKILL` backstop is the reason the grace period matters even for a well-behaved service. A shutdown handler that hangs, waits on an unreachable dependency, or simply has more to do than the budget allows will not run forever; the kubelet ends it at the deadline. The lesson is to measure a service's real shutdown time and set the grace period above it with margin, rather than leaving the default and hoping. A clean shutdown is a contract between the application, which has to exit promptly on `SIGTERM`, and the manifest, which has to give it enough time.

`preStop` supports the same three mechanisms a probe does: `exec`, `httpGet`, and `tcpSocket`. The Kubernetes Patterns book's own example uses `httpGet` against a dedicated `/shutdown` endpoint, a cleaner design than a fixed sleep wherever a service can expose one: the hook becomes an explicit signal ("I'm being drained") whose duration tracks the work actually in flight, rather than a conservative worst case baked into the manifest. `shipping-service` has no such endpoint, which is why the example uses the blunt instrument. A fixed sleep is the right default when a service offers nothing more specific, and the right upgrade path if it later adds a drain signal.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for reliability (graceful startup and shutdown)
> **Competency:** Configure lifecycle hooks and a termination grace period on a workload
> **Drill:** `oc get pod $POD -n patterns -o jsonpath='{.spec.terminationGracePeriodSeconds}{"\n"}'`

> **🤖 Explore with your agent**
>
> "Change the preStop sleep to 40 seconds without raising terminationGracePeriodSeconds past 30, delete the Pod, and show me what happens to the shutdown when the grace period runs out first."

## Cleanup

```bash
oc delete deployment/shipping-service service/shipping-service -n patterns
oc delete -f managed-lifecycle/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/managed-lifecycle/

The runnable example deploys `shipping-service` with `postStart` and `preStop` hooks, confirms the `postStart` marker and that `uvicorn` is PID 1, then deletes the Pod and watches the termination sequence: readiness answers `200` through the ten-second `preStop` window, then FastAPI's lifespan disposes the connection pool and the process exits, ten seconds total, well under the thirty-second grace period. Full walkthrough in `examples/appendix-patterns/managed-lifecycle/README.md`.
