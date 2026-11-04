# Immutable Configuration

Runnable example for the [Immutable Configuration chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/21-immutable-configuration/).

`graphql-gateway` (stateless, no Postgres) consuming an immutable ConfigMap. The
API server rejects an in-place edit; a config change is a new ConfigMap name plus
a Deployment rollout.

## Run it

```bash
oc apply -f 01-configmap-v1.yaml -f 02-deployment.yaml
oc rollout status deploy/graphql-gateway -n patterns
```

An in-place patch is refused:

```bash
oc patch configmap gateway-config-v1 -n patterns --type merge \
  -p '{"data":{"order_rest_url":"http://order-service-v2"}}'
# The ConfigMap "gateway-config-v1" is invalid: data: Forbidden: field is immutable ...
```

Roll the change forward with a new ConfigMap + a Deployment update:

```bash
oc apply -f 03-configmap-v2.yaml -f 04-deployment-v2.yaml
oc rollout status deploy/graphql-gateway -n patterns
NP=$(oc get pod -n patterns -l app.kubernetes.io/name=graphql-gateway --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}')
oc exec -n patterns "$NP" -- env | grep order_rest_url     # http://order-service-v2
oc rollout history deploy/graphql-gateway -n patterns       # the config change is revision 2
```

## Cleanup

```bash
oc delete -f 04-deployment-v2.yaml -n patterns
oc delete configmap gateway-config-v2 gateway-config-v1 -n patterns --ignore-not-found
```
