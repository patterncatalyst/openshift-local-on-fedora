# Elastic Scale

Runnable example for the [Elastic Scale chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/23-elastic-scale/).

Three autoscalers on one cluster: a CPU-based **HPA** and a Recommendation-only
**VPA** on `shipping-service` (both reading the Pods themselves), and a Custom
Metrics Autoscaler **ScaledObject** scaling `graphql-gateway` from zero on a
cron schedule (reading a signal outside the Pods, which is what lets it reach
zero).

## One-time prerequisites

### 1. metrics-server (resource metrics API)

CRC ships with cluster monitoring off, so `metrics.k8s.io` isn't registered and
HPA/VPA have nothing to read. Install the lightweight metrics-server:

```bash
oc apply -f metrics-server.yaml
oc rollout status deploy/metrics-server -n kube-system
oc adm top pod -n patterns          # returns numbers once it's serving
```

This manifest is the upstream release with two CRC edits: `--kubelet-insecure-tls`
and the removal of the pinned `runAsUser: 1000` (outside the namespace's UID
range, so restricted-v2 rejects it).

### 2. Custom Metrics Autoscaler (Red Hat KEDA)

```bash
# From the repo root; re-check the current CSV first (see openshift/references/versions.md)
oc apply -f openshift/platform/subscriptions/custom-metrics-autoscaler.yaml
# approve the Manual InstallPlan for the pinned CSV, then:
oc apply -f openshift/platform/keda/kedacontroller.yaml
oc get deploy -n openshift-keda           # keda-operator, -metrics-apiserver, -admission
```

### 3. VerticalPodAutoscaler operator

Install `vertical-pod-autoscaler` from OperatorHub (stable channel). After the
CSV reaches `Succeeded`, the operator creates the recommender, updater, and
admission-plugin Deployments in `openshift-vertical-pod-autoscaler` and
registers the `verticalpodautoscalers.autoscaling.k8s.io` CRD.

## Part 1: HPA and VPA on shipping-service

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-deployment.yaml -f 02-hpa.yaml -f 03-vpa.yaml
oc rollout status deploy/shipping-service -n patterns
oc get hpa shipping-service -n patterns    # cpu: <n>%/50% once metrics flow
```

Drive CPU load from an in-cluster Pod and watch the HPA climb from 1 toward 5:

```bash
oc -n patterns run load-gen --image=registry.access.redhat.com/ubi9/ubi-minimal:9.6 --restart=Never -- \
  /bin/sh -c 'for i in $(seq 1 40); do (while true; do curl -s http://shipping-service/health >/dev/null 2>&1; done &); done; sleep 600'
watch oc get hpa shipping-service -n patterns      # TARGETS climbs past 50%, REPLICAS -> 5
oc delete pod load-gen -n patterns --force         # stop; HPA settles back to 1 after its window
```

The VPA recommendation (it never acts, only recommends):

```bash
oc describe vpa shipping-service -n patterns | sed -n '/Recommendation/,/Events/p'
```

## Part 2: scale-to-zero on graphql-gateway

```bash
oc apply -f 04-gateway-deployment.yaml     # starts at replicas: 0
oc apply -f 05-gateway-scaledobject.yaml   # active cron window -> scales 0 -> 2
oc get scaledobject,deploy graphql-gateway -n patterns
oc get hpa -n patterns | grep keda         # KEDA's generated keda-hpa-graphql-gateway
```

Patch the cron window to a span that excludes now, and KEDA scales it back to
zero within a polling interval:

```bash
oc patch scaledobject graphql-gateway -n patterns --type merge \
  -p '{"spec":{"triggers":[{"type":"cron","metadata":{"timezone":"UTC","start":"0 3 * * *","end":"1 3 * * *","desiredReplicas":"2"}}]}}'
oc get deploy graphql-gateway -n patterns  # 0/0 within ~30s
```

`06-shipping-kafka-scaledobject.yaml` is a reference only (Kafka consumer-lag
trigger); the pristine cluster runs no broker, so it is not applied.

## Cleanup

```bash
oc delete -n patterns -f 05-gateway-scaledobject.yaml -f 04-gateway-deployment.yaml \
  -f 03-vpa.yaml -f 02-hpa.yaml -f 01-deployment.yaml -f 00-postgres.yaml --ignore-not-found
```

To remove the shared infrastructure too:

```bash
oc delete -f metrics-server.yaml
oc delete -f ../../../openshift/platform/keda/kedacontroller.yaml
# then delete the CMA and VPA Subscriptions/CSVs and their namespaces
```
