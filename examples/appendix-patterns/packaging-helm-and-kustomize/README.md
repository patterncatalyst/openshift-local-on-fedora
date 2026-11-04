# Packaging: Helm and Kustomize

Runnable example for the [Packaging chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/31-packaging-helm-and-kustomize/).

The same `shipping-service` deployed two ways: a Helm chart (`chart/`) with a
tracked release, and a Kustomize base (`kustomize/base`) patched by `dev` and
`prod` overlays. `oc` has Kustomize built in; `helm` is a separate binary.

## Postgres first

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
```

## Helm: install, upgrade, rollback

```bash
helm lint ./chart
helm install shipping-helm ./chart --namespace patterns
oc rollout status deploy/shipping-helm -n patterns
helm list -n patterns

helm upgrade shipping-helm ./chart --namespace patterns --set replicaCount=2   # -> revision 2
helm history shipping-helm -n patterns
oc get deploy shipping-helm -n patterns -o jsonpath='{.spec.replicas}{"\n"}'    # 2

helm rollback shipping-helm 1 -n patterns
oc get deploy shipping-helm -n patterns -o jsonpath='{.spec.replicas}{"\n"}'    # 1
```

## Kustomize: base + overlays

```bash
oc kustomize kustomize/overlays/dev                       # render only, no cluster
oc apply -n patterns -k kustomize/overlays/dev
oc get deploy shipping-kustomize -n patterns -o jsonpath='{.spec.replicas}{"\n"}'   # 1

oc diff -n patterns -k kustomize/overlays/prod            # preview the change
oc apply -n patterns -k kustomize/overlays/prod
oc get deploy shipping-kustomize -n patterns -o jsonpath='{.spec.replicas}{"\n"}'   # 2
```

## Cleanup

```bash
helm uninstall shipping-helm -n patterns
oc delete -n patterns -k kustomize/overlays/prod
oc delete -n patterns -f 00-postgres.yaml --ignore-not-found
```
