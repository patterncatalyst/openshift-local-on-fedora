# Declarative Deployment

Runnable example for the [Declarative Deployment chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/02-declarative-deployment/).

Worked against **shipping-service** on OpenShift: `RollingUpdate` with a
`preStop` drain for true zero-downtime through the router, `Recreate` for the
contrast, and `oc rollout status / history / undo`.

## Run it

Build the images once (see the appendix [README](../README.md)), including the
`v2` tag the rollout switches to:

```bash
cd examples/appendix-patterns
./scripts/build-and-push.sh shipping-service
REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
podman tag shipping-service:v1 "$REG/patterns/shipping-service:v2"
podman push --tls-verify=false "$REG/patterns/shipping-service:v2"
```

Deploy Postgres and the rolling version, then get the Route:

```bash
oc apply -f declarative-deployment/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -f declarative-deployment/01-deployment-rolling.yaml
oc rollout status deploy/shipping-service -n patterns
HOST=$(oc get route shipping-service -n patterns -o jsonpath='{.spec.host}')
```

Roll to `v2` while a curl loop hits the Route. With the `preStop` drain and
`minReadySeconds`, every request succeeds:

```bash
oc set image deployment/shipping-service -n patterns \
  shipping-service=image-registry.openshift-image-registry.svc:5000/patterns/shipping-service:v2
# in another shell, for the duration of the rollout:
while true; do curl -sk -o /dev/null -w '%{http_code}\n' "https://$HOST/health"; sleep 0.4; done
```

Check the revision history and roll back:

```bash
oc rollout history deployment/shipping-service -n patterns
oc get rs -n patterns -l app.kubernetes.io/name=shipping-service   # old RS kept at 0
oc rollout undo deployment/shipping-service -n patterns
```

Now switch to `Recreate` and repeat the rollout. The same curl loop shows a
contiguous outage (about ten seconds, zero ready Pods):

```bash
oc apply -f declarative-deployment/02-deployment-recreate.yaml
oc set image deployment/shipping-service -n patterns \
  shipping-service=image-registry.openshift-image-registry.svc:5000/patterns/shipping-service:v2
```

## Cleanup

```bash
oc delete deployment/shipping-service service/shipping-service route/shipping-service -n patterns
oc delete -f declarative-deployment/00-postgres.yaml -n patterns
```
