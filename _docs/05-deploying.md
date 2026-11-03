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

## A workload that fits OpenShift's defaults

OpenShift assigns each Pod a high, random user ID from a per-namespace range and
refuses to run a container as root unless you grant it an exception. So the image
you deploy must tolerate an arbitrary non-root UID. Red Hat's Universal Base
Image (UBI) application images are built for exactly this, which makes
`ubi9/httpd-24` a safe first workload: a web server that starts fine as any UID.

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

## Inspect what you deployed

```bash
kubectl get deployment web            # desired/ready replicas
kubectl get pods -l app=web -o wide   # the two Pods and their node
kubectl logs deployment/web           # httpd startup logs
# the UID OpenShift injected into the container:
kubectl get pod -l app=web -o jsonpath='{.items[0].spec.containers[0].securityContext.runAsUser}{"\n"}'
```

That prints a high UID like `1000650000`. It comes from the project's allocated
range, visible as the `openshift.io/sa.scc.uid-range` annotation on the namespace
(`1000650000/10000` here: the first UID and the size of the range). You did not
set it; OpenShift did, and the pod runs under the `restricted-v2` security
context constraint that enforces it.

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

## Scale and update

Scaling and rolling updates are the same commands you would run on any cluster:

```bash
kubectl scale deployment/web --replicas=3
kubectl rollout restart deployment/web      # re-roll the Pods
kubectl rollout status deployment/web
```

## When a container needs more than restricted-v2 allows

Some images expect to run as root or bind a low port. On OpenShift those need a
*security context constraint* (SCC) exception, which is a deliberate grant, not a
default. The security chapters cover SCCs in depth; for now the rule is: prefer an
image that runs as an arbitrary non-root UID, and you never have to think about
it. Most official Red Hat images already do.

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
