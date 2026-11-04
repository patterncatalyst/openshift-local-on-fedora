# shipping-policy-operator

A [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime)
operator backing the [Controller](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/22-controller/)
and [Operator](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/25-operator/)
chapters. It defines one CRD, `ShippingPolicy` (group
`shipping.patterncatalyst.io`, version `v1alpha1`), and reconciles each
`ShippingPolicy` into a `shipping-service` Deployment and a ConfigMap, sized
and prioritized from the policy's own spec, all under the restricted-v2 SCC.

## Layout

```
operator/
  api/v1alpha1/              # ShippingPolicy, ShippingPolicySpec, ShippingPolicyStatus
  cmd/main.go                # manager entrypoint
  internal/controller/       # the reconciler + its tests
  config/
    crd/bases/                # generated CRD
    rbac/                     # ServiceAccount, Role, RoleBinding (namespaced to patterns)
    manager/                  # the operator's own Deployment
    samples/                  # a sample ShippingPolicy
    default/                  # kustomization combining the three above
  install.yaml                # flattened `kustomize build config/default`
  Containerfile               # ubi10/ubi-micro runtime for a host-built binary
```

## The API

```yaml
apiVersion: shipping.patterncatalyst.io/v1alpha1
kind: ShippingPolicy
metadata:
  name: ground-standard
  namespace: patterns
spec:
  carrier: ground              # required
  maxTransitDays: 5            # required, >= 1
  replicas: 3                  # required, >= 0
  priorityClassName: patterns-high-priority   # optional
status:
  observedReplicas: 3
  conditions:
    - type: Ready
      status: "True"
      reason: ReplicasMatch
```

## The reconciler

`internal/controller/shippingpolicy_controller.go`'s `Reconcile` is the
observe-diff-act loop chapter 22 describes: given a `ShippingPolicy`, it

1. creates or updates a ConfigMap named after the policy, carrying
   `carrier` and `maxTransitDays`,
2. creates or updates a Deployment named after the policy, running
   `shipping-service:v1` from the integrated registry at `spec.replicas`
   with `spec.priorityClassName`, stamped with the restricted-v2
   securityContext every other chapter's example carries, and
3. re-reads the Deployment's own `status.replicas` and writes it to
   `status.observedReplicas`, setting a single `Ready` condition True once
   observed matches desired.

Both children carry a controller owner reference back to the
`ShippingPolicy` (`controllerutil.SetControllerReference`), so deleting the
`ShippingPolicy` garbage-collects both without a finalizer.

`SetupWithManager` watches `ShippingPolicy` directly and owns both child
kinds, so hand-editing the Deployment (or deleting the ConfigMap) also
triggers a reconcile, not just a spec change on the `ShippingPolicy` itself.

### The OpenShift RBAC difference

OpenShift enables the `OwnerReferencesPermissionEnforcement` admission plugin
by default. Setting `blockOwnerDeletion` on an owned object (what
`SetControllerReference` does) then requires `update` on the owner's
`finalizers` subresource. `config/rbac/role.yaml` and `install.yaml` both
carry that rule:

```yaml
- apiGroups: [shipping.patterncatalyst.io]
  resources: [shippingpolicies/finalizers]
  verbs: [update]
```

Without it the first reconcile fails with `cannot set blockOwnerDeletion if
an ownerReference refers to a resource you can't set finalizers on`, visible
in `oc logs deploy/shipping-policy-operator -n patterns`.

## Verification run

```
$ go build ./...
$ go vet ./...
$ export KUBEBUILDER_ASSETS="$(go run sigs.k8s.io/controller-runtime/tools/setup-envtest@release-0.25 use 1.34.1 -p path)"
$ go test ./... -v
=== RUN   TestReconcile_CreatesDeploymentAndConfigMap
--- PASS: TestReconcile_CreatesDeploymentAndConfigMap
=== RUN   TestReconcile_StatusReadyOnceReplicasMatch
--- PASS: TestReconcile_StatusReadyOnceReplicasMatch
=== RUN   TestReconcile_IsIdempotent
--- PASS: TestReconcile_IsIdempotent
=== RUN   TestEnvtest_ReconcileAgainstRealAPIServer
--- PASS: TestEnvtest_ReconcileAgainstRealAPIServer
PASS
```

Three tests run against the controller-runtime **fake client**
(`sigs.k8s.io/controller-runtime/pkg/client/fake`): object creation and
shape, the Ready condition tracking observed-vs-desired replicas across two
reconciles, and idempotency (a second reconcile with no spec change leaves
the Deployment's generation untouched). A fourth runs against a real
**envtest** control plane (etcd + kube-apiserver, no kubelet) to prove the
generated CRD's own OpenAPI validation rejects a `ShippingPolicy` missing
`carrier`. Without `KUBEBUILDER_ASSETS` set, the envtest-backed test skips
itself and the three fake-client tests still pass.

## Regenerating code and manifests

```bash
controller-gen object paths=./api/...                                  # zz_generated.deepcopy.go
controller-gen crd paths=./api/... output:crd:artifacts:config=config/crd/bases
controller-gen rbac:roleName=shipping-policy-operator paths=./... output:rbac:artifacts:config=config/rbac
```

`controller-gen rbac` always emits a `ClusterRole`; `config/rbac/role.yaml`
is hand-edited afterward from `ClusterRole` to a namespaced `Role` in
`patterns`, since this operator only reconciles objects in that one
namespace. Re-apply that namespace edit after regenerating.

## Build, push, deploy, try, cleanup

Everything below targets the `patterns` namespace and the CRC integrated
registry (see `examples/appendix-patterns/README.md` for creating the
namespace and enabling the registry's default route).

### Build and push the operator image

The manager binary is compiled on the host (Go required), then packaged into
a `ubi10/ubi-micro` image and pushed to the integrated registry:

```bash
cd examples/appendix-patterns/operator
CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o manager ./cmd
podman build -t shipping-policy-operator:v1 -f Containerfile .

REG=default-route-openshift-image-registry.apps-crc.testing
podman login -u kubeadmin -p "$(oc whoami -t)" "$REG" --tls-verify=false
podman tag shipping-policy-operator:v1 "$REG/patterns/shipping-policy-operator:v1"
podman push "$REG/patterns/shipping-policy-operator:v1" --tls-verify=false
```

Build `shipping-service` itself with the appendix's `scripts/build-and-push.sh`
if its imagestream isn't already present in `patterns`.

### Deploy

The operator's child Deployment points `shipping-service` at the shared
Postgres and uses the `patterns-high-priority` PriorityClass:

```bash
cd examples/appendix-patterns
oc apply -f predictable-demands/01-priorityclass.yaml
oc apply -f controller/00-postgres.yaml
oc rollout status deploy/patterns-postgres -n patterns

cd operator
oc apply -f install.yaml
oc wait --for=condition=Available deployment/shipping-policy-operator -n patterns --timeout=120s
```

### Try it

```bash
oc apply -f config/samples/shipping_v1alpha1_shippingpolicy.yaml
oc get shippingpolicy -n patterns
oc wait --for=condition=Ready shippingpolicy/ground-standard -n patterns --timeout=180s
oc get deployment ground-standard -n patterns
oc get configmap ground-standard -n patterns -o jsonpath='{.data}'
```

Patch the policy's `replicas` and the child Deployment follows without the
operator restarting; scale the child Deployment directly and the operator
reverts it:

```bash
oc patch shippingpolicy ground-standard -n patterns --type=merge -p '{"spec":{"replicas":5}}'
oc get deployment ground-standard -n patterns -o jsonpath='{.spec.replicas}'
oc scale deployment/ground-standard -n patterns --replicas=1
sleep 6; oc get deployment ground-standard -n patterns -o jsonpath='{.spec.replicas}'   # back to 5
```

Delete the `ShippingPolicy` and both children disappear through their owner
references, with no finalizer delay:

```bash
oc delete shippingpolicy ground-standard -n patterns
oc get deployment,configmap -n patterns -l shipping.patterncatalyst.io/policy=ground-standard
```

### Cleanup

```bash
oc delete -f install.yaml --ignore-not-found
oc delete -f ../controller/00-postgres.yaml -n patterns --ignore-not-found
oc delete priorityclass patterns-high-priority --ignore-not-found
```
