# Process Containment

Runnable example for the [Process Containment chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/28-process-containment/).

A hardened `inventory-service` admitted by the **restricted-v2** SCC (which
injects the UID), plus a disposable namespace showing the baseline Pod Security
Standard admitting a compliant Pod and rejecting a privileged one.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-deployment.yaml && oc rollout status deploy/inventory-service -n patterns
```

## Verify the hardening

```bash
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=inventory-service -o jsonpath='{.items[0].metadata.name}')
oc get pod "$POD" -n patterns -o jsonpath='{.metadata.annotations.openshift\.io/scc}{"\n"}'   # restricted-v2
oc exec -n patterns "$POD" -c inventory-service -- id                                          # uid=1000650000 gid=0
oc exec -n patterns "$POD" -c inventory-service -- grep CapEff /proc/1/status                  # all zero
oc exec -n patterns "$POD" -c inventory-service -- touch /opt/app-root/src/x                   # Read-only file system
oc exec -n patterns "$POD" -c inventory-service -- sh -c 'touch /tmp/x && echo ok'             # ok
```

## The admission demo

```bash
oc apply -f 02-namespace.yaml
oc apply -f 03-compliant-pod.yaml                 # admitted; scc=restricted-v2
oc get pod compliant-demo -n patterns-pss-demo -o jsonpath='{.metadata.annotations.openshift\.io/scc}{"\n"}'
oc apply -f 04-privileged-pod-rejected.yaml       # Forbidden: violates PodSecurity "baseline:latest"
```

## Cleanup

```bash
oc delete namespace patterns-pss-demo --ignore-not-found
oc delete -n patterns -f 01-deployment.yaml -f 00-postgres.yaml --ignore-not-found
```
