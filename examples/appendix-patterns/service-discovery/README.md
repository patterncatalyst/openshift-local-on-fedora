# Service Discovery

Runnable example for the [Service Discovery chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/16-service-discovery/).

One `shipping-service` backend, fronted every way on OpenShift: `ClusterIP`
(CoreDNS), `NodePort`, `LoadBalancer` (pending on CRC), a `Route` (the native
external path), and an `Ingress` that OpenShift turns into a Route.

## Run it

```bash
oc apply -f 00-postgres.yaml && oc rollout status deploy/patterns-postgres -n patterns
oc apply -f 01-deployment.yaml -f 02-clusterip.yaml -f 03-nodeport.yaml \
  -f 04-loadbalancer.yaml -f 05-route.yaml -f 06-ingress.yaml
oc rollout status deploy/shipping-service -n patterns
```

Service types, DNS, EndpointSlice:

```bash
oc get svc -n patterns shipping-service shipping-nodeport shipping-lb   # LB EXTERNAL-IP <pending>
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=shipping-service -o jsonpath='{.items[0].metadata.name}')
oc exec -n patterns "$POD" -- getent hosts shipping-service.patterns.svc.cluster.local   # -> ClusterIP
oc get endpointslices -n patterns -l kubernetes.io/service-name=shipping-service \
  -o jsonpath='{range .items[*]}{.endpoints[*].addresses}{"\n"}{end}'                     # 2 ready
```

Route (external) and the Route the Ingress became:

```bash
RH=$(oc get route shipping-route -n patterns -o jsonpath='{.spec.host}')
curl -sk -o /dev/null -w '%{http_code}\n' "https://$RH/health"    # 200
oc get route -n patterns    # shipping-route + shipping-ingress-<hash> (auto-created from the Ingress)
```

## Cleanup

```bash
oc delete -f 06-ingress.yaml -f 05-route.yaml -f 04-loadbalancer.yaml \
  -f 03-nodeport.yaml -f 02-clusterip.yaml -f 01-deployment.yaml -f 00-postgres.yaml -n patterns
```
