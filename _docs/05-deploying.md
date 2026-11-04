---
title: "Deploying applications"
order: 5
description: "Run a first workload with a Deployment and Pods using kubectl, with the oc shortcuts, and meet OpenShift's restricted-v2 security defaults."
---

With the cluster up and both CLIs understood, this chapter deploys a first
application. It uses the portable `kubectl` workflow (a Deployment that manages
Pods), shows the `oc` one-liner that does the same thing, and introduces the one
rule that trips people up when they come to OpenShift from plain Kubernetes: Pods
run under a restricted security context by default.

{% include excalidraw.html
   file="deploy-scc"
   alt="A Deployment named web creates a ReplicaSet, which keeps two Pods running, each an httpd container. The restricted-v2 security context constraint injects a non-root runAsUser, UID 1000650000, into the Pods."
   caption="Figure 5.1: A Deployment manages its Pods through a ReplicaSet, and the restricted-v2 SCC assigns each Pod a non-root UID from the project's range." %}

## A workload that fits OpenShift's defaults

OpenShift assigns each Pod a high, random user ID from a per-namespace range and
refuses to run a container as root unless you grant it an exception. So the image
you deploy must tolerate an arbitrary non-root UID. Red Hat's Universal Base
Image (UBI) application images are built for exactly this, which makes
`ubi9/httpd-24` a safe first workload: a web server that starts fine as any UID.

The reason behind the arbitrary UID is worth understanding, because it explains why so
much of OpenShift's behavior differs from a permissive local cluster. Each project is
allocated its own block of user IDs, ten thousand wide, and every Pod in the project runs
somewhere in that block. Because two projects never share a UID range, a process in one
project cannot masquerade as a user in another, and a container that escapes its boundary
still holds only an unprivileged ID that owns nothing on the host. It is defense in depth
applied to identity: the cluster assumes a workload might misbehave and limits the blast
radius in advance. The cost is that images have to be written to not care which UID they
run as, which UBI images are, and which is the first thing to check when a third-party
image fails to start here.

Create a project to work in:

```bash
oc new-project deploy-demo
```

## Deploy with kubectl

Write a Deployment. This is standard Kubernetes; nothing here is OpenShift-specific:

```yaml
# httpd-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: httpd
          image: registry.access.redhat.com/ubi9/httpd-24:latest
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: web
  labels:
    app: web
spec:
  selector:
    app: web
  ports:
    - port: 8080
      targetPort: 8080
```

The manifest declares two objects: the Deployment that runs the Pods and a
Service named `web` that gives them one stable in-cluster address. The Service is
what the `curl` later in this chapter reaches, and what the next chapter puts a
Route in front of. Apply it and watch the Pods come up:

```bash
kubectl apply -f httpd-deployment.yaml
kubectl get pods -l app=web -w        # Ctrl-C once both are Running
kubectl rollout status deployment/web
```

The container listens on 8080, not 80: an unprivileged process cannot bind a port
below 1024, and UBI's httpd image is configured for 8080 precisely because it runs
non-root. That is the restricted default in action.

### What a Deployment actually manages

A Deployment does not run Pods directly. It creates a *ReplicaSet*, and the ReplicaSet
keeps the requested number of Pods alive. The chain matters because it is what makes the
workload self-healing: the `selector` tells the ReplicaSet which Pods are its
responsibility (here, any Pod labelled `app=web`), and the `template` is the blueprint it
stamps out to reach the replica count. Delete a Pod and the ReplicaSet notices the count
is low and creates a replacement within seconds; you can watch it happen:

```bash
kubectl delete pod -l app=web --field-selector status.phase=Running | head -1
kubectl get pods -l app=web -w        # a replacement appears almost immediately
```

The `selector` and the template labels have to agree, which is a common first mistake: if
the template's `app=web` did not match the selector, the ReplicaSet would create Pods it
then refused to count, and the Deployment would churn. Keeping both on the same label is
what ties the three objects together.

## Inspect what you deployed

```bash
kubectl get deployment web            # desired/ready replicas
kubectl get pods -l app=web -o wide   # the two Pods and their node
kubectl logs deployment/web           # httpd startup logs
kubectl describe pod -l app=web       # events, the assigned node, and why if it is not running
# the UID OpenShift injected into the container:
kubectl get pod -l app=web -o jsonpath='{.items[0].spec.containers[0].securityContext.runAsUser}{"\n"}'
```

`kubectl describe` is the command to reach for first when a Pod is not Running. Its Events
section at the bottom records the Pod's whole recent history, including scheduling
decisions, image pulls, and any admission or probe failure, in plain language. Between
`describe` and `logs`, almost every "why is this Pod not up" question answers itself
without guesswork.

That prints a high UID like `1000650000`. It comes from the project's allocated
range, visible as the `openshift.io/sa.scc.uid-range` annotation on the namespace
(`1000650000/10000` here: the first UID and the size of the range). You did not
set it; OpenShift did, and the pod runs under the `restricted-v2` security
context constraint that enforces it.

The UID sits at the *container* security context, not the Pod's, which is where to look
when you verify it:

```bash
kubectl get pod -l app=web \
  -o jsonpath='{.items[0].spec.containers[0].securityContext.runAsUser}{"\n"}'
# the namespace range the UID was drawn from:
kubectl get namespace deploy-demo \
  -o jsonpath='{.metadata.annotations.openshift\.io/sa\.scc\.uid-range}{"\n"}'
```

### Which SCC the Pod got, and how

A Pod does not pick its own SCC. At admission time OpenShift looks at the Pod's
*ServiceAccount*, finds the SCCs that account is allowed to use, and applies the most
restrictive one that still permits what the Pod asks for. With no ServiceAccount named,
the Pod uses the project's `default` account, which is allowed `restricted-v2`, so that is
what it gets. The decision is recorded on the Pod as an annotation:

```bash
kubectl get pod -l app=web -o jsonpath='{.items[0].metadata.annotations.openshift\.io/scc}{"\n"}'
# restricted-v2
```

Reading that annotation is the quickest way to answer "why did this Pod run the way it
did": it names the exact policy admission applied. When a workload behaves unexpectedly
around permissions, the SCC annotation and the injected `runAsUser` together explain it.

### What restricted-v2 forbids

`restricted-v2` is strict by design, because it is the policy every workload gets unless
an administrator grants more. It drops nearly all Linux capabilities, forbids privilege
escalation, refuses the host's network, PID, and IPC namespaces, blocks host-path
volumes, and assigns the arbitrary non-root UID you just saw rather than honoring a
`runAsUser` the image requests. UBI images cope with this because they are built to run as
any UID and to keep their writable files group-owned by GID 0, the group the arbitrary UID
still belongs to. An image that hard-codes a specific user, writes to root-owned paths, or
needs a low port will not start cleanly here, and that is the constraint working as
intended rather than a fault to route around.

> **⌨️ The `oc` way**
>
> `oc new-app` collapses the YAML above into one command: it creates the
> Deployment, the matching Service, and the labels in a single step.
>
> ```bash
> oc new-app --image=registry.access.redhat.com/ubi9/httpd-24:latest --name=web
> ```
>
> It is the fastest way to get something running. The guide uses explicit YAML
> where seeing the object matters, and `oc new-app` where speed matters.

One difference is worth knowing: `oc new-app` also creates an *ImageStream*, an OpenShift
object that tracks an image and can trigger a redeploy when the image updates. The plain
YAML above references the image directly and has no ImageStream. Neither is wrong; the
ImageStream adds OpenShift's image-tracking on top, which the build chapters make use of,
while the direct reference keeps the manifest portable to any Kubernetes cluster. For a
first deploy the direct reference is the clearer of the two to read.

## The Service and how Pods are found

The second object in the manifest, the Service, is what gives two interchangeable Pods a
single stable address. A Service of the default type, `ClusterIP`, gets a virtual IP and a
DNS name inside the cluster, and it forwards to whichever Pods match its selector. The DNS
name follows a fixed pattern, `web.deploy-demo.svc.cluster.local`, which is why the `curl`
later in this chapter can reach `http://web:8080` from another Pod in the same namespace:
the short name resolves through cluster DNS.

The Service tracks its Pods through *endpoints*, which the cluster keeps in step with the
label selector as Pods come and go:

```bash
kubectl get endpoints web     # the Pod IPs currently behind the Service
kubectl get svc web           # the Service's own ClusterIP and port
```

When you scaled or re-rolled the Deployment, the endpoints list changed to match, with no
edit to the Service. That decoupling is the point: clients talk to the stable Service name
while the Pods behind it are replaced freely.

Inside the same namespace, the short name `web` resolves. From another namespace you use
the fully qualified form, `web.deploy-demo.svc.cluster.local`, or its shorter
`web.deploy-demo.svc` variant, which is how services in different projects find each other.
This matters as soon as a system spans more than one namespace, and it is the same name a
Route will target in the next chapter. A Service is reachable only from inside the cluster,
which is exactly why exposing one to your host needs the separate Route object rather than a
bigger Service.

## Scale, update, and roll back

Scaling and rolling updates are the same commands you would run on any cluster:

```bash
kubectl scale deployment/web --replicas=3
kubectl rollout restart deployment/web      # re-roll the Pods
kubectl rollout status deployment/web
```

A Deployment updates its Pods gradually rather than all at once. By default it brings up
new Pods before taking old ones down (controlled by `maxSurge` and `maxUnavailable` in the
rollout strategy), so the Service keeps serving throughout. Each rollout is recorded, so a
bad change is one command to reverse:

```bash
kubectl rollout history deployment/web      # the recorded revisions
kubectl rollout undo deployment/web         # roll back to the previous revision
```

Being able to undo a rollout is why changing the image or the template is low-risk here:
if the new Pods misbehave, you return to the last good revision without reconstructing it
by hand.

## Where the image comes from

The Deployment pulls from `registry.access.redhat.com`, Red Hat's public registry, which
serves UBI images without authentication. That is why this chapter needs no image pull
secret for the workload itself: the pull secret you gave `crc start` is for the cluster's
own release and Operator content, not for public UBI images. Red Hat's other registry,
`registry.redhat.io`, does require authentication, and an image from there needs a pull
secret in the namespace. For everything in this guide the public registry is enough, and
sticking to UBI images keeps you on content that is built to run under `restricted-v2`.

## Give the container health checks

The Deployment above omits health probes to stay minimal, but a workload you intend to
keep running should declare them, because they are how the cluster knows the difference
between "started" and "ready to serve":

```yaml
        readinessProbe:
          httpGet: { path: /, port: 8080 }
        livenessProbe:
          httpGet: { path: /, port: 8080 }
```

A *readiness* probe decides whether a Pod receives Service traffic: until it passes, the
Pod stays out of the endpoints list, so a rollout does not send requests to a Pod that is
still starting. A *liveness* probe decides whether a Pod should be restarted: if it starts
failing, the kubelet restarts the container. Without probes the cluster treats a running
process as healthy, which is fine for this demo and risky for anything real. Adding them is
the single highest-value change to a bare Deployment.

## Resource requests and limits

The other addition a real workload wants is resource requests and limits:

```yaml
        resources:
          requests: { cpu: 50m, memory: 64Mi }
          limits:   { memory: 256Mi }
```

A *request* is what the scheduler reserves when it places the Pod, so it is how the cluster
avoids overcommitting the node; a *limit* is the ceiling the Pod is held to at runtime. On a
single-node CRC cluster, where everything competes for one node's memory, requests are what
keep your workloads and the platform from starving each other. Leaving them off is why an
oversubscribed cluster schedules Pods it then cannot feed, so set at least a modest request
on anything you expect to stay up.

The platform components already hold a large share of the node, so on CRC the practical
budget for your own workloads is smaller than the raw memory figure suggests. Modest
requests let several small workloads coexist; a single Pod that requests gigabytes it does
not need will crowd the rest out and leave later Pods stuck Pending. When that happens, the
fix is to right-size the requests, not to raise the VM, because the request is a claim on
the node whether or not the Pod uses it.

## When a container needs more than restricted-v2 allows

Some images expect to run as root or bind a low port. On OpenShift those need a
*security context constraint* (SCC) exception, which is a deliberate grant, not a
default. Granting one binds a more permissive SCC to the workload's ServiceAccount,
rather than loosening the default for everyone:

```bash
# Grant the anyuid SCC to one ServiceAccount (a deliberate, scoped exception).
oc adm policy add-scc-to-user anyuid -z default -n deploy-demo
```

The security chapters cover SCCs in depth; for now the rule is: prefer an
image that runs as an arbitrary non-root UID, and you never have to think about
it. Most official Red Hat images already do, so you reach for `anyuid` rarely, and when
you do it is worth a comment saying which workload needed it and why.

> **🤖 Explore with your agent**
>
> "Show me the UID range assigned to the deploy-demo project, explain where it
> comes from, and show the securityContext OpenShift injected into one of the web
> Pods."

## Build, run, observe

```bash
oc new-project deploy-demo 2>/dev/null || oc project deploy-demo
kubectl apply -f httpd-deployment.yaml
kubectl rollout status deployment/web                 # waits until ready
kubectl get pods -l app=web                           # two Running Pods
# reach the Service from inside the cluster (no Route yet; that is the next chapter)
kubectl run curl --image=registry.access.redhat.com/ubi9/ubi-minimal --rm -i --restart=Never -- \
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://web:8080
oc delete project deploy-demo                          # clean up
```

The `httpd` image ships an empty document root, so a request to `/` answers
`HTTP 403`: the server is up and the Service routes to it, which is all this step
proves. Serving real content is an image or ConfigMap concern, not a cluster one.
Exposing that Service to your host, rather than reaching it from inside the
cluster, is the next chapter.

## Where this fits

You can deploy a workload and you understand why it runs as a random non-root UID.
The next chapter puts a Route in front of the Service so you can reach it from a
browser on your host, with TLS terminated at the edge.
