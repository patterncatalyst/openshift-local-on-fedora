---
title: "Configuration Template"
order: 20
part: "Configuration"
description: "Render a structured config file from a template and an environment overlay with an init container on OpenShift, for configuration shapes a flat environment variable can't express."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain what Configuration Template solves that env vars and mounted ConfigMaps can't
- Wire an init container to render a template against overlay values into a shared `emptyDir`
- Switch an environment overlay and explain why the change needs a new Pod, not just a new ConfigMap
- Distinguish runtime templating (this pattern) from deploy-time templating (Helm, Kustomize)

## Why this matters

Every configuration pattern so far assumes config is flat: named values, one per env var or file. That breaks the moment a piece of config is structured in a way env vars were never meant to express, an XML document, a YAML file with lists and maps, any format where the shape matters as much as the values. A ConfigMap can hold that file whole as one key's value, but the values *inside* still vary by environment, and stuffing a different complete file per environment duplicates everything that doesn't change.

Configuration Template splits the file in two: a template holding the structure that never changes, and a small overlay of values that do, per environment. An init container renders them together into a real file before the main container starts, so by the time the app reads its config, there's no template syntax left. `inventory-service` is the example; its own runtime settings stay flat env vars, and the rendered file stands in for the structured configs real services in this position read.

## Template, overlays, and the init container

The template is one ConfigMap key with two tokens (`__ENV_LABEL__`, `__LOG_LEVEL__`); two more ConfigMaps (`inventory-dev-overlay`, `inventory-prod-overlay`) hold the per-environment values. An init container renders them:

```yaml
initContainers:
  - name: render-config
    image: registry.access.redhat.com/ubi10/ubi-minimal:latest
    command:
      - sh
      - -c
      - |
        sed -e "s/__ENV_LABEL__/${ENV_LABEL}/" -e "s/__LOG_LEVEL__/${LOG_LEVEL}/" \
          /templates/app.conf.tmpl > /rendered/app.conf
    envFrom:
      - configMapRef:
          name: inventory-dev-overlay
    volumeMounts:
      - { name: template, mountPath: /templates, readOnly: true }
      - { name: rendered, mountPath: /rendered }
```

The overlay arrives via `envFrom` (bulk env vars the shell reads), the template as a read-only mount, and the output goes to `rendered`, an `emptyDir`: ephemeral, shared between the Pod's containers, gone when the Pod is. That's the right lifetime: the rendered file only needs to exist as long as this Pod, and re-rendering is what the next Pod start does anyway. This example uses `sed` to keep the init container a stock `ubi-minimal` with no custom build; a real structured config usually warrants `envsubst` or a template engine, but the shared-volume mechanism is identical whatever the renderer.

![A template and an overlay feeding an init container, which writes one rendered file into a shared volume before the main container starts]({{ "/assets/diagrams/appendix-20-configuration-template.svg" | relative_url }})
*The init container runs once, renders the file once, and exits; the main container only ever sees the finished result.*

## The main container only sees the result

`inventory-service` mounts the same `rendered` volume read-only at `/config/app`. By the time it starts, the file exists with every token substituted, no template syntax, no rendering tool needed in its own image:

```console
$ oc exec $POD -n patterns -- cat /config/app/app.conf
[inventory-service]
environment=development
log_level=debug
rendered_by=init-container
$ oc get pod $POD -n patterns -o jsonpath='{.status.initContainerStatuses[0].state.terminated.reason}'
Completed
```

That division of labor is the value of an init container over a startup script in the main image: the app image stays focused on the application, and the rendering logic (which might use a different tool) lives in its own image, started and torn down by OpenShift rather than by application code.

## Switching overlays means a new Pod

The dev-to-prod switch changes which ConfigMap the init container's `envFrom` names, then recreates the Pod:

```console
$ oc patch deployment inventory-service -n patterns --type json \
    -p '[{"op":"replace","path":"/spec/template/spec/initContainers/0/envFrom/0/configMapRef/name","value":"inventory-prod-overlay"}]'
$ oc rollout restart deployment/inventory-service -n patterns
$ oc exec $NEWPOD -n patterns -- cat /config/app/app.conf
[inventory-service]
environment=production
log_level=warning
rendered_by=init-container
```

Worth sitting with: an init container runs exactly once per Pod, at creation, and never again. Changing the overlay ConfigMap's *contents* while a Pod runs would have no effect, for the same reason, there's no mechanism that re-triggers a finished init container. The only way to a new rendered file is a new Pod, which `rollout restart` produces. This is a third operational model alongside env vars (resolved once, like this) and mounted ConfigMap files (synced continuously, unlike this), and knowing which a given setting follows keeps an on-call engineer from waiting on a sync that was never going to happen.

A sidecar could render, watch the overlay, and re-render on the fly, closing that gap, but it costs a long-running process, a file-watch loop, and a main container that tolerates its config changing underneath it, which an app that reads config once at startup generally isn't built for. An init container is the right default precisely because most apps read their config file once; render it before that read and never touch it again.

## Runtime templating versus deploy-time templating

Why not template the whole manifest with Helm or Kustomize instead? Both are legitimate and solve a related problem differently. Helm and Kustomize template at *deploy time*, on the machine or pipeline doing the apply: the cluster never sees a template, only the rendered manifest, and switching environments means rerunning the tool. Configuration Template renders at *runtime*, inside the cluster, from ConfigMaps that are themselves already applied; what changes between environments is which overlay a Pod references, not what's submitted to the API. The two aren't exclusive (a Helm chart could template the overlay's values while the in-Pod rendering stays as described), but conflating them is a common confusion: Helm's `{{ }}` resolves before Kubernetes sees it, while these `__ENV_LABEL__` tokens survive into a running container and get resolved there.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications (prepare a config file with an init container and a shared volume)
> **Competency:** Render a ConfigMap-backed template into a volume the main container reads
> **Drill:** `oc get pod -n patterns -l app.kubernetes.io/name=inventory-service -o jsonpath='{.items[0].status.initContainerStatuses[0].state.terminated.reason}'`

> **🤖 Explore with your agent**
>
> "Add a third token to app.conf.tmpl for a connection-pool size, add it to both overlays with different numbers, and confirm the rendered file picks up the right one for each overlay."

## Cleanup

```bash
oc delete -f configuration-template/04-deployment.yaml -f configuration-template/03-configmap-prod-overlay.yaml \
  -f configuration-template/02-configmap-dev-overlay.yaml -f configuration-template/01-configmap-template.yaml \
  -f configuration-template/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/configuration-template/

The runnable example deploys `inventory-service` with an init container rendering the template against the dev overlay, confirms the rendered file (`environment=development`) and the init container's `Completed` exit, then switches to the production overlay and recreates the Pod to show the new values (`environment=production`) land only after a fresh start. Full walkthrough in `examples/appendix-patterns/configuration-template/README.md`.
