# Sidecar

Runnable example for the [Sidecar chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/07-sidecar/).

Worked against **shipping-service** on OpenShift: a native sidecar
(`probe-tailer`, an `initContainers` entry with `restartPolicy: Always`) polls
the app over `127.0.0.1` and writes to a shared `emptyDir`. The sidecar starts
before the main container and stops after it.

## Run it

Build the images once (see the appendix [README](../README.md)), then deploy:

```bash
oc apply -f sidecar/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -f sidecar/01-deployment.yaml
oc rollout status deploy/shipping-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
```

The Pod reads `2/2`; the sidecar is a native sidecar:

```bash
oc get pod "$POD" -n patterns          # READY 2/2
oc get pod "$POD" -n patterns -o jsonpath='{.spec.initContainers[0].restartPolicy}{"\n"}'   # Always
```

Read the tailed log. Its first line failed because the sidecar started before
the app was ready:

```bash
oc exec "$POD" -n patterns -c probe-tailer -- tail -n 5 /var/log/shipping-service/probe-tail.log
```

Delete the Pod and compare the two containers' terminated timestamps; the
sidecar's is later (it stops after the main container):

```bash
oc delete pod "$POD" -n patterns --wait=false
# poll `oc get pod $POD -o json` and read:
#   .status.containerStatuses[name=shipping-service].state.terminated.finishedAt   (earlier)
#   .status.initContainerStatuses[name=probe-tailer].state.terminated.finishedAt   (later)
```

## Cleanup

```bash
oc delete -f sidecar/01-deployment.yaml -n patterns
oc delete -f sidecar/00-postgres.yaml -n patterns
```
