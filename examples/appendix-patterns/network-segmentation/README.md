# Network Segmentation

Runnable example for the [Network Segmentation chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/27-network-segmentation/).

Default-deny ingress scoped per workload, one allow rule for the legitimate
caller, and a restricted egress. OpenShift's default **OVN-Kubernetes** CNI
enforces NetworkPolicy out of the box, so there's no Calico step like the
minikube sibling needs.

```bash
oc get network.config/cluster -o jsonpath='{.spec.networkType}{"\n"}'   # OVNKubernetes
```

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-inventory-service.yaml -f 02-payment-service.yaml -f 03-graphql-gateway.yaml -f 08-test-client.yaml
oc rollout status deploy/inventory-service -n patterns
oc rollout status deploy/payment-service -n patterns
```

## Verify

Baseline (open), then deny, then allow one caller:

```bash
# baseline: both reachable
oc exec -n patterns netseg-test-client -- curl -s -o /dev/null -w '%{http_code}\n' -m 4 http://payment-service:80/healthz   # 200

oc apply -f 04-deny-all-inventory.yaml -f 06-deny-all-payment.yaml
oc exec -n patterns netseg-test-client -- sh -c 'curl -s -o /dev/null -m 4 http://payment-service:80/healthz; echo exit=$?'   # exit=28 (blocked)

oc apply -f 05-allow-gateway-to-inventory.yaml
# a probe Pod labeled as the gateway reaches inventory:50051; the test client does not
oc run netseg-probe-gateway --image=registry.access.redhat.com/ubi9/ubi-minimal:latest \
  --labels=app.kubernetes.io/name=graphql-gateway -n patterns --restart=Never \
  --overrides='{"spec":{"securityContext":{"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"p","image":"registry.access.redhat.com/ubi9/ubi-minimal:latest","command":["sleep","infinity"],"securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}'
oc wait --for=condition=Ready pod/netseg-probe-gateway -n patterns --timeout=60s
oc exec -n patterns netseg-probe-gateway -- sh -c 'curl -s -o /dev/null -m 4 inventory-service:50051; echo exit=$?'   # connected (not 28)
oc exec -n patterns netseg-test-client  -- sh -c 'curl -s -o /dev/null -m 4 inventory-service:50051; echo exit=$?'   # exit=28
```

Egress (note the OpenShift DNS target: `openshift-dns` namespace, port 5353):

```bash
oc apply -f 07-egress-inventory-restricted.yaml
oc rollout restart deployment/inventory-service -n patterns
oc rollout status deploy/inventory-service -n patterns   # Ready => DNS 5353 + Postgres 5432 are sufficient
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=inventory-service -o jsonpath='{.items[0].metadata.name}')
oc exec -n patterns "$POD" -c inventory-service -- sh -c 'curl -s -o /dev/null -m 4 https://example.com; echo exit=$?'   # exit=28 (public egress blocked)
```

## Cleanup

```bash
oc delete pod netseg-probe-gateway -n patterns --ignore-not-found
oc delete -n patterns -f 08-test-client.yaml -f 07-egress-inventory-restricted.yaml -f 06-deny-all-payment.yaml \
  -f 05-allow-gateway-to-inventory.yaml -f 04-deny-all-inventory.yaml -f 03-graphql-gateway.yaml \
  -f 02-payment-service.yaml -f 01-inventory-service.yaml -f 00-postgres.yaml --ignore-not-found
```
