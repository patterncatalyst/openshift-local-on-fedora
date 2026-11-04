// deck.js : Kubernetes Patterns on OpenShift, worked against DO280/EX280.
// Data-driven: FAMILIES holds one entry per pattern family; each pattern renders
// one slide (bullets or its diagram), framed by its DO280/EX280 objective.
// Mined from the §18 appendix (33 chapters). Notes on every slide.
//
// Build:  export NODE_PATH=$PWD/../node_modules DECK_ASSETS=../assets DECK_PNG=./png && node deck.js

"use strict";

const H = require("../deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addSectionDivider, addNotes,
} = H;

const OUT = "kubernetes-patterns-on-openshift-r01.0.pptx";
const REV = "r01.0";

const pres = newDeck();
pres.title = "Kubernetes Patterns on OpenShift (DO280/EX280)";
let pageNum = 0, notesCount = 0;

function S() { const s = pres.addSlide(); pageNum += 1; addFooter(s, pageNum); return s; }
function note(s, text) {
  if (!text || !text.trim()) throw new Error(`slide ${pageNum} has no speaker notes`);
  addNotes(s, text); notesCount += 1;
}
function divider(code, title, subtitle, notes) {
  const s = pres.addSlide(); pageNum += 1; addSectionDivider(s, code, title, subtitle); note(s, notes);
}

// ---------------------------------------------------------------------------
// Content: one object per family. Each pattern renders one slide.
//   { n, name, diagram?, bullets:[...], objective, notes }
// ---------------------------------------------------------------------------
const FAMILIES = [
  {
    code: "01", title: "Foundational", subtitle: "What every workload declares",
    anchor: "appendix-01-predictable-demands",
    dividerNote: "The foundational family is the shape every workload takes before it does anything clever: what it needs, how it rolls out, how it reports health, how it starts and stops, and where it lands. On OpenShift each of these meets restricted-v2 and the single-node reality of CRC.",
    patterns: [
      { n: "01", name: "Predictable Demands", diagram: true,
        bullets: ["Declare CPU/memory requests and limits so the scheduler can place the Pod and the kubelet can protect the node.",
          "A PriorityClass decides who wins under pressure; a ConfigMap or PVC reference is a hard requirement, missing one leaves the Pod Pending.",
          "On CRC the default StorageClass is WaitForFirstConsumer, so a PVC stays Pending until a Pod mounts it, not immediately bound."],
        objective: "DO280/EX280: Configure applications for reliability (requests, limits, resource references).",
        notes: "Predictable Demands is where every workload starts: it tells the platform what it needs. Requests and limits let the scheduler place the Pod and let the kubelet defend the node under memory pressure. A PriorityClass breaks ties when the node is squeezed. And a referenced ConfigMap or PersistentVolumeClaim is a hard requirement, not a hint: if it is missing, the Pod sits in Pending or CreateContainerConfigError until it exists. The one CRC-specific wrinkle is storage: the default hostpath StorageClass uses WaitForFirstConsumer, so a claim stays Pending until the first Pod actually mounts it, which changes the minikube narrative that a claim binds immediately." },
      { n: "02", name: "Declarative Deployment",
        bullets: ["RollingUpdate overlaps old and new Pods for zero-gap releases; Recreate tears all down first for a clean cutover.",
          "oc rollout status, history, and undo manage the release; a Deployment revision is the unit you roll back to.",
          "OpenShift finding: a RollingUpdate alone still dropped ~2/80 requests on router reload; a preStop drain plus minReadySeconds got it to 100/100."],
        objective: "DO280/EX280: Deploy and manage applications (update strategies, rollouts).",
        notes: "Declarative Deployment is how a new version reaches the cluster without a human orchestrating it. RollingUpdate overlaps old and new Pods so there is no gap in service; Recreate tears everything down before starting the replacement, for workloads that cannot run two versions at once. The real OpenShift finding here, which the minikube sibling does not have, is that a RollingUpdate by itself still dropped about two of every eighty requests, because the HAProxy router reloads on every endpoint change and a Pod SIGTERM'd before the reload propagates resets new connections. Adding a preStop drain, minReadySeconds, and a sane termination grace period took it to a true zero-downtime 100 out of 100, and that drain is the pattern to apply to every Route-fronted workload." },
      { n: "03", name: "Health Probe",
        bullets: ["Startup, readiness, and liveness probes tell the kubelet when a container is up, able to serve, and still alive.",
          "Readiness gates Service endpoints; liveness restarts a hung container; startup protects a slow cold start from a trigger-happy liveness.",
          "A single-replica Route returns 503 when no endpoint is ready, the correct signal that readiness is doing its job."],
        objective: "DO280/EX280: Configure applications for reliability (health probes).",
        notes: "Health Probe is how the platform knows the difference between a process that exists and a process that works. The startup probe guards a slow boot so a liveness check does not kill a container that is simply still coming up. The readiness probe gates whether the Service sends traffic to the Pod at all. The liveness probe restarts a container that has wedged. On OpenShift the observable proof is clean: with one replica behind a Route, the Route answers 503 the moment readiness goes false, which is exactly right, no ready endpoint, no traffic, rather than sending requests into a broken Pod." },
      { n: "04", name: "Managed Lifecycle",
        bullets: ["postStart and preStop hooks, plus honoring SIGTERM, let a container start and stop gracefully within its termination grace period.",
          "The platform drives the lifecycle; the container cooperates by draining in-flight work on preStop before the grace period expires.",
          "Finding: use a clean-shutdown service for the demo; a Kafka-consumer stop that never completes runs out the grace period and looks like a hang."],
        objective: "DO280/EX280: Deploy and manage applications (container lifecycle).",
        notes: "Managed Lifecycle is the contract between the platform and the container about starting and stopping. The kubelet sends SIGTERM and waits the termination grace period before SIGKILL; a well-behaved container uses a preStop hook or its own SIGTERM handler to finish in-flight work and close connections in that window. The finding worth carrying: pick a service with a clean shutdown to demonstrate this. A service whose shutdown blocks, for example one trying to cleanly stop a Kafka consumer with no broker reachable, will run out the grace period and get SIGKILLed, which looks like the pattern failing when it is really the example's choice of workload." },
      { n: "05", name: "Automated Placement",
        bullets: ["nodeSelector, affinity/anti-affinity, and taints/tolerations steer where Pods land.",
          "Single-node reframe: CRC has one node, so cross-node anti-affinity can be shown as intent (one Pod Pending) but not satisfied.",
          "Always untaint the node after a taint demo, it is the only node, so a lingering taint strands everything."],
        objective: "DO280/EX280: Deploy and manage applications (pod scheduling).",
        notes: "Automated Placement is how you influence the scheduler. nodeSelector and node affinity attract Pods to nodes with certain labels; pod anti-affinity spreads replicas apart; taints and tolerations repel Pods unless they explicitly tolerate a node. The CRC reframe is that there is exactly one node, so the demos that need a second node, spreading two replicas across nodes, can be shown as intent, you see the second replica go Pending because it cannot satisfy anti-affinity, but not actually satisfied. And a safety note that bites on a single node: after demonstrating a taint, untaint immediately, because tainting the only node strands every workload that does not tolerate it." },
    ],
  },
  {
    code: "02", title: "Structural", subtitle: "Shaping the Pod",
    anchor: "appendix-07-sidecar",
    dividerNote: "The structural family is about the shape of a Pod with more than one container: an init container that must finish first, a sidecar that runs alongside, an adapter that normalizes output, an ambassador that brokers a connection. All four are multi-container Pod design, and OpenShift runs them under restricted-v2 like anything else.",
    patterns: [
      { n: "06", name: "Init Container",
        bullets: ["An init container runs to completion before the app container starts, used for setup the app depends on.",
          "Here it runs an Alembic database migration; the app only starts once the schema is in place.",
          "Init:Error is visible and expected when its dependency (Postgres) is absent; it retries until the migration applies."],
        objective: "DO280/EX280: Deploy and manage applications (init containers).",
        notes: "An Init Container is a container that must finish successfully before the main container is allowed to start, which makes it the right place for one-time setup the application assumes is already done. In the appendix it runs a database migration with Alembic, so the service never starts against an unmigrated schema. When its dependency is missing, you see the Pod sit in Init:Error, which is the clear, visible signal that the setup step cannot complete yet; once Postgres is reachable the migration applies and the app proceeds." },
      { n: "07", name: "Sidecar", diagram: true,
        bullets: ["A sidecar container runs alongside the app, sharing the Pod's network and volumes, adding a capability without changing the app.",
          "OpenShift runs native sidecars (an init container with restartPolicy: Always), so the Pod is ready only when both are up.",
          "Startup order proven by the probe log; shutdown order by finishedAt timestamps (main stops before the sidecar)."],
        objective: "DO280/EX280: Deploy and manage applications (sidecar containers).",
        notes: "A Sidecar adds a capability to a Pod by running a second container next to the application, sharing its network and storage, without the application knowing. The modern form, which OpenShift supports, is the native sidecar: an init container marked restartPolicy Always, which the kubelet starts before the app and keeps running, and which makes the Pod report ready only when both containers are up. The appendix proves the ordering concretely: the sidecar's probe log shows it started first, and the finishedAt timestamps on shutdown show the main container stopped before the sidecar, which is the lifecycle guarantee native sidecars give you." },
      { n: "08", name: "Adapter",
        bullets: ["An adapter sidecar translates the app's output into a standard the outside world expects, here JSON metrics into Prometheus text.",
          "The failure domain stays on the adapter: the app keeps serving even if the adapter restarts.",
          "The app is unaware; the adapter reads its output and re-exposes it in the expected format."],
        objective: "DO280/EX280: Configure applications for reliability (observability).",
        notes: "An Adapter is a specialized sidecar whose job is to make a non-conforming application fit a standard interface the platform expects. The appendix example puts an adapter in front of a service that emits metrics as JSON and re-exposes them in the Prometheus text format a scraper understands, with no change to the application. The design point is failure isolation: the adapter is a separate container, so if it crashes and restarts, the application keeps serving; the Pod shows one container unready while the app container stays up with zero restarts." },
      { n: "09", name: "Ambassador",
        bullets: ["An ambassador sidecar brokers the app's outbound connection, so the app always dials localhost and the ambassador handles the real endpoint.",
          "Repointing the upstream is a config change on the ambassador, not the app.",
          "Finding: match the app's expected credentials so a zero-env app connects; a wrong upstream crash-loops the new Pod while the old keeps serving."],
        objective: "DO280/EX280: Deploy and manage applications (proxy sidecars).",
        notes: "An Ambassador is a sidecar that owns the application's connection to the outside, so the application only ever talks to localhost and the ambassador deals with where the real service lives, how to authenticate, and how to fail over. Changing the upstream becomes a change to the ambassador's config, not the application. The appendix finding is a practical one about getting the demo to actually connect: align the credentials the image defaults to so a service with no environment configured connects cleanly, and note that repointing the ambassador at a missing upstream crash-loops the new Pod while the rolling update keeps the old one serving, which is the pattern protecting you." },
    ],
  },
  {
    code: "03", title: "Behavioral", subtitle: "How workloads run over time",
    anchor: "appendix-16-service-discovery",
    dividerNote: "The behavioral family covers how workloads behave over their lifetime: batch and periodic jobs, node daemons, singletons, stateless and stateful services, discovery, and self-awareness. This is the largest family, and it is where several OpenShift and single-node findings surface.",
    patterns: [
      { n: "10", name: "Batch Job",
        bullets: ["A Job runs a task to completion; an Indexed Job partitions work across Pods by JOB_COMPLETION_INDEX.",
          "The appendix's shipping-report partitions 300 rows into three indexed Pods of 100 each.",
          "completions and parallelism control how many run and how many at once."],
        objective: "DO280/EX280: Deploy and manage applications (Jobs).",
        notes: "A Batch Job runs a finite task to completion rather than serving forever. The interesting mode is the Indexed Job, where each Pod gets a unique completion index in an environment variable and uses it to claim its slice of the work. The appendix's shipping-report job partitions three hundred rows of a table across three indexed Pods, a hundred rows each, with no coordination beyond the index. completions sets how many successful runs are needed and parallelism sets how many run concurrently." },
      { n: "11", name: "Periodic Job",
        bullets: ["A CronJob runs a Job on a schedule; concurrencyPolicy decides what happens when a run overruns the next trigger.",
          "oc create job --from=cronjob runs it on demand, bypassing Forbid; suspend pauses the schedule.",
          "Forbid skips a new run while the previous is still going."],
        objective: "DO280/EX280: Deploy and manage applications (CronJobs).",
        notes: "A Periodic Job is a CronJob: a schedule that stamps out a Job at each trigger. The subtlety is concurrencyPolicy, what to do when a run is still going at the next trigger; Forbid skips the new one, Replace cancels the old, Allow lets them overlap. Two operational touches the appendix shows: oc create job from-cronjob runs the job immediately on demand even under a Forbid policy, which is how you test it, and suspend pauses the schedule without deleting it." },
      { n: "12", name: "Daemon Service",
        bullets: ["A DaemonSet runs one Pod per node, for node-level agents like log or metrics collectors.",
          "OpenShift finding: a hostPath daemon needs the privileged SCC plus the spc_t SELinux type to actually read node files.",
          "hostmount-anyuid mounts the path but SELinux still blocks the read; privileged + spc_t is what works."],
        objective: "DO280/EX280: Deploy and manage applications (DaemonSets; leans cluster-ops).",
        notes: "A Daemon Service is a DaemonSet: one Pod on every node, the shape node-level agents take. On OpenShift this is where the security model bites hardest, because reading the node's own files from a Pod is exactly what restricted-v2 exists to prevent. The appendix documents the real layering: granting hostmount-anyuid lets the Pod mount the hostPath, but SELinux still blocks the actual read; it takes the privileged SCC plus the spc_t SELinux type, and running as root, before the daemon can read the node's log directory. That is two enforcement layers, the SCC and SELinux, that the minikube sibling simply does not have." },
      { n: "13", name: "Singleton Service",
        bullets: ["A PodDisruptionBudget with minAvailable: 1 blocks a voluntary eviction that would take the last replica.",
          "A node drain is held back (eviction returns 429); a direct delete bypasses the PDB.",
          "Finding: use a clean-startup service; one that blocks on a Kafka producer at startup never becomes ready."],
        objective: "DO280/EX280: Configure applications for reliability (PodDisruptionBudget).",
        notes: "A Singleton Service is about protecting availability during voluntary disruption. A PodDisruptionBudget with minAvailable one tells the platform it may never voluntarily take the last ready replica, so a node drain is held back, the eviction API returns 429, until there is somewhere for a replacement to run. The distinction to teach is voluntary versus involuntary: a PDB stops a drain, but a direct oc delete pod bypasses it, because that is not a voluntary disruption the budget governs. The finding is the same startup caution as elsewhere, choose a service that reaches ready cleanly, because one that blocks waiting on a Kafka producer at startup never becomes ready to protect." },
      { n: "14", name: "Stateless Service",
        bullets: ["A stateless service holds no per-Pod state, so any replica serves any request and replicas are interchangeable.",
          "Delete a Pod and its replacement has a new identity and serves identically; scaling is free.",
          "This is the default shape the application tier of the data mesh takes."],
        objective: "DO280/EX280: Manage storage and configuration (stateless workloads).",
        notes: "A Stateless Service keeps no state tied to a particular Pod, which is what makes a Deployment's replicas interchangeable: any one can serve any request, you can scale to any number, and deleting a Pod simply yields a fresh replacement with a new name that serves exactly the same. Recognizing when a workload is truly stateless, and keeping it that way, is what lets the platform move it around freely. It is the default shape of the application tier in the data mesh, and the contrast that sets up the next pattern." },
      { n: "15", name: "Stateful Service",
        bullets: ["A StatefulSet gives each replica a stable identity and its own PersistentVolume via volumeClaimTemplates.",
          "Identity survives a Pod delete; the headless Service gives stable per-Pod DNS names.",
          "Postgres runs this way under nonroot-v2 with a pinned UID and fsGroup."],
        objective: "DO280/EX280: Manage storage and configuration (StatefulSets).",
        notes: "A Stateful Service is the opposite: each replica has a stable, sticky identity and its own storage that follows it. A StatefulSet numbers its Pods, gives each one its own PersistentVolumeClaim through a volumeClaimTemplate, and fronts them with a headless Service so each has a predictable DNS name. The appendix proves the identity survives: write a value, delete the Pod, and the replacement comes back as the same ordinal with the same data. Postgres is the worked example, running under a scoped nonroot-v2 grant with a pinned UID and fsGroup so it can own its data directory." },
      { n: "16", name: "Service Discovery", diagram: true,
        bullets: ["ClusterIP plus cluster DNS lets services find each other by name; EndpointSlices track the ready Pods.",
          "OpenShift: a LoadBalancer Service stays <pending> on CRC; the Route is the external answer.",
          "An Ingress auto-creates a Route behind it."],
        objective: "DO280/EX280: Configure networking (Services, DNS, Routes).",
        notes: "Service Discovery is how one service finds another without hardcoding Pod IPs. A ClusterIP Service plus cluster DNS means a service is reachable by a stable name, and the EndpointSlice behind it tracks exactly which Pods are ready to receive traffic. On OpenShift the external story differs from upstream: a Service of type LoadBalancer stays pending on CRC because there is no cloud to provision one, so the Route is the external-access answer, and a standard Kubernetes Ingress quietly creates a Route behind itself. Internal discovery is identical to any Kubernetes cluster; external access is the OpenShift-specific part." },
      { n: "17", name: "Self Awareness",
        bullets: ["The Downward API injects a Pod's own metadata (name, namespace, labels) and resource values into itself.",
          "fieldRef for metadata, resourceFieldRef for requests/limits; a volume form updates when annotations change.",
          "A CPU request without a divisor rounds up to whole cores; a divisor of 1m gives millicores."],
        objective: "DO280/EX280: Manage storage and configuration (Downward API).",
        notes: "Self Awareness is the Downward API: a Pod learning about itself without calling the Kubernetes API. fieldRef injects metadata like the Pod's name, namespace, and labels as environment variables; resourceFieldRef injects the container's own requests and limits. A subtlety worth knowing for the exam: a CPU resourceFieldRef without a divisor rounds up to whole cores, so a 500m limit reads as 1, while a divisor of 1m gives you the value in millicores. The volume form of the Downward API is the one that updates in place when a Pod's annotations change at runtime, with no restart." },
    ],
  },
  {
    code: "04", title: "Configuration", subtitle: "Separating config from code",
    anchor: "appendix-19-configuration-resource",
    dividerNote: "The configuration family keeps configuration out of the image: environment variables, bulk resources and mounted files, rendered templates, and immutable config. One live finding here contradicts the minikube sibling outright, because OpenShift's Kubernetes version validates env-var names differently.",
    patterns: [
      { n: "18", name: "Env Var Configuration",
        bullets: ["Environment comes from three sources: literals, ConfigMap keys (configMapKeyRef), and Secret keys (secretKeyRef).",
          "All resolve once at container start; patching the ConfigMap does nothing until a rollout restart.",
          "The cleanest first configuration step and the most common exam task."],
        objective: "DO280/EX280: Manage storage and configuration (environment).",
        notes: "Env Var Configuration is the most common way to parameterize a container: environment variables drawn from a literal baked into the manifest, a ConfigMap key via configMapKeyRef, or a Secret key via secretKeyRef. The property to internalize is timing: environment variables are resolved once, when the container starts, so patching the underlying ConfigMap changes nothing about a running Pod until it is restarted. That is a feature, config is stable for the life of the Pod, but it surprises people who expect a live update, which is what the next pattern provides." },
      { n: "19", name: "Configuration Resource", diagram: true,
        bullets: ["envFrom exposes every key of a ConfigMap/Secret at once; a volume mount exposes the same resource as files.",
          "Mounted files update live (~60s); env vars do not.",
          "OpenShift finding: k8s 1.35's relaxed env-var validation EXPOSES dotted keys via envFrom (contradicts minikube)."],
        objective: "DO280/EX280: Manage storage and configuration (bulk config, volumes).",
        notes: "Configuration Resource is about consuming a whole ConfigMap or Secret at once, two ways. envFrom turns every key into an environment variable in one line; mounting the same resource as a volume turns every key into a file. The difference that matters is live update: mounted files are refreshed within about a minute when the underlying resource changes, while environment variables never update. This chapter carries the clearest contradiction with the minikube sibling: the minikube book says envFrom skips keys with dotted names, but on OpenShift's Kubernetes 1.35, with its relaxed env-var-name validation, envFrom actually exposes a dotted key like payment-service.conf as an environment variable. The chapter was rewritten to the OpenShift reality: the file mount is justified because a config file is useless as an env var, not because envFrom cannot expose it." },
      { n: "20", name: "Configuration Template",
        bullets: ["An init container renders a template against a per-environment overlay into a shared emptyDir before the app starts.",
          "The app reads the finished config file; switching dev to prod needs a new Pod (the init runs once).",
          "Combines init containers with ConfigMap-backed templating."],
        objective: "DO280/EX280: Manage storage and configuration (templated config).",
        notes: "Configuration Template handles the case where the final config is computed from a template plus some per-environment values, rather than stored ready-made. An init container renders the template against an overlay ConfigMap into a shared emptyDir volume, and the main container reads the finished file from that volume. The teaching point about lifecycle: the init container runs once at Pod start, so switching from the dev overlay to the prod overlay requires a new Pod, a rollout, not an in-place change. It is a clean combination of the init-container pattern with ConfigMap-driven templating." },
      { n: "21", name: "Immutable Configuration",
        bullets: ["immutable: true makes the API server reject any edit to a ConfigMap's or Secret's data.",
          "A change becomes a new, differently named resource plus a Deployment update, so it goes through rollout history.",
          "The trade: a versioned name per change, in exchange for an auditable, rollback-able config change."],
        objective: "DO280/EX280: Manage storage and configuration (immutable config).",
        notes: "Immutable Configuration closes a quiet risk: a ConfigMap or Secret that any process with write access can change in place, silently reconfiguring every Pod that uses it with no record. Setting immutable true makes the API server reject any edit to the data, so the only way to change a value is to create a new, differently named resource and update the Deployment to reference it, which routes the change through the Deployment's rollout history where it can be audited and rolled back. The cost is a versioned name per change; the benefit is that nothing about a running Pod's config shifts without a visible, deliberate update, and it applies identically to Secrets, which is where it matters most." },
    ],
  },
  {
    code: "05", title: "Advanced", subtitle: "Extending the platform",
    anchor: "appendix-25-operator",
    dividerNote: "The advanced family extends the platform itself: the reconcile loop every controller runs, autoscaling including scale-to-zero, in-cluster image builds, and a full Operator. This is where OpenShift's operator and build machinery is the native answer, and where two real OpenShift-vs-upstream differences appear.",
    patterns: [
      { n: "22", name: "Controller",
        bullets: ["Every controller runs the same level-triggered loop: watch, observe, diff, act, closing the gap between spec and reality.",
          "Shown twice: the built-in ReplicaSet controller (delete a Pod, it returns) and a custom controller-runtime reconciler.",
          "Owner references drive garbage collection; self-healing falls out of the loop, it is not a separate feature."],
        objective: "DO280/EX280: Manage Operators (the reconcile loop).",
        notes: "The Controller pattern is the single mechanism the rest of Kubernetes is built on: a level-triggered loop that watches an object, observes current state, diffs it against the spec, and acts to close the gap, every time, regardless of what triggered it. The appendix proves it twice against the same cluster, with the built-in ReplicaSet controller, delete a Pod and it is recreated, and with a custom controller-runtime reconciler we wrote. Level-triggered is the key word: because the loop re-reads reality every time rather than trusting an event, a controller that misses an event or crashes still converges. Self-healing is not a feature anyone coded; it falls out of running the same loop on every change, and owner references give you automatic garbage collection at no extra cost." },
      { n: "23", name: "Elastic Scale", diagram: true,
        bullets: ["HPA scales on CPU (never to zero); VPA recommends right-sized requests; the Custom Metrics Autoscaler scales to zero on an external signal.",
          "OpenShift findings: CRC ships no metrics API (install metrics-server); CMA has no HTTP add-on, so scale-to-zero uses a cron trigger.",
          "A workload has an HPA or a ScaledObject, never both on the same target."],
        objective: "DO280/EX280: Configure applications for reliability (autoscaling).",
        notes: "Elastic Scale answers how many replicas right now, from three sources. The HorizontalPodAutoscaler reads CPU and can never scale to zero, because a percentage cannot be computed from a Pod that is not running. The VerticalPodAutoscaler, from an OpenShift operator, recommends right-sized requests. The Custom Metrics Autoscaler, Red Hat's KEDA, reads an external signal, a queue, a schedule, that exists whether or not a Pod is running, and so can legitimately scale to zero. Two CRC findings matter: the resource metrics API is not installed by default, so you add a metrics-server before an HPA can read CPU at all; and the Custom Metrics Autoscaler does not ship the HTTP add-on upstream KEDA has, so scale-to-zero here is demonstrated with a cron trigger. And a hard rule the webhook enforces: a target has a standalone HPA or a KEDA ScaledObject, never both." },
      { n: "24", name: "Image Builder",
        bullets: ["OpenShift builds images in-cluster with Buildah (no Docker daemon, no privileged container), as a first-class BuildConfig.",
          "Docker strategy from a Containerfile or Source (S2I) strategy from plain source; a git-source build is stamped with its commit.",
          "Containerfile gotcha: the Docker strategy wants 'Dockerfile'; set dockerfilePath for a Containerfile project."],
        objective: "DO280/EX280: Manage application builds (BuildConfig, S2I).",
        notes: "Image Builder is where OpenShift's native machinery replaces the minikube-and-Kaniko story. A Build is a first-class API object: a BuildConfig that runs Buildah inside a Pod, with no Docker daemon and no privileged container anywhere, which is the security win Kaniko was invented for, built into the platform. The Docker strategy builds a Containerfile; the Source strategy, S2I, builds from plain source with no Containerfile at all by injecting it into a language builder image. A git-source build stamps the resulting image with the exact commit it came from, the traceability a real pipeline needs. The one gotcha: the Docker strategy looks for a file named Dockerfile, so a project using the Containerfile convention must set dockerfilePath explicitly or the build fails fast." },
      { n: "25", name: "Operator", diagram: true,
        bullets: ["An Operator is a CRD plus a controller: a new typed, validated API object plus the reconciler that acts on it.",
          "A Go controller-runtime ShippingPolicy operator, restricted-v2, all tests green including an envtest schema check.",
          "OpenShift finding: the OwnerReferencesPermissionEnforcement plugin requires a finalizers RBAC rule the minikube sibling omits."],
        objective: "DO280/EX280: Manage Operators (CRD-based operators).",
        notes: "An Operator is the combination that turns a controller into something more: a CustomResourceDefinition that registers a new, typed, validated API object, plus the controller that reconciles it. The appendix builds a real one in Go with controller-runtime, a ShippingPolicy operator that turns each policy into a Deployment and a ConfigMap, running under restricted-v2 with all four of its tests green, including an envtest that proves the CRD's schema validation against a real API server. The OpenShift-specific finding is a good porting lesson: OpenShift enables the OwnerReferencesPermissionEnforcement admission plugin by default, so the operator needs an RBAC rule granting update on the shippingpolicies/finalizers subresource, which the minikube sibling can omit; without it the very first reconcile fails with a clear permission error in the operator's log." },
    ],
  },
  {
    code: "06", title: "Security", subtitle: "Least privilege, enforced",
    anchor: "appendix-28-process-containment",
    dividerNote: "The security family is where OpenShift is strongest and most different from upstream: scoped RBAC, default-deny networking on OVN, the SCC model that has shaped every chapter, and Secret handling. Each one is a DO280/EX280 security objective worked live.",
    patterns: [
      { n: "26", name: "Access Control",
        bullets: ["A dedicated ServiceAccount plus a Role scoped by resourceNames grants exactly the named objects, nothing else.",
          "resourceNames scopes get/update/delete, but not list or watch, which return collections.",
          "A ClusterRole bound by a namespaced RoleBinding (e.g. view) scopes a reusable rule set to one namespace."],
        objective: "DO280/EX280: Configure security (RBAC).",
        notes: "Access Control is least-privilege RBAC. Give a workload its own ServiceAccount instead of the shared default, grant that identity a Role scoped by resourceNames to exactly the ConfigMap and Secret it needs, and leave default with nothing. The sharp edge to teach: resourceNames only scopes verbs that name a single object, get, update, patch, delete; it has no effect on list or watch, which return collections, so granting list quietly grants it across the whole namespace. On OpenShift you verify all of this with oc auth can-i as the service account, and you reuse the built-in view, edit, and admin ClusterRoles by binding them with a namespaced RoleBinding to confine them to one namespace." },
      { n: "27", name: "Network Segmentation", diagram: true,
        bullets: ["A default-deny NetworkPolicy plus one allow rule restricts which Pods can reach a service; egress works the same way.",
          "OpenShift: OVN-Kubernetes enforces NetworkPolicy natively, no Calico step needed.",
          "DNS egress targets openshift-dns on port 5353 (not kube-dns:53), a key reframe from minikube."],
        objective: "DO280/EX280: Configure networking (NetworkPolicy).",
        notes: "Network Segmentation replaces the flat default network, where any Pod can reach any Pod, with explicit allow rules. A default-deny NetworkPolicy scoped to one workload's Pods, plus a single allow rule naming the one legitimate caller by label and port, is the shape; egress policy restricts outbound the same way. Two OpenShift differences from the minikube sibling: the default CNI is OVN-Kubernetes, which enforces NetworkPolicy natively, so there is no Calico prerequisite step; and the DNS egress rule must target the openshift-dns namespace on port 5353, not kube-dns on 53, which is the most common way this policy half-works, the Pod can reach Postgres but cannot resolve names and never goes ready." },
      { n: "28", name: "Process Containment", diagram: true,
        bullets: ["securityContext: non-root, drop all capabilities, read-only root filesystem, RuntimeDefault seccomp.",
          "The restricted-v2 SCC injects an arbitrary non-root UID; omit runAsUser and let it assign one.",
          "SCC and Pod Security Admission are two admission layers; a privileged Pod is rejected by both."],
        objective: "DO280/EX280: Configure security (SCC, securityContext).",
        notes: "Process Containment is the SCC chapter, the mechanism that has shaped every example in the appendix. The securityContext hardens a container: run as non-root, drop every Linux capability, make the root filesystem read-only with one explicit writable volume, and turn on the default seccomp filter. The OpenShift-defining behavior is that the restricted-v2 SCC injects an arbitrary non-root UID from the project's range, so you set runAsNonRoot true and omit runAsUser, because a hardcoded UID would be rejected. And there are two independent admission layers: the SCC, which mutates and admits, and Pod Security Admission, the upstream standard; a privileged Pod is refused by both, which you can watch happen with a clear message naming the field." },
      { n: "29", name: "Secure Configuration",
        bullets: ["A Secret is base64, not encryption; oc describe redacts but oc get -o yaml decodes in one line.",
          "Consume it as an env var or a mounted file; the file is the tighter exposure.",
          "OpenShift: a projected Secret file is effectively 0440 under the arbitrary UID (owner root, group = injected fsGroup), never world-readable."],
        objective: "DO280/EX280: Configure security (Secrets).",
        notes: "Secure Configuration is about treating a Secret as a credential rather than a ConfigMap with a different name. The first thing to internalize is that base64 is encoding, not encryption, a Secret's value is one oc get and one base64 decode away, so its real protection comes from RBAC and, optionally, etcd encryption at rest, which is off by default on CRC. Consuming a Secret as a mounted file rather than an environment variable removes an exposure surface, process environment dumps and child-process inheritance. The OpenShift nuance the chapter documents: a projected Secret file asked for as mode 0400 comes out effectively 0440, owned by root with the group set to the Pod's injected fsGroup, because the arbitrary-UID container is not the file owner and reads it through its group, and it is still never world-readable." },
    ],
  },
  {
    code: "07", title: "Operations", subtitle: "What the patterns leave out",
    anchor: "appendix-30-observability-and-debugging",
    dividerNote: "The operations family fills the gaps the pattern families leave: seeing into a running Pod, packaging a deployment, and governing a namespace's resources. These are the day-two skills DO280 and EX280 test directly.",
    patterns: [
      { n: "30", name: "Observability and Debugging",
        bullets: ["oc logs (-p/-c/-f), exec, port-forward, describe, and get events are the five windows into a running Pod.",
          "Two debuggers: oc debug (a pod copy, works under restricted-v2) and kubectl debug ephemeral containers.",
          "On OpenShift, ephemeral containers need --profile=restricted; --target/ps is blocked (SYS_PTRACE)."],
        objective: "DO280/EX280: Troubleshoot applications.",
        notes: "Observability and Debugging is the day-two toolkit. oc logs, with its previous, container, and follow flags, oc exec, oc port-forward (a debug tool, never an exposure path, Routes are for that), oc describe, and oc get events are the five windows that answer almost every what-is-wrong question. For tools the image does not carry, OpenShift gives you two debuggers: oc debug, which starts a copy of the Pod with a shell and works cleanly under restricted-v2, and ephemeral containers via kubectl debug, which attach to the running Pod but need the restricted profile, and whose process-namespace sharing is blocked because restricted-v2 drops the SYS_PTRACE capability, which is why oc debug is the practical default on OpenShift." },
      { n: "31", name: "Packaging: Helm and Kustomize",
        bullets: ["Helm packages a deployment as a versioned release you install, upgrade, and roll back.",
          "Kustomize patches plain YAML with overlays, no templating and no release object; oc has it built in.",
          "A real cluster often runs both: a vendor Helm chart plus your own Kustomize overlays."],
        objective: "DO280/EX280: Deploy and manage applications (packaging).",
        notes: "Packaging covers the two ways Kubernetes manifests get parameterized for more than one environment. Helm treats manifests as a template rendered from values into a numbered release you can install, upgrade, and roll back as a unit. Kustomize treats them as data: a base of plain YAML plus overlays that patch specific fields, with no templating language and no release object, and oc has Kustomize built in so no extra tool is needed. Neither is strictly better; a vendor's database chart is a Helm problem, your own service with small per-environment differences is often a Kustomize problem, and real clusters run both, with OpenShift GitOps reconciling either." },
      { n: "32", name: "Namespace Governance",
        bullets: ["ResourceQuota caps a namespace's totals; LimitRange defaults and bounds each container.",
          "LimitRange (mutating) runs before ResourceQuota (validating), so a defaulted CPU limit satisfies a limits.cpu quota.",
          "OpenShift adds ClusterResourceQuota across projects and a project template for default guardrails."],
        objective: "DO280/EX280: Configure resource limits and quotas.",
        notes: "Namespace Governance is the administrator's side of resource management. A ResourceQuota caps a namespace's aggregate consumption, and a violation is reported on the ReplicaSet, not a Pod, because no Pod is ever created. A LimitRange works one level down, defaulting and bounding each container. The ordering is the clever part: LimitRange is a mutating admission step that runs before ResourceQuota's validating one, so a container that sets no CPU limit gets the LimitRange default stamped in, and that default is already present when the quota's limits.cpu dimension counts it. OpenShift adds two pieces on top: ClusterResourceQuota, which caps consumption across many projects at once, and a customizable project template so every new project is born with quota and limits already applied." },
    ],
  },
];

// ---- Cover ------------------------------------------------------------------
{
  const s = pres.addSlide(); pageNum += 1;
  s.background = { color: COLOR.white };
  try { s.addImage({ path: `${ASSETS}/cover-panel.png`, x: 0, y: 0, w: W, h: 7.5 }); } catch (e) {}
  s.addText("KUBERNETES PATTERNS", { x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 5, align: "left", valign: "middle" });
  s.addText([{ text: "33 patterns,", options: { breakLine: true } }, { text: "on OpenShift" }], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00, fontFace: FONT.title, fontSize: 52, bold: true, color: COLOR.ink, align: "left", valign: "top" });
  s.addText("The Kubernetes design patterns, each worked live on OpenShift Local under restricted-v2 and mapped to a DO280/EX280 objective.", {
    x: 6.00, y: 4.55, w: 6.70, h: 1.20, fontFace: FONT.body, fontSize: 17, italic: true, color: COLOR.caption, align: "left", valign: "top" });
  s.addText(REV, { x: 11.85, y: 5.85, w: 0.95, h: 0.30, fontFace: FONT.mono, fontSize: 11, color: COLOR.caption, align: "right", valign: "middle" });
  try { s.addImage({ path: `${ASSETS}/logo-candidate-2.png`, x: 11.10, y: 6.80, w: 1.55, h: 0.37 }); } catch (e) {}
  note(s, "This deck works the Kubernetes design patterns, the catalog from Ibryam and Huss, on OpenShift specifically, and maps each one to the DO280 course and EX280 exam objective it reconciles against. Every pattern in here was built and verified live on an OpenShift Local cluster under the restricted-v2 security model, not described from the book, so the findings are what actually happened on the cluster, including the handful of places OpenShift differs from upstream Kubernetes. We move through six pattern families, foundational, structural, behavioral, configuration, advanced, and security, then three operations gap chapters, and close with the exam crosswalk. It pairs with the tutorial's §18 appendix, which is the written, runnable version of everything here.");
}

// ---- Overview ---------------------------------------------------------------
{
  const s = S();
  addContentTitle(s, "OVERVIEW", "Six families, three gaps, one exam");
  addTwoColBullets(s,
    [
      "**Foundational** (01-05): what every workload declares.",
      "**Structural** (06-09): shaping a multi-container Pod.",
      "**Behavioral** (10-17): how workloads run over time.",
      "**Configuration** (18-21): config out of the image.",
    ],
    [
      "**Advanced** (22-25): extending the platform itself.",
      "**Security** (26-29): least privilege, enforced.",
      "**Operations** (30-32): the day-two gaps.",
      "**Crosswalk**: every pattern mapped to DO280/EX280.",
    ],
    { fontSize: 15 });
  addCaption(s, "33 patterns, each verified live on OpenShift Local under restricted-v2, each tied to an exam objective.");
  note(s, "Here is the map. Six pattern families in reading order: foundational, the shape every workload takes; structural, multi-container Pod design; behavioral, how workloads run over their lifetime; configuration, keeping config out of the image; advanced, extending the platform with controllers, operators, builds, and autoscaling; and security, the least-privilege model. Then three operations chapters that fill what the patterns leave out: observability, packaging, and governance. And a closing crosswalk that maps all thirty-three to their DO280 and EX280 objective areas. Every one was worked live on the cluster, so where OpenShift differs from the book, and it does in several places, the deck tells you what actually happened, not what should have.");
}

// ---- Render each family -----------------------------------------------------
for (const fam of FAMILIES) {
  divider(fam.code, fam.title, fam.subtitle, fam.dividerNote);
  for (const p of fam.patterns) {
    const s = S();
    if (p.diagram) {
      addDiagramSlide(s, `${fam.title.toUpperCase()} · ${p.n}`, p.name, `appendix-${p.n}-${slug(p.name)}`, p.objective);
    } else {
      addContentTitle(s, `${fam.title.toUpperCase()} · ${p.n}`, p.name);
      addBullets(s, p.bullets, { fontSize: 15 });
      addCaption(s, p.objective);
    }
    note(s, p.notes);
  }
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---- Crosswalk --------------------------------------------------------------
divider("08", "DO280/EX280 Crosswalk", "Every pattern, mapped to an objective",
  "The appendix closes with a crosswalk: each of the thirty-three chapters mapped to the EX280 objective area it reconciles against, with a coverage count and a fifteen-task self-test against the shipping services. Here is the shape of that coverage.");

{
  const s = S();
  addContentTitle(s, "CROSSWALK", "Coverage by objective area");
  addStatusTable(s, [
    { code: "8", name: "Deploy & manage apps", purpose: "Declarative deployment, lifecycle, placement, init/sidecar/ambassador, Jobs, CronJobs, DaemonSets, packaging." },
    { code: "7", name: "Storage & configuration", purpose: "Stateless/stateful, Downward API, env vars, bulk config, templates, immutable config." },
    { code: "6", name: "Reliability", purpose: "Predictable demands, health probes, adapter, PodDisruptionBudget, elastic scale, governance." },
    { code: "3", name: "Security", purpose: "Access control (RBAC), process containment (SCC), secure configuration (Secrets)." },
    { code: "2", name: "Networking", purpose: "Service discovery (Routes), network segmentation (NetworkPolicy)." },
    { code: "2", name: "Operators", purpose: "The controller reconcile loop, and a full CRD-based operator." },
  ], { colW: [0.8, 3.1, 8.19], rowH: 0.58 });
  addCaption(s, "Plus builds (1) and troubleshooting (2); every EX280 objective area has direct, live-verified coverage.");
  note(s, "This is the coverage the crosswalk tabulates. Deploy and manage applications is the largest area, eight patterns, because so much of the catalog is about the shape and lifecycle of workloads. Storage and configuration is next with seven, then reliability with six. Security has three dedicated patterns but an outsized influence, because restricted-v2 touches every single example. Networking and operators have two each, builds has one, and troubleshooting has two. The point of the crosswalk is not the exact counts; it is that every EX280 objective area has direct, live-verified coverage, so the appendix doubles as exam preparation, and the fifteen-task self-test at the end lets you check yourself against the shipping services on a real cluster.");
}

// ---- Close ------------------------------------------------------------------
{
  const s = S();
  addContentTitle(s, "EXPLORE", "Read it, run it, sit the exam");
  addBullets(s, [
    "**The appendix:** patterncatalyst.github.io/openshift-local-on-fedora/appendix/k8s-patterns (all 33 chapters, each with a runnable example and verified output).",
    "**The source:** github.com/patterncatalyst/openshift-local-on-fedora (every manifest, the Go operator, and the diagrams in editable form).",
    "**Companion decks:** OpenShift 101 (the cluster) and OpenShift 201 (the data mesh built on it).",
  ], { fontSize: 15 });
  addCaption(s, "Every pattern here is reproducible on a Fedora workstation with CRC; work the self-test before the exam.");
  note(s, "Everything in this deck is written up in full in the tutorial's patterns appendix, thirty-three chapters, each with a runnable example, the exact oc commands, and their real output, so you can work any pattern on your own cluster. The source repository carries every manifest, the Go operator with its tests, and the diagrams in editable form. If OpenShift Local itself or the data-mesh application is where you want to start, the 101 and 201 decks cover those. And if EX280 is the goal, work the crosswalk's fifteen-task self-test against a live cluster until each one is muscle memory; that, plus the DO280 course, is what the appendix was built to support.");
}

// ---- finalize ---------------------------------------------------------------
if (notesCount !== pageNum) { throw new Error(`notes ${notesCount} != slides ${pageNum}`); }
pres.writeFile({ fileName: OUT }).then(() => {
  console.log(`wrote ${OUT}: ${pageNum} slides, ${notesCount} with notes`);
});
