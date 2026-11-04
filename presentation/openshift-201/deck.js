// deck.js : OpenShift 201 - Data Mesh on OpenShift (CRC).
// Implementation deck: build the data-mesh reference application on a single
// CRC cluster. Mined from the main tutorial (chapters 5-17). Notes on every slide.
//
// Build:  export NODE_PATH=$PWD/../node_modules DECK_ASSETS=../assets DECK_PNG=./png && node deck.js

"use strict";

const H = require("../deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addSectionDivider, addNotes,
} = H;

const OUT = "openshift-201-r01.0.pptx";
const REV = "r01.0";

const pres = newDeck();
pres.title = "OpenShift 201: Data Mesh on OpenShift (CRC)";
let pageNum = 0;
let notesCount = 0;

function S() { const s = pres.addSlide(); pageNum += 1; addFooter(s, pageNum); return s; }
function note(s, text) {
  if (!text || !text.trim()) throw new Error(`slide ${pageNum} has no speaker notes`);
  addNotes(s, text); notesCount += 1;
}
function divider(code, title, subtitle, notes) {
  const s = pres.addSlide(); pageNum += 1; addSectionDivider(s, code, title, subtitle); note(s, notes);
}

// ---- Cover ------------------------------------------------------------------
{
  const s = pres.addSlide(); pageNum += 1;
  s.background = { color: COLOR.white };
  try { s.addImage({ path: `${ASSETS}/cover-panel.png`, x: 0, y: 0, w: W, h: 7.5 }); } catch (e) {}
  s.addText("OPENSHIFT 201", { x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 6, align: "left", valign: "middle" });
  s.addText([{ text: "A data mesh,", options: { breakLine: true } }, { text: "on one cluster" }], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00, fontFace: FONT.title, fontSize: 52, bold: true, color: COLOR.ink, align: "left", valign: "top" });
  s.addText("Build the seven-service data-mesh reference application on a single OpenShift Local cluster: images, Helm, persistent state, scaling, the mesh, and the platform operators.", {
    x: 6.00, y: 4.55, w: 6.70, h: 1.20, fontFace: FONT.body, fontSize: 17, italic: true, color: COLOR.caption, align: "left", valign: "top" });
  s.addText(REV, { x: 11.85, y: 5.85, w: 0.95, h: 0.30, fontFace: FONT.mono, fontSize: 11, color: COLOR.caption, align: "right", valign: "middle" });
  try { s.addImage({ path: `${ASSETS}/logo-candidate-2.png`, x: 11.10, y: 6.80, w: 1.55, h: 0.37 }); } catch (e) {}
  note(s, "This is the hands-on companion to the 101 deck. The 101 established the model: a single-node OpenShift cluster, oc, Projects, restricted-v2, Routes, Operators, and the integrated registry. Here we put all of it to work by building one realistic application, a data-mesh reference architecture of seven cooperating services, on that cluster. We cover how images get onto CRC, how Helm packages the deployment under restricted-v2, how stateful components get persistent storage, how workloads scale, how the service mesh secures traffic, and how the platform operators layer on. By the end you have seen every moving part of a production-shaped OpenShift deployment, running on a laptop. This assumes the 101 model; if a term like restricted-v2 or Route is new, start there.");
}

// ---- The application --------------------------------------------------------
divider("01", "The application", "A data mesh of seven services",
  "Before deploying anything we need to know what we are deploying. The reference application is a small data mesh: a set of independent data-product services, each owning its own data and exposing it over a well-defined contract, with a gateway composing them. It is multi-protocol by design, so the deployment exercises REST, gRPC, GraphQL, and Kafka on one cluster.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 1 · ARCHITECTURE", "The seven-service data mesh",
    "capstone-datamesh",
    "A GraphQL gateway behind an edge-TLS Route fronts six data-product services over REST, gRPC, GraphQL, and Kafka; app Pods run restricted-v2, infra runs nonroot-v2, images come from the integrated registry.");
  note(s, "Here is the whole system on one cluster. A GraphQL gateway sits behind an edge-TLS Route and composes reads from six data-product services: inventory, order, payment, shipping, notification, and the catalog behind the gateway itself. The services talk over a mix of protocols by design: REST, gRPC between order and inventory, GraphQL at the gateway, and Kafka for the event flow, so that deploying this one application exercises every kind of traffic an OpenShift cluster has to carry. Two security tiers show up immediately: the application services run under the default restricted-v2 SCC with no fixed UID, while the infrastructure that needs a pinned user, Postgres and Kafka, runs under the nonroot-v2 SCC with an explicit UID and fsGroup. Every image is built into and pulled from the cluster's own integrated registry. This is the architecture the following sections build up piece by piece.");
}

{
  const s = S();
  addContentTitle(s, "SECTION 1 · DATA MESH", "Why this shape");
  addBullets(s, [
    "**Each service owns its data.** A data product exposes its domain over a contract (REST, gRPC, or GraphQL) and keeps its own storage; no shared database couples two services together.",
    "**The gateway composes, it doesn't own.** `graphql-gateway` federates reads across services at query time, so a client asks one endpoint and the gateway fans out.",
    "**Events decouple writes.** Order placement flows over Kafka, so a slow or absent consumer never blocks the producer.",
    "**It maps cleanly onto Kubernetes.** Each data product is a Deployment plus a Service; the contracts are ports; the mesh and the registry are the platform underneath.",
  ], { fontSize: 15 });
  addCaption(s, "A data mesh is an architecture of independently owned data products; Kubernetes is a natural substrate for it.");
  note(s, "A quick word on why the application takes this shape, because it drives every deployment decision that follows. A data mesh treats each domain as a data product: a service that owns its data and exposes it over an explicit contract, rather than many services sharing one database. Inventory owns stock levels and exposes them over gRPC; order owns orders and calls inventory to check stock; the gateway owns nothing but composes reads across all of them so a client has a single endpoint to query. Writes that need to ripple, like an order being placed, travel over Kafka so the producer never waits on the consumer. The reason this matters for an OpenShift deck is that the architecture maps one-to-one onto Kubernetes primitives: each data product is a Deployment and a Service, each contract is a port, and the platform concerns, securing the traffic, scaling it, storing the state, are exactly the OpenShift features we are here to exercise.");
}

// ---- Images -----------------------------------------------------------------
divider("02", "Images on the cluster", "Build into the integrated registry",
  "Nothing runs until the images exist where the cluster can pull them. On OpenShift that place is the integrated registry, and there are two ways to get images there: push them from your workstation, or build them inside the cluster. We use both.");

{
  const s = S();
  addContentTitle(s, "SECTION 2 · REGISTRY", "Two ways to get an image in");
  addStatusTable(s, [
    { code: "podman push", name: "From the host", purpose: "Build locally, log in to the external registry route, and push. Fast for iterating; the image lands in the integrated registry as an ImageStream tag." },
    { code: "BuildConfig", name: "In the cluster", purpose: "oc start-build runs Buildah inside a Pod (no Docker daemon, no privileged container), from a local dir or a git commit, and pushes to the same registry." },
    { code: "ImageStream", name: "The reference", purpose: "Either way, a Deployment pulls by the in-cluster service address or a bare ImageStream tag that OpenShift resolves to a digest." },
  ], { colW: [2.3, 2.3, 7.49] });
  addCaption(s, "Host push for speed, in-cluster BuildConfig for a CI-shaped build traceable to a commit; one registry behind both.");
  note(s, "Getting images onto the cluster is the first concrete step. The quick path is to build with podman on your laptop, log in to the registry's external route, and push; the image appears in the integrated registry as an ImageStream tag and a Deployment can use it immediately. The production-shaped path is an in-cluster build: a BuildConfig that runs Buildah inside a Pod, with no Docker daemon and no privileged container anywhere, building either from a directory you upload or straight from a git commit. The git-source build is the interesting one because the resulting image is stamped with the exact commit it came from, which is the traceability a real pipeline needs. Both paths end in the same place, the integrated registry, and a Deployment references the result either by the in-cluster service address or by a bare ImageStream tag that OpenShift resolves to an exact digest. For the data mesh we build each of the seven service images once and retain them as ImageStreams.");
}

// ---- Helm -------------------------------------------------------------------
divider("03", "Deploying with Helm", "One chart, restricted-v2 clean",
  "With images in place, the deployment itself is a Helm chart. The chart templates every service's Deployment, Service, ConfigMap, and Route, and critically, every Pod template is written to satisfy restricted-v2 out of the box so nothing needs an elevated SCC.");

{
  const s = S();
  addCodeSlide(s, "SECTION 3 · HELM", "The restricted-v2 Pod template", "yaml", [
    "securityContext:                 # pod level",
    "  runAsNonRoot: true             # let the SCC inject the UID",
    "  seccompProfile: { type: RuntimeDefault }",
    "containers:",
    "  - name: inventory-service",
    "    securityContext:             # container level",
    "      allowPrivilegeEscalation: false",
    "      runAsNonRoot: true",
    "      capabilities: { drop: [ALL] }",
    "      seccompProfile: { type: RuntimeDefault }",
    "    # no runAsUser: restricted-v2 assigns one from the project range",
  ], "Every service in the chart carries this shape; a clean image is admitted by the default SCC with no exception granted.");
  note(s, "This is the single most important piece of the whole deployment, and it is why the chart deploys without anyone running oc adm policy to grant a special SCC. Every Pod template in the chart carries this security context: at the pod level, run as non-root and turn on the default seccomp profile; at the container level, forbid privilege escalation, drop every capability, and set seccomp again. The omitted field is runAsUser: we do not set it, because restricted-v2 injects a UID from the project's range and a hardcoded one would be rejected if it fell outside that range. Because the service images were built to run as any UID, owning their files by group zero, they come up cleanly under this context. The lesson for anyone deploying their own application to OpenShift: write the security context into the chart from the start, build images that tolerate an arbitrary UID, and the default SCC admits everything with no elevation.");
}

{
  const s = S();
  addDiagramSlide(s, "SECTION 3 · SECURITY", "The SCC admits every service Pod",
    "deploy-scc",
    "Each service Deployment makes a ReplicaSet and Pods; restricted-v2 admits them and assigns each a non-root UID from the project's range, no elevated SCC required.");
  note(s, "To close the Helm section, here is what happens at deploy time across all seven services at once. Each service's Deployment creates a ReplicaSet, which creates Pods, and every one of those Pods passes through restricted-v2 admission and comes up running as an injected non-root UID. Nothing in the chart asked for anyuid or privileged; nothing needed to. The one exception in the whole application is the infrastructure tier, Postgres and Kafka, which require a pinned UID to own their data directories, and those get the nonroot-v2 SCC granted to a dedicated service account, a scoped exception to exactly the workloads that require it rather than a blanket loosening. That contrast, restricted-v2 for the thirteen application Pods and a narrowly granted nonroot-v2 for the two infrastructure ones, is the security posture a real OpenShift deployment aims for.");
}

// ---- Storage ----------------------------------------------------------------
divider("04", "Persistent state", "Storage for the data products",
  "Application services are stateless and scale freely, but the data products are backed by Postgres, which is not. This section covers how persistent storage works on CRC and how a stateful component claims it.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 4 · STORAGE", "A claim binds to a volume on the node",
    "persistent-storage",
    "A Pod mounts a PersistentVolumeClaim; the default hostpath StorageClass provisions a PersistentVolume on the CRC node's disk, and the claim binds when the first Pod mounts it.");
  note(s, "Persistent storage on CRC is simple. The cluster ships a default StorageClass backed by a hostpath provisioner, which carves persistent volumes out of the single node's own disk. A stateful component declares a PersistentVolumeClaim, and when the first Pod that mounts it is scheduled, the provisioner creates a PersistentVolume and binds the claim to it. One behavior that differs from some clusters: the default class uses WaitForFirstConsumer, so the claim stays Pending until a Pod actually mounts it, rather than binding immediately. That is expected, not a defect. For the data mesh, Postgres runs as a StatefulSet with a volumeClaimTemplate, which gives each replica its own stable claim and its own volume that survives a Pod restart, and it runs under nonroot-v2 with a pinned UID and fsGroup so it can own its data directory.");
}

// ---- Scaling ----------------------------------------------------------------
divider("05", "Scaling", "From CPU to scale-to-zero",
  "A deployed service should track demand without a human editing replica counts. OpenShift gives you a built-in HorizontalPodAutoscaler and, through the Custom Metrics Autoscaler operator, event-driven scaling all the way to zero.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 5 · AUTOSCALING", "An autoscaler sets the replica count",
    "autoscaling",
    "An autoscaler reads a load signal (CPU, a queue, or a cron schedule) and sets the Deployment's replica count between a min and a max, so the Pod count tracks demand.");
  note(s, "Scaling on OpenShift comes in two flavors that answer the same question, how many replicas right now, from different signals. The HorizontalPodAutoscaler reads CPU utilization against each Pod's request and scales a Deployment between a floor and a ceiling; its floor can never be zero, because a CPU percentage cannot be computed from a Pod that is not running. For scale-to-zero you install the Custom Metrics Autoscaler, Red Hat's supported build of KEDA, which reads an external signal, a Kafka queue's depth, an HTTP rate, or a cron schedule, none of which require a running Pod to measure, and can therefore legitimately scale a workload down to zero and back up on demand. One practical CRC note: the resource metrics API is not installed by default, so an HPA needs a lightweight metrics-server added before it can read CPU at all. In the data mesh, the HPA handles the steady services and the autoscaler handles the bursty, event-driven ones.");
}

// ---- Mesh -------------------------------------------------------------------
divider("06", "The mesh", "mTLS between services",
  "Seven services talking over four protocols is exactly the case a service mesh exists for. OpenShift Service Mesh, built on Istio, adds mutual TLS, traffic policy, and observability without changing a line of application code.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 6 · SERVICE MESH", "The mesh secures traffic with mTLS",
    "service-mesh",
    "The istiod control plane configures an Envoy sidecar in each Pod; the sidecars carry the traffic and enforce STRICT mutual TLS between services.");
  note(s, "OpenShift Service Mesh, the product name for a supported Istio, is how the data mesh secures service-to-service traffic. When a namespace is enrolled in the mesh, every Pod gets an Envoy sidecar injected, and on recent OpenShift that sidecar is a native sidecar container, so the Pod reports ready only when both the app and the proxy are up. The istiod control plane pushes configuration and certificates to those sidecars, and with a STRICT peer-authentication policy, all traffic between meshed Pods is mutual TLS, each end cryptographically proving its identity, with no change to the application code that only ever speaks plain HTTP or gRPC to localhost. On top of mTLS the mesh gives you traffic shaping; a canary release shifts weight between two subsets, and a console, Kiali, to see the whole call graph. This is the platform tier: you adopt it by installing operators and labeling a namespace, not by rewriting services.");
}

// ---- Operators --------------------------------------------------------------
divider("07", "The platform tier", "Operators do the heavy lifting",
  "The mesh, the autoscaler, Kafka, and observability all arrive the same way: as operators installed from OperatorHub and managed by OLM. This is how an OpenShift cluster grows the capabilities a real application needs.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 7 · OPERATORS", "Install capabilities through OLM",
    "operator-olm",
    "A pinned Subscription yields an InstallPlan you approve, which installs a ClusterServiceVersion; a Succeeded CSV and its CRDs confirm the capability is ready to use.");
  note(s, "Everything that is not the application itself arrives as an operator. AMQ Streams brings Kafka; OpenShift Service Mesh brings Istio and Kiali; the Custom Metrics Autoscaler brings KEDA; the Red Hat build of OpenTelemetry and a Grafana stack bring observability. Each one is installed the same careful way the 101 deck introduced: a Subscription that pins an exact version and requires manual approval, producing an InstallPlan you approve, which lays down the ClusterServiceVersion and its custom resource definitions. Once a CSV reads Succeeded, you create that operator's custom resources, a Kafka, an Istio control plane, a KedaController, and the capability is live. Pinning versions matters here more than anywhere, because the platform tier is the part most likely to drift and break a reproducible setup; the tutorial records the exact CSV for each operator and re-checks it against the catalog before each run.");
}

{
  const s = S();
  addContentTitle(s, "SECTION 7 · THE PLATFORM SET", "What the data mesh installs");
  addStatusTable(s, [
    { code: "AMQ Streams", name: "Kafka", purpose: "The event backbone: a single-node KRaft Kafka the order and notification flow publish to and consume from." },
    { code: "OSSM 3", name: "Service mesh", purpose: "Istio plus Kiali: STRICT mTLS between services and a console for the call graph." },
    { code: "CMA", name: "Autoscaler", purpose: "The Custom Metrics Autoscaler (KEDA): event-driven scaling, including scale-to-zero on a queue or schedule." },
    { code: "RH OTel", name: "Observability", purpose: "The Red Hat build of OpenTelemetry feeding a Grafana LGTM stack: traces, metrics, and logs in one place." },
  ], { colW: [2.1, 2.1, 7.89] });
  addCaption(s, "Four operators turn a bare cluster into the platform a production-shaped data mesh runs on.");
  note(s, "This is the concrete platform set the data mesh deployment installs, and it is a useful template for any real OpenShift application. AMQ Streams gives you Kafka as the event backbone; the order service publishes an order-placed event and the notification service consumes it, decoupled through the broker. OpenShift Service Mesh 3 gives you mTLS and the Kiali console. The Custom Metrics Autoscaler gives you event-driven scaling, including the scale-to-zero the HPA cannot do. And the Red Hat build of OpenTelemetry, feeding a Grafana LGTM stack of Loki, Grafana, Tempo, and Mimir, gives you traces, metrics, and logs in one console. Each is pinned, each is opt-in, and together they are the difference between a cluster that runs Pods and a platform that operates an application. The tutorial's final project brings all four up and verifies the data mesh end to end on top of them.");
}

// ---- Operate ----------------------------------------------------------------
divider("08", "Operating it", "See inside a running mesh",
  "Once the data mesh is running, you need to see into it. The same oc tools the 101 deck introduced, plus the mesh console and the observability stack, are how you operate and debug a live system.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 8 · OPERATE", "oc reaches into a running Pod",
    "editor-shell",
    "oc reaches into a running Pod with rsh, exec, cp, and port-forward, and oc debug starts a throwaway copy for a workload that will not stay up.");
  note(s, "Operating the running system uses the toolkit the 101 deck introduced and the patterns appendix develops in full. oc logs, oc exec, and oc rsh get you inside a container; oc cp moves files; oc port-forward reaches one specific Pod directly for debugging, never as a way to expose the application, which is always a Route. For a workload that will not stay up long enough to exec into, oc debug starts a throwaway copy of its Pod with a shell, which works cleanly under restricted-v2. Above the per-Pod tools, Kiali shows the live mesh call graph and the Grafana stack shows traces, metrics, and logs correlated together, so when an order does not produce a notification you can follow the request from the gateway through the order service, across Kafka, to the consumer. That end-to-end visibility is the payoff of the platform tier.");
}

// ---- Wrap -------------------------------------------------------------------
divider("09", "Wrap-up", "What you built",
  "That is the data mesh, end to end, on one OpenShift Local cluster. Every layer you touched, images, Helm, storage, scaling, the mesh, the operators, is a layer of a real production deployment.");

{
  const s = S();
  addContentTitle(s, "WRAP-UP", "A production shape, on a laptop");
  addTwoColBullets(s,
    [
      "**Images** built into the integrated registry, host-push or in-cluster BuildConfig.",
      "**Helm** deploys all seven services restricted-v2 clean, no elevated SCC.",
      "**Storage** via the default StorageClass; Postgres as a StatefulSet under nonroot-v2.",
    ],
    [
      "**Scaling** with the HPA and the Custom Metrics Autoscaler to zero.",
      "**Mesh** mTLS and Kiali; **operators** for Kafka, mesh, scaling, and observability.",
      "**Operate** with oc, oc debug, Kiali, and the Grafana stack.",
    ],
    { fontSize: 15 });
  addCaption(s, "Nothing here needed a cloud; the same manifests run on a production OpenShift cluster unchanged.");
  note(s, "To recap what you built: seven service images in the integrated registry; a Helm chart that deploys all of them clean under restricted-v2 with no elevated SCC; persistent Postgres as a StatefulSet under a scoped nonroot-v2 grant; autoscaling from CPU-based HPA up to event-driven scale-to-zero; a service mesh enforcing mTLS with a Kiali console; four platform operators for Kafka, mesh, scaling, and observability; and the oc toolkit plus Kiali and Grafana to operate it. Every one of those layers is a real production concern, and you exercised all of them on a single laptop with no cloud account. The manifests you wrote run unchanged against a multi-node production OpenShift cluster, because, as the 101 deck promised, CRC is the same software. From here, the Kubernetes Patterns appendix deck works the design patterns underneath all of this against the DO280 and EX280 exam objectives.");
}

{
  const s = S();
  addContentTitle(s, "EXPLORE", "Build it yourself");
  addBullets(s, [
    "**The final-project chapter:** patterncatalyst.github.io/openshift-local-on-fedora walks the full data-mesh build and verification on CRC, step by step.",
    "**The source:** github.com/patterncatalyst/openshift-local-on-fedora carries the Helm chart, the operator subscriptions, and every verification script.",
    "**Go deeper:** the Kubernetes Patterns appendix deck works the 33 design patterns underneath this application, mapped to DO280/EX280.",
  ], { fontSize: 16 });
  addCaption(s, "Everything is reproducible on a Fedora workstation with CRC sized to 12 CPUs and 32 GB.");
  note(s, "The full build is written up as the tutorial's final project, which walks every step we compressed into this deck, bringing up the platform operators, deploying the chart, and verifying the data mesh end to end with real traffic, all with the exact commands and their output. The source repository has the Helm chart, the pinned operator subscriptions, and the verification scripts so you can run the whole thing yourself; size the CRC VM to twelve CPUs and thirty-two gigabytes for the platform tier and it runs comfortably on a developer laptop. When you want to understand the Kubernetes design patterns that sit underneath this application, the patterns appendix deck is the next one, and it doubles as DO280 and EX280 exam preparation.");
}

// ---- finalize ---------------------------------------------------------------
if (notesCount !== pageNum) { throw new Error(`notes ${notesCount} != slides ${pageNum}`); }
pres.writeFile({ fileName: OUT }).then(() => {
  console.log(`wrote ${OUT}: ${pageNum} slides, ${notesCount} with notes`);
});
