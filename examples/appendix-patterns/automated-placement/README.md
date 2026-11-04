# Automated Placement

Runnable example for the [Automated Placement chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/05-automated-placement/).

Worked on single-node CRC with UBI placeholders: `nodeSelector`, `nodeAffinity`,
`podAntiAffinity`, and taints/tolerations against the one `crc` node. Placement
is independent of what a container runs, so no service images are needed here.

## Run it

```bash
cd examples/appendix-patterns
oc project patterns
```

**nodeSelector** (Pending until the node is labeled):

```bash
oc apply -f automated-placement/01-node-selector.yaml
oc get pods -n patterns -l app.kubernetes.io/name=shipping-placeholder   # Pending
oc label node crc zone=warehouse-a
oc get pods -n patterns -l app.kubernetes.io/name=shipping-placeholder   # Running
```

**nodeAffinity** (required tier label + a soft preference):

```bash
oc apply -f automated-placement/02-node-affinity.yaml
oc label node crc tier=fulfillment
oc get pods -n patterns -l app.kubernetes.io/name=order-placeholder      # Running
```

**podAntiAffinity** (2 replicas, one Pending on a single node):

```bash
oc apply -f automated-placement/03-pod-anti-affinity.yaml
oc get pods -n patterns -l app.kubernetes.io/name=shipping-ha-placeholder \
  -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,NODE:.spec.nodeName
# one Running on crc, one Pending (no second node to spread to)
```

**taints / tolerations** (taint the node, then untaint):

```bash
oc adm taint node crc dedicated=fulfillment:NoSchedule
oc apply -f automated-placement/04-toleration.yaml
oc get pods -n patterns -l app.kubernetes.io/name=tolerating-placeholder  # Running
oc get pods -n patterns -l app.kubernetes.io/name=intolerant-placeholder  # Pending
oc adm taint node crc dedicated=fulfillment:NoSchedule-                    # untaint, important
```

## Cleanup

```bash
oc delete deployment -n patterns \
  -l 'app.kubernetes.io/name in (shipping-placeholder,order-placeholder,shipping-ha-placeholder,tolerating-placeholder,intolerant-placeholder)'
oc adm taint node crc dedicated=fulfillment:NoSchedule-   # if still applied
oc label node crc zone- tier-
```
