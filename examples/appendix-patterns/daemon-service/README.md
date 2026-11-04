# Daemon Service

Runnable example for the [Daemon Service chapter](https://patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns/12-daemon-service/).

A `node-collector` DaemonSet runs one Pod per node (one on single-node CRC),
mounts the node's `/var/log` read-only via `hostPath`, and logs a per-node
summary. No service images needed.

## The two OpenShift access layers

Reading a node's filesystem takes more than a `hostPath` volume on OpenShift:

1. `restricted-v2` forbids `hostPath` volumes outright.
2. Even with a host mount, `/var/log/pods` is `root:root` and SELinux-labeled
   `var_log_t`, which an ordinary container type can't read.

So `node-collector` runs under its own ServiceAccount bound to the `privileged`
SCC, as UID 0 with the `spc_t` SELinux type, the same way OpenShift's own
cluster log collector runs. The grant is scoped to this daemon's SA, not the
namespace.

## Run it

```bash
cd examples/appendix-patterns/daemon-service
oc apply -f 00-daemonset.yaml
oc rollout status daemonset/node-collector -n patterns --timeout=60s
oc get daemonset node-collector -n patterns      # DESIRED/CURRENT/READY = 1 (one node)
```

Confirm the admitting SCC and that the collector reads the node's logs:

```bash
POD=$(oc get pod -n patterns -l app.kubernetes.io/name=node-collector -o jsonpath='{.items[0].metadata.name}')
oc get pod "$POD" -n patterns -o jsonpath='{.metadata.annotations.openshift\.io/scc}{"\n"}'   # privileged
oc logs "$POD" -n patterns --tail=2    # node=crc pod-log-dirs=<N>
```

If you remove the `privileged` grant and `spc_t` and fall back to
`hostmount-anyuid`, the Pod still starts but reads `pod-log-dirs=0`, SELinux
blocking the read. That contrast is the chapter's point.

## Cleanup

```bash
oc delete -f 00-daemonset.yaml -n patterns
```
