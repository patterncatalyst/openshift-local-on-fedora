# Adapter

Runnable example for the [Adapter chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/08-adapter/).

Worked against **shipping-service** on OpenShift: a `metrics-adapter` sidecar
polls the app's `/healthz` over `127.0.0.1` and re-serves the same readiness
fact as Prometheus exposition text on `:9100/metrics`, without touching the app.

## Run it

Build the images once (see the appendix [README](../README.md)), then deploy:

```bash
oc apply -f adapter/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -f adapter/01-deployment.yaml
oc rollout status deploy/shipping-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
oc port-forward -n patterns "pod/$POD" 18080:8080 19100:9100 &
```

Compare the app's JSON against the adapter's Prometheus text for the same fact:

```bash
curl -s http://127.0.0.1:18080/healthz          # {"status":"ready",...}
curl -s http://127.0.0.1:19100/metrics          # shipping_service_up 1
curl -sD - -o /dev/null http://127.0.0.1:19100/metrics | grep -i content-type   # text/plain; version=0.0.4
```

Scale Postgres to zero: `/healthz` returns 503, the metric follows to `0`, and
the adapter container keeps running (the Pod reads `1/2`, the app not-ready):

```bash
oc scale deploy/patterns-postgres -n patterns --replicas=0
sleep 15
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/healthz   # 503
curl -s http://127.0.0.1:19100/metrics | grep shipping_service_up          # 0
oc get pod "$POD" -n patterns                                              # 1/2 Running, 0 restarts
oc scale deploy/patterns-postgres -n patterns --replicas=1
```

## Cleanup

```bash
oc delete -f adapter/01-deployment.yaml -n patterns
oc delete -f adapter/00-postgres.yaml -n patterns
```
