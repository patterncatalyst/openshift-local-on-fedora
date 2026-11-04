# Singleton Service

Runnable example for the [Singleton Service chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/13-singleton-service/).

A `shipping-service` Deployment at `replicas: 1`, protected by a
`PodDisruptionBudget` (`minAvailable: 1`). The PDB refuses the Eviction API but
not a direct delete. (shipping-service stands in for any singleton; its startup
is a clean DB connect with nothing to block on.)

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-deployment.yaml -f 02-pdb.yaml
oc rollout status deploy/shipping-service -n patterns
oc get pdb shipping-service-pdb -n patterns      # ALLOWED DISRUPTIONS = 0
```

The Eviction API (what `oc adm drain` uses) is refused:

```bash
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
oc create --raw "/api/v1/namespaces/patterns/pods/${POD}/eviction" -f - <<EOF
{"apiVersion":"policy/v1","kind":"Eviction","metadata":{"name":"${POD}","namespace":"patterns"}}
EOF
# Error from server (TooManyRequests): Cannot evict pod as it would violate the pod's disruption budget.
```

A direct delete bypasses the PDB entirely and the Deployment replaces the Pod:

```bash
oc delete pod "$POD" -n patterns      # succeeds immediately, no 429
oc get pods -n patterns -l app.kubernetes.io/name=shipping-service
```

Do not run `oc adm drain` against CRC's single node: it would evict everything.
The eviction-request refusal above is exactly what a drain hits at a
PDB-protected Pod.

## Cleanup

```bash
oc delete -f 02-pdb.yaml -f 01-deployment.yaml -f 00-postgres.yaml -n patterns
```
