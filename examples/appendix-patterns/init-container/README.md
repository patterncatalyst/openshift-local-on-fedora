# Init Container

Runnable example for the [Init Container chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/06-init-container/).

Worked against **notification-service** on OpenShift: an init container runs the
service's real Alembic migration (`alembic upgrade head`) before the main
container starts, using the same image. The main container only starts if the
init container exits zero.

## Run it

Build the images once (see the appendix [README](../README.md)). To see the init
container gate the main one, create only the secret first (so the migration
starts but Postgres is still absent):

```bash
oc create secret generic patterns-postgres-app -n patterns \
  --from-literal=username=patterns_app --from-literal=password=changeme --from-literal=dbname=patterns
oc apply -f init-container/01-deployment.yaml
oc get pods -n patterns -l app.kubernetes.io/name=notification-service -w
# Init:Error -> Init:CrashLoopBackOff; main container stays PodInitializing
oc logs -n patterns -l app.kubernetes.io/name=notification-service -c migrate   # connection failure
```

Now bring up Postgres; the next init retry applies the migration and the main
container starts:

```bash
oc apply -f init-container/00-postgres.yaml
oc rollout status deploy/notification-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=notification-service -o jsonpath='{.items[0].metadata.name}')
oc logs "$POD" -n patterns -c migrate | grep 'Running upgrade'
```

Confirm the schema and version table the migration created:

```bash
PG=$(oc get pod -n patterns -l app.kubernetes.io/name=patterns-postgres -o jsonpath='{.items[0].metadata.name}')
oc exec "$PG" -n patterns -- psql -U patterns_app -d patterns -c "\dn"
oc exec "$PG" -n patterns -- psql -U patterns_app -d patterns -c "SELECT version_num FROM notifications.alembic_version;"
```

## Cleanup

```bash
oc delete -f init-container/01-deployment.yaml -n patterns
oc delete -f init-container/00-postgres.yaml -n patterns
```
