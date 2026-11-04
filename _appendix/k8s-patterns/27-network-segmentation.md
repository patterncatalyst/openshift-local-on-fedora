---
title: "Network Segmentation"
order: 27
part: "Security"
description: "Deny all ingress to a service by default, allow only the one caller that legitimately needs it, and restrict egress to the destinations a workload talks to, with NetworkPolicy on OpenShift's OVN-Kubernetes."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Explain why every Pod in a cluster can reach every other Pod by default, and why that default is what NetworkPolicy exists to change
- Write a default-deny `NetworkPolicy` scoped to one workload's Pods, rather than an entire namespace
- Allow ingress from one specific Pod selector while leaving every other source denied
- Restrict a workload's egress to the destinations it needs (OpenShift DNS, its own database) and explain what a NetworkPolicy's selectors do and don't guarantee

## Why this matters

A freshly created cluster has no network segmentation: any Pod can open a connection to any other Pod's IP and port, across every namespace, with nothing in the network layer checking whether that connection should be allowed. That flat network is convenient right up until one workload is compromised, at which point it's also the reason a single vulnerable container can reach every database, every internal API, and every other service without escalating privileges or moving laterally through anything more sophisticated than a TCP connection. Network Segmentation is the pattern for closing that gap: a `NetworkPolicy` that tells the cluster's network layer which connections are allowed, with everything else denied by default once any policy selects a given Pod.

The "once any policy selects a given Pod" clause is the part worth sitting with. A `NetworkPolicy` is additive and Pod-scoped, not a cluster-wide switch: a Pod with no policy selecting it is still fully open, and a Pod that becomes the target of even one policy's `podSelector` flips to deny-by-default for whichever direction (ingress, egress, or both) that policy's `policyTypes` names, with only the rules that policy (and any other policy also selecting it) explicitly allow surviving. That's why this chapter writes a default-deny policy for `inventory-service`'s Pods and a separate one for `payment-service`'s Pods, rather than one sweeping policy with an empty `podSelector` that would deny-by-default for every Pod in `patterns` at once, including Postgres.

`inventory-service`, `payment-service`, and `graphql-gateway` are the worked example. `graphql-gateway` is the legitimate caller: it federates reads by calling `inventory-service` over gRPC, so this chapter's allow rule protects a connection the gateway actually makes. `payment-service` has no legitimate caller in this codebase, which makes it the cleanest case for a service that should be fully isolated by default.

## The CNI: enforced out of the box on OpenShift

NetworkPolicy is an API object, but enforcing it is the job of the cluster's Container Network Interface (CNI) plugin. This is where OpenShift differs sharply from the minikube sibling: minikube's default CNI doesn't implement NetworkPolicy at all (applying a policy succeeds but changes nothing, a silent no-op), so the minikube version of this chapter has to recreate the cluster with Calico first. OpenShift's default CNI is **OVN-Kubernetes**, which enforces NetworkPolicy natively. There's nothing to install and no prerequisite step: a policy applied on CRC takes effect immediately.

```console
$ oc get network.config/cluster -o jsonpath='{.spec.networkType}'
OVNKubernetes
```

## Starting point: everything open

Before any policy exists, a test client in the same namespace reaches both services without restriction, worth confirming explicitly rather than assuming: it's the baseline the policies change, and the first thing to re-check if a policy later appears not to work.

```console
$ oc exec -n patterns netseg-test-client -- curl -s -o /dev/null -w '%{http_code}\n' -m 4 http://payment-service:80/healthz
200
$ oc exec -n patterns netseg-test-client -- curl -s -o /dev/null -w '%{http_code}\n' -m 4 http://inventory-service:8080/healthz
200
```

## Default-deny, scoped to one workload

A `NetworkPolicy` with no `ingress` rules denies every inbound connection to the Pods it selects, once `policyTypes` includes `Ingress`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-inventory
  namespace: patterns
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: inventory-service
  policyTypes:
    - Ingress
```

`podSelector` keeps this scoped: only Pods labeled `app.kubernetes.io/name: inventory-service` are affected. Postgres, `payment-service`, `graphql-gateway`, and every other Pod in `patterns` are untouched. `payment-service` gets the identical treatment in its own policy, and because nothing grants it an allow rule afterward, that one policy is its entire story: fully isolated until a real caller exists. With both applied, the test client times out against both:

```console
$ oc exec -n patterns netseg-test-client -- curl -s -o /dev/null -m 4 http://payment-service:80/healthz; echo "exit=$?"
exit=28      # 28 = timeout, blocked
```

## Allowing exactly one caller

`inventory-service` has a legitimate caller, so its isolation needs one hole punched in it, scoped as tightly as the caller it's for:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-inventory
  namespace: patterns
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: inventory-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: graphql-gateway
      ports:
        - protocol: TCP
          port: 50051
```

Two policies selecting the same Pods combine additively: a connection is allowed if any applicable policy permits it, so `deny-all-inventory`'s empty rule list and this one rule aren't a contradiction, they're deny-by-default plus one explicit exception, the shape every default-deny firewall takes. The `ports` field narrows it further: only port 50051, the gRPC port, not `inventory-service`'s REST port 8080. A short-lived probe Pod labeled to match the gateway's selector proves it, while the unlabeled test client stays denied:

```console
$ oc exec -n patterns netseg-probe-gateway -- curl -s -o /dev/null -m 4 inventory-service:50051; echo "exit=$?"
exit=1       # connected (curl speaks HTTP to a gRPC port and errors, but the TCP path opened)
$ oc exec -n patterns netseg-test-client -- curl -s -o /dev/null -m 4 inventory-service:50051; echo "exit=$?"
exit=28      # timeout, still blocked
```

![inventory-service denies all ingress by default; graphql-gateway is the one allowed caller on the gRPC port; payment-service has no allow rule at all]({{ "/assets/diagrams/appendix-27-network-segmentation.svg" | relative_url }})
*A test client's connection attempts are denied against both services; graphql-gateway's gRPC call to inventory-service is the one path an explicit rule opens.*

## A selector match, not an identity check

Worth being precise about, because it's a frequent source of false confidence: `podSelector` matches on a Pod's **labels** and nothing more. It says nothing about what process runs inside a Pod carrying that label, what `ServiceAccount` it uses, or whether it's cryptographically anything in particular. A Pod that happens to carry `app.kubernetes.io/name: graphql-gateway` satisfies the allow rule's selector whether or not it's running the gateway's code, which is exactly how this chapter verifies the rule: a short-lived probe Pod, labeled to match, proves the selector math without the gateway's own container (which has no `curl`) making the test.

That same fact is a caution in the other direction: this probe Pod, for as long as it exists, also satisfies `graphql-gateway`'s **Service** selector (the same label), briefly becoming an endpoint of that Service too. `NetworkPolicy` selectors and `Service` selectors are evaluated independently, with no linkage; reusing the identical label for both is convenient and is also how a test Pod can accidentally join a Service's real traffic rotation. This example's probe Pod is deleted immediately after its one check; in a cluster carrying real traffic through the gateway's Service, a Service selector built from a label combination a test Pod won't reproduce by accident is the safer default.

## Restricting egress, and the OpenShift DNS difference

Everything so far restricts who can call *in*. Egress works the same mechanism pointed the other way, and it matters for a different reason: a compromised container's most common next move is an outbound connection, to exfiltrate data or reach a command-and-control endpoint. `inventory-service` legitimately needs two egress destinations: DNS and its own Postgres.

This is the second place OpenShift differs from the minikube sibling. minikube's DNS runs as `kube-dns` on port 53; OpenShift runs CoreDNS as the `openshift-dns` DaemonSet, listening on port **5353**, in the `openshift-dns` namespace. The egress rule has to target that:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: inventory-egress-restricted
  namespace: patterns
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: inventory-service
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: openshift-dns
          podSelector:
            matchLabels:
              dns.operator.openshift.io/daemonset-dns: default
      ports:
        - protocol: UDP
          port: 5353
        - protocol: TCP
          port: 5353
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: patterns-postgres
      ports:
        - protocol: TCP
          port: 5432
```

Once `policyTypes` includes `Egress`, `inventory-service`'s Pods lose every other outbound path by default. The cleanest proof the restriction is compatible with the workload, rather than taking it on faith, is the workload's own readiness: `/healthz` depends on reaching Postgres, so an `oc rollout restart` and the Pod reaching `Ready` again confirms the two allowed paths are the two the service needs. Reaching anything else is blocked:

```console
$ oc rollout status deploy/inventory-service -n patterns      # Ready again under the restriction
$ oc exec -n patterns "$POD" -c inventory-service -- curl -s -o /dev/null -m 4 https://example.com; echo "exit=$?"
exit=28      # public internet blocked
```

Getting the DNS target wrong is the most common way this policy half-works: point it at `kube-dns` on 53 (the minikube shape) and `inventory-service` can reach Postgres by IP but can't resolve its DNS name, so the Pod never goes `Ready` and the failure looks like a database problem rather than a DNS one.

## Combining podSelector and namespaceSelector

`allow-gateway-to-inventory`'s `from` entry names only a `podSelector`, which matches the gateway's Pods regardless of namespace (invisible here with one namespace, but it matters the moment a cluster has more than one). A single `from` entry can name both a `podSelector` and a `namespaceSelector`, and when it does the two combine with AND: a source has to match both the namespace label and the Pod label.

```yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            team: checkout
        podSelector:
          matchLabels:
            app.kubernetes.io/name: graphql-gateway
```

Listing the same two selectors as two separate items in the `from` array instead changes the meaning from AND to OR: either alone would then match, a much broader rule than most authors intend. The egress DNS rule above relies on exactly the AND form, one `to` entry naming both the `openshift-dns` namespace and the DNS Pod label, so it matches the DNS Pods and nothing else.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Configure networking for applications (control traffic with NetworkPolicy)
> **Competency:** Write a default-deny NetworkPolicy scoped to a workload, allow one caller by podSelector and port, and restrict egress to named destinations including OpenShift DNS
> **Drill:** `oc exec -n patterns netseg-test-client -- curl -m 3 payment-service:80` (expect a timeout, confirming payment-service has no allow rule)

> **🤖 Explore with your agent**
>
> "Add a namespaceSelector to allow-gateway-to-inventory so graphql-gateway could also be called from a namespace labeled team: checkout, apply it, and show me the ingress rule combining both the podSelector and the namespaceSelector correctly (both must match, not either)."

## Cleanup

```bash
oc delete pod netseg-probe-gateway -n patterns --ignore-not-found
oc delete -n patterns -f network-segmentation/08-test-client.yaml -f network-segmentation/07-egress-inventory-restricted.yaml \
  -f network-segmentation/06-deny-all-payment.yaml -f network-segmentation/05-allow-gateway-to-inventory.yaml \
  -f network-segmentation/04-deny-all-inventory.yaml -f network-segmentation/03-graphql-gateway.yaml \
  -f network-segmentation/02-payment-service.yaml -f network-segmentation/01-inventory-service.yaml \
  -f network-segmentation/00-postgres.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/network-segmentation/

The runnable example deploys `inventory-service`, `payment-service`, and `graphql-gateway`, confirms a test client reaches both protected services before any policy (200/200), applies default-deny policies scoped to each (both now time out), applies the gateway-only allow rule and proves it with a labeled probe Pod (connected) while the test client stays denied, then applies the egress restriction and confirms `inventory-service` stays `Ready` (DNS 5353 + Postgres 5432 reachable) while public egress is blocked. All confirmed on CRC's OVN-Kubernetes with no Calico step. Full walkthrough in `examples/appendix-patterns/network-segmentation/README.md`.
