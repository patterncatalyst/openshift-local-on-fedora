---
title: "Access Control"
order: 26
part: "Security"
description: "Give a workload its own ServiceAccount, grant it exactly the ConfigMap and Secret reads it needs with a Role and RoleBinding, and prove the boundary with oc auth can-i."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Create a dedicated `ServiceAccount` for a workload instead of letting it run under its namespace's `default` account
- Write a `Role` scoped to exactly the resources a workload needs, using `resourceNames` to name individual objects rather than every object of a kind
- Bind a `Role` to a `ServiceAccount` with a `RoleBinding`, and explain when a `ClusterRole` belongs in a namespaced binding instead of a cluster-wide one
- Prove a permission boundary with `oc auth can-i --as`, including the one case where `resourceNames` quietly stops working

## Why this matters

Every Pod authenticates to the API server as something: a user, or a `ServiceAccount`. Leave `serviceAccountName` off a Pod spec and OpenShift doesn't leave the field empty, it fills in `default`, the one `ServiceAccount` every namespace already has. That account starts with no RBAC grants of its own, but it's shared by every Pod in the namespace that doesn't ask for something else, which means a Role accidentally bound to `default` grants its permissions to everything running there, not to the one workload it was written for. Access Control is the pattern for closing that gap: give a workload its own `ServiceAccount`, grant that one account exactly what it needs with a `Role`, and leave `default` with nothing bound to it.

The stakes are concrete for a workload like `payment-service`. It has no business listing every Secret in the `patterns` namespace, watching Pods, or reading another service's ConfigMap, and if its container is ever compromised, the blast radius of that compromise is bounded by exactly what its `ServiceAccount` can do against the OpenShift API. A `ServiceAccount` token mounted into a Pod is a credential like any other: scope it the way you'd scope a database role, to the minimum a legitimate workload could ever need, not to whatever happened to be convenient to grant.

`payment-service` is the worked example: a dedicated `ServiceAccount` that can read its own `payment-config` ConfigMap and its own Postgres credentials Secret, and nothing else in the namespace.

## ServiceAccount: an identity, not a permission

A `ServiceAccount` by itself grants nothing. Creating one is a single, almost content-free manifest:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-service
  namespace: patterns
```

What this buys is an identity the API server can distinguish from every other workload's: `system:serviceaccount:patterns:payment-service`, the exact string RBAC rules and `oc auth can-i --as` both key on. A Pod that sets `serviceAccountName: payment-service` gets a token for this identity mounted at `/var/run/secrets/kubernetes.io/serviceaccount/token`, a projected, time-bound token the kubelet refreshes, and every request that container makes to the API carries it, evaluated against whatever RBAC is bound to the identity. Until something binds a `Role` to this `ServiceAccount`, it can do nothing: creating the identity and granting it permissions are two separate steps by design, because an identity with zero attached permissions is the safe default to fall back to while the permissions are worked out.

## Role: naming exactly what's allowed

A `Role` is a namespaced list of rules, each a group of API resources, verbs, and optionally the specific object names those verbs apply to:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: payment-service-reader
  namespace: patterns
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["payment-config"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["patterns-postgres-app"]
    verbs: ["get"]
```

`resourceNames` turns "can read ConfigMaps" into "can read this one ConfigMap." Without it, a rule granting `get` on `configmaps` lets the bound identity read every ConfigMap in the namespace by name; with it, the rule only matches a request for `payment-config`, and a request for any other ConfigMap is denied as if the rule didn't exist. The same scoping applies to the Secret: `payment-service-reader` can fetch `patterns-postgres-app` and nothing else, not even another Secret sitting right next to it.

A `RoleBinding` connects the `Role` to the `ServiceAccount`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payment-service-reader-binding
  namespace: patterns
subjects:
  - kind: ServiceAccount
    name: payment-service
    namespace: patterns
roleRef:
  kind: Role
  name: payment-service-reader
  apiGroup: rbac.authorization.k8s.io
```

Both the `Role` and the `RoleBinding` live in `patterns`, and that's not incidental: a `Role` only grants permissions within the namespace it's created in, regardless of which namespace the bound `ServiceAccount` lives in. A `ServiceAccount` in `patterns` with this binding has exactly the permissions this `Role` lists, inside `patterns`, and none anywhere else in the cluster. `oc auth can-i --as` confirms the boundary directly:

```console
$ SA=system:serviceaccount:patterns:payment-service
$ oc auth can-i get configmap/payment-config      --as=$SA -n patterns   # yes
$ oc auth can-i get secret/patterns-postgres-app   --as=$SA -n patterns   # yes
$ oc auth can-i get configmap/other-team-config    --as=$SA -n patterns   # no
$ oc auth can-i get secret/other-team-secret       --as=$SA -n patterns   # no
$ oc auth can-i list configmaps                     --as=$SA -n patterns   # no
```

![A ServiceAccount, bound by a RoleBinding to a Role naming two specific resources, with an unnamed Secret left outside the grant]({{ "/assets/diagrams/appendix-26-access-control.svg" | relative_url }})
*`payment-service`'s ServiceAccount reaches `payment-config` and `patterns-postgres-app` by name through its Role; `other-team-secret` is never named, so no rule matches a request for it.*

## The gotcha: resourceNames doesn't restrict list or watch

The scoping `resourceNames` provides has a sharp edge: it only restricts verbs that name a single object directly, `get`, `update`, `patch`, `delete`. It has no effect on `list` or `watch`, because those verbs don't take an object name; they return a collection, and RBAC has no way to filter a collection response down to specific names after the fact. A rule written as:

```yaml
resources: ["configmaps"]
resourceNames: ["payment-config"]
verbs: ["get", "list", "watch"]
```

looks like it scopes `list` and `watch` the same way it scopes `get`, but it doesn't: granting `list` here grants `list` on every ConfigMap in the namespace, with `resourceNames` ignored for that verb. `payment-service-reader` grants only `get` for exactly this reason: a workload that only ever fetches one named ConfigMap and one named Secret never needs `list` or `watch` on either kind, and adding those verbs "just in case" widens the grant to the entire namespace the moment `resourceNames` stops doing anything.

## ClusterRole in a namespaced binding, and OpenShift's built-in roles

A `Role` and `RoleBinding` are both namespaced, the right shape for `payment-service`. A `ClusterRole` is the cluster-scoped equivalent, used for two different reasons worth telling apart. The first is a rule targeting a resource with no namespace at all (`nodes`, `persistentvolumes`), which can't be expressed as a `Role` rule. The second is reuse: a common rule set useful across many namespaces. OpenShift ships the familiar trio of built-in `ClusterRole`s, `view` (read-only), `edit` (read/write on most namespaced resources), and `admin` (those plus RBAC within the namespace), the same ones `oc adm policy add-role-to-user` grants.

Binding a `ClusterRole` with a `ClusterRoleBinding` grants it everywhere; binding the same `ClusterRole` with a namespaced `RoleBinding` scopes it to that one namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ops-readonly-binding
  namespace: patterns
subjects:
  - kind: ServiceAccount
    name: ops-readonly
    namespace: patterns
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
```

`roleRef` names a `ClusterRole` from a `RoleBinding`, and when it does, the permissions apply only within the `RoleBinding`'s own namespace. Verified live, `ops-readonly` gets `view`'s entire read-only rule set confined to `patterns`:

```console
$ OPS=system:serviceaccount:patterns:ops-readonly
$ oc auth can-i list pods   --as=$OPS -n patterns   # yes
$ oc auth can-i list pods   --as=$OPS -n default    # no
$ oc auth can-i delete pods --as=$OPS -n patterns   # no  (view is read-only)
```

This is the standard way to reuse a well-tested rule set per namespace without ever granting it cluster-wide, a different outcome from a `ClusterRoleBinding` even though both reference the identical `ClusterRole`.

## Reading a Forbidden error, and auditing with --list

A denied request names the identity, the verb, the resource, and the namespace, usually enough to tell whether a Role is missing a rule or the request is made as the wrong identity:

```
Error from server (Forbidden): configmaps "other-team-config" is forbidden:
User "system:serviceaccount:patterns:payment-service" cannot get resource "configmaps"
in API group "" in the namespace "patterns"
```

Read every field literally before assuming the Role is wrong: the identity string confirms which `ServiceAccount` actually made the request (a Pod under the wrong `serviceAccountName`, a stale token, or a `--as` typo all produce a Forbidden that looks like a missing permission but isn't), and the resource and namespace confirm the request landed where expected. `oc auth can-i --list` audits the whole identity at once rather than one check at a time:

```console
$ oc auth can-i --list --as=system:serviceaccount:patterns:payment-service -n patterns
Resources     Resource Names              Verbs
configmaps    [payment-config]            [get]
secrets       [patterns-postgres-app]     [get]
```

Running that after writing a new Role is a cheap habit that catches an over-broad grant (an unexpected verb, a resource nobody meant to include) before it ships rather than after.

## Hardening the default ServiceAccount

Every namespace's `default` `ServiceAccount` exists whether anything uses it or not, and a Pod that doesn't set `serviceAccountName` gets its token mounted the same way a Pod that explicitly asked for API access would. Most workloads, `payment-service` included, never call the OpenShift API from their own process: FastAPI serving HTTP and talking to Postgres has no reason to hold a live API token, and a mounted token that's never read is still a credential on disk. `automountServiceAccountToken: false`, on the `ServiceAccount` or per-Pod, stops the kubelet from projecting it:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-service
  namespace: patterns
automountServiceAccountToken: false
```

The two controls are layers, not alternatives: a tightly scoped Role limits what a leaked token can reach, and `automountServiceAccountToken: false` removes the token from a container that never needed one. `oc auth can-i --as` evaluates RBAC against the identity string regardless of whether any Pod mounts the token, so this chapter's verification is unaffected either way; a production `payment-service` that never calls the API is better off with automounting off entirely.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure security (define and apply permissions with RBAC)
> **Competency:** Create a ServiceAccount, write a namespaced Role scoped by resourceNames, bind it with a RoleBinding, and verify with oc auth can-i
> **Drill:** `oc auth can-i get configmap/other-team-config --as=system:serviceaccount:patterns:payment-service -n patterns` (expect `no`, since the Role never names it)

> **🤖 Explore with your agent**
>
> "Add a third resourceNames entry to payment-service-reader's secrets rule for a new payment-tls Secret, apply it, and show me the oc auth can-i check that confirms payment-service can now read it while other-team-secret is still denied."

## Cleanup

```bash
oc delete -n patterns -f access-control/06-deployment.yaml -f access-control/05-ops-readonly.yaml \
  -f access-control/04-rbac.yaml -f access-control/03-serviceaccount.yaml \
  -f access-control/02-decoys.yaml -f access-control/01-configmap.yaml -f access-control/00-postgres.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/access-control/

The runnable example deploys `payment-service` under a dedicated `ServiceAccount` bound to a `Role` scoped by `resourceNames`, then runs a sequence of `oc auth can-i --as` checks: an allowed read of its own ConfigMap and Secret, a denied read of a decoy ConfigMap and Secret the Role never names, a denied `list` across the namespace, and a `ClusterRole`-via-`RoleBinding` check showing the built-in `view` role scoped to one namespace (allowed in `patterns`, denied in `default`, read-only throughout). All confirmed on CRC. Full walkthrough in `examples/appendix-patterns/access-control/README.md`.
