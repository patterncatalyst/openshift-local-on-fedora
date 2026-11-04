---
title: "Operator"
order: 25
part: "Advanced"
description: "A CRD and a controller together, packaging an application's own operational knowledge as an OpenShift API: the ShippingPolicy operator, built from scratch in Go with controller-runtime and run under restricted-v2."
duration: "35 min"
---

## Learning objectives

By the end of this chapter you can:

- Define a CustomResourceDefinition's spec and status, and explain what `+kubebuilder` markers generate from them
- Explain precisely what turns a controller into an Operator, and what doesn't
- Trace a `ShippingPolicy` object from `oc apply` through reconciliation to a running Deployment and ConfigMap
- State what OLM and OperatorHub add on top of an operator's own code, and the RBAC OpenShift requires that an upstream cluster does not

## Why this matters

The Controller chapter established the loop: watch, observe, diff, act, running identically whether the watched kind ships with OpenShift or was invented for this project. `ShippingPolicy`, the custom resource that controller reconciles, is where the other half of the Operator pattern lives, the half the Controller chapter never needed to cover: the API itself. A controller needs something to watch. An Operator is the combination of a controller and a CRD that gives it something to watch that didn't exist in OpenShift before this project defined it, a first-class API object with its own schema, validation, and `oc get` support, standing in for operational knowledge about `shipping-service` that would otherwise live in a README, a runbook, or a senior engineer's memory.

That distinction, controller versus Operator, is easy to state and easy to blur in practice, so this chapter draws it as precisely as the code allows. `ShippingPolicyReconciler`'s reconcile loop is identical in shape to the ReplicaSet controller's, covered already. What makes the whole system an Operator rather than just a controller is `ShippingPolicy` itself: a `CustomResourceDefinition` registering a new API group (`shipping.patterncatalyst.io`), a new kind (`ShippingPolicy`), a validated schema (`carrier` is required and non-empty, `replicas` can't be negative), and a status subresource the reconciler writes to independently of the spec a human wrote. None of that existed in OpenShift before this chapter's CRD registered it. The controller is the half that acts; the CRD is the half that gives a fulfillment team's own domain concept, "a shipping policy for one carrier lane," a real, typed, validated place to live in the cluster's own API, reachable by every tool that already talks to that API: `oc get shippingpolicy`, `oc describe`, RBAC scoped to the `shippingpolicies` resource, all at no extra cost the moment the CRD is registered.

## The CRD: a new kind, typed and validated

`ShippingPolicySpec` is a plain Go struct with `+kubebuilder` markers controlling what the generated OpenAPI schema enforces:

```go
type ShippingPolicySpec struct {
	// +kubebuilder:validation:Required
	// +kubebuilder:validation:MinLength=1
	Carrier string `json:"carrier"`

	// +kubebuilder:validation:Required
	// +kubebuilder:validation:Minimum=1
	MaxTransitDays int `json:"maxTransitDays"`

	// +kubebuilder:validation:Required
	// +kubebuilder:validation:Minimum=0
	Replicas int32 `json:"replicas"`

	// +optional
	PriorityClassName string `json:"priorityClassName,omitempty"`
}
```

`controller-gen`, the code generator `kubebuilder`-style projects use, turns these markers into a real `CustomResourceDefinition` manifest with a full OpenAPI v3 schema: `carrier` becomes a required string with `minLength: 1`, `maxTransitDays` a required integer with `minimum: 1`, and so on. That schema is enforced by the API server itself, on every `create` and `update`, before a `ShippingPolicy` object is ever persisted, let alone reconciled: `oc apply` a `ShippingPolicy` with an empty `carrier` and the API server rejects it outright with a validation error naming the exact field, the same category of protection a Deployment's own schema already gives a malformed `replicas` field, now extended to a type this project invented. This is the one guarantee a fake client in a unit test cannot make, since a fake client never runs the API server's schema validation; this appendix's own test suite covers it with a real `envtest` control plane specifically to prove the rejection happens where it's supposed to, against a real API server rather than an in-memory stand-in.

`ShippingPolicyStatus` is the second half of the CRD, and it's where the pattern's "status reflects observed state, spec reflects desired state" discipline lives:

```go
type ShippingPolicyStatus struct {
	// +optional
	ObservedReplicas int32 `json:"observedReplicas,omitempty"`

	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}
```

`+kubebuilder:subresource:status` on the `ShippingPolicy` type splits `spec` and `status` into fully separate API subresources, which does more than organize the YAML: a client with write access to `shippingpolicies` but not `shippingpolicies/status` can create and edit the spec but can never forge the status, the same separation of concerns RBAC already relies on for a Deployment's own `status.replicas`. `ShippingPolicyReconciler` is the only writer of `status.observedReplicas` and the `Ready` condition precisely because the RBAC in `config/rbac/role.yaml` grants the operator's own `ServiceAccount` write access to that subresource and nothing else does.

## Reconciling: spec to real objects

`Reconcile` turns a `ShippingPolicy` into exactly two owned objects, a Deployment and a ConfigMap, both named after the policy itself:

```go
func (r *ShippingPolicyReconciler) reconcileDeployment(ctx context.Context, policy *v1alpha1.ShippingPolicy) (int32, error) {
	deploy := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{
		Name: policy.Name, Namespace: policy.Namespace,
	}}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, deploy, func() error {
		deploy.Spec.Replicas = &policy.Spec.Replicas
		deploy.Spec.Template.Spec.PriorityClassName = policy.Spec.PriorityClassName
		// ... container spec, env, resources, probes, restricted-v2 securityContext ...
		return controllerutil.SetControllerReference(policy, deploy, r.Scheme)
	})
	...
}
```

Every field the Deployment needs traces back to the `ShippingPolicy`'s own spec: `replicas` sets the Deployment's `spec.replicas` one-to-one, `priorityClassName` flows straight through to the Pod template, the same `PriorityClass` mechanism Predictable Demands covers for a hand-written Deployment, now set by a controller instead of a human. The reconciler also stamps the child Pod with the restricted-v2 shape every other chapter's example carries by hand (`runAsNonRoot`, `allowPrivilegeEscalation: false`, all capabilities dropped, the `RuntimeDefault` seccomp profile), so a policy-generated Deployment is admitted under the default SCC exactly like a hand-written one. The ConfigMap carries the policy's own data, `carrier` and `maxTransitDays`, mounted into the running container via `envFrom`, so `shipping-service`'s own process can read back the policy governing it.

`controllerutil.SetControllerReference` is called on both children, which makes `ShippingPolicy` the garbage-collection root for everything it owns: delete the `ShippingPolicy` and the API server's own garbage collector, not `ShippingPolicyReconciler`'s code, removes the Deployment and ConfigMap automatically, with no finalizer in this operator at all. That absence is a design choice: a finalizer exists to block deletion until a controller releases something external to the cluster, and `ShippingPolicy`'s two owned objects are both ordinary in-cluster objects the built-in garbage collector already cleans up correctly. Adding a finalizer here would introduce a real failure mode (an object stuck in `Terminating` if the finalizer's removal logic ever errors) in exchange for nothing.

Status comes last, reading the Deployment's own observed state back rather than assuming the write just issued already took effect:

```go
var current appsv1.Deployment
r.Get(ctx, types.NamespacedName{Name: policy.Name, Namespace: policy.Namespace}, &current)
policy.Status.ObservedReplicas = current.Status.Replicas
```

`status.replicas` on a freshly created Deployment often still reads its *previous* value, or zero, until the Deployment controller and the ReplicaSet controller underneath it have both run and the kubelet has actually started the resulting Pods; `ShippingPolicy`'s own `Ready` condition stays `False`, with a `ReplicasReconciling` reason, for exactly that gap, flipping to `True` only once a later reconcile observes `ObservedReplicas` matching `spec.replicas`. On this cluster that convergence is quick: `oc get shippingpolicy` prints `READY True` with `OBSERVED 3` within a few seconds of applying the sample.

![A ShippingPolicy custom resource watched by the operator's Reconcile loop, which owns a child Deployment and ConfigMap, creating and updating both from the spec and reading the Deployment's own status.replicas back into the ShippingPolicy's status conditions]({{ "/assets/diagrams/appendix-25-operator.svg" | relative_url }})
*The CRD gives the fulfillment domain's own concept, a shipping policy, a real place in the API; the reconciler is what keeps it true.*

## The RBAC OpenShift requires that minikube does not

The one place this operator needs a rule its minikube sibling can omit is the owner-reference permission check. OpenShift enables the `OwnerReferencesPermissionEnforcement` admission plugin by default; most upstream clusters leave it off. With it on, a controller may only set `blockOwnerDeletion` on an owned object's owner reference (which `controllerutil.SetControllerReference` does by default) if it holds `update` on the owner's `finalizers` subresource. Without that rule, the very first reconcile fails with a message that names the exact cause:

```
configmaps "ground-standard" is forbidden: cannot set blockOwnerDeletion
if an ownerReference refers to a resource you can't set finalizers on
```

The fix is one rule in the operator's `Role`, generated from one `+kubebuilder:rbac` marker:

```go
// +kubebuilder:rbac:groups=shipping.patterncatalyst.io,resources=shippingpolicies/finalizers,verbs=update
```

This is a representative lesson for porting any controller to OpenShift: the reconciler logic is portable unchanged, but OpenShift's admission layer is stricter, and the gap shows up as an RBAC denial on first run rather than a code bug. `oc logs` on the operator Pod names the missing permission directly, which is where a stuck operator's diagnosis starts.

## Building and verifying it like real Go, because it is

Everything here is ordinary `controller-runtime`, which means it's ordinary Go, testable with ordinary Go tools. `shipping-policy-operator`'s own test suite proves the reconciler two ways: three tests against `controller-runtime`'s fake client, an in-memory object tracker with no API server behind it, asserting the Deployment and ConfigMap come out shaped correctly, that a second reconcile with no spec change is a true no-op (confirmed by checking the Deployment's `generation` is unchanged, not just that the test didn't error), and that the `Ready` condition tracks the gap between desired and observed replicas across two reconciles. A fourth test runs the identical reconcile against `envtest`, a real `etcd` and `kube-apiserver` pair with no kubelet, to prove the one thing a fake client structurally cannot: that the generated CRD's own schema validation rejects a `ShippingPolicy` with no `carrier` before the reconciler ever sees it. All four run green with no cluster running anywhere, in seconds, which is the difference between catching a reconciler bug in CI and catching it in production.

Only the container build and the live deploy touch a cluster. The manager binary is compiled on the host as a static, CGO-free executable, then copied into a `ubi10/ubi-micro` runtime image that carries nothing else, no shell and no package manager, built and pushed to the integrated registry the same way every service image in this appendix is. The operator's own Deployment runs under restricted-v2 like everything else: non-root, no privilege escalation, a read-only root filesystem, every capability dropped.

## What an Operator is not: OLM and OperatorHub

Nothing in this chapter installs this operator through the Operator Lifecycle Manager, and that's worth being explicit about rather than silent on. OLM is a separate layer: it manages an operator's own install, upgrade, and dependency lifecycle as a packaged artifact (a `ClusterServiceVersion` plus a `Subscription` to a channel in a catalog), and it's the mechanism behind OperatorHub's one-click installs that OpenShift ships enabled out of the box. The Elastic Scale chapter uses exactly that path to install the Custom Metrics Autoscaler. `shipping-policy-operator` here is deployed the plainer way, a `CustomResourceDefinition`, a `Role`/`RoleBinding`/`ServiceAccount`, and a Deployment, applied directly with `oc apply -f install.yaml`, no different in mechanism from any other workload in this appendix. That's a legitimate, complete way to run an operator, and it's also the layer OLM exists to add structure on top of once an operator needs versioned upgrades, a dependency graph against other operators, or a one-click install for cluster administrators who never want to read this chapter's `install.yaml` at all. Building and publishing that packaging layer (a bundle image and a catalog) is out of scope here; understanding that it exists, that OpenShift is where it runs by default, and what problem it solves that a flat manifest doesn't, is the exam-relevant half.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure applications for reliability (extend the cluster API with CRDs and operators; scope RBAC correctly)
> **Competency:** Understand a CRD-based operator packaging operational knowledge as an OpenShift API, including the finalizers RBAC the OwnerReferencesPermissionEnforcement plugin requires
> **Drill:** `oc get shippingpolicy ground-standard -n patterns -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'`

> **🤖 Explore with your agent**
>
> "Add a new required field, destinationRegion, to ShippingPolicySpec, regenerate the CRD, apply an existing ShippingPolicy that doesn't set it, and show me the exact API-server validation error that results."

## Cleanup

```bash
oc delete -f operator/config/samples/shipping_v1alpha1_shippingpolicy.yaml --ignore-not-found
oc delete -f operator/install.yaml --ignore-not-found
oc delete -n patterns -f controller/00-postgres.yaml --ignore-not-found
oc delete priorityclass patterns-high-priority --ignore-not-found
```

## Verification: examples/appendix-patterns/operator/

The runnable example is the operator itself: `go build ./...`, `go vet ./...`, and `go test ./...` all run green, covering both the controller-runtime fake-client suite and an envtest-backed test proving the generated CRD's own schema validation (all four tests confirmed passing on this machine). Deploying it live applies the generated CRD, RBAC (including the OpenShift finalizers rule), and the operator's own Deployment, then a sample `ShippingPolicy` whose `Ready` condition flips `True` once its child Deployment's observed replicas match the spec (confirmed: `READY True`, `OBSERVED 3`). Full build, push, deploy, and try walkthrough in `examples/appendix-patterns/operator/README.md`.
