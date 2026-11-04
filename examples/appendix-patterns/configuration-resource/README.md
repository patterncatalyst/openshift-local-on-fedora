# Configuration Resource

Runnable example for the [Configuration Resource chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/19-configuration-resource/).

`payment-service` consumes one `ConfigMap` and one `Secret` two ways at once:
`envFrom` bulk-exposes every key as an env var, and a `volumeMount` delivers
keys as files.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-config.yaml -f 02-deployment.yaml
oc rollout status deploy/payment-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=payment-service -o jsonpath='{.items[0].metadata.name}')
```

`envFrom` bulk-exposes every key (current OpenShift exposes the dotted
`payment-service.conf` too, rather than skipping it), and the file mount:

```bash
oc exec -n patterns "$POD" -- env | grep -E '^service_schema|^pg_'
oc exec -n patterns "$POD" -- cat /config/app/payment-service.conf
oc exec -n patterns "$POD" -- ls -lL /config/app/payment-service.conf   # 0440
```

Patch the file-shaped key; the mounted file updates on its own (~60s, no restart):

```bash
oc patch configmap payment-config -n patterns --type merge \
  -p '{"data":{"payment-service.conf":"[payment-service]\nschema=payments\nnote=updated in place\n"}}'
sleep 70
oc exec -n patterns "$POD" -- grep note /config/app/payment-service.conf   # updated in place
oc get pod "$POD" -n patterns -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}'   # 0
```

## Cleanup

```bash
oc delete -f 02-deployment.yaml -f 01-config.yaml -f 00-postgres.yaml -n patterns
```
