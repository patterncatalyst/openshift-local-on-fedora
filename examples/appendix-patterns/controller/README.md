# Controller

Runnable example for the [Controller chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/22-controller/).

Two reconcile loops, stacked on the same cluster: the **built-in**
ReplicaSet controller keeping `shipping-service`'s Pods at two replicas, and
the **custom** `ShippingPolicy` controller from `../operator/` keeping a
Deployment and ConfigMap matching a `ShippingPolicy`'s spec. Same
observe-diff-act shape, one layer apart.

## Part 1: the built-in controller

```bash
cd examples/appendix-patterns
oc apply -n patterns -f controller/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns
oc apply -n patterns -f controller/01-deployment.yaml
oc rollout status deploy/shipping-service -n patterns
```

Two Pods, each owned by a ReplicaSet, which is itself owned by the
Deployment:

```bash
oc get deployment,replicaset,pod -n patterns -l app.kubernetes.io/name=shipping-service
oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.ownerReferences[0].kind}{"\n"}'
```

The last command prints `ReplicaSet`, not `Deployment`: the Deployment
controller only manages ReplicaSets, and the ReplicaSet controller is the one
that owns and counts Pods. Delete one directly and watch the ReplicaSet
controller notice the gap and close it, with nothing in this repository
involved:

```bash
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
oc delete pod "$POD" -n patterns
oc get pod -n patterns -l app.kubernetes.io/name=shipping-service
```

A new Pod, a new name, same count: two. The ReplicaSet controller's watch
fired the moment the API server recorded the deletion, it diffed
`status.replicas` (now 1) against `spec.replicas` (still 2), and it created a
replacement. It doesn't know or care *why* the count dropped: a manual
delete, an OOM kill, a node failure, and a rolling update all produce the
same diff and the same reaction. That's the level-triggered design every
controller in this chapter shares.

## Part 2: the custom controller

Build, push, and deploy the operator from `../operator/` (see that
directory's own `README.md` for the full walkthrough, including the
OpenShift finalizers RBAC rule):

```bash
cd ../operator
CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o manager ./cmd
podman build -t shipping-policy-operator:v1 -f Containerfile .
REG=default-route-openshift-image-registry.apps-crc.testing
podman login -u kubeadmin -p "$(oc whoami -t)" "$REG" --tls-verify=false
podman tag shipping-policy-operator:v1 "$REG/patterns/shipping-policy-operator:v1"
podman push "$REG/patterns/shipping-policy-operator:v1" --tls-verify=false
oc apply -f install.yaml
oc wait --for=condition=Available deployment/shipping-policy-operator -n patterns --timeout=120s
cd ../controller
```

Apply this chapter's own `ShippingPolicy`:

```bash
oc apply -f 02-shippingpolicy.yaml
oc wait --for=condition=Ready shippingpolicy/controller-demo -n patterns --timeout=180s
oc get deployment,configmap -n patterns -l shipping.patterncatalyst.io/policy=controller-demo
```

A Deployment and a ConfigMap, both named `controller-demo`, both owned by the
`ShippingPolicy` object, neither one hand-written: the reconciler built both
from the spec the instant it saw the object. Watch the reconciler's own log
while poking at its children from a second terminal:

```bash
oc logs -f -n patterns deployment/shipping-policy-operator
```

### Scale the Deployment directly

```bash
oc scale deployment/controller-demo -n patterns --replicas=5
sleep 6; oc get deployment controller-demo -n patterns -o jsonpath='{.spec.replicas}{"\n"}'
```

Replicas climb to 5 for a moment, then settle back to 2.
`SetupWithManager` calls `.Owns(&appsv1.Deployment{})`, so the manager
watches every Deployment this `ShippingPolicy` owns, not just the
`ShippingPolicy` object itself; the scale is exactly the kind of out-of-band
edit that watch exists to catch. A new reconcile fires within moments,
compares `spec.replicas` (still 2) against the Deployment's current `5`, and
corrects it, the same observe-diff-act shape as the ReplicaSet controller in
Part 1, one object layer higher: this controller's "replicas" are Deployments
and ConfigMaps, not Pods.

### Delete the ConfigMap directly

```bash
oc delete configmap controller-demo -n patterns
sleep 6; oc get configmap controller-demo -n patterns
```

Gone, then back, usually inside seconds. `.Owns(&corev1.ConfigMap{})` covers
this the way `.Owns(&appsv1.Deployment{})` covered the scale command above.

![The reconcile loop: a watch fires, Reconcile observes current state, diffs it against spec, and acts, whether the watched object is a Pod (built-in) or a Deployment and ConfigMap (custom)]({{ "/assets/diagrams/appendix-22-controller.svg" | relative_url }})
*Both controllers in this example run the identical loop; only the kind of object being watched, diffed, and corrected changes.*

## Cleanup

```bash
oc delete -f 02-shippingpolicy.yaml --ignore-not-found
oc delete -f ../operator/install.yaml --ignore-not-found
oc delete -n patterns -f 01-deployment.yaml --ignore-not-found
oc delete -n patterns -f 00-postgres.yaml --ignore-not-found
oc delete priorityclass patterns-high-priority --ignore-not-found
```
