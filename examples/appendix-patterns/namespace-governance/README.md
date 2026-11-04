# Namespace Governance

Runnable example for the [Namespace Governance chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/32-namespace-governance/).

A `ResourceQuota` caps the namespace total, a `LimitRange` defaults and bounds
each container, and `shipping-service` sits exactly at the pod quota alongside
Postgres.

## Run it

```bash
oc apply -f 01-priorityclass.yaml
oc apply -f 02-resourcequota.yaml -f 03-limitrange.yaml -f 04-configmap.yaml
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 05-deployment.yaml && oc rollout status deploy/shipping-service -n patterns
```

## Verify

```bash
# quota is exactly full (3/3): Postgres + 2 shipping replicas
oc get resourcequota patterns-quota -n patterns -o jsonpath='{.status.used.pods}/{.status.hard.pods}{"\n"}'

# a 4th pod is rejected before it exists (event on the ReplicaSet, not a Pod)
oc scale deployment/shipping-service -n patterns --replicas=3
oc get events -n patterns --field-selector reason=FailedCreate | tail -1

# LimitRange runs BEFORE the quota: the shipping container got its CPU limit injected
oc get pod -n patterns -l app.kubernetes.io/name=shipping-service \
  -o jsonpath='{.items[0].spec.containers[0].resources.limits.cpu}{"\n"}'          # 200m

# a bare pod gets defaulted; an over-max pod is rejected synchronously
oc scale deployment/shipping-service -n patterns --replicas=1
oc apply -f 06-pod-no-resources.yaml
oc get pod inventory-defaults-check -n patterns -o jsonpath='{.spec.containers[0].resources}{"\n"}'
oc apply -f 07-pod-over-max.yaml     # Forbidden: maximum cpu usage per Container is 500m
```

## Cleanup

```bash
oc delete pod inventory-defaults-check -n patterns --ignore-not-found
oc delete -n patterns -f 05-deployment.yaml -f 04-configmap.yaml -f 03-limitrange.yaml \
  -f 02-resourcequota.yaml -f 00-postgres.yaml --ignore-not-found
oc delete -f 01-priorityclass.yaml --ignore-not-found
```
