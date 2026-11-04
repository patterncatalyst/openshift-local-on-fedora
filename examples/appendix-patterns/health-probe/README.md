# Health Probe

Runnable example for the [Health Probe chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/03-health-probe/).

Worked against **inventory-service** on OpenShift: `startupProbe`, `livenessProbe`,
and `readinessProbe`, plus a `readinessGate` only an external signal can satisfy.
`/health` reports the process; `/healthz` reports whether Postgres is reachable.

## Run it

Build the images once (see the appendix [README](../README.md)), then deploy:

```bash
oc apply -f health-probe/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -f health-probe/01-deployment.yaml
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=inventory-service -o jsonpath='{.items[0].metadata.name}')
```

The container passes its probes, but the Pod is not `Ready`: the readiness gate
is unsatisfied.

```bash
oc get pod "$POD" -n patterns -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"\n"}{end}'
# ContainersReady=True, Ready=False
```

Satisfy the gate (a controller would do this in production):

```bash
oc patch "pod/$POD" -n patterns --type='json' --subresource=status \
  -p='[{"op":"add","path":"/status/conditions/-","value":{"type":"patterns.example.com/InventorySeeded","status":"True"}}]'
oc get pod "$POD" -n patterns -o jsonpath='{range .status.conditions[?(@.type=="Ready")]}{.type}={.status}{"\n"}{end}'
# Ready=True
```

Show liveness and readiness diverge. Scale Postgres to zero, then probe both
endpoints through a port-forward:

```bash
oc scale deploy/patterns-postgres -n patterns --replicas=0
oc port-forward -n patterns "pod/$POD" 18080:8080 &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/health    # 200 (liveness)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/healthz   # 503 (readiness)
oc get pod "$POD" -n patterns -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}'  # 0
oc scale deploy/patterns-postgres -n patterns --replicas=1   # readiness recovers, still 0 restarts
```

## Cleanup

```bash
oc delete deployment/inventory-service service/inventory-service -n patterns
oc delete -f health-probe/00-postgres.yaml -n patterns
```
