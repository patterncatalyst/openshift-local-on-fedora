# Stateful Service

Runnable example for the [Stateful Service chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/15-stateful-service/).

`shipment-archive`, a StatefulSet of three independent `postgres:17-alpine`
instances on OpenShift, with a headless Service, `volumeClaimTemplates`, and the
`nonroot-v2` SCC the UID-70 Postgres image needs.

## Run it

```bash
oc apply -f 00-setup.yaml -f 01-service.yaml -f 02-statefulset.yaml
oc rollout status statefulset/shipment-archive -n patterns --timeout=180s
oc get pods,pvc -n patterns -l app.kubernetes.io/name=shipment-archive
# shipment-archive-0/1/2 in order; archive-data-shipment-archive-0/1/2 each Bound
```

Per-Pod headless DNS:

```bash
oc exec shipment-archive-0 -n patterns -- getent hosts \
  shipment-archive-1.shipment-archive.patterns.svc.cluster.local
```

Sticky storage, write a row, delete the Pod, confirm name and data return:

```bash
oc exec shipment-archive-1 -n patterns -- psql -U archive_app -d archive \
  -c "CREATE TABLE t(id int); INSERT INTO t VALUES (42);"
oc delete pod shipment-archive-1 -n patterns
oc wait --for=condition=ready pod/shipment-archive-1 -n patterns --timeout=120s
oc exec shipment-archive-1 -n patterns -- psql -U archive_app -d archive -tc "SELECT id FROM t;"   # 42
```

## Cleanup

```bash
oc delete -f 02-statefulset.yaml -f 01-service.yaml -f 00-setup.yaml -n patterns
oc delete pvc -n patterns -l app.kubernetes.io/name=shipment-archive   # not auto-deleted
```
