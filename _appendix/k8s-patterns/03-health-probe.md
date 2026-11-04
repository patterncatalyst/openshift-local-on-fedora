---
title: "Health Probe"
order: 3
part: "Foundational"
description: "Separate liveness from readiness with startup, liveness, and readiness probes on OpenShift, then add a readiness gate that only an external signal can satisfy."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain the difference between a liveness probe and a readiness probe, and what each controls
- Configure a `startupProbe` to protect a slow-booting container from a liveness probe that would kill it mid-boot
- Read `oc get pods` and `oc describe pod` to tell a crashed container apart from one that's merely not ready
- Add a `readinessGate` and satisfy it manually, to see how a Pod can be fully running and still not `Ready`

## Why this matters

OpenShift asks two different questions about a running container, and conflating them is one of the most common ways a cluster misbehaves. "Is this container alive?" governs whether the kubelet should restart it. "Is this container ready for traffic?" governs whether the Service, and the Route in front of it, should send it any. A container can be alive and not ready, still loading or its database unreachable, and the correct response to each failure is different: restart on the first, stop sending traffic on the second. Neither is a safe substitute for the other.

`inventory-service` exposes exactly the two endpoints the pattern needs: `/health`, which returns `200` as long as the process can respond, and `/healthz`, which returns `200` only if it can reach its Postgres instance and `503` otherwise. That isn't an accident of naming. It's the liveness/readiness split made concrete: one endpoint answers "is the process up," the other answers "can this process do its job right now."

The probes themselves are plain Kubernetes, identical to the minikube sibling. What this chapter adds is the OpenShift framing: the readiness verdict is what the Route's router acts on, so a Pod that fails `/healthz` quietly leaves the load-balanced set without the kubelet touching the container at all.

## Liveness and readiness

The example's Deployment wires both endpoints to their matching probe type:

```yaml
livenessProbe:
  httpGet: { path: /health, port: http }
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /healthz, port: http }
  initialDelaySeconds: 5
  periodSeconds: 5
```

The kubelet runs `livenessProbe` on its own schedule and, on repeated failure, kills the container and restarts it. It runs `readinessProbe` independently, and on failure removes the Pod from every Service's endpoint list without touching the container. Scale the backing Postgres to zero and watch both behaviors diverge:

```console
$ oc scale deploy/patterns-postgres -n patterns --replicas=0
$ curl http://127.0.0.1:18080/health     # 200: the process is fine
$ curl http://127.0.0.1:18080/healthz    # 503: it can't reach Postgres
$ oc get pod $POD -n patterns -o jsonpath='{.status.containerStatuses[0].restartCount}'
0
```

The restart count stays at zero the entire time, and `ContainersReady` flips to `False`. The Pod simply stops receiving traffic, which is the correct response to a dependency outage: restarting a process that works perfectly, just unable to reach a downed database, accomplishes nothing except noise. Scale Postgres back to one and readiness recovers on its own, still with zero restarts, because the readiness probe checks current state rather than remembering the last failure.

This is also where readiness meets the Route. The router builds its backend set from the Service's ready endpoints, the same list the readiness probe maintains, so a Pod that fails `/healthz` disappears from the router's view the moment it's removed from the endpoints. With more than one replica, the router simply routes around the unready one. With a single replica, as here, the router has no ready backend left and answers the client `503` itself, which is the correct response: the service is up as a process but not ready to serve, and the edge reports that directly rather than forwarding a request that would fail deeper in. Readiness, in other words, is not a local detail; it's the signal that decides whether a request ever reaches the container.

## Startup probe

A liveness probe with a short `initialDelaySeconds` assumes the container finishes booting quickly. `inventory-service` doesn't: FastAPI's lifespan startup creates the Postgres schema if it's missing, seeds demo stock rows, and binds a gRPC server for `CheckStock`, all before `/health` answers anything. A liveness probe checking five seconds in would, on a slow node, kill and restart the container repeatedly before it finished that sequence once, a failure that looks exactly like a crash loop but is impatience.

`startupProbe` is the fix: while it's active, the kubelet suppresses both liveness and readiness checks entirely.

```yaml
startupProbe:
  httpGet: { path: /health, port: http }
  failureThreshold: 30
  periodSeconds: 2
```

Thirty attempts at two-second intervals gives the container up to sixty seconds to answer `/health` once before liveness takes over. The moment it does, the startup probe steps aside for that container's lifetime and the regular probes begin. `oc describe pod` shows this transition: the startup probe's events stop the instant the container reports healthy, replaced by the usual liveness and readiness activity.

![A startup probe gates liveness and readiness until the container reports healthy; a readiness gate adds a condition no in-container probe can satisfy before the Pod joins the Service]({{ "/assets/diagrams/appendix-03-health-probe.svg" | relative_url }})
*The startup probe holds liveness and readiness back during boot; once it passes, both the readiness probe and any readiness gate must clear before the router sends traffic.*

## Readiness gates

A readiness probe only checks what the container can observe about itself. Sometimes a Pod's actual readiness depends on something external that no endpoint inside the container can see: a sidecar finishing its setup, or an operational signal a controller must confirm before traffic arrives. A `readinessGate` adds exactly that, a named condition that must be `True` in the Pod's status before OpenShift considers the Pod ready, on top of whatever the readiness probe checks:

```yaml
spec:
  readinessGates:
    - conditionType: "patterns.example.com/InventorySeeded"
```

Apply this and the Pod shows something that looks contradictory at first. The container passes every probe, yet the Pod is not `Ready`:

```console
$ oc get pod $POD -n patterns \
    -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"\n"}{end}'
Initialized=True
Ready=False
ContainersReady=True
PodScheduled=True
```

`ContainersReady=True` but `Ready=False`: the container is healthy, the Pod as a whole is not, because nothing has set the gate's condition. In production a controller watching for confirmation that seeding finished would patch it; for the example, patch it directly:

```console
$ oc patch "pod/$POD" -n patterns --type='json' --subresource=status \
    -p='[{"op":"add","path":"/status/conditions/-","value":{"type":"patterns.example.com/InventorySeeded","status":"True"}}]'
$ oc get pod $POD -n patterns \
    -o jsonpath='{range .status.conditions[?(@.type=="Ready")]}{.type}={.status}{end}'
Ready=True
```

The Pod's overall `Ready` condition goes `True` and it joins the Service's endpoints for the first time. Nothing about the container changed; only the external signal did. That's the value of a readiness gate: it lets a condition no in-container probe could check, a dependency acknowledged, a migration confirmed, an operator's sign-off, gate traffic the same way a failed `/healthz` would.

## The three probe mechanisms

Every probe here uses `httpGet`, the natural fit for a service with an HTTP health endpoint. OpenShift supports two others for workloads that don't have one:

- **`exec`** runs a command in the container and treats exit code `0` as success. This is the choice for a process with no network listener, or where the health signal is a file or local socket rather than an HTTP response.
- **`tcpSocket`** attempts a TCP connection and treats success as a working port, with no awareness of what answers. Weaker than `httpGet`, but the only option for a non-HTTP protocol with no richer health contract.
- **`grpc`** calls the standard gRPC health-checking protocol on a named service, the correct mechanism for `inventory-service`'s own `CheckStock` endpoint if this example probed the gRPC side as well as the REST side.

All three share the same tuning fields and all three can attach as a `startupProbe`, `livenessProbe`, or `readinessProbe`: the mechanism (how the check runs) and the role (what the result controls) are independent choices.

`successThreshold` is the field most often set wrong: its default of `1` is correct for readiness and startup, and its only legal value for a liveness probe is also `1`, because "require two successes before trusting this process is alive" doesn't make sense for a check whose failure means killing the container. `failureThreshold` has the matching asymmetry: a low value on a readiness probe just removes a flaky Pod from traffic for a beat, cheap and reversible, while the same value on a liveness probe restarts a container over one slow response under load. A probe failure also leaves a trace: `oc describe pod` records each as an `Unhealthy` event with the HTTP status or exit code that failed, usually the fastest way to tell a misconfigured probe (wrong path or port) from an application that's actually unhealthy.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for reliability (health probes that let OpenShift manage availability)
> **Competency:** Configure liveness, readiness, and startup probes on a workload
> **Drill:** `oc set probe deployment/inventory-service -n patterns --readiness --get-url=http://:8080/healthz --initial-delay-seconds=5`

> **🤖 Explore with your agent**
>
> "Add a second readiness gate to inventory-service that models a cache warm-up check, satisfy both gates in sequence, and show me the Pod's conditions after each one."

## Cleanup

```bash
oc delete deployment/inventory-service service/inventory-service -n patterns
oc delete -f health-probe/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/health-probe/

The runnable example deploys `inventory-service` with all three probe types and the readiness gate, confirms the `ContainersReady=True` / `Ready=False` split before patching the gate and `Ready=True` after, then scales Postgres to zero to show readiness go `False` and `/healthz` return `503` while `/health` stays `200` and the restart count holds at zero. Full walkthrough in `examples/appendix-patterns/health-probe/README.md`.
