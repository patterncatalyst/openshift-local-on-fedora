# Periodic Job

Runnable example for the [Periodic Job chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/11-periodic-job/).

Wraps the Batch Job chapter's **shipping-report** runner in a `CronJob`
(`*/5 * * * *`, `concurrencyPolicy: Forbid`) on OpenShift. Reuses the
`shipping-report:v1` image from the Batch Job example.

## Run it

Build `shipping-report:v1` first if you haven't (see the Batch Job README), then:

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-pvc.yaml -f 02-seed-job.yaml
oc wait --for=condition=complete job/shipping-report-seed -n patterns --timeout=120s
oc apply -f 03-cronjob.yaml
oc get cronjob shipping-report -n patterns
```

Trigger an on-demand run instead of waiting for the next five-minute tick:

```bash
oc create job --from=cronjob/shipping-report shipping-report-manual-1 -n patterns
oc wait --for=condition=complete job/shipping-report-manual-1 -n patterns --timeout=120s
```

Pause and resume the schedule without deleting it:

```bash
oc patch cronjob shipping-report -n patterns -p '{"spec":{"suspend":true}}'
oc get cronjob shipping-report -n patterns -o jsonpath='{.spec.suspend}{"\n"}'   # true
oc patch cronjob shipping-report -n patterns -p '{"spec":{"suspend":false}}'
```

Inspect the reports through a viewer Pod on the same PVC:

```bash
oc apply -f 04-report-viewer.yaml
oc wait --for=condition=ready pod/shipping-report-viewer -n patterns --timeout=60s
oc exec -n patterns shipping-report-viewer -- ls /var/lib/shipping-reports/
```

## Cleanup

```bash
oc delete -f 03-cronjob.yaml -n patterns
oc delete jobs -n patterns -l app.kubernetes.io/name=shipping-report
oc delete job/shipping-report-manual-1 pod/shipping-report-viewer -n patterns --ignore-not-found
oc delete -f 02-seed-job.yaml -f 01-pvc.yaml -f 00-postgres.yaml -n patterns
```
