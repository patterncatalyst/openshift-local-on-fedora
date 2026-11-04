# Predictable Demands

Runnable example for the [Predictable Demands chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/01-predictable-demands/).

Worked against **shipping-service** on OpenShift: resource requests/limits under
`restricted-v2`, a `PriorityClass`, and two hard requirements (a ConfigMap and a
PVC) the Pod cannot start without. The shared Postgres runs under the `nonroot-v2`
SCC, since its image keeps the pinned UID 70.

## Run it

Build the images once (see the appendix [README](../README.md)):

```bash
cd examples/appendix-patterns
./scripts/build-and-push.sh
```

Apply the PriorityClass and Postgres, then the Deployment out of order to see the
hard requirements bite:

```bash
oc apply -f predictable-demands/01-priorityclass.yaml
oc apply -f predictable-demands/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns

oc apply -f predictable-demands/04-deployment.yaml
oc get pods -n patterns -w
```

The Pod sits in `Pending` (no `shipping-data` PVC), then
`CreateContainerConfigError` (no `shipping-config` ConfigMap) once it schedules.
`oc describe pod -n patterns -l app.kubernetes.io/name=shipping-service` shows
both events. Satisfy the two hard requirements:

```bash
oc apply -f predictable-demands/03-pvc.yaml     # binds WaitForFirstConsumer
oc apply -f predictable-demands/02-configmap.yaml
oc rollout status deploy/shipping-service -n patterns
```

Inspect what landed, the QoS class, priority, and the UID restricted-v2 injected:

```bash
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o name)
oc get "$POD" -n patterns -o jsonpath='{.status.qosClass}{"\n"}'          # Burstable
oc get "$POD" -n patterns -o jsonpath='{.spec.priority}{"\n"}'            # 1000000
oc get "$POD" -n patterns -o jsonpath='{.spec.containers[0].securityContext.runAsUser}{"\n"}'  # from the project range
```

`oc adm top pod` needs the metrics API, which CRC disables by default; enable it
with `crc config set enable-cluster-monitoring true` if you want live usage.

## Cleanup

```bash
oc delete -f predictable-demands/04-deployment.yaml -f predictable-demands/03-pvc.yaml \
  -f predictable-demands/02-configmap.yaml -f predictable-demands/00-postgres.yaml -n patterns
oc delete -f predictable-demands/01-priorityclass.yaml
```
