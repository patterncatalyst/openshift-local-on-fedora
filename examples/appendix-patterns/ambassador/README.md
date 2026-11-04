# Ambassador

Runnable example for the [Ambassador chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/09-ambassador/).

Worked against **shipping-service** on OpenShift: the app runs with **zero**
Postgres environment variables and reaches its database through a
`postgres-ambassador` sidecar on `127.0.0.1:5432`. The ambassador alone decides
which real backend that address reaches.

The example's Postgres uses the credentials `datamesh_app` / `changeme` /
`datamesh`, matching shipping-service's `config.py` defaults exactly, which is
what lets the app connect with no env vars.

## Run it

Build the images once (see the appendix [README](../README.md)), then deploy:

```bash
oc apply -f ambassador/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -f ambassador/01-deployment.yaml
oc rollout status deploy/shipping-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
```

The app container has no env, yet the Pod is `2/2` and ready:

```bash
oc get deploy shipping-service -n patterns -o jsonpath='{.spec.template.spec.containers[0].env}{"\n"}'   # []
oc port-forward -n patterns "pod/$POD" 18080:8080 &
curl -s http://127.0.0.1:18080/healthz      # {"status":"ready",...}
```

Repoint only the ambassador's upstream to a Service that doesn't exist. The new
Pod crash-loops (shipping-service needs the DB at startup) while the old Pod
keeps serving, and the app container is never edited:

```bash
oc set env deployment/shipping-service -n patterns \
  --containers=postgres-ambassador UPSTREAM_HOST=patterns-postgres-missing.patterns.svc.cluster.local
oc get pods -n patterns -l app.kubernetes.io/name=shipping-service   # old 2/2 Running, new 1/2 CrashLoopBackOff
oc get deploy shipping-service -n patterns -o jsonpath='{.spec.template.spec.containers[0].env}{"\n"}'   # still []
# restore:
oc set env deployment/shipping-service -n patterns \
  --containers=postgres-ambassador UPSTREAM_HOST=patterns-postgres.patterns.svc.cluster.local
```

## Cleanup

```bash
oc delete -f ambassador/01-deployment.yaml -n patterns
oc delete -f ambassador/00-postgres.yaml -n patterns
```
