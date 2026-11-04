# Managed Lifecycle

Runnable example for the [Managed Lifecycle chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/04-managed-lifecycle/).

Worked against **shipping-service** on OpenShift: `postStart` and `preStop`
hooks, `SIGTERM` to PID 1, and a `terminationGracePeriodSeconds` that backstops
a graceful shutdown. shipping-service is used because its lifespan shutdown is a
clean connection-pool dispose with no external dependency.

## Run it

Build the images once (see the appendix [README](../README.md)), then deploy:

```bash
oc apply -f managed-lifecycle/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -f managed-lifecycle/01-deployment.yaml
oc rollout status deploy/shipping-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
```

Confirm the `postStart` marker and that the app is PID 1 (so it receives SIGTERM):

```bash
oc exec "$POD" -n patterns -- cat /tmp/managed-lifecycle-ready
oc exec "$POD" -n patterns -- cat /proc/1/comm      # uvicorn
```

Stream the logs, delete the Pod, and watch the termination sequence. The
container keeps answering `/healthz` through the 10s `preStop` window, then
shuts down gracefully, about 10s total, well under the 30s grace period:

```bash
oc logs -f "pod/$POD" -n patterns &
oc delete "pod/$POD" -n patterns     # blocks until terminated
# log tail:
#   GET /healthz 200 OK            (still serving during preStop)
#   Shutting down
#   Waiting for application shutdown.
#   Application shutdown complete.
#   Finished server process [1]
```

## Cleanup

```bash
oc delete deployment/shipping-service service/shipping-service -n patterns
oc delete -f managed-lifecycle/00-postgres.yaml -n patterns
```
