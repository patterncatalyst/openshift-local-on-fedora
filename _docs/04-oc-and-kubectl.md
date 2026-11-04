---
title: "oc and kubectl"
order: 4
description: "The two CLIs side by side: what they share, where oc does more, and how projects relate to namespaces."
---

## Learning objectives

By the end of this chapter you can:

- Explain where `oc` and `kubectl` overlap and where `oc` does more
- Relate an OpenShift Project to a Kubernetes Namespace plus RBAC and quota
- Create and switch Projects with `oc`, and see them as namespaces with `kubectl`
- Choose the portable `kubectl` workflow and add `oc` shortcuts where they help

## Why this matters

OpenShift gives you two command-line tools: `kubectl`, the standard Kubernetes
CLI, and `oc`, the OpenShift CLI. They overlap almost completely. This chapter
sets out exactly how they relate, so the chapters that follow can lead with the
portable `kubectl` workflow and point out the OpenShift shortcuts as it goes.

{% include excalidraw.html
   file="oc-and-kubectl"
   alt="The oc client contains all of kubectl's verbs for Pods, Deployments, Services, logs, and apply, plus OpenShift-only verbs such as new-app, expose, project, adm, and status. Those OpenShift verbs manage a Project, which is a Namespace plus RBAC and quota."
   caption="Figure 4.1: oc is a superset of kubectl, adding the OpenShift-only verbs; a Project is a Namespace with OpenShift's RBAC and quota on top." %}

## oc is a superset of kubectl

`oc` is built from the same code as `kubectl` and adds OpenShift-specific verbs on
top. Anything you can do with `kubectl` you can do with `oc` by the same name:

```bash
kubectl get pods          # standard Kubernetes
oc get pods               # identical result
```

So the whole Kubernetes workflow (creating Deployments, inspecting Pods, reading
logs, applying YAML) is written as `kubectl` in this guide and works verbatim as
`oc`. What `oc` adds is a set of commands for things that only exist on OpenShift,
or that OpenShift makes easier:

| Task | `kubectl` | `oc` |
|------|-----------|------|
| Switch working namespace | `kubectl config set-context --current --namespace=x` | `oc project x` |
| Create a namespace | `kubectl create namespace x` | `oc new-project x` |
| Expose a Service to the host | no equivalent (Routes are OpenShift) | `oc expose service x` |
| Build from source in the cluster | no equivalent (S2I is OpenShift) | `oc new-app` / `oc new-build` |
| Project-scoped status summary | no equivalent | `oc status` |
| Cluster-admin operations | limited | `oc adm ...` |
| Who am I / log in | no equivalent | `oc whoami`, `oc login` |

This is why the guide uses a callout rather than rewriting every command twice:

> **⌨️ The `oc` way**
>
> Where a `kubectl` command has a shorter or more capable `oc` form, a callout
> like this shows it. Where the feature is OpenShift-only (Routes, source builds,
> security context constraints, Operators), the chapter uses `oc` directly and
> says so. You never need both tools at once: pick one and the guide reads the
> same.

Keeping to `kubectl` for the portable parts is a deliberate choice, not a stylistic
one. Nearly everything you deploy in this guide is standard Kubernetes, and writing it
as `kubectl` keeps that portable knowledge visible: the same manifests and commands run
on any conformant cluster. The `oc`-only verbs are exactly the places where OpenShift
does something plain Kubernetes does not, so a command that has to be `oc` is itself a
signal that you have crossed into OpenShift-specific territory.

## Projects are namespaces

OpenShift *projects* are Kubernetes namespaces with a thin wrapper. A project is a
namespace plus some OpenShift metadata (a display name, a description, and the
default role bindings OpenShift adds when you create one through its own commands).

```bash
# These create the same underlying namespace; oc new-project also sets you to it
# and adds OpenShift's default role bindings.
kubectl create namespace demo
oc new-project demo
```

`oc project` both switches your current namespace and, with no argument, reports
which one you are in:

```bash
oc project demo           # switch to demo
oc project                # "Using project demo on server https://api.crc.testing:6443"
oc projects               # list the projects you can see
```

With `kubectl`, the equivalent of "switch namespace" is a context edit:

```bash
kubectl config set-context --current --namespace=demo
kubectl config view --minify -o jsonpath='{..namespace}'   # read it back
```

Both change the same thing: the namespace your next command acts on. `oc project`
is just the shorter path.

### Why projects exist at all

The wrapper matters on a shared cluster. Projects are how OpenShift does
multi-tenancy: a `Project` is backed by a `ProjectRequest` flow that lets ordinary
users create their own projects without cluster-admin, within templates and quotas an
administrator sets. Creating one through `oc new-project` also attaches the default
role bindings, a `limits` range, and, where configured, a resource quota, so a new
project arrives governed rather than wide open. On a single-user CRC cluster you feel
little of this, because you are always the admin, but it is the reason the project
abstraction exists and the reason `oc new-project` does more than `kubectl create
namespace`. When you later see a Pod land with a UID it did not ask for, that is the
project's wrapper at work, applying the defaults OpenShift attached.

On a real cluster an administrator controls two levers that shape every new project. The
`self-provisioner` cluster role decides whether ordinary users may create projects at
all, and a *project template* decides what a new project arrives with: its quota, its
limit range, and its default network policy. CRC ships the stock defaults, so you inherit
a sensible starting project without configuring anything, but knowing the levers exist
explains why two OpenShift clusters can hand you very different projects from the same
`oc new-project` command. The behavior you see here is the permissive, single-user end of
that range.

### Namespaces to leave alone

A fresh cluster already has dozens of namespaces, and most are not yours. Anything
prefixed `openshift-` or `kube-` belongs to the platform: the control plane, the
operators, the registry, the router, and monitoring all live there. Treat them as
read-only. You can look (`oc get pods -n openshift-ingress` is a fine way to learn how
the router runs), but create your workloads in your own project, never in a system
namespace, where a stray change can destabilize the cluster.

## The contexts crc writes

`crc start` writes a kubeconfig with two contexts: `crc-admin` (the `kubeadmin`
cluster administrator, which the guide uses) and `crc-developer` (an unprivileged
`developer` user, useful for seeing the cluster the way a non-admin does). Switch
between them with the standard kubeconfig command, or `oc`:

```bash
oc config get-contexts                 # list contexts; the current one is marked *
oc config use-context crc-admin        # admin for installing Operators, mesh, etc.
oc config use-context crc-developer    # a non-admin view
oc whoami                              # which user the current context is
```

Most of this guide runs as `crc-admin`, because installing Operators and a service
mesh needs cluster-admin. The developer context is worth knowing for the access
chapters, where seeing a permission denied is the point.

### Where the kubeconfig lives

Both contexts live in your kubeconfig, by default `~/.kube/config`. It is a single
file holding clusters, users, and the contexts that pair them, and the "current
context" is the one every `oc` and `kubectl` command uses unless you say otherwise. Two
habits save confusion later. First, `oc config current-context` tells you, at any
moment, which cluster and user you are about to act as, worth a glance before any
destructive command. Second, if you work with more than one cluster, the `KUBECONFIG`
environment variable can point at a specific file, which keeps CRC's contexts from
mixing with another cluster's. On this single cluster you can ignore all of that and
stay on `crc-admin`; it matters once a second cluster enters the picture.

## Permissions: roles and who can do what

OpenShift's access control is standard Kubernetes RBAC with a set of built-in roles
layered on top, and `oc` adds verbs that make it readable. Three cluster roles cover
most project work: `view` (read everything in a project), `edit` (create and change
workloads, but not manage access), and `admin` (full control of the project, including
granting others access). `oc new-project` makes its creator a project `admin`, which is
why you can do everything in a project you made.

Granting access is a role binding, and `oc policy` is the short path to one:

```bash
oc policy add-role-to-user edit alice -n demo    # let alice change workloads in demo
oc policy who-can create deployments -n demo     # who currently can
oc auth can-i create routes -n demo              # can *I*, as the current user?
```

`oc auth can-i` is the one to reach for constantly. It answers, for the user your
current context represents, whether a specific action is allowed, without you having to
perform it. Run it as `crc-developer` and you see the cluster's restrictions from the
outside; run it as `crc-admin` and almost everything answers `yes`. It turns "will this
be allowed" from a guess into a command.

## Security context constraints, briefly

One OpenShift-specific piece of access control shapes how every Pod here runs, so it is
worth meeting before the deploying chapter: the *security context constraint* (SCC). An
SCC is an admission-time policy that decides which UID, group, capabilities, and volume
types a Pod may use. The default, `restricted-v2`, is strict: it refuses a container
that insists on running as root and assigns each Pod a high, project-specific UID
instead.

```bash
oc get scc                              # the SCCs the cluster offers
oc describe scc restricted-v2          # what the default allows and forbids
```

This is why an image that runs fine on a permissive local cluster can behave
differently here, and why the next chapter uses an image built to run as an arbitrary
non-root user. You do not change the SCC to make an image work; you use an image that
respects the constraint. `oc adm policy add-scc-to-user` can grant a more permissive SCC
when a workload requires one, but reaching for it should be the exception, with a
stated reason.

## Output formats shared with kubectl

Both tools format output the same way, and a few flags do most of the work across every
chapter:

```bash
oc get pods -o wide                    # extra columns: node, IP
oc get deploy/web -o yaml              # the full object as YAML
oc get pods -o jsonpath='{.items[*].metadata.name}{"\n"}'   # pull one field
oc get pods -w                         # watch, streaming changes until Ctrl-C
oc get pods -L app                     # add a column for the "app" label
```

`-o jsonpath` is the one worth practicing, because it turns any command into a precise
question: it extracts exactly the field you name, which is how the verification commands
in later chapters read a single value, such as the UID a Pod was assigned, rather than
eyeballing a wall of YAML. `-o yaml` is its complement, for when you want the whole
object to see what the cluster filled in. These are plain Kubernetes features, so every
one works unchanged under `kubectl`.

Selectors narrow what a command acts on, which pairs with the output flags:

```bash
oc get pods -l app=web                      # label selector: only Pods labelled app=web
oc get pods --field-selector status.phase=Running
oc delete pods -l app=web                   # act on a whole set at once
```

Label selectors are how workloads refer to their Pods throughout Kubernetes, so a
Deployment's Pods, a Service's endpoints, and your own `oc get -l` query all speak the
same language. Later chapters lean on `-l app=web` to read and act on exactly the Pods a
Deployment created, without copying generated Pod names by hand.

## Which tool to reach for

In practice the choice is simple. Use `kubectl` (or `oc` by the same name) for anything
that is plain Kubernetes: Deployments, Services, ConfigMaps, Secrets, scaling, logs,
applying YAML. Reach for an `oc`-only verb when the task is OpenShift-specific: creating
a Route, building from source, inspecting or granting an SCC, managing projects and their
access, or any `oc adm` cluster operation. The callouts in this guide mark those
crossings, so you are never guessing which world you are in. If you want a single tool,
make it `oc`: it does everything `kubectl` does and the OpenShift extras besides, which
is why the bundled client the earlier chapter set up is `oc`. The guide writes the
portable half as `kubectl` only to keep the transferable knowledge visible, not because
you need two binaries installed.

## Logging in without handling secrets

`oc login` exists, and on a shared cluster it is how you authenticate: `oc login -u
<user>` prompts for a password, or `oc login --token=<token>` uses a bearer token from
the web console's "Copy login command" page. This guide does not need either, because
`crc start` already wrote the `crc-admin` context, so you are logged in the moment you
switch to it.

When you do handle a token, keep it private the same way you keep the kubeadmin
password private. `oc whoami -t` prints the current token; do not paste its output into
a script, a commit, or a chat, exactly as with the pull secret and the console
password. The context-based login this guide uses avoids tokens entirely, which is the
cleanest way to stay out of that trap. A token is a live credential for as long as it is
valid, so treating it casually is the same risk as pasting a password, and the habit of
never printing one carries over directly to any real cluster you later work on.

## Discovering the API

OpenShift adds many resource types beyond core Kubernetes, and `oc` shares
`kubectl`'s discovery commands for finding them:

```bash
oc api-resources                       # every type the cluster serves, with short names and API groups
oc api-resources --api-group=route.openshift.io   # just the Route-related types
oc explain route.spec                  # the schema of a type, field by field
oc explain route.spec.tls --recursive  # drill into a nested field
```

`oc api-resources` is the authoritative list for this cluster at this moment, including
every type an installed Operator has added, and `oc explain` is how you read a type's
schema without leaving the terminal. Together they answer most "what fields does this
take" questions faster than searching documentation, and they stay correct as the
cluster gains new types. Because they read the live cluster rather than a fixed
reference, they also account for the exact version installed here, which matters when a
field was added or renamed between releases.

## oc verbs worth meeting now

A few `oc` commands have no `kubectl` equivalent, or a friendlier form, and later
chapters use them in context:

```bash
oc status                 # project summary: Routes, Services, what is not running
oc get routes             # the host-facing URLs (the next chapter)
oc new-app --help         # build-and-deploy from source or an image
oc adm top nodes          # node CPU/memory, like kubectl top with admin framing
oc rsh deploy/web         # open a shell in a running Pod of a Deployment
oc debug deploy/web       # a throwaway debug Pod from a workload's spec
oc port-forward svc/web 8080:8080   # forward a Service port to your host
```

`oc rsh` and `oc debug` are the two to remember. `oc rsh` drops you into a shell inside
a running Pod, the fastest way to check what a container actually sees. `oc debug`
starts a fresh copy of a workload's Pod with the command replaced by a shell, so you
can inspect the image and environment even when the real Pod is crash-looping. Both
beat reconstructing a `kubectl exec` invocation by hand.

For everyday debugging, two more commands do the heavy lifting and are identical under
`kubectl`:

```bash
oc logs deploy/web                     # logs from the Deployment's Pods
oc get events --sort-by=.lastTimestamp # recent cluster events, newest last
```

When a workload will not start, the pairing of `oc get events` and `oc logs` usually
tells you why before you reach for anything heavier: events show scheduling,
image-pull, and admission problems, while logs show what the container itself said.
Reading those two first turns most "it is not working" moments into a specific cause.

> **🤖 Explore with your agent**
>
> "List every API resource that exists on this cluster but is not part of upstream
> Kubernetes, and group them by their API group, so I can see what OpenShift adds."

## Build, run, observe

Confirm the two CLIs behave as described:

```bash
oc config use-context crc-admin
oc whoami                              # kubeadmin
oc new-project cli-tour                 # project == namespace
kubectl get namespace cli-tour          # kubectl sees the same namespace
oc project cli-tour                     # switch with the short form
oc status                              # project summary (empty for now)
oc delete project cli-tour              # clean up
```

Creating a project with `oc` and seeing it as a namespace with `kubectl` is the
whole relationship in one exchange: same object, two names, two tools.

## For deeper coverage

- [**Kubernetes for Developers**](https://www.manning.com/books/kubernetes-for-developers) (William Denniss, Manning) works the day-to-day CLI workflow this chapter leans on.
- Official docs: the [OpenShift Container Platform documentation](https://docs.openshift.com/) for the `oc` CLI and Projects, and the [Kubernetes documentation](https://kubernetes.io/docs/reference/kubectl/) for `kubectl` and namespaces.

## Where this fits

You know how the two CLIs relate and how projects map to namespaces. The next
chapter deploys a first application with `kubectl`, with `oc` callouts for the
OpenShift shortcuts, and the one after exposes it to your host with a Route.
