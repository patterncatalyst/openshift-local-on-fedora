---
title: "Secure Configuration"
order: 29
part: "Security"
description: "Treat a Secret as a credential, not a ConfigMap with a different name: know what base64 doesn't do, read a Secret two ways under an arbitrary UID, and survey where to go once a raw Secret isn't enough."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain exactly what encoding a Secret's value as base64 does and doesn't protect against
- Create a Secret with `stringData`, read back its `data`, and explain why `oc describe` and `oc get -o yaml` show two different things
- Mount a Secret as a file under restricted-v2 and read the effective permission bits an arbitrary-UID container actually gets
- Describe, at a survey level, what External Secrets Operator, Sealed Secrets, and SOPS each add on top of a raw Secret

## Why this matters

A `Secret` and a `ConfigMap` are nearly the same object: same API shape, same `data` field, same `configMapKeyRef`/`secretKeyRef` mechanics every earlier chapter covers. The reason `Secret` exists as a separate kind, rather than everyone using `ConfigMap` for credentials too, is that treating a password differently from a schema name is a decision worth making explicitly. A schema name leaking into a log line is an inconvenience; a Postgres password leaking the same way is an incident. Secure Configuration is the pattern for making that distinction count for something beyond the resource kind's name: understanding what a `Secret` protects against, where it doesn't, and what to reach for once a raw `Secret` stops being enough.

`inventory-service`'s Postgres credentials are the worked example, held in their own `inventory-db-credentials` Secret rather than reusing the shared `patterns-postgres-app` other examples share. That's narrower than this disposable Postgres can enforce (it recognizes one role, so both carry the same values here), but the pattern holds: each service owning a distinctly named Secret is what makes rotating or revoking one service's credential possible without touching every other service.

## What base64 buys

Create a Secret with `stringData` (plain text at creation; the API server base64-encodes it into `data`) and read it back:

```console
$ oc get secret inventory-db-credentials -n patterns -o jsonpath='{.data.password}'
Y2hhbmdlbWU=
$ oc get secret inventory-db-credentials -n patterns -o jsonpath='{.data.password}' | base64 -d
changeme
```

base64 is a reversible encoding, not encryption, and decoding it is a one-line command available to anyone, not a specialized attack. `oc describe secret` redacts the values, printing byte counts instead of content, which is a real and useful default (it keeps a credential off a screen-shared terminal or a CI log that runs `describe` for debugging), but it's a UI convenience in one tool, not a property of the Secret:

```console
$ oc describe secret inventory-db-credentials -n patterns
Data
====
dbname:    8 bytes
password:  8 bytes
username:  12 bytes
```

`oc get -o yaml`, `oc get -o jsonpath`, and anything with `get secrets` RBAC on the object see the full, trivially decodable value. A Secret's actual protection comes from two places earlier chapters cover: RBAC (Access Control, scoping exactly who can `get` a given Secret by name) and etcd encryption-at-rest. OpenShift supports the latter cluster-wide (set `spec.encryption.type` on the `APIServer` config and the control plane re-encrypts Secrets and ConfigMaps at rest), but it's off by default and not enabled on a stock CRC instance. Without it, a Secret's data sits in etcd no more protected than a ConfigMap's; base64 alone was never doing that job.

## Choosing env or file, for a credential specifically

The Configuration Resource chapter established the mechanical difference between a `secretKeyRef` env var and a mounted Secret volume, and it matters more for a credential than for an ordinary setting. `inventory-service`'s Deployment uses both at once, so this chapter's checks have both to inspect:

```yaml
env:
  - name: PG_PASSWORD
    valueFrom:
      secretKeyRef:
        name: inventory-db-credentials
        key: password
volumeMounts:
  - name: db-credentials
    mountPath: /etc/inventory/credentials
    readOnly: true
volumes:
  - name: db-credentials
    secret:
      secretName: inventory-db-credentials
      defaultMode: 0400
```

An environment variable is readable by the process, inherited into every child process it spawns, and visible to anything with access to `/proc/<pid>/environ` in the same namespaces. A file has none of that: nothing reads it unless something opens the path, nothing inherits it into a child by accident. For a password, choosing the file path removes an entire exposure surface (process environment dumps, child-process inheritance) that a file was never going to have.

## The effective file mode under an arbitrary UID

There's an OpenShift wrinkle here worth reading carefully, because `defaultMode: 0400` does not produce a `0400` file. A projected Secret file is owned by `root`, not by the container's injected UID, and OpenShift sets the file's group to the Pod's injected `fsGroup`. If the mode were a strict `0400` (owner-only read), the arbitrary-UID container (which is not the owner) couldn't read its own credential. So the effective mode comes out group-readable:

```console
$ oc exec -n patterns "$POD" -c inventory-service -- ls -lL /etc/inventory/credentials/password
-r--r-----. 1 root 1000650000 8 /etc/inventory/credentials/password
```

`r--r-----` is `0440`: owner (root) read, group (the Pod's injected fsGroup) read, and no access for anyone else. That's how an arbitrary-UID container reads a Secret it doesn't own, through its group membership, and it's still never world-readable. The file remains a tighter exposure than the env var; the exact bits just reflect OpenShift's UID-injection model rather than the literal number the manifest requested.

![A Secret reaching inventory-service two ways (an env var and a group-readable mounted file), with the Secret's own object flagged as base64, not encrypted, in etcd]({{ "/assets/diagrams/appendix-29-secure-configuration.svg" | relative_url }})
*Both paths read from the same inventory-db-credentials Secret; the file path narrows exposure, and neither path changes what the Secret object looks like at rest.*

## Secret types beyond Opaque

Every Secret this appendix has created is `type: Opaque`, an unstructured bag of key-value pairs. Kubernetes defines other built-in types that add validation and a documented shape. `kubernetes.io/basic-auth` requires `username` and `password` keys, rejecting a Secret missing either at creation. `kubernetes.io/tls` requires `tls.crt` and `tls.key`, the shape a Route expects when terminating TLS, which ties this directly to the Routes chapter: an edge-terminated Route references a `kubernetes.io/tls` Secret (or has `oc create route edge` build one) rather than carrying the certificate inline. `kubernetes.io/dockerconfigjson` holds registry credentials in the shape the kubelet's image-pull machinery expects, referenced from `imagePullSecrets`. None of these change how RBAC or etcd encryption treat the Secret; the type is a validation and intent signal, worth reaching for when a Secret's shape matches one exactly, since `oc create secret tls` or `oc create secret docker-registry` then names the fields correctly for you.

## Two places a credential leaks in practice

The theory is usually solid by the time a team reaches Kubernetes; the practical leaks happen in two avoidable places. The first is the container image: an `ARG` or `ENV` in a Containerfile that bakes a credential in at build time persists in that image's layer history forever, pullable by anyone who can pull the image, long after the credential is rotated. `inventory-service`'s own Containerfile avoids this by construction: its multi-stage build copies only dependencies and application code into the runtime stage, with Postgres credentials never touching a build argument, arriving only through the Secret at deploy time. A Containerfile with no `ARG` or `ENV` capable of holding a credential can't leak one through its history, regardless of how any individual build was invoked.

The second leak is logging. A connection string embedding a password (`postgresql://patterns_app:changeme@host/db`) is a natural thing to log on a connection failure, and a full exception traceback is a natural thing to log on an error, and either puts a credential in a log aggregator, a CI console, or a pasted incident traceback, outside Kubernetes entirely and outside anything RBAC or encryption-at-rest was scoped to protect. The habit that closes it is narrower than "be careful": never log a full connection string or a raw database-client exception without confirming neither carries the password, and prefer structured logging that names the fields (`host`, `port`, `database`) over an f-string that interpolates an object whose `__repr__` might include more than intended.

## Rotation, and beyond a raw Secret

`immutable: true` applies to a `Secret` exactly as the Immutable Configuration chapter shows it for a `ConfigMap`, and for a credential it closes a gap that matters more: without it, anyone with write access can silently replace a password every Pod relies on, with no record. A rotation workflow built on immutable Secrets creates a new, differently-named Secret with the new password set in Postgres, updates the Deployment to reference the new name (an ordinary rolling update with the usual rollback story), confirms every Pod rolled, and only then revokes the old password.

Three tools exist for the gap that opens once credentials need to live outside the cluster, or be safe to commit to a Git repo the way GitOps-managed manifests already are. None is installed here; the survey goes only deep enough to know which solves which problem. **External Secrets Operator** syncs credentials from an external manager (Vault, AWS Secrets Manager) into ordinary Secrets via a controller, for a team whose credentials already live in a dedicated manager. **Sealed Secrets** encrypts a Secret's values client-side into a `SealedSecret` custom resource safe to commit, decryptable only by a controller holding the matching key in the target cluster, for a GitOps workflow where a Secret is the one resource that can't otherwise be committed. **SOPS** encrypts individual values inside an otherwise-plain YAML or JSON file using a KMS, PGP, or age key, decrypted at apply time, for a team wanting one file format across secrets and ordinary config with only the sensitive fields protected. All three answer the same question, how a credential gets into the cluster without ever sitting in a repo or CI variable in plain form, with a different point in the pipeline where the encryption happens. Picking among them is a question of what's already in a team's toolchain.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure security (manage sensitive data with Secrets)
> **Competency:** Create a Secret with stringData, read it back as base64 and decoded, and consume it as an env var and a mounted file
> **Drill:** `oc get secret inventory-db-credentials -n patterns -o jsonpath='{.data.username}' | base64 -d` (confirms the value is a one-line decode away, not encrypted)

> **🤖 Explore with your agent**
>
> "Create inventory-db-credentials as a kubernetes.io/basic-auth typed Secret instead of Opaque, and show me what error oc returns if I try to create it missing the required password key."

## Cleanup

```bash
oc delete -n patterns -f secure-configuration/02-deployment.yaml -f secure-configuration/01-secret.yaml \
  -f secure-configuration/00-postgres.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/secure-configuration/

The runnable example creates `inventory-db-credentials` with `stringData`, decodes it back to confirm base64 isn't encryption, confirms `oc describe` redacts while `oc get` doesn't, deploys `inventory-service` consuming the same Secret as an env var and a mounted file, and reads the file's effective `0440` mode from inside the running container (group-readable to the injected fsGroup, never world-readable). All confirmed on CRC. Full walkthrough in `examples/appendix-patterns/secure-configuration/README.md`.
