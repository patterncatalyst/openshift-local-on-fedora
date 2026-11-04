# Access Control

Runnable example for the [Access Control chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/26-access-control/).

`payment-service` under a dedicated `ServiceAccount` bound to a `Role` scoped by
`resourceNames`, plus an `ops-readonly` account showing the built-in `view`
`ClusterRole` confined to one namespace by a `RoleBinding`.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-configmap.yaml -f 02-decoys.yaml -f 03-serviceaccount.yaml \
  -f 04-rbac.yaml -f 05-ops-readonly.yaml -f 06-deployment.yaml
oc rollout status deploy/payment-service -n patterns
```

## Verify the boundary

```bash
SA=system:serviceaccount:patterns:payment-service
oc auth can-i get configmap/payment-config     --as=$SA -n patterns   # yes
oc auth can-i get secret/patterns-postgres-app --as=$SA -n patterns   # yes
oc auth can-i get configmap/other-team-config  --as=$SA -n patterns   # no
oc auth can-i get secret/other-team-secret     --as=$SA -n patterns   # no
oc auth can-i list configmaps                  --as=$SA -n patterns   # no (resourceNames can't scope list)
oc auth can-i --list --as=$SA -n patterns                             # audit the whole identity

OPS=system:serviceaccount:patterns:ops-readonly
oc auth can-i list pods   --as=$OPS -n patterns   # yes
oc auth can-i list pods   --as=$OPS -n default    # no  (RoleBinding scopes view to patterns)
oc auth can-i delete pods --as=$OPS -n patterns   # no  (view is read-only)
```

## Cleanup

```bash
oc delete -n patterns -f 06-deployment.yaml -f 05-ops-readonly.yaml -f 04-rbac.yaml \
  -f 03-serviceaccount.yaml -f 02-decoys.yaml -f 01-configmap.yaml -f 00-postgres.yaml --ignore-not-found
```
