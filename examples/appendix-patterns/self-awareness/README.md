# Self Awareness

Runnable example for the [Self Awareness chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/17-self-awareness/).

`shipping-service` reads its own Pod's facts through the Downward API: `fieldRef`
and `resourceFieldRef` as environment variables, plus a `downwardAPI` volume at
`/etc/podinfo` that updates in place.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-deployment.yaml && oc rollout status deploy/shipping-service -n patterns
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
```

Downward API env vars (note `CPU_REQUEST=1`: without a divisor, CPU rounds up to
whole cores) and the volume:

```bash
oc exec -n patterns "$POD" -- env | grep -E 'POD_|NODE_|CPU_REQUEST|MEMORY_LIMIT'
oc exec -n patterns "$POD" -- cat /etc/podinfo/cpu_limit      # 500 (divisor: 1m)
oc exec -n patterns "$POD" -- cat /etc/podinfo/annotations
```

Patch an annotation and watch the volume file update with no restart:

```bash
oc annotate pod "$POD" -n patterns patterns.example.com/owner=logistics-team --overwrite
sleep 8
oc exec -n patterns "$POD" -- grep owner /etc/podinfo/annotations    # logistics-team
oc get pod "$POD" -n patterns -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}'   # 0
```

## Cleanup

```bash
oc delete -f 01-deployment.yaml -f 00-postgres.yaml -n patterns
```
