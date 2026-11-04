---
title: "Immutable Configuration"
order: 21
part: "Configuration"
description: "Mark a ConfigMap immutable on OpenShift, watch the API server reject an in-place edit, and roll a config change the only way an immutable resource allows: a new name and a new rollout."
duration: "20 min"
---

## Learning objectives

By the end of this chapter you can:

- Create a ConfigMap with `immutable: true` and explain what the API server does differently
- Explain why the earlier configuration chapters quietly assumed ConfigMaps are mutable
- Roll a config change forward by creating a new, differently named ConfigMap and updating a Deployment
- Weigh immutability's safety against the cost of a versioned name per change

## Why this matters

Every example in this family so far patched a ConfigMap in place and watched the change propagate, instantly for a mounted file, after a restart for an env var. That's convenient, and it's a failure mode the earlier chapters didn't mention: a ConfigMap is a cluster-wide resource any Pod picks up by name, and a mutation has no versioning, no audit trail beyond an external system, and no way to tell from the resource what it looked like five minutes ago. Patch a ConfigMap behind twenty replicas and each either picks up the new value on its own schedule (mounted files) or keeps the old one until some unrelated restart bounces it (env vars): a rollout nobody declared.

Immutable Configuration removes the option that causes this: set `immutable: true` and the API server refuses any write to `data` or `binaryData`, no exception. A change can no longer be an invisible in-place mutation; it must be a new resource, referenced by a Deployment update, so it goes through the same rollout, history, and rollback machinery as any Pod template change. The trade is explicit: every change needs a new ConfigMap name, more ceremony than a quiet patch, in exchange for a guarantee that nothing about a running Pod's config shifts without a visible, auditable update. `graphql-gateway` is the example, chosen because it's stateless, no Postgres, nothing beyond the ConfigMap and Deployment.

## Marking a ConfigMap immutable, and the rejected patch

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: gateway-config-v1
immutable: true
data:
  order_rest_url: "http://order-service"
  inventory_grpc_addr: "inventory-service:50051"
```

`immutable` can only be set at creation; there's no marking an existing mutable ConfigMap immutable without deleting and recreating it, which pushes teams to decide immutability as an up-front policy rather than bolting it on reactively. Consuming it is unchanged, `envFrom`, `configMapKeyRef`, and volumes all work identically. The difference shows only when something writes:

```console
$ oc patch configmap gateway-config-v1 -n patterns --type merge \
    -p '{"data":{"order_rest_url":"http://order-service-v2"}}'
The ConfigMap "gateway-config-v1" is invalid: data: Forbidden: field is immutable when `immutable` is set
```

Rejected outright, naming the field and the reason. No `--force` makes it succeed short of deleting the ConfigMap, and deleting one a running Deployment still references is its own hazard: any Pod that restarts while it's gone hits the `CreateContainerConfigError` the Predictable Demands chapter covers for a missing ConfigMap.

![ConfigMap v1 and v2, both immutable, with a Deployment's reference moving from one to the other and a rollout following]({{ "/assets/diagrams/appendix-21-immutable-configuration.svg" | relative_url }})
*The old ConfigMap is never edited; a new one is created and the Deployment's reference moves to it, triggering an ordinary rolling update.*

## Rolling a change forward

The only path to a new value is a new ConfigMap (`gateway-config-v2`, `immutable: true`, the changed value). Creating it changes nothing by itself; it's inert until referenced. The change happens when the Deployment's template names it:

```console
$ oc apply -f 03-configmap-v2.yaml -f 04-deployment-v2.yaml   # envFrom -> gateway-config-v2
$ oc rollout status deploy/graphql-gateway -n patterns
$ oc exec $NEWPOD -n patterns -- env | grep order_rest_url
order_rest_url=http://order-service-v2
$ oc rollout history deploy/graphql-gateway -n patterns
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

That's an ordinary rolling update: a new ReplicaSet, new Pods against the new name, old ones retired once the new pass readiness. It's a first-class entry in the Deployment's revision history, so `oc rollout undo` reverts to `gateway-config-v1` the same way it reverts an image change, not an edit that leaves no trace of the previous value. Once nothing references `gateway-config-v1`, it's safe to delete, but checking what a Deployment references before deleting the ConfigMap it used to point at is the habit worth building, for the same `CreateContainerConfigError` reason.

## Weighing the cost, and Secrets

A versioned name per change is real overhead a mutable ConfigMap doesn't have: a naming convention to agree on (`-v1`, a content hash, a timestamp; Kubernetes prescribes none), old versions to clean up, and a Deployment update for even a one-line tweak a `oc patch` would have handled in seconds. A ConfigMap used by one developer against a throwaway Pod rarely needs this.

The guarantee matters at the other end: a ConfigMap behind a many-replica production Deployment, where "what changed and when" must be answerable from `oc rollout history` months later, and where a fat-fingered `oc edit configmap` shouldn't silently reconfigure every replica at once. `immutable: true` also reduces API-server watch load at scale, a ConfigMap that can never change needs no mutation watch, which matters as a cluster's ConfigMap count grows into the thousands.

Everything here applies to `Secret` identically: `immutable: true` is a field on both kinds, and an immutable Secret rejects a `data`/`stringData` patch exactly the same. That's a stronger guarantee for a credential: it makes it structurally impossible for an operator or an automated tool to silently replace a password every Pod relies on, removing a class of "who changed the database password and when" incidents. A credential-rotation pipeline built on immutable Secrets generates a new Secret under a new name, updates the Deployments, confirms the rollout, then revokes the old credential only once nothing points at it.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications (manage configuration lifecycle safely)
> **Competency:** Create an immutable ConfigMap or Secret and roll a change through a Deployment update
> **Drill:** `oc get deployment graphql-gateway -n patterns -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}'`

> **🤖 Explore with your agent**
>
> "Create gateway-config-v3 with one more value changed, roll graphql-gateway onto it, then run oc rollout undo and show me which ConfigMap name the Deployment reverts to."

## Cleanup

```bash
oc delete -f immutable-configuration/04-deployment-v2.yaml -n patterns
oc delete configmap gateway-config-v2 gateway-config-v1 -n patterns --ignore-not-found
```

## Verification: examples/appendix-patterns/immutable-configuration/

The runnable example deploys `graphql-gateway` against an immutable ConfigMap, confirms the API server rejects an in-place patch (`field is immutable`), creates a second immutable ConfigMap with a changed value, then rolls the Deployment onto it and confirms the new value (`order-service-v2`) reaches the Pod only through that rollout, recorded as revision 2. Full walkthrough in `examples/appendix-patterns/immutable-configuration/README.md`.
