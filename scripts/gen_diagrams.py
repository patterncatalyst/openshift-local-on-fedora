#!/usr/bin/env python3
"""Generate the guide's figures as paired SVG + .excalidraw files.

Run from the repository root:

    python3 scripts/gen_diagrams.py

Each emit() writes assets/diagrams/<name>.svg and <name>.excalidraw and
self-validates both. Labels name concepts only (no chapter/release/tracking
codes, no em dashes), per lgtm-professional-voice rule 10.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_diagram as g

g.OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets/diagrams")

# 1. CRC architecture: host -> KVM/libvirt -> single-node OpenShift VM
g.emit("crc-architecture", 900, 460,
    bands=[
        {"x":20, "y":60, "w":860, "h":380, "label":"Fedora host", "fill":"#fafafa"},
        {"x":250, "y":90, "w":610, "h":330, "label":"VM: Red Hat Enterprise Linux CoreOS", "fill":"#ffffff"},
    ],
    nodes=[
        {"x":45, "y":110, "w":170, "h":60, "style":"box",    "lines":["crc daemon", "manages the VM"]},
        {"x":45, "y":210, "w":170, "h":60, "style":"kernel", "lines":["KVM", "libvirt + qemu"]},
        {"x":275, "y":135, "w":260, "h":70, "style":"accent", "lines":["Control plane", "API server, etcd, scheduler"]},
        {"x":575, "y":135, "w":260, "h":70, "style":"box",    "lines":["Worker", "your Pods run here"]},
        {"x":275, "y":240, "w":260, "h":60, "style":"sub",    "lines":["Internal registry", "+ in-cluster builds"]},
        {"x":575, "y":240, "w":260, "h":60, "style":"sub",    "lines":["Router", "serves Routes"]},
        {"x":275, "y":330, "w":560, "h":55, "style":"sub",    "lines":["OLM + OperatorHub"]},
    ],
    edges=[
        {"x1":215, "y1":140, "x2":250, "y2":160, "label":"manages"},
        {"x1":215, "y1":240, "x2":250, "y2":255, "label":"runs"},
    ],
    notes=[
        {"x":450, "y":45, "text":"user-mode networking: api.crc.testing and *.apps-crc.testing resolve to 127.0.0.1",
         "anchor":"middle", "bold":True},
    ])

# 2. oc is a superset of kubectl; a project is a namespace
g.emit("oc-and-kubectl", 880, 320,
    bands=[
        {"x":20, "y":60, "w":500, "h":230, "label":"oc", "fill":"#fff8ef"},
    ],
    nodes=[
        {"x":45, "y":105, "w":210, "h":150, "style":"box",
         "lines":["kubectl", "Pods, Deployments,", "Services, logs,", "apply"]},
        {"x":285, "y":105, "w":210, "h":150, "style":"accent",
         "lines":["OpenShift verbs", "new-app, expose,", "project, adm,", "status"]},
        {"x":600, "y":140, "w":250, "h":80, "style":"ink",
         "lines":["Project", "= Namespace + RBAC + quota"]},
    ],
    edges=[
        {"x1":520, "y1":180, "x2":600, "y2":180, "label":"manages"},
    ],
    notes=[
        {"x":270, "y":45, "text":"oc is kubectl plus the OpenShift-only verbs", "anchor":"middle", "bold":True},
    ])

# 3. Deploying: Deployment -> ReplicaSet -> Pods, SCC injects the UID
g.emit("deploy-scc", 880, 380,
    bands=[
        {"x":560, "y":70, "w":300, "h":170, "label":"Pods (2 replicas)", "fill":"#fafafa"},
    ],
    nodes=[
        {"x":40,  "y":95, "w":170, "h":65, "style":"accent", "lines":["Deployment", "web"]},
        {"x":300, "y":95, "w":170, "h":65, "style":"box",    "lines":["ReplicaSet"]},
        {"x":580, "y":110, "w":120, "h":55, "style":"box",   "lines":["Pod", "httpd"]},
        {"x":720, "y":110, "w":120, "h":55, "style":"box",   "lines":["Pod", "httpd"]},
        {"x":300, "y":270, "w":300, "h":70, "style":"ink",
         "lines":["restricted-v2 SCC", "assigns UID 1000650000, non-root"]},
    ],
    edges=[
        {"x1":210, "y1":127, "x2":300, "y2":127, "label":"creates"},
        {"x1":470, "y1":127, "x2":560, "y2":140, "label":"keeps N up"},
        {"x1":450, "y1":270, "x2":450, "y2":240, "label":"injects runAsUser", "amber":True},
    ],
    notes=[
        {"x":440, "y":40, "text":"a Deployment manages Pods; OpenShift assigns the UID", "anchor":"middle", "bold":True},
    ])

# 4. Route with edge TLS
g.emit("route-edge-tls", 880, 320,
    nodes=[
        {"x":40,  "y":110, "w":170, "h":70, "style":"user",   "lines":["Browser", "on your host"]},
        {"x":330, "y":105, "w":200, "h":85, "style":"accent", "lines":["OpenShift router", "terminates TLS", "(edge)"]},
        {"x":660, "y":110, "w":180, "h":70, "style":"box",    "lines":["Pod", "httpd :8080"]},
    ],
    edges=[
        {"x1":210, "y1":145, "x2":330, "y2":145, "label":"HTTPS", "amber":True},
        {"x1":530, "y1":145, "x2":660, "y2":145, "label":"HTTP (plain)"},
    ],
    notes=[
        {"x":440, "y":45, "text":"edge TLS: encrypted to the router, plain HTTP to the Pod", "anchor":"middle", "bold":True},
        {"x":440, "y":230, "text":"trust the cluster ingress CA (curl --cacert), never --insecure",
         "anchor":"middle", "size":13, "color":"#64748b"},
    ])

# 5. Service mesh: control plane configures, data-plane proxies carry traffic
g.emit("service-mesh", 900, 390,
    bands=[
        {"x":20, "y":95, "w":560, "h":260, "label":"mesh-demo (istio.io/rev=default)", "fill":"#fafafa"},
    ],
    nodes=[
        {"x":55,  "y":150, "w":220, "h":80, "style":"box", "lines":["Pod A", "app + Envoy sidecar"]},
        {"x":330, "y":150, "w":220, "h":80, "style":"box", "lines":["Pod B", "app + Envoy sidecar"]},
        {"x":680, "y":150, "w":190, "h":80, "style":"accent", "lines":["istiod", "control plane"]},
        {"x":680, "y":265, "w":190, "h":60, "style":"sub", "lines":["Kiali", "mesh console"]},
    ],
    edges=[
        {"x1":275, "y1":190, "x2":330, "y2":190, "label":"mTLS (STRICT)", "amber":True, "bidir":True},
        {"x1":680, "y1":190, "x2":580, "y2":190, "label":"config + certs", "dashed":True},
    ],
    notes=[
        {"x":450, "y":45, "text":"the control plane configures the proxies; the proxies carry the traffic",
         "anchor":"middle", "bold":True},
    ])

# 6. OperatorHub / OLM install flow
g.emit("operator-olm", 920, 320,
    bands=[
        {"x":655, "y":80, "w":240, "h":175, "label":"installed operator", "fill":"#fff8ef"},
    ],
    nodes=[
        {"x":30,  "y":120, "w":160, "h":70, "style":"accent", "lines":["Subscription", "pinned CSV, Manual"]},
        {"x":250, "y":120, "w":160, "h":70, "style":"box",    "lines":["InstallPlan", "you approve one"]},
        {"x":470, "y":120, "w":150, "h":70, "style":"box",    "lines":["CSV", "Succeeded"]},
        {"x":675, "y":110, "w":200, "h":55, "style":"box",    "lines":["Operator controller"]},
        {"x":675, "y":180, "w":200, "h":55, "style":"sub",    "lines":["CRDs", "e.g. kafkas.kafka.strimzi.io"]},
    ],
    edges=[
        {"x1":190, "y1":155, "x2":250, "y2":155, "label":"OLM creates"},
        {"x1":410, "y1":155, "x2":470, "y2":155, "label":"approved"},
        {"x1":620, "y1":155, "x2":655, "y2":150, "label":"installs"},
    ],
    notes=[
        {"x":330, "y":45, "text":"a pinned Subscription, one approved InstallPlan, a Succeeded CSV",
         "anchor":"middle", "bold":True},
        {"x":330, "y":270, "text":"catalog: redhat-operators (OperatorHub)", "anchor":"middle",
         "size":13, "color":"#64748b"},
    ])

print("wrote 6 diagrams to", g.OUT)
