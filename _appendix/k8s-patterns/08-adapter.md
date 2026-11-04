---
title: "Adapter"
order: 8
part: "Structural"
description: "Normalize an application's own output into a standard interface with a sidecar on OpenShift, translating shipping-service's JSON health body into Prometheus exposition text."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what makes Adapter different from a generic Sidecar: an obligation to translate one interface into a standard one
- Translate an application's health output into Prometheus exposition format without changing the application
- Reason about where an adapter's failure should land (on itself, not on the application it adapts)
- Judge when format translation belongs in a sidecar instead of the application's own instrumentation

## Why this matters

Monitoring works at scale only when every target speaks the same protocol. A fleet with one service emitting `key=value` in a log, another a JSON blob, and a third whatever its framework defaulted to is a fleet where every integration is a one-off. Prometheus's text exposition format solved that for metrics by giving every service one wire format; the problem Adapter solves is what to do with a service that doesn't, and shouldn't have to, emit that format itself.

Adapter is narrower than Sidecar: every adapter is a sidecar, not every sidecar is an adapter. The defining trait is a format obligation. An adapter reads something the main container already produces, in whatever shape it produces it, and re-emits the same fact in the shape an external consumer requires. It adds no information and changes no behavior; it only changes the wire format, which is why it belongs in its own container rather than inside the application. On OpenShift it's a plain second container under `containers:` (no start-ordering needed), run under `restricted-v2` like the app.

## shipping-service's own output

`shipping-service` reports its health as JSON, the natural format for a FastAPI service and what the other tooling in this appendix already expects:

```console
$ curl -s http://127.0.0.1:8080/healthz
{"status":"ready","service":"shipping-service"}
```

That's a fine interface for a human, for a readiness probe, or for another service checking dependency health. It's not something a Prometheus scraper can ingest: Prometheus doesn't parse arbitrary JSON for a status field, it expects its own line-based format with `# HELP`, `# TYPE`, and a metric name followed by a number. Teaching `shipping-service` to also emit that format would add a metrics library, an endpoint, and an ongoing maintenance surface to every service that needs the same translation, for a concern (how this cluster's monitoring happens to ingest numbers) that has nothing to do with shipping.

## The adapter sidecar

The `metrics-adapter` container does the translation, as a second container in the Pod. Every request to its `:9100/metrics` triggers a fresh poll of `/healthz` over `localhost` and renders a single Prometheus gauge:

```console
$ curl -s http://127.0.0.1:9100/metrics
# HELP shipping_service_up Whether shipping-service's /healthz reported ready.
# TYPE shipping_service_up gauge
shipping_service_up 1
$ curl -sD - -o /dev/null http://127.0.0.1:9100/metrics | grep -i content-type
Content-Type: text/plain; version=0.0.4
```

The adapter invents nothing: the underlying fact (is this instance ready) is exactly what `/healthz` already reports, and only the syntax changed. The response sets a real `Content-Type: text/plain; version=0.0.4`, Prometheus's versioned media type for its exposition format, not an arbitrary string. A scraper strict about content negotiation uses that header to decide whether it's looking at the format it expects; omitting it, or getting the version wrong, is a common way a homemade adapter stops being scraped even though `curl` against it looks fine.

A `prometheus.io/scrape: "true"` annotation on the Pod template, with `prometheus.io/port: "9100"` and `prometheus.io/path: "/metrics"`, is how a Prometheus set up for annotation-based discovery finds the port without a hand-maintained target list. The three annotations are a convention, not a Kubernetes field, but a widely honored one.

![shipping-service's JSON output translated into Prometheus exposition text by an adapter sidecar, with a scraper reading only the translated port]({{ "/assets/diagrams/appendix-08-adapter.svg" | relative_url }})
*The adapter never changes what's true about shipping-service, only the syntax a scraper needs to read it.*

## Named ports instead of magic numbers

The Service exposes both container ports by name: `http` to `8080` for the app, `metrics` to `9100` for the adapter. Every probe in this appendix references `port: http` rather than a literal `8080` for the same reason named ports exist: the number can move (a base-image upgrade changing a framework's default) without touching every manifest, as long as the name stays. Naming the adapter's port the same way keeps the Service and Pod readable together: `oc describe service shipping-service` shows `http` and `metrics` side by side, not two bare numbers to cross-reference.

## Whose failure is it

Scale Postgres to zero and `/healthz` starts returning `503`, because the app can't reach its database. The adapter's `/metrics` follows a moment later, and the adapter does not crash:

```console
$ oc scale deploy/patterns-postgres -n patterns --replicas=0
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz
503
$ curl -s http://127.0.0.1:9100/metrics | grep shipping_service_up
shipping_service_up 0
$ oc get pod $POD -n patterns
NAME                        READY   STATUS    RESTARTS
shipping-service-...        1/2     Running   0
```

`1/2` tells the story exactly: the app container is out of `Ready` because its own readiness probe fails, while the adapter container keeps running with zero restarts. That's the adapter working correctly: its failure surface is strictly the translation, not the thing being translated. An adapter that returned `500` from `/metrics` whenever the app was unhealthy would conflate the two domains, turning a normal, expected application state into an adapter-level incident that pages someone for the wrong reason.

The reverse matters too: if the adapter container itself crashes, `shipping-service` keeps serving and answering `/healthz` as before. A readiness probe pointed at the adapter's `/metrics` would get this backwards, making the Pod's readiness depend on observability tooling. The probes here, like every chapter's, target the app container directly; the adapter is additive, never required for the Pod's readiness.

## A narrow adapter versus a general-purpose exporter

Tools like Prometheus's `blackbox_exporter`, or a generic JSON-to-Prometheus exporter, solve the same translation as a general-purpose, configuration-driven tool meant to adapt arbitrary endpoints. `metrics-adapter` goes the other way by design: it hardcodes one upstream URL and one output metric, because it exists to adapt this one service's output, not to be a reusable platform component. That's the right shape for a sidecar riding inside one application's Pod. A general-purpose exporter run as a cluster-wide Deployment scraping many targets is a different, often better architecture for a fleet, but it's separate infrastructure to operate rather than a sidecar. Adding a second metric here means a few more lines in the same script; growing it to adapt more than one application's output is the signal that a general-purpose exporter has become the better tool.

## When this is worth its own container

Format translation belongs in a sidecar when the source format is something the application already produces for its own reasons (structured logs, a health check, an admin endpoint) and changing it inside the app would mean serving two audiences from one interface. The moment an application is instrumented with a proper metrics library from day one, there's no adapter to write, because it already speaks Prometheus natively. Adapter earns its container specifically at the boundary with something that wasn't designed with a particular scraper's format in mind: most legacy services, most third-party components, and any service whose output format is driven by its actual job rather than a monitoring stack's requirements.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Deploy multi-container applications (a sidecar exposing metrics in a standard format)
> **Competency:** Add an adapter container that translates an application's output without modifying it
> **Drill:** `oc exec -n patterns deploy/shipping-service -c metrics-adapter -- python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:9100/metrics').read().decode())"`

> **🤖 Explore with your agent**
>
> "Extend metrics-adapter to also report shipping_service_probe_latency_seconds, measuring how long its own call to /healthz took, and show me the new line in the /metrics output."

## Cleanup

```bash
oc delete -f adapter/01-deployment.yaml -n patterns
oc delete -f adapter/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/adapter/

The runnable example deploys `shipping-service` with `metrics-adapter` as a second container, compares `/healthz`'s JSON against `/metrics`'s Prometheus text (with the `text/plain; version=0.0.4` content type) for the same readiness fact, then scales Postgres to zero to confirm the translated metric follows the app down to `0` while the adapter container keeps running. Full walkthrough in `examples/appendix-patterns/adapter/README.md`.
