// deck.js : OpenShift 101: OpenShift Local (CRC) on Fedora.
// Orientation deck: what CRC is, the mental model, and the moving parts.
// Mined from the main tutorial (chapters 1-9). Speaker notes on every slide.
//
// Build:  export NODE_PATH=$PWD/../node_modules && node deck.js

"use strict";

const H = require("../deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addSectionDivider, addNotes,
} = H;

const OUT = "openshift-101-r01.0.pptx";
const REV = "r01.0";

const pres = newDeck();
pres.title = "OpenShift 101: OpenShift Local (CRC) on Fedora";
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
  s.addText("OPENSHIFT 101", { x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 6, align: "left", valign: "middle" });
  s.addText([{ text: "OpenShift Local,", options: { breakLine: true } }, { text: "on your laptop" }], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00, fontFace: FONT.title, fontSize: 52, bold: true, color: COLOR.ink, align: "left", valign: "top" });
  s.addText("A full single-node OpenShift cluster, running in one local VM on Fedora. What it is, how you talk to it, and the five things that make it OpenShift and not just Kubernetes.", {
    x: 6.00, y: 4.55, w: 6.70, h: 1.20, fontFace: FONT.body, fontSize: 17, italic: true, color: COLOR.caption, align: "left", valign: "top" });
  s.addText(REV, { x: 11.85, y: 5.85, w: 0.95, h: 0.30, fontFace: FONT.mono, fontSize: 11, color: COLOR.caption, align: "right", valign: "middle" });
  try { s.addImage({ path: `${ASSETS}/logo-candidate-2.png`, x: 11.10, y: 6.80, w: 1.55, h: 0.37 }); } catch (e) {}
  note(s, "Welcome. This is the orientation deck for OpenShift Local, the tool Red Hat ships as CRC, running on a Fedora workstation. The promise is simple: a real, complete OpenShift cluster, the same API and the same security model you meet in production, running inside one virtual machine on the laptop in front of you. Over the next half hour we build the mental model: what CRC actually runs, how oc differs from kubectl, and the five OpenShift-specific pieces (Projects, the restricted-v2 security model, Routes with edge TLS, OperatorHub, and the integrated registry) that a Kubernetes user hasn't met yet. The companion 201 deck takes the same cluster and builds a real application on it; the patterns appendix deck works the Kubernetes design patterns against the DO280/EX280 exam objectives.");
}

// ---- What it is -------------------------------------------------------------
divider("01", "What OpenShift Local is", "One VM, one node, the whole platform",
  "This first section answers the question a newcomer always asks: is this a toy, a simulator, or the real thing. The answer is that it's the real OpenShift, scoped down to a single node so it fits on a workstation. Everything you learn here transfers to a production cluster unchanged, because it is the same software.");

{
  const s = S();
  addContentTitle(s, "SECTION 1 · WHAT IT IS", "A real cluster, scoped to one machine");
  addBullets(s, [
    "**OpenShift Local** (the tool is called CRC, CodeReady Containers) runs a complete OpenShift cluster inside a single virtual machine on your workstation.",
    "It is **not a simulator**: the API server, the controllers, the integrated registry, the router, and OLM are the same components a production cluster runs, just all on one node.",
    "The trade is scope, not fidelity. One node means no cross-node scheduling and no cloud load balancer, and that is the only category of thing that behaves differently here.",
    "If it works against CRC, the manifest works against a production OpenShift cluster, because it is the same software answering the same API.",
  ], { fontSize: 16 });
  addCaption(s, "CRC is OpenShift with the node count turned down to one, not OpenShift with features removed.");
  note(s, "The single most important thing to establish up front is that this is not a lightweight reimplementation. minikube, by contrast, is upstream Kubernetes with addons; CRC is the actual OpenShift Container Platform distribution, the same bits Red Hat ships to customers, installed onto one node. That matters because the whole point of learning on it is that nothing you learn is throwaway. The security model that rejects your first Pod is the same one that will reject it in production. The Route you create is the same object an ops team creates. The only things that cannot be shown on a single node are cross-node scheduling (anti-affinity across nodes, draining one node onto another) and a cloud LoadBalancer Service, which stays pending because there is no cloud underneath to provision one. We call those out when we reach them rather than pretending they work.");
}

{
  const s = S();
  addDiagramSlide(s, "SECTION 1 · ARCHITECTURE", "What CRC actually runs",
    "crc-architecture",
    "The crc daemon drives a KVM virtual machine running Red Hat Enterprise Linux CoreOS; the whole cluster lives inside it, reached from the host over user-mode networking.");
  note(s, "Here is the physical picture. On your Fedora host, the crc binary starts a daemon that drives libvirt and KVM to boot one virtual machine. That VM runs Red Hat Enterprise Linux CoreOS, the immutable, container-optimized OS OpenShift nodes always run. Inside that single VM sits everything: the control plane (API server, etcd, controllers), the worker role on the same node, the integrated image registry, the ingress router, and OLM with OperatorHub. From the host you reach it over user-mode networking, which is why the cluster's own names like api.crc.testing and anything under apps-crc.testing all resolve back to 127.0.0.1. There is no external network exposure and nothing to firewall; the VM is a self-contained cluster you talk to through a local port. Sizing is set while the VM is stopped, cpus and memory and disk, and for this tutorial's heavier platform work we give it 12 CPUs and 32 gigabytes.");
}

{
  const s = S();
  addCodeSlide(s, "SECTION 1 · FIRST RUN", "From zero to a running cluster", "bash", [
    "# one-time: give the VM room for the platform tier, then start",
    "crc config set cpus 12",
    "crc config set memory 32768",
    "crc setup        # one-time host preparation",
    "crc start        # boots the VM; prints the kubeadmin login",
    "",
    "# point your shell at the bundled client and log in",
    "eval $(crc oc-env)",
    "oc whoami        # kubeadmin",
    "oc get co        # cluster operators, all Available",
  ], "crc start is CPU-heavy on first boot; subsequent starts are quick. Use crc stop, not delete, to keep your work.");
  note(s, "The lifecycle is three commands you run rarely and two you run daily. crc config sets the VM size, and it only takes effect while the VM is stopped, so you do it first. crc setup prepares the host once, installing the libvirt pieces and the network helper. crc start boots the VM and, the first time, pulls and lays down the cluster; this is the slow, CPU-heavy step, and on a laptop it will spin the fans. After that, crc start and crc stop are quick. The pull secret you downloaded from the Red Hat console lives at a path crc reads; you never paste it anywhere. eval of crc oc-env points your shell at the bundled oc client and the cluster's credentials, and from then on oc whoami says kubeadmin and oc get co shows the cluster operators all healthy. A reflex worth building: stop, never delete, unless you actually want to start over, because delete throws away everything in the cluster.");
}

// ---- Talking to the cluster -------------------------------------------------
divider("02", "Talking to the cluster", "oc, kubectl, and Projects",
  "OpenShift's command-line client is oc, and the first thing to understand is its relationship to kubectl: oc is a strict superset. This section covers that relationship, the terminal-first stance this tutorial takes, and the one resource that is pure OpenShift, the Project.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 2 · THE CLIENT", "oc is a superset of kubectl",
    "oc-and-kubectl",
    "Everything kubectl does, oc does with the same syntax; oc adds OpenShift-only verbs (new-app, expose, project, adm) and the Project resource on top.");
  note(s, "If you know kubectl, you already know most of oc. Every kubectl verb, get, apply, delete, logs, exec, scale, rollout, exists in oc with identical syntax and behavior, because oc embeds kubectl. What oc adds is a set of OpenShift-only verbs that wrap common workflows: oc new-app to stand up an application from an image or source, oc expose to create a Route in front of a Service, oc project to switch the active namespace, and oc adm for administrative tasks like granting a security context constraint. The practical advice: use oc for everything on an OpenShift cluster, even the commands that are really kubectl, so your muscle memory is consistent and the OpenShift-only verbs are always available. This tutorial is oc-first and terminal-first; the web console is real and useful, but we treat it as a secondary way to see what the commands did, not the primary interface.");
}

{
  const s = S();
  addContentTitle(s, "SECTION 2 · PROJECTS", "A Project is a Namespace, plus");
  addBullets(s, [
    "A **Project** is a Kubernetes Namespace with OpenShift's additions layered on: default RBAC role bindings, a default resource quota and limit range (if the cluster's project template sets them), and ownership metadata.",
    "`oc new-project patterns` creates the Namespace and wires up those defaults in one step; `oc project patterns` switches your active context to it.",
    "Every example in this tutorial lives in one Project, so cleanup is a single `oc delete project`.",
    "You still write `namespace:` in manifests and `-n` on commands; Project is the management layer, Namespace is the API object underneath.",
  ], { fontSize: 16 });
  addCaption(s, "Think of a Project as a Namespace that arrives with its access control and guardrails already attached.");
  note(s, "The Project is the first pure-OpenShift concept. Underneath it is an ordinary Kubernetes Namespace, and in manifests and on the command line you still use namespace and dash-n exactly as you would anywhere. What OpenShift adds is that creating a Project through oc new-project also lays down the default role bindings that make you its administrator, and, on a cluster whose administrator has customized the project template, a default ResourceQuota and LimitRange so the Project is governed from birth. This is the governance story the patterns appendix develops in full. For now the takeaway is operational: everything in this tutorial lives in one Project called patterns, which means when you are done, oc delete project patterns removes every object you created in one command, with no stray resources left behind.");
}

// ---- Running a workload -----------------------------------------------------
divider("03", "Running a workload", "Deployments and the security model",
  "Now we run something, and immediately meet the piece of OpenShift that surprises every Kubernetes user: the security context constraint. A Pod that runs fine on a permissive cluster is rejected or silently rewritten here, and understanding why is the key that unlocks everything else.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 3 · SECURITY", "The SCC injects a non-root UID",
    "deploy-scc",
    "A Deployment makes a ReplicaSet makes Pods; the restricted-v2 SCC admits each Pod and assigns it a non-root UID from the Project's own range.");
  note(s, "Deploy an application and the object graph is the ordinary Kubernetes one: a Deployment manages a ReplicaSet, which keeps the Pods running. The OpenShift-specific step happens at admission. Every Pod is checked against a Security Context Constraint, an SCC, and by default that is restricted-v2, the most locked-down one. restricted-v2 does something a plain Kubernetes cluster does not: it refuses to let a container choose its own user ID, and instead injects an arbitrary high-numbered, non-root UID from a range the Project owns, something like 1000650000. Your container runs as a user it did not pick and cannot predict. This is deliberate. It means a container image that assumes it is root, or assumes a specific UID, will break here in exactly the way it should break in a secure production environment, and you find out on your laptop instead of in an incident.");
}

{
  const s = S();
  addContentTitle(s, "SECTION 3 · restricted-v2", "What a well-behaved container looks like");
  addTwoColBullets(s,
    [
      "**Runs as any UID.** The image must not hardcode a user or assume root; it tolerates the injected UID and keeps its group at 0.",
      "**No privilege escalation.** `allowPrivilegeEscalation: false`.",
      "**Drops all capabilities.** `capabilities: { drop: [ALL] }`.",
    ],
    [
      "**Seccomp on.** `seccompProfile: { type: RuntimeDefault }`.",
      "**No host access.** No hostPath, host network, or host PID.",
      "**Writes only where it should.** A read-only root filesystem with an explicit writable volume for scratch space.",
    ],
    { fontSize: 15 });
  addCaption(s, "These six properties are the restricted-v2 contract; a clean image satisfies them without special handling.");
  note(s, "This is the contract restricted-v2 enforces, and it is worth memorizing because it is the shape every workload in this tutorial takes. Run as any UID: build images that do not care who they run as, which in practice means owning files by group 0 rather than by a specific user. No privilege escalation, and drop every Linux capability, because an application serving HTTP and talking to a database needs none of root's forty-odd separate powers. Turn on the default seccomp syscall filter. Take no host access at all, no mounting the node's filesystem or network. And where possible run with a read-only root filesystem, carving out one explicit writable volume for scratch space like a temp directory. A container built this way is admitted by restricted-v2 with no special handling and no elevated SCC, and that is the goal: least privilege as the default, not as an afterthought.");
}

// ---- Getting traffic in -----------------------------------------------------
divider("04", "Getting traffic in", "Routes and edge TLS",
  "A Service gives a workload a stable in-cluster address, but nothing outside the cluster can reach it. OpenShift's answer to external access is the Route, and it is one of the places OpenShift is more convenient than plain Kubernetes.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 4 · ROUTES", "A Route terminates TLS at the edge",
    "route-edge-tls",
    "The browser speaks HTTPS to the OpenShift router, which terminates TLS at the edge and forwards plain HTTP to the Pod; verify over HTTPS by trusting the cluster's ingress CA.");
  note(s, "A Route is OpenShift's external-access object, and the router that serves it ships with the cluster, running as HAProxy. The common and recommended mode is edge termination: the browser connects to the router over HTTPS, the router terminates TLS there at the edge using a certificate the cluster manages, and it forwards plain HTTP to your Pod on its own port. Your application never deals with certificates; it just serves HTTP, and the platform wraps it in TLS. One practical note for verification: because the certificate is signed by the cluster's own ingress CA rather than a public authority, curl needs the CA bundle with dash-dash-cacert to verify cleanly, rather than dash-k which would skip verification entirely. Creating a Route is usually one command, oc create route edge, or oc expose service which picks sensible defaults.");
}

{
  const s = S();
  addContentTitle(s, "SECTION 4 · THREE WAYS OUT", "Route, Ingress, and the LoadBalancer that waits");
  addStatusTable(s, [
    { code: "Route", name: "OpenShift-native", purpose: "The default and recommended path. Edge, passthrough, or re-encrypt TLS. One object, served by the built-in router." },
    { code: "Ingress", name: "Portable", purpose: "Standard Kubernetes Ingress works; OpenShift auto-creates a Route behind it. Use it when a manifest must stay portable across distributions." },
    { code: "LoadBalancer", name: "Pending on CRC", purpose: "A Service of type LoadBalancer stays <pending> forever: there is no cloud underneath to provision an external load balancer. Expected, not a bug." },
  ], { colW: [1.9, 2.6, 7.59] });
  addCaption(s, "On a single local cluster, the Route is the answer; the LoadBalancer's pending state is the single-node view.");
  note(s, "There are three ways to ask for external access, and it helps to know which does what here. The Route is OpenShift-native and the one to reach for: it supports edge termination as we just saw, plus passthrough (the Pod handles TLS itself) and re-encrypt (TLS to the edge and again to the Pod). A standard Kubernetes Ingress object also works, and OpenShift quietly creates a Route behind it, so if you need a manifest that is portable across Kubernetes distributions, Ingress is a reasonable choice. The third, a Service of type LoadBalancer, is the one that behaves differently on CRC: it stays pending forever, because provisioning an external load balancer requires a cloud provider, and there is none under a local VM. That is not a defect to fix; it is the one real limitation of a single-node cluster, and the Route is what you use instead.");
}

// ---- Extending the cluster --------------------------------------------------
divider("05", "Extending the cluster", "Operators and the registry",
  "The last two pieces are how OpenShift grows new capabilities and where it keeps container images. Operators, installed through OperatorHub and managed by OLM, are how you add things like Kafka or a service mesh; the integrated registry is where your own images live.");

{
  const s = S();
  addDiagramSlide(s, "SECTION 5 · OPERATORS", "OperatorHub and OLM",
    "operator-olm",
    "A pinned Subscription yields an InstallPlan you approve, which installs a ClusterServiceVersion; a Succeeded CSV and its CRDs confirm the operator is running.");
  note(s, "An Operator is a controller plus the custom resource definitions it manages, packaged so the cluster can install and upgrade it as a unit. OpenShift ships OperatorHub, a catalog of them, and OLM, the Operator Lifecycle Manager, which handles install and upgrade. The flow this tutorial uses is the careful one: a Subscription that pins an exact version and sets manual approval, so installing an operator produces an InstallPlan that you explicitly approve, which then lays down the ClusterServiceVersion, the CSV. When the CSV reaches Succeeded and its CRDs appear, the operator is live and you can create its custom resources. This is how the 201 deck adds AMQ Streams for Kafka, the service mesh, and the autoscaler; each is an operator from OperatorHub, pinned and approved the same way.");
}

{
  const s = S();
  addContentTitle(s, "SECTION 5 · IMAGES", "The integrated registry, two addresses");
  addBullets(s, [
    "OpenShift runs its own **integrated image registry** inside the cluster; your builds push to it and your Deployments pull from it, no external registry required.",
    "**Inside the cluster** it is `image-registry.openshift-image-registry.svc:5000`, the address builds push to and the kubelet pulls from.",
    "**From your host**, push with `podman` to the external route `default-route-openshift-image-registry.apps-crc.testing`, the same registry at a different front door.",
    "An **ImageStream** tracks tags in that registry; a Deployment can reference a bare `name:tag` and let OpenShift resolve it to a digest.",
  ], { fontSize: 15 });
  addCaption(s, "One registry, two addresses: the in-cluster service name for the cluster, the external route for your laptop.");
  note(s, "Every container platform needs somewhere to keep images, and OpenShift includes its own. The subtlety worth learning early is that the same registry answers at two addresses depending on who is asking. Anything inside the cluster, an in-cluster build pushing its result, or the kubelet pulling an image to run, uses the service DNS name ending in svc colon 5000. Your laptop is not inside the cluster's network, so when you build an image with podman and push it, you use the external route under apps-crc.testing instead. Same stored layers, two front doors, split by whether the client is inside or outside. On top of the registry, an ImageStream is an OpenShift object that tracks the tags of a repository, and it lets a Deployment refer to an image by a short name and have OpenShift resolve it to an exact content digest. The 201 deck and the patterns appendix both build images straight into this registry.");
}

// ---- Where to go ------------------------------------------------------------
divider("06", "Where this goes", "201 and the patterns appendix",
  "That is the whole mental model: one VM, oc as a kubectl superset, Projects, restricted-v2, Routes, Operators, and the registry. From here, the tutorial puts it to work.");

{
  const s = S();
  addContentTitle(s, "WRAP-UP", "You now have the model");
  addTwoColBullets(s,
    [
      "**CRC** is a real single-node OpenShift cluster in one local VM.",
      "**oc** is kubectl plus OpenShift verbs; a **Project** is a Namespace with guardrails.",
      "**restricted-v2** injects a non-root UID and demands least privilege.",
    ],
    [
      "**Routes** with edge TLS are how traffic gets in; LoadBalancer stays pending.",
      "**Operators** from OperatorHub, via OLM, add capabilities; the **integrated registry** holds images.",
      "**Next:** the 201 deck builds a real data-mesh application on this cluster.",
    ],
    { fontSize: 15 });
  addCaption(s, "Six ideas separate OpenShift from plain Kubernetes; everything else you already knew still applies.");
  note(s, "To recap the whole model in one breath: OpenShift Local is a single-node cluster in a VM; you drive it with oc, which is kubectl plus a handful of OpenShift verbs; your work lives in a Project, a Namespace that comes with access control and guardrails attached; restricted-v2 runs your containers as a non-root UID it chooses and holds them to least privilege; Routes with edge TLS carry outside traffic in while a cloud LoadBalancer stays pending on one node; and Operators from OperatorHub extend the cluster while the integrated registry holds your images. Everything else, every Deployment, Service, ConfigMap, and probe, is the Kubernetes you already know. From here, the 201 deck takes this exact cluster and builds a real multi-service data-mesh application on it, and the patterns appendix deck works the Kubernetes design patterns against the DO280 and EX280 exam objectives.");
}

{
  const s = S();
  addContentTitle(s, "EXPLORE", "Read, run, and go deeper");
  addBullets(s, [
    "**The tutorial:** patterncatalyst.github.io/openshift-local-on-fedora (every chapter, with runnable commands and verified output).",
    "**The source:** github.com/patterncatalyst/openshift-local-on-fedora (manifests, scripts, and the diagrams in editable form).",
    "**Next decks:** OpenShift 201 (build the data mesh on CRC) and the Kubernetes Patterns appendix (worked against DO280/EX280).",
  ], { fontSize: 16 });
  addCaption(s, "Everything shown here is reproducible on a Fedora workstation with CRC; nothing depends on a cloud account.");
  note(s, "Everything in this deck is written up in full on the tutorial site, chapter by chapter, with the exact commands and their real output, so you can work through it at your own pace on your own machine. The source repository carries the manifests, the helper scripts, and the diagrams in editable Excalidraw form. When you are ready to build something real on the cluster, the 201 deck walks the data-mesh reference application end to end on CRC, and the patterns appendix deck is the one to study alongside the DO280 course if the EX280 exam is your goal. None of it needs a cloud account or a paid subscription beyond the free Red Hat developer account that gives you the pull secret.");
}

// ---- finalize ---------------------------------------------------------------
if (notesCount !== pageNum) {
  throw new Error(`notes ${notesCount} != slides ${pageNum}`);
}
pres.writeFile({ fileName: OUT }).then(() => {
  console.log(`wrote ${OUT}: ${pageNum} slides, ${notesCount} with notes`);
});
