---
title: "Env Var Configuration"
order: 18
part: "Configuration"
description: "Populate a container's environment on OpenShift from three sources at once: a literal, a ConfigMap key, and a Secret key, and understand why none of them update a running container."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Set an environment variable from a literal, a `ConfigMap` key, and a `Secret` key in one Pod spec
- Explain why a container can't tell, from inside, which source populated a given variable
- State when an env var is resolved, and why editing the backing ConfigMap or Secret has no effect until the container restarts
- Choose which source fits a value: fixed constant, environment-shaped setting, or credential

## Why this matters

Every useful container needs to know things about its environment: which database to connect to, which Kafka cluster to publish to, which credentials to use. None of that belongs in the image: baking a hostname in means a new image per environment, and baking a password in means it sits in a registry forever, readable by anyone who can pull. Env Var Configuration keeps all of it out of the image and in the Pod spec, where it changes without a rebuild.

The twist is that "out of the image" isn't one mechanism. A Pod's `env` block sources each variable from three places: a literal typed into the manifest, a `ConfigMap` key, or a `Secret` key. All three produce the same thing from the container's view, a plain environment variable, indistinguishable once the process reads it. The difference lives in the manifest. The example wires all three against `notification-service`, which needs both a Postgres connection and Kafka settings.

## Three sources, one env block

```yaml
env:
  # Literal: fixed for this service.
  - name: SERVICE_SCHEMA
    value: notifications
  # Secret key: credentials.
  - name: PG_USER
    valueFrom:
      secretKeyRef: { name: patterns-postgres-app, key: username }
  # ConfigMap key: non-secret, environment-shaped.
  - name: KAFKA_ORDER_TOPIC
    valueFrom:
      configMapKeyRef: { name: notification-config, key: kafka_order_topic }
```

Inside the running container, the three are indistinguishable:

```console
$ oc exec $POD -n patterns -- env | grep -E 'SERVICE_SCHEMA|KAFKA_ORDER_TOPIC|PG_USER'
KAFKA_ORDER_TOPIC=order-placed
PG_USER=patterns_app
SERVICE_SCHEMA=notifications
```

A **literal** has no indirection, no extra resource, nothing for RBAC to gate. That's its limit too: it changes only by editing and reapplying the Deployment, so it fits a value fixed for this service, like the in-cluster DNS name of a Service this Deployment was written to talk to. (Note the quoted `"5432"` for the port elsewhere in the manifest: every env var is a string, but YAML parses an unquoted `5432` as an integer the API rejects for this field.)

A **ConfigMap key** fits environment-shaped values: not secret, but reasonably something an operator changes per environment without a new image or write access to the Deployment. A Kafka bootstrap address is the textbook case. The `notification-config` ConfigMap is an ordinary resource holding `kafka_bootstrap`, `kafka_order_topic`, and the rest as key-value pairs.

A **Secret key** uses the identical YAML shape, pointed at a `Secret`. What differs is what OpenShift does around it: RBAC can grant read access to Secrets separately from ConfigMaps, and encryption-at-rest (where configured) applies to Secret data. None of that hides the value from someone with `oc exec`: `oc exec ... -- env` prints `PG_PASSWORD` in plain text once resolved. A Secret restricts who can read the credential by name from the API; it does nothing once the credential is in a running container's environment, which the file-mount option in the next chapter addresses differently.

![Three sources feeding one container's environment: a literal, a ConfigMap key, and a Secret key]({{ "/assets/diagrams/appendix-18-env-var-configuration.svg" | relative_url }})
*SERVICE_SCHEMA is a literal, KAFKA_ORDER_TOPIC comes from a ConfigMap key, PG_USER from a Secret key; all three land as ordinary env vars.*

## Resolution happens once, at container start

Every source resolves exactly once, when the kubelet starts the container. From then on the env var is just a string in the process environment, with no connection back to the ConfigMap or Secret. Editing the ConfigMap after the Pod runs changes nothing it can see:

```console
$ oc patch configmap notification-config -n patterns --type merge \
    -p '{"data":{"kafka_order_topic":"order-placed-v2"}}'
$ oc exec $POD -n patterns -- env | grep KAFKA_ORDER_TOPIC
KAFKA_ORDER_TOPIC=order-placed          # still the old value
$ oc rollout restart deployment/notification-service -n patterns
# the new Pod has it:
$ oc exec $NEWPOD -n patterns -- env | grep KAFKA_ORDER_TOPIC
KAFKA_ORDER_TOPIC=order-placed-v2
```

This is the single most important fact in the chapter, and a frequent source of confusion because it's invisible at edit time: `oc patch configmap` succeeds with no signal that the change hasn't reached anything. The next chapter's mounted-file consumption behaves the opposite way, the kubelet syncs a changed value into the running filesystem within about a minute, no restart. The two read from the same resources but diverge completely once something changes after the Pod is running, and knowing which you're using is the difference between a config change that takes effect and one that silently doesn't.

## Beyond the three, and choosing a source

Three more `valueFrom` sources exist: `fieldRef` and `resourceFieldRef` (the Downward API, covered in Self Awareness) and `envFrom` (bulk-expose every key in a ConfigMap or Secret at once, covered in the next chapter). The three here cover the overwhelming majority of real configuration.

Two OpenShift-practical notes. `oc set env` is the quickest way to wire or inspect these without hand-editing YAML: `oc set env deployment/notification-service --from=configmap/notification-config` bulk-imports every key, and `oc set env deployment/notification-service --list` prints what's wired, resolved sources included. And a ConfigMap or Secret is project-scoped: a `configMapKeyRef` resolves only against a ConfigMap in the same project as the Pod, so there's no reaching into another project's ConfigMap by name, each project carries its own copy, which is usually what you want for per-environment config but occasionally surprises someone expecting a shared one.

The decision is about the value, not the mechanism. A literal fits something fixed for this Deployment. A ConfigMap key fits an environment-shaped value worth its own resource so RBAC and audit history treat it separately. A Secret key fits anything granting access to something else: a password, a token, a connection string. Getting this right the first time matters: moving a value between sources later means touching both the Deployment and whatever created the original, and a credential accidentally wired as a ConfigMap key is a credential in a resource kind nobody locked down.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications (environment from literals, ConfigMaps, and Secrets)
> **Competency:** Populate a Pod's environment from all three sources and reason about resolution timing
> **Drill:** `oc set env deployment/notification-service -n patterns --from=configmap/notification-config`

> **🤖 Explore with your agent**
>
> "Add a fourth env var to notification-service sourced from the Pod's own namespace via fieldRef, and confirm the resolved value inside the container matches oc get pod -o jsonpath='{.metadata.namespace}'."

## Cleanup

```bash
oc delete -f env-var-configuration/02-deployment.yaml -f env-var-configuration/01-configmap.yaml \
  -f env-var-configuration/00-postgres.yaml -n patterns
```

## Verification: examples/appendix-patterns/env-var-configuration/

The runnable example deploys `notification-service` with its env block drawing from a literal, a ConfigMap, and a Secret, confirms the resolved values inside the container, patches the ConfigMap to show a running Pod unaffected (`order-placed`), then restarts the Deployment to show the new value (`order-placed-v2`) finally land. Full walkthrough in `examples/appendix-patterns/env-var-configuration/README.md`.
