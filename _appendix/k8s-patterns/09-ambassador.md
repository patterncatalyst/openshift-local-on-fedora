---
title: "Ambassador"
order: 9
part: "Structural"
description: "Broker an application's outbound connection through a localhost proxy sidecar on OpenShift, letting shipping-service reach Postgres with no Postgres-aware environment variable at all."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what an ambassador sidecar hides from the main container: not whether a dependency exists, but where it lives
- Wire an application to a fixed `localhost` address and let a sidecar decide what's really on the other end
- Change where a connection goes by editing only the ambassador container, with no change to the application's manifest
- Judge when a localhost proxy is worth the extra container versus pointing the application at the real address

## Why this matters

An application that opens a database connection has to know an address. The straightforward way to give it one is an environment variable pointing at the real thing, which is what every other chapter in this appendix does. That's fine until the real thing needs to change out from under the application for reasons that have nothing to do with its logic: a connection pooler inserted in front of the database, a mesh sidecar intercepting outbound TCP, a credential-rotation proxy refreshing short-lived tokens the app was never written to manage, or decoupling the app's configuration from the cluster's actual topology.

Ambassador is the pattern for that decoupling: a sidecar proxy, reachable at `localhost` from the main container, that owns the decision of where a connection to that local address ends up. The main container's view never changes: it always talks to `127.0.0.1` on a fixed port, so every one of those cross-cutting concerns can be added, removed, or reconfigured by changing the ambassador alone.

## The defaults were already written for this

`shipping-service`'s own `config.py` carries defaults that, read with this pattern in mind, describe the Ambassador setup directly:

```python
pg_host: str = "127.0.0.1"
pg_port: int = 5432
pg_user: str = "datamesh_app"
pg_password: str = "changeme"
pg_database: str = "datamesh"
```

Those defaults exist so a developer running the service outside the cluster, against a Postgres forwarded to their own machine, sets no environment variables at all. The same defaults are exactly what an ambassador needs. The example's `01-deployment.yaml` sets **no Postgres-related environment variables on the `shipping-service` container whatsoever**, and the service still connects:

```console
$ oc get deploy shipping-service -n patterns -o jsonpath='{.spec.template.spec.containers[0].env}'
[]
$ oc get pod $POD -n patterns      # READY 2/2
$ curl -s http://127.0.0.1:8080/healthz
{"status":"ready","service":"shipping-service"}
```

An empty env, yet a ready service: it reached Postgres purely through its `127.0.0.1:5432` default. The one thing that makes this work is that the example's disposable Postgres uses `datamesh_app` / `changeme` / `datamesh`, matching the image's built-in defaults exactly. Pick different credentials for the database and the zero-env trick breaks, because there'd be nothing to tell the app the new ones; the defaults and the database have to agree.

## A proxy that never sees a password

The ambassador, `postgres-ambassador`, is a plain TCP relay with no Postgres-protocol awareness and no credentials of its own:

```python
async def handle(cr, cw):
    try:
        sr, sw = await asyncio.open_connection(UPSTREAM_HOST, UPSTREAM_PORT)
    except OSError:
        cw.close()
        return
    await asyncio.gather(pipe(cr, sw), pipe(sr, cw))
```

It listens on `127.0.0.1:5432` in the shared Pod network namespace, and for every connection it accepts, opens a second to the real `patterns-postgres` Service and copies bytes both ways until either side closes. `shipping-service`'s username and password still travel end to end inside the TCP stream, exactly as if the app had dialed `patterns-postgres` directly: the ambassador never parses them, never stores them, and would work identically in front of any binary protocol on a TCP port. This is the simplest possible ambassador, a protocol-blind byte pipe; a more capable one might terminate TLS, inject short-lived credentials, or rate-limit, all on top of the same shape: a listener on `localhost` and a client to the real backend.

![shipping-service always connecting to 127.0.0.1:5432; the ambassador alone decides which real backend that address reaches]({{ "/assets/diagrams/appendix-09-ambassador.svg" | relative_url }})
*The app's connection target never changes; only the ambassador's upstream does.*

## Bound to localhost by design

`postgres-ambassador` listens on `127.0.0.1:5432`, not `0.0.0.0:5432`, and the choice isn't incidental. A Pod's IP is routable from anywhere in the cluster network, so a proxy bound to every interface would accept connections from any other Pod, turning a scoped convenience into an accidental open relay onto `patterns-postgres`. Binding to loopback means only processes sharing this Pod's network namespace, which is `shipping-service` and nothing else, can reach it. That's why the app's `pg_host` default of `127.0.0.1` is more than developer convenience: it's the address the pattern depends on, unreachable from anywhere a misrouted connection from another namespace could get to it.

## Moving the target without touching the app

Because the upstream address lives entirely in the ambassador's own configuration, changing it is a one-container edit that never touches the application spec:

```bash
oc set env deployment/shipping-service -n patterns \
  --containers=postgres-ambassador UPSTREAM_HOST=patterns-postgres-missing.patterns.svc.cluster.local
```

`shipping-service` keeps connecting to `127.0.0.1:5432` exactly as before; it has no way to know the address behind it changed. The new Pod's app container can't start: `shipping-service` opens its database connection during startup (to create its schema), and with the ambassador's upstream gone, that connection is refused, so the container crash-loops rather than merely failing readiness:

```console
$ oc get pods -n patterns -l app.kubernetes.io/name=shipping-service
NAME                                READY   STATUS             RESTARTS
shipping-service-6f7d65ff98-vqfnr   2/2     Running            1
shipping-service-84665455c-gmjd7    1/2     CrashLoopBackOff   4
$ oc get deploy shipping-service -n patterns -o jsonpath='{.spec.template.spec.containers[0].env}'
[]
```

Two things stand out. The application container's own env is still empty: nothing about it changed, and `oc describe pod` shows its config correct. The failure is entirely legible as "the ambassador can't reach its upstream," which is the right place for it, because that's the component that changed. And the old Pod is still `2/2 Running`: the rolling update's `maxUnavailable` protection won't retire a working Pod for one that never becomes ready, so the service keeps serving on the old revision until the ambassador config is fixed. Restore the upstream and the rollout completes, the healthy Pod replaces the old one, and the app container is never once edited.

This is the payoff: a platform team can rotate which Postgres a fleet talks to, insert a pooler, or add TLS termination by changing ambassador sidecars across a rollout, with no application-level config change (and its own review and rollback) per service. The blast radius of a wrong ambassador config is smaller and more obvious than a wrong application config: it breaks one specific, well-understood thing, this Pod's path to its backend, not any of the dozen things a misconfigured app environment could.

## The same slot a service mesh occupies

`order-service`, elsewhere in the data mesh, runs in an Istio-injected Pod where `istio-proxy` intercepts every outbound connection transparently through iptables rather than a hand-dialed `localhost` address: the app doesn't even configure a proxy, because interception happens below its socket calls. That's architecturally the same ambassador slot `postgres-ambassador` fills, automated and generalized: a sidecar on the same network namespace, standing between the app and everything it talks to, able to add retries, mutual TLS, or observability without the app knowing. The hand-rolled version makes that slot visible and inspectable: one script, one upstream address, every rule in the Pod spec a reader can read directly. Kafka is the same shape: a service reaching a broker at a fixed bootstrap address could sit behind an identical TCP ambassador, none the wiser about where the connection terminates.

## Fail fast, not slow

`shipping-service`'s `db.py` creates its engine with `pool_pre_ping=True`, a cheap liveness check on a pooled connection before each query, a defense against a connection going stale, unrelated to the ambassador. What the ambassador changes is the first connection: its `handle()` closes the client connection immediately if `open_connection()` to the upstream fails, which `asyncpg` experiences as a connection actively refused at `127.0.0.1:5432`, the same error shape as nothing listening there at all. No hang, no slow timeout working through retry logic. The ambassador fails fast and visibly, which is exactly what the startup and readiness checks are built to catch within one interval.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy multi-container applications (a proxy sidecar brokering outbound connections)
> **Competency:** Reason about a localhost proxy container and change a dependency's location without editing the application
> **Drill:** `oc get deployment shipping-service -n patterns -o jsonpath='{.spec.template.spec.containers[0].env}'` (confirm it's empty)

> **🤖 Explore with your agent**
>
> "Add a second ambassador container to this Pod proxying a made-up port for a fictional orders-cache dependency, pointed at the same patterns-postgres Service, and show me shipping-service still needs zero environment variables."

## Cleanup

```bash
oc delete -f ambassador/01-deployment.yaml -n patterns
oc delete -f ambassador/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/ambassador/

The runnable example deploys `shipping-service` with zero Postgres environment variables and a `postgres-ambassador` sidecar proxying `127.0.0.1:5432` to the real `patterns-postgres` Service (whose credentials match the image's defaults), confirms the Pod reaches `2/2` and `/healthz` succeeds, then repoints only the ambassador's `UPSTREAM_HOST` at a Service that doesn't exist to show the new Pod crash-loop while the old one keeps serving and the application container stays untouched. Full walkthrough in `examples/appendix-patterns/ambassador/README.md`.
