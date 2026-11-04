# Env Var Configuration

Runnable example for the [Env Var Configuration chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/18-env-var-configuration/).

`notification-service` with its environment drawn from three sources at once: a
literal, a `ConfigMap`, and a `Secret`. All resolve once at container start.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-configmap.yaml -f 02-deployment.yaml
oc rollout status deploy/notification-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=notification-service -o jsonpath='{.items[0].metadata.name}')
oc exec -n patterns "$POD" -- env | grep -E 'SERVICE_SCHEMA|KAFKA_ORDER_TOPIC|PG_USER'
```

Patch the ConfigMap; the running Pod is unaffected until a restart:

```bash
oc patch configmap notification-config -n patterns --type merge \
  -p '{"data":{"kafka_order_topic":"order-placed-v2"}}'
oc exec -n patterns "$POD" -- env | grep KAFKA_ORDER_TOPIC         # still order-placed
oc rollout restart deployment/notification-service -n patterns
oc rollout status deploy/notification-service -n patterns
NP=$(oc get pod -n patterns -l app.kubernetes.io/name=notification-service --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}')
oc exec -n patterns "$NP" -- env | grep KAFKA_ORDER_TOPIC          # order-placed-v2
```

## Cleanup

```bash
oc delete -f 02-deployment.yaml -f 01-configmap.yaml -f 00-postgres.yaml -n patterns
```
