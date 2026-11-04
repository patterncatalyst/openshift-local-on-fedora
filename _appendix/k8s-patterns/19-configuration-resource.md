---
title: "Configuration Resource"
order: 19
part: "Configuration"
description: "Bulk-expose a ConfigMap or Secret as environment variables with envFrom on OpenShift, mount the same resource as files at once, and see why one half updates live and the other doesn't."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Bulk-expose every key of a ConfigMap or Secret as environment variables with `envFrom`
- Mount a ConfigMap or Secret as a volume and read its keys as files
- Explain why a config-file-shaped value belongs as a mounted file even when `envFrom` can expose it
- State why a mounted file updates on its own within about a minute of an edit, while a bulk-exposed env var never does

## Why this matters

Env Var Configuration wired one key at a time. That's precise but doesn't scale past a handful of settings, and every new value needs another line in the Deployment. Configuration Resource treats an entire ConfigMap or Secret as one configuration unit, consumed in whichever of two shapes the application needs: a flat set of environment variables, or a directory of files.

Most applications need one shape. A twelve-factor process reads config from the environment. A process built around a config file (an `.ini`, a `.properties`, anything a library expects to `open()`) needs the file shape, and no env var substitutes. The case this chapter works is the one where a single resource reaches a container both ways at once. `payment-service` is the example: a ConfigMap and a Secret, each bulk-exposed as env vars and mounted as files.

## envFrom: every key, one line

```yaml
envFrom:
  - configMapRef:
      name: payment-config
  - secretRef:
      name: payment-pg-credentials
```

Every key becomes an env var named exactly after the key, no transformation. The keys in `payment-config` and `payment-pg-credentials` match `payment-service`'s own settings field names, which is what makes `envFrom` worth it over per-key wiring: adding a setting is editing one resource, not the resource and the Deployment. Verified live:

```console
$ oc exec $POD -n patterns -- env | grep -E '^service_schema|^pg_'
pg_database=patterns
pg_host=patterns-postgres.patterns.svc.cluster.local
pg_password=changeme
pg_port=5432
pg_user=patterns_app
service_schema=payments
```

The cost is precision: a typo'd or unwanted key becomes an env var whether anyone meant it or not, with no per-key filter on the Deployment side (a `prefix` field namespaces the names but can't select a subset). `envFrom` also can't exceed etcd's per-object limit: a ConfigMap or Secret is one object, capped near 1MiB (`--max-request-bytes`), generous for config but not a home for a certificate bundle or dataset, which belong on a PVC or in the image.

## The file-shaped key, and a version-specific surprise

`payment-config` has a fourth key, `payment-service.conf`, holding a multi-line INI blob. Older Kubernetes refused to expose a key whose name isn't a valid POSIX environment variable (`payment-service.conf` has a dot and a dash): `envFrom` skipped it and raised a Warning event. Current OpenShift does not. On this cluster (OpenShift 4.22, Kubernetes 1.35, with relaxed environment-variable-name validation), `envFrom` exposes it like any other key:

```console
$ oc exec $POD -n patterns -- env | grep payment-service.conf
payment-service.conf=[payment-service]
```

So the key isn't skipped here. But exposing it doesn't make it useful: a multi-line INI file crammed into an environment variable named `payment-service.conf` is not something a process can hand to a config-file parser that wants a path to `open()`. The reason to also mount it as a file isn't that `envFrom` can't deliver it (on this version it can); it's that a config *file* belongs on disk in the shape its reader expects, regardless of whether the platform would also let it through as an awkward env var.

![The same ConfigMap and Secret, each reaching the container as bulk env vars and as a mounted file]({{ "/assets/diagrams/appendix-19-configuration-resource.svg" | relative_url }})
*envFrom bulk-exposes every key as an env var; a volumeMount delivers the same resource's keys as files, which is the shape a config-file reader actually needs.*

## Mounting the same resource as files

```yaml
volumes:
  - name: payment-config-file
    configMap:
      name: payment-config
      items:
        - key: payment-service.conf
          path: payment-service.conf
      defaultMode: 0440
```

A `configMap` or `secret` volume projects one key per file. `defaultMode: 0440`, not `0400`: projected files are owned `root:root`, and under `restricted-v2` the container runs as an arbitrary UID in group 0, so `0400` would make the file unreadable by the app itself, while `0440` lets gid 0 read it and still blocks world and other groups. The file lands as a symlink into the projected `..data` directory, which is how the kubelet does atomic updates:

```console
$ oc exec $POD -n patterns -- cat /config/app/payment-service.conf
[payment-service]
schema=payments
note=delivered as a file for tooling that expects a config path, not an env var
```

Mounting the Secret's password as a file alongside bulk-exposing it demonstrates a real exposure difference. An env var is inherited by every child process and readable through `/proc/<pid>/environ`; a file is neither inherited nor read unless something opens the path, and the mode bits add a second gate. A credential read from a path instead of the environment is choosing the narrower exposure.

## Two update models, same resources

Patch the file-shaped key and the mounted file updates on its own, no restart:

```console
$ oc patch configmap payment-config -n patterns --type merge \
    -p '{"data":{"payment-service.conf":"[payment-service]\nschema=payments\nnote=updated in place\n"}}'
# ~70s later (the kubelet's projected-volume sync period):
$ oc exec $POD -n patterns -- grep note /config/app/payment-service.conf
note=updated in place
$ oc get pod $POD -n patterns -o jsonpath='{.status.containerStatuses[0].restartCount}'
0
```

Patch a bulk-exposed key instead and nothing changes in the running environment, for the reason Env Var Configuration established: env vars resolve once at container start, and a mounted file is the only one of the two the kubelet keeps in sync. This asymmetry is easy to get backward since both read the same ConfigMap. Knowing which consumption mode a setting uses, not just which ConfigMap it comes from, is the operational knowledge that matters.

One exception: `volumeMounts.subPath`. Mounting a single key into a directory that has other content requires `subPath`, but the kubelet's live-sync works by atomically swapping a symlinked directory, which `subPath` pins past at mount time. A `subPath`-mounted ConfigMap file never updates, no matter how long you wait. The example mounts at the directory level (`/config/app`, no `subPath`), which is exactly why it updates live.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications (ConfigMaps and Secrets as env vars and as volumes)
> **Competency:** Bulk-expose a resource with `envFrom` and mount the same resource as files; reason about which updates live
> **Drill:** `oc exec -n patterns "$POD" -- env | grep -c '^pg_'` (counts the bulk-exposed Postgres variables)

> **🤖 Explore with your agent**
>
> "Mount payment-service.conf with subPath into a directory that already has another file, patch the ConfigMap, and show me that the subPath-mounted file does not pick up the change the way the directory-level mount did."

## Cleanup

```bash
oc delete -f configuration-resource/02-deployment.yaml -f configuration-resource/01-config.yaml \
  -f configuration-resource/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/configuration-resource/

The runnable example deploys `payment-service` with a ConfigMap and Secret each bulk-exposed via `envFrom` and mounted as files, confirms every key lands as an env var (including the dotted `payment-service.conf`, which current OpenShift exposes rather than skips), checks the mounted file's `0440` mode, then patches the file-shaped key to show the live update (`updated in place`, 0 restarts) that the bulk-exposed env vars never get. Full walkthrough in `examples/appendix-patterns/configuration-resource/README.md`.
