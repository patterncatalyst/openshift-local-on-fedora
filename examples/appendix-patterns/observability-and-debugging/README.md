# Observability and Debugging

Runnable example for the [Observability and Debugging chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/30-observability-and-debugging/).

`shipping-service` plus a trivial `heartbeat` container, so the per-container
flags have something to pick between. Exercises every `oc` window into a running
Pod, plus OpenShift's two debuggers.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 02-deployment.yaml && oc rollout status deploy/shipping-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
```

## The five windows

```bash
oc logs -n patterns "$POD" -c heartbeat --tail=3          # -c picks a container
oc logs -n patterns "$POD"                                # oc DEFAULTS to the first (prints a notice)
oc exec -n patterns "$POD" -c shipping-service -- env | grep SERVICE_SCHEMA
oc port-forward -n patterns "$POD" 18080:8080 &           # debug/dev only, never app exposure
curl -s http://127.0.0.1:18080/healthz; kill %1
oc describe pod -n patterns "$POD" | sed -n '/Events:/,$p'
oc get events -n patterns --sort-by=.metadata.creationTimestamp
```

Previous logs after a forced restart (kill PID 1 is blocked; fail a liveness probe instead):

```bash
oc set probe deployment/shipping-service -n patterns --liveness \
  --get-url=http://:8080/nonexistent --period-seconds=5 --failure-threshold=2
# wait for RESTARTS to climb, then:
oc logs -n patterns "$POD" -c shipping-service --previous
oc set probe deployment/shipping-service -n patterns --liveness --remove   # revert
```

## The two debuggers

```bash
# oc debug: a pod COPY with a shell, OpenShift-native, works under restricted-v2
oc debug -n patterns deployment/shipping-service -- /bin/sh -c 'env | grep SERVICE_SCHEMA; id'

# ephemeral container: attaches to the RUNNING pod; needs --profile=restricted here
kubectl debug -n patterns "$POD" --profile=restricted -c netcheck \
  --image=registry.access.redhat.com/ubi9/ubi-minimal:9.6 \
  -- curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/health
oc logs -n patterns "$POD" -c netcheck            # ephemeral localhost:8080/health -> 200
```

`kubectl debug --target` (shared process namespace, for `ps`) needs `SYS_PTRACE`,
which restricted-v2 forbids; `oc debug` is the practical default on OpenShift.

## Cleanup

```bash
oc delete -n patterns -f 02-deployment.yaml -f 00-postgres.yaml --ignore-not-found
```
