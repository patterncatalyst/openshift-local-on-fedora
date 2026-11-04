# Batch Job

Runnable example for the [Batch Job chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/10-batch-job/).

Worked with **shipping-report**, a net-new `uv`-managed CLI (built here, not a
data-mesh service), that reads `shipping.shipment_events` and writes a CSV to a
PVC. A plain Job runs three redundant reports; an Indexed Job partitions the
table across three Pods by completion index.

## Build the image

This pattern ships its own small image. Build and push it to the integrated
registry (reusing the appendix [README](../README.md)'s login):

```bash
cd examples/appendix-patterns/batch-job
REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
podman login -u "$(oc whoami)" -p "$(oc whoami -t)" --tls-verify=false "$REG"
podman build -t "$REG/patterns/shipping-report:v1" -f Containerfile .
podman push --tls-verify=false "$REG/patterns/shipping-report:v1"
```

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-pvc.yaml -f 02-seed-job.yaml
oc wait --for=condition=complete job/shipping-report-seed -n patterns --timeout=120s   # seeds 300 rows

oc create -f 03-job-plain.yaml       # 3 full reports, tagged by Pod name
oc create -f 04-job-indexed.yaml     # 3 disjoint partitions, report-0/1/2.csv
oc wait --for=condition=complete -l app.kubernetes.io/name=shipping-report-indexed job -n patterns --timeout=150s
```

Inspect the output through a viewer Pod on the same PVC (a finished Job's own
Pod is gone, so you can't `exec` into it):

```bash
oc apply -f 05-report-viewer.yaml
oc wait --for=condition=ready pod/shipping-report-viewer -n patterns --timeout=60s
oc exec -n patterns shipping-report-viewer -- ls /var/lib/shipping-reports/
# report-0.csv report-1.csv report-2.csv  (100 rows each, disjoint)
# report-shipping-report-plain-*.csv       (300 rows each, redundant full reports)
```

## Cleanup

```bash
oc delete jobs -n patterns -l app.kubernetes.io/name=shipping-report-plain
oc delete jobs -n patterns -l app.kubernetes.io/name=shipping-report-indexed
oc delete pod/shipping-report-viewer -n patterns
oc delete -f 02-seed-job.yaml -f 01-pvc.yaml -f 00-postgres.yaml -n patterns
```
