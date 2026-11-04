# Stateless Service

Runnable example for the [Stateless Service chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/14-stateless-service/).

`payment-service` at `replicas: 3` on OpenShift: no per-Pod storage, no stable
identity, no in-memory state a client depends on. All state lives in Postgres.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-deployment.yaml && oc rollout status deploy/payment-service -n patterns
oc get pod -n patterns -l app.kubernetes.io/name=payment-service -o name
```

Delete a replica; the ReplacementSet brings up a new Pod with a new name and IP
while the Service keeps answering:

```bash
VICTIM=$(oc get pod -n patterns -l app.kubernetes.io/name=payment-service -o jsonpath='{.items[0].metadata.name}')
oc delete pod "$VICTIM" -n patterns
oc get pod -n patterns -l app.kubernetes.io/name=payment-service -o name   # new name in place of the deleted one
```

Scale with nothing but a number:

```bash
oc scale deployment/payment-service -n patterns --replicas=5
oc rollout status deploy/payment-service -n patterns
oc scale deployment/payment-service -n patterns --replicas=3
```

## Cleanup

```bash
oc delete -f 01-deployment.yaml -f 00-postgres.yaml -n patterns
```
