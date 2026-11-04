# Secure Configuration

Runnable example for the [Secure Configuration chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/29-secure-configuration/).

`inventory-service` consuming its own `inventory-db-credentials` Secret two ways,
an env var and a mounted file, with a look at what base64 does (nothing for
confidentiality) and the effective file mode an arbitrary-UID container gets.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-secret.yaml -f 02-deployment.yaml
oc rollout status deploy/inventory-service -n patterns
```

## Verify

```bash
# base64 is encoding, not encryption
oc get secret inventory-db-credentials -n patterns -o jsonpath='{.data.password}'; echo
oc get secret inventory-db-credentials -n patterns -o jsonpath='{.data.password}' | base64 -d; echo   # changeme

# describe redacts (UI convenience only)
oc describe secret inventory-db-credentials -n patterns | sed -n '/^Data/,/^$/p'

# mounted file: effective 0440 under the injected UID (owner root, group = fsGroup), never world-readable
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=inventory-service -o jsonpath='{.items[0].metadata.name}')
oc exec -n patterns "$POD" -c inventory-service -- ls -lL /etc/inventory/credentials/password
oc exec -n patterns "$POD" -c inventory-service -- cat /etc/inventory/credentials/password; echo
```

## Cleanup

```bash
oc delete -n patterns -f 02-deployment.yaml -f 01-secret.yaml -f 00-postgres.yaml --ignore-not-found
```
