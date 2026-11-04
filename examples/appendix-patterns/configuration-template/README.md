# Configuration Template

Runnable example for the [Configuration Template chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/20-configuration-template/).

`inventory-service` with an init container that renders `app.conf.tmpl` against a
per-environment overlay into a shared `emptyDir`, before the main container
starts. Both containers run under `restricted-v2`.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-configmap-template.yaml -f 02-configmap-dev-overlay.yaml \
  -f 03-configmap-prod-overlay.yaml -f 04-deployment.yaml
oc rollout status deploy/inventory-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=inventory-service -o jsonpath='{.items[0].metadata.name}')
oc exec -n patterns "$POD" -c inventory-service -- cat /config/app/app.conf   # environment=development
```

Switch to the production overlay; the init container only re-renders on a new Pod:

```bash
oc patch deployment inventory-service -n patterns --type json \
  -p '[{"op":"replace","path":"/spec/template/spec/initContainers/0/envFrom/0/configMapRef/name","value":"inventory-prod-overlay"}]'
oc rollout restart deployment/inventory-service -n patterns
oc rollout status deploy/inventory-service -n patterns
NP=$(oc get pod -n patterns -l app.kubernetes.io/name=inventory-service --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}')
oc exec -n patterns "$NP" -c inventory-service -- cat /config/app/app.conf     # environment=production
```

## Cleanup

```bash
oc delete -f 04-deployment.yaml -f 03-configmap-prod-overlay.yaml -f 02-configmap-dev-overlay.yaml \
  -f 01-configmap-template.yaml -f 00-postgres.yaml -n patterns
```
