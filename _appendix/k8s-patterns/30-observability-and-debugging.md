---
title: "Observability and Debugging"
order: 30
part: "Operations"
description: "oc's windows into a running Pod: logs (-p, -c, -f), exec, port-forward, describe, get events, and the two debuggers OpenShift gives you, oc debug's pod copy and kubectl debug's ephemeral container under restricted-v2."
duration: "25 min"
---

## Learning objectives

By the end of this chapter you can:

- Read a container's logs with `oc logs`, including a previous crashed instance (`-p`), a specific container (`-c`), and a live stream (`-f`)
- Run a command inside a running container with `oc exec`, and reach a Pod's port directly with `oc port-forward`
- Read `oc describe pod` and `oc get events` to reconstruct what the control plane did to a Pod
- Choose between the two debuggers OpenShift offers: `oc debug`'s pod copy and a `kubectl debug` ephemeral container, and explain why restricted-v2 shapes that choice

## Why this matters

A Kubernetes Pattern tells you how to build something correctly. None of them tell you what to do when a correctly built thing still misbehaves: a readiness probe that passes locally but fails on the cluster, a process that logs a stack trace once and never again, a connection that times out for reasons neither the application nor the manifest explains. That's a different skill from the one the pattern chapters teach, and it's the one an on-call engineer actually reaches for.

Almost every observability problem reduces to one of five questions: what did this container print, what does its filesystem and process table look like right now, can I reach this Pod's port directly, what did the scheduler and kubelet decide and when, and (when the running image doesn't carry the tools to answer any of that) how do I get a debugging tool into a Pod without rebuilding it. `oc logs`, `oc exec`, `oc port-forward`, `oc describe` / `oc get events`, and OpenShift's two debuggers answer those five in order, worked here against `shipping-service`. The example also adds a trivial second container, `heartbeat`, so `oc logs -c` and `oc exec -c` have a real second container to pick between.

## Logs: plain, by container, following, and after a crash

The baseline command reads whatever a container has written to stdout and stderr: OpenShift never reads a container's log files, only the stream the container runtime captures from those two descriptors.

```bash
oc logs -n patterns "$POD" -c heartbeat --tail=2
```

Here's the first small difference from upstream `kubectl`: on a multi-container Pod, `kubectl logs` with no `-c` refuses and makes you choose. `oc logs` instead defaults to the first container and tells you it did:

```console
$ oc logs -n patterns "$POD"
Defaulted container "shipping-service" out of: shipping-service, heartbeat
...
```

Convenient, but read that first line: it's easy to think you're looking at the container you meant when `oc` quietly picked another. `-f` turns the command into a live stream; `--since=20s` limits how far back the initial read goes before following, which matters on a container that's been running for hours.

`-p` (`--previous`) reads the log of the instance that just terminated, not the one running now. This only makes sense immediately after a restart, because the kubelet keeps exactly one previous instance's logs, not a history. The cleanest way to force a restart on OpenShift (killing PID 1 from inside is blocked by the kernel's init protection) is to make a liveness probe fail:

```bash
oc set probe deployment/shipping-service -n patterns --liveness \
  --get-url=http://:8080/nonexistent --period-seconds=5 --failure-threshold=2
# wait for RESTARTS to climb, then:
oc logs -n patterns "$POD" -c shipping-service --previous
oc set probe deployment/shipping-service -n patterns --liveness --remove   # revert
```

A Pod showing a `RESTARTS` count above zero in `oc get pod` is the signal to reach for `--previous` first: it's the only way to see what the dead instance printed on its way out, and once a second restart happens the first instance's logs are gone.

## exec and port-forward

`oc exec` runs a command inside an already-running container, through the same mechanism the runtime uses to start the container's own process, a second time in the same namespaces:

```bash
oc exec -n patterns "$POD" -c shipping-service -- env | grep SERVICE_SCHEMA
```

There's no SSH daemon anywhere, and that's a design property: a container never needs to accept inbound connections to be debuggable, because `exec` is proxied through the kubelet and API server under the same RBAC that gates every other `oc` verb. A user with `exec` on a Pod can run arbitrary commands in it, which is worth remembering when scoping the Roles the Access Control chapter covers.

`oc port-forward` opens a tunnel straight to one Pod's port, bypassing the Service layer:

```bash
oc port-forward -n patterns "$POD" 18080:8080 &
curl -s http://127.0.0.1:18080/healthz      # 200
```

One caution, because this tutorial is otherwise strict about it: `port-forward` is a debugging and development tool, not a way to expose an application. Every user-facing service in this tutorial reaches the outside world through a Route with edge TLS, never a forwarded port. `port-forward` is for exactly one situation, confirming that one specific Pod behaves correctly, independent of whatever a Service's selector is matching right now: with three replicas and one misbehaving, forwarding straight to that Pod's name is the only way to be certain which one you're talking to. It holds one connection open for as long as the command runs and dies when that connection drops.

## describe and events: the control plane's view

`oc logs` and `oc exec` answer questions about what's happening *inside* a container. `oc describe pod` and `oc get events` answer a different one: what the control plane itself did to this Pod, and in what order.

```bash
oc describe pod -n patterns "$POD"
```

The output's final `Events` section is a chronological list of everything the scheduler and kubelet reported about this Pod: which node it landed on, which images were pulled, which probes failed, any reason a container was killed. On CRC a healthy Pod's events read `Scheduled`, `AddedInterface ... ovn-kubernetes`, `Pulled`, `Created`, `Started`. This is where a `CreateContainerConfigError` or a `Pending` Pod stuck on a missing claim actually says what's wrong, in plain text.

`oc describe` only shows events still attached to the one object you named (events expire after about an hour). `oc get events` shows the namespace's whole stream, which matters when a failure touches more than one object, a ResourceQuota rejection is reported against the ReplicaSet that tried to create the Pod, not against any Pod, since no Pod was created:

```bash
oc get events -n patterns --sort-by=.metadata.creationTimestamp
```

`--sort-by` matters: without it, events come back in whatever order the API server holds them, rarely chronological once more than a few objects are involved.

![oc's windows into a running Pod: logs, exec, port-forward, describe/events, and the two debuggers (oc debug's pod copy and a kubectl debug ephemeral container)]({{ "/assets/diagrams/appendix-30-observability-and-debugging.svg" | relative_url }})
*Separate tools answering separate questions about the same running Pod; the two debuggers differ in whether they copy the Pod or attach to it.*

## Two debuggers, and what restricted-v2 does to them

Every tool so far works with what the Pod's containers already carry. `shipping-service`'s runtime image, like most production images, has no shell utilities beyond what the Python process needs: no `curl`, no `ps`. That's a security property worth keeping, and it means `oc exec -- curl ...` fails with "executable file not found" the moment you need a tool the image never shipped. OpenShift gives you two ways around that, and which one to reach for is shaped by the restricted-v2 SCC.

**`oc debug`** is the OpenShift-native answer and the one to try first. It starts a *copy* of the Pod (labels stripped, probes disabled, command replaced with a shell), so you get an interactive environment with the workload's own image, or any image you name:

```console
$ oc debug -n patterns deployment/shipping-service -- /bin/sh -c 'env | grep SERVICE_SCHEMA; id'
SERVICE_SCHEMA=shipping
uid=1000650000(1000650000) gid=0(root) groups=0(root),1000650000
```

The copy runs under restricted-v2 exactly like the original, injected UID and all, and cleans itself up when the session ends. It's the tool DO280 teaches and the one that works without fighting the admission layer.

**An ephemeral container** attaches a throwaway container to a Pod that's already running, without restarting anything, which is the one thing `oc debug`'s copy can't do: inspect the actual running Pod, not a fresh copy of it. OpenShift supports ephemeral containers, but restricted-v2 shapes how you create one. `kubectl debug`'s default profile sets fields restricted-v2's Pod Security Admission rejects, so you need `--profile=restricted`:

```console
$ kubectl debug -n patterns "$POD" --profile=restricted -c netcheck \
    --image=registry.access.redhat.com/ubi9/ubi-minimal:latest \
    -- curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/health
$ oc logs -n patterns "$POD" -c netcheck
ephemeral localhost:8080/health -> 200
```

The ephemeral container shares the Pod's network namespace, so `localhost:8080` reaches the application container's port: a guest in the same Pod, not a separate one. Sharing the Pod's *process* namespace (`kubectl debug --target`, to run `ps` against the real application's PIDs) is the one piece restricted-v2 won't allow: `--target` requires the `SYS_PTRACE` capability, and the restricted profile drops all capabilities. That's not a gap to work around; it's the SCC doing its job, and it's the reason `oc debug` is the practical default on OpenShift while ephemeral containers are the tool for the specific case of attaching to a running Pod's network namespace.

One ephemeral-container property surprises people: they can't be removed individually. A terminated ephemeral container stays in the Pod's `ephemeralContainerStatuses` for the rest of the Pod's life (consuming nothing, but the record stays), so running the same probe twice means two entries, which is why the example uses distinct names each time.

> **🎓 DO280/EX280 exam lens**
>
> **Objective:** Troubleshoot applications (inspect and debug running workloads)
> **Competency:** Use oc logs, exec, port-forward, describe, get events, and both oc debug and ephemeral containers to troubleshoot a Pod
> **Drill:** `oc debug -n patterns deployment/shipping-service -- id` (confirm the copy runs under the injected restricted-v2 UID)

> **🤖 Explore with your agent**
>
> "Misconfigure shipping-service's readiness probe to point at the wrong path, apply it, then walk me through diagnosing it using only oc describe pod and oc get events (no oc logs) to show what the control-plane view alone can and can't tell you."

## Cleanup

```bash
oc delete -n patterns -f observability-and-debugging/02-deployment.yaml -f observability-and-debugging/00-postgres.yaml --ignore-not-found
```

## Verification: examples/appendix-patterns/observability-and-debugging/

The runnable example deploys `shipping-service` with a `heartbeat` second container and exercises every tool against it: `logs` (plain, `-c`, `-f`, and `-p` after a liveness-forced restart), `exec`, `port-forward` (200), `describe pod` / `get events`, `oc debug`'s pod copy (confirmed running under the injected restricted-v2 UID), and a `kubectl debug --profile=restricted` ephemeral container whose network-namespace probe reaches `localhost:8080/health -> 200`. All confirmed on CRC. Full walkthrough in `examples/appendix-patterns/observability-and-debugging/README.md`.
