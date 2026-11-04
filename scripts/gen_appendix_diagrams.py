#!/usr/bin/env python3
"""Generate the Kubernetes-patterns-on-OpenShift appendix diagrams.

Paired SVG + .excalidraw into assets/diagrams/, one per pattern chapter, using
the vendored generate_diagram engine. Run from the repo root:

    python3 scripts/gen_appendix_diagrams.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import generate_diagram as g  # noqa: E402

g.OUT = "assets/diagrams"


def predictable_demands():
    g.emit(
        "appendix-01-predictable-demands", 880, 400,
        bands=[{"x": 20, "y": 44, "w": 840, "h": 328,
                "label": "patterns project", "fill": "#fafafa"}],
        nodes=[
            {"x": 60, "y": 92, "w": 180, "h": 64, "style": "box",
             "lines": ["ConfigMap", "shipping-config", "schema = shipping"]},
            {"x": 60, "y": 250, "w": 180, "h": 80, "style": "box",
             "lines": ["PersistentVolumeClaim", "shipping-data",
                       "crc-csi-hostpath", "WaitForFirstConsumer"]},
            {"x": 360, "y": 56, "w": 210, "h": 56, "style": "box",
             "lines": ["PriorityClass", "patterns-high-priority (1000000)"]},
            {"x": 360, "y": 150, "w": 210, "h": 120, "style": "accent",
             "lines": ["Pod: shipping-service",
                       "requests cpu 100m / mem 192Mi",
                       "limit mem 512Mi",
                       "QoS Burstable"]},
            {"x": 660, "y": 150, "w": 180, "h": 120, "style": "ink",
             "lines": ["restricted-v2 SCC",
                       "injects runAsUser",
                       "1000650000",
                       "drop ALL caps"]},
        ],
        edges=[
            {"x1": 240, "y1": 122, "x2": 360, "y2": 182,
             "label": "env (required)"},
            {"x1": 240, "y1": 288, "x2": 360, "y2": 236,
             "label": "volume (required)"},
            {"x1": 465, "y1": 112, "x2": 465, "y2": 150,
             "label": "scheduling + eviction", "amber": True},
            {"x1": 660, "y1": 210, "x2": 570, "y2": 210,
             "label": "admits"},
        ],
        notes=[{"x": 440, "y": 32,
                "text": "Predictable Demands on OpenShift",
                "anchor": "middle", "bold": True}],
    )


def declarative_deployment():
    g.emit(
        "appendix-02-declarative-deployment", 880, 420,
        bands=[
            {"x": 20, "y": 50, "w": 840, "h": 150,
             "label": "RollingUpdate: overlap, zero downtime (100/100)",
             "fill": "#fafafa"},
            {"x": 20, "y": 236, "w": 840, "h": 150,
             "label": "Recreate: all down, then all up (75/100)",
             "fill": "#fafafa"},
        ],
        nodes=[
            {"x": 60, "y": 96, "w": 150, "h": 60, "style": "box",
             "lines": ["3 old Pods", "serving"]},
            {"x": 330, "y": 90, "w": 200, "h": 72, "style": "accent",
             "lines": ["+1 new (surge)", "drain 1 old (preStop)",
                       "ready endpoints >= 3"]},
            {"x": 650, "y": 96, "w": 150, "h": 60, "style": "box",
             "lines": ["3 new Pods", "serving"]},
            {"x": 60, "y": 282, "w": 150, "h": 60, "style": "box",
             "lines": ["3 old Pods", "serving"]},
            {"x": 350, "y": 278, "w": 170, "h": 68, "style": "ink",
             "lines": ["0 Pods", "~10s outage"]},
            {"x": 650, "y": 282, "w": 150, "h": 60, "style": "box",
             "lines": ["3 new Pods", "serving"]},
        ],
        edges=[
            {"x1": 210, "y1": 126, "x2": 330, "y2": 126, "label": "roll"},
            {"x1": 530, "y1": 126, "x2": 650, "y2": 126},
            {"x1": 210, "y1": 312, "x2": 350, "y2": 312,
             "label": "terminate all"},
            {"x1": 520, "y1": 312, "x2": 650, "y2": 312,
             "label": "start all", "amber": True},
        ],
        notes=[{"x": 440, "y": 34,
                "text": "Declarative Deployment: RollingUpdate vs Recreate",
                "anchor": "middle", "bold": True}],
    )


def health_probe():
    g.emit(
        "appendix-03-health-probe", 900, 400,
        bands=[{"x": 20, "y": 48, "w": 860, "h": 324,
                "label": "readiness decides traffic; liveness decides restart",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 150, "w": 150, "h": 90, "style": "box",
             "lines": ["startupProbe", "/health", "30 x 2s"]},
            {"x": 270, "y": 120, "w": 200, "h": 150, "style": "accent",
             "lines": ["Pod: inventory-service",
                       "livenessProbe /health",
                       "readinessProbe /healthz",
                       "(checks Postgres)"]},
            {"x": 270, "y": 300, "w": 200, "h": 56, "style": "ghost",
             "lines": ["readinessGate", "InventorySeeded (external)"]},
            {"x": 560, "y": 160, "w": 150, "h": 80, "style": "ink",
             "lines": ["Pod Ready", "= probe AND gate"]},
            {"x": 760, "y": 168, "w": 110, "h": 64, "style": "box",
             "lines": ["Route", "endpoints"]},
        ],
        edges=[
            {"x1": 200, "y1": 195, "x2": 270, "y2": 195,
             "label": "suppresses until pass"},
            {"x1": 470, "y1": 185, "x2": 560, "y2": 185,
             "label": "readiness True"},
            {"x1": 470, "y1": 325, "x2": 600, "y2": 240,
             "label": "gate True", "amber": True},
            {"x1": 710, "y1": 200, "x2": 760, "y2": 200, "label": "traffic"},
        ],
        notes=[
            {"x": 450, "y": 32, "text": "Health Probe: startup, liveness, readiness, and a readiness gate",
             "anchor": "middle", "bold": True},
            {"x": 370, "y": 110, "text": "liveness fail -> restart; readiness fail -> leave endpoints",
             "anchor": "middle", "size": 10, "color": "#888"},
        ],
    )


def managed_lifecycle():
    g.emit(
        "appendix-04-managed-lifecycle", 920, 340,
        bands=[{"x": 20, "y": 50, "w": 880, "h": 200,
                "label": "termination sequence (grace period 30s)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 40, "y": 110, "w": 130, "h": 80, "style": "box",
             "lines": ["delete", "remove from", "endpoints"]},
            {"x": 205, "y": 104, "w": 150, "h": 92, "style": "accent",
             "lines": ["preStop", "sleep 10", "still serving"]},
            {"x": 390, "y": 110, "w": 150, "h": 80, "style": "box",
             "lines": ["SIGTERM", "to PID 1", "(uvicorn)"]},
            {"x": 575, "y": 110, "w": 160, "h": 80, "style": "box",
             "lines": ["graceful shutdown", "dispose pool"]},
            {"x": 770, "y": 116, "w": 110, "h": 68, "style": "ink",
             "lines": ["exit", "~10s total"]},
        ],
        edges=[
            {"x1": 170, "y1": 150, "x2": 205, "y2": 150},
            {"x1": 355, "y1": 150, "x2": 390, "y2": 150, "label": "after hook"},
            {"x1": 540, "y1": 150, "x2": 575, "y2": 150},
            {"x1": 735, "y1": 150, "x2": 770, "y2": 150},
        ],
        notes=[
            {"x": 460, "y": 34,
             "text": "Managed Lifecycle: the termination sequence",
             "anchor": "middle", "bold": True},
            {"x": 460, "y": 228,
             "text": "SIGKILL instead if the grace period expires first",
             "anchor": "middle", "size": 10, "color": "#b8650a"},
        ],
    )


def automated_placement():
    g.emit(
        "appendix-05-automated-placement", 900, 380,
        bands=[{"x": 20, "y": 48, "w": 860, "h": 312,
                "label": "single-node CRC: who may land on the one node",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 340, "y": 135, "w": 220, "h": 140, "style": "accent",
             "lines": ["crc (only node)", "zone=warehouse-a",
                       "tier=fulfillment", "taint dedicated=fulfillment"]},
            {"x": 40, "y": 100, "w": 185, "h": 64, "style": "box",
             "lines": ["nodeSelector /", "nodeAffinity Pod"]},
            {"x": 40, "y": 250, "w": 185, "h": 64, "style": "box",
             "lines": ["tolerating Pod"]},
            {"x": 660, "y": 108, "w": 200, "h": 64, "style": "ghost",
             "lines": ["intolerant Pod", "Pending (repelled)"]},
            {"x": 660, "y": 248, "w": 200, "h": 70, "style": "ghost",
             "lines": ["2nd replica (anti-affinity)", "Pending: no 2nd node"]},
        ],
        edges=[
            {"x1": 225, "y1": 150, "x2": 340, "y2": 175, "label": "label match"},
            {"x1": 225, "y1": 280, "x2": 340, "y2": 235, "label": "tolerates taint"},
            {"x1": 560, "y1": 175, "x2": 660, "y2": 140, "label": "repelled", "amber": True},
            {"x1": 560, "y1": 235, "x2": 660, "y2": 280, "label": "no room", "amber": True},
        ],
        notes=[{"x": 460, "y": 32,
                "text": "Automated Placement on single-node CRC",
                "anchor": "middle", "bold": True}],
    )


def init_container():
    g.emit(
        "appendix-06-init-container", 880, 340,
        bands=[{"x": 20, "y": 48, "w": 840, "h": 272,
                "label": "Pod startup: init runs to completion first",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 70, "y": 100, "w": 200, "h": 80, "style": "box",
             "lines": ["init: migrate", "alembic upgrade head"]},
            {"x": 440, "y": 92, "w": 220, "h": 80, "style": "accent",
             "lines": ["main: notification-service", "uvicorn (serving)"]},
            {"x": 440, "y": 214, "w": 220, "h": 64, "style": "ghost",
             "lines": ["main never created", "PodInitializing"]},
            {"x": 70, "y": 230, "w": 200, "h": 56, "style": "box",
             "lines": ["Postgres"]},
        ],
        edges=[
            {"x1": 270, "y1": 135, "x2": 440, "y2": 132, "label": "exit 0 -> start"},
            {"x1": 250, "y1": 180, "x2": 440, "y2": 240,
             "label": "exit != 0", "amber": True},
            {"x1": 170, "y1": 230, "x2": 170, "y2": 180,
             "label": "connects", "dashed": True},
        ],
        notes=[{"x": 440, "y": 32,
                "text": "Init Container: the migration gates the app",
                "anchor": "middle", "bold": True}],
    )


def sidecar():
    g.emit(
        "appendix-07-sidecar", 900, 300,
        bands=[{"x": 20, "y": 56, "w": 860, "h": 200,
                "label": "one Pod, shared network namespace (localhost)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 90, "y": 96, "w": 720, "h": 46, "style": "accent",
             "lines": ["probe-tailer  —  restartPolicy: Always (native sidecar)"]},
            {"x": 210, "y": 168, "w": 480, "h": 46, "style": "box",
             "lines": ["shipping-service (main container)"]},
        ],
        edges=[
            {"x1": 70, "y1": 236, "x2": 830, "y2": 236, "label": "time"},
        ],
        notes=[
            {"x": 450, "y": 38,
             "text": "Sidecar: the native sidecar brackets the app's lifetime",
             "anchor": "middle", "bold": True},
            {"x": 95, "y": 90, "text": "sidecar starts", "anchor": "start",
             "size": 10, "color": "#b8650a"},
            {"x": 215, "y": 162, "text": "app starts", "anchor": "start",
             "size": 10, "color": "#888"},
            {"x": 688, "y": 162, "text": "app stops (SIGTERM)", "anchor": "end",
             "size": 10, "color": "#888"},
            {"x": 808, "y": 90, "text": "sidecar stops last", "anchor": "end",
             "size": 10, "color": "#b8650a"},
        ],
    )


def adapter():
    g.emit(
        "appendix-08-adapter", 900, 300,
        bands=[{"x": 20, "y": 70, "w": 600, "h": 170,
                "label": "one Pod (shared localhost)", "fill": "#fafafa"}],
        nodes=[
            {"x": 60, "y": 120, "w": 190, "h": 80, "style": "box",
             "lines": ["shipping-service", "/healthz", "JSON body"]},
            {"x": 360, "y": 116, "w": 200, "h": 88, "style": "accent",
             "lines": ["metrics-adapter", ":9100/metrics",
                       "Prometheus text"]},
            {"x": 700, "y": 128, "w": 170, "h": 64, "style": "box",
             "lines": ["Prometheus", "scraper"]},
        ],
        edges=[
            {"x1": 250, "y1": 160, "x2": 360, "y2": 160,
             "label": "poll (localhost)"},
            {"x1": 560, "y1": 160, "x2": 700, "y2": 160,
             "label": "scrape /metrics", "amber": True},
        ],
        notes=[
            {"x": 450, "y": 44,
             "text": "Adapter: same fact, the scraper's format",
             "anchor": "middle", "bold": True},
            {"x": 760, "y": 108, "text": "external", "anchor": "middle",
             "size": 10, "color": "#888"},
        ],
    )


def ambassador():
    g.emit(
        "appendix-09-ambassador", 920, 320,
        bands=[{"x": 20, "y": 66, "w": 600, "h": 190,
                "label": "one Pod (shared localhost)", "fill": "#fafafa"}],
        nodes=[
            {"x": 60, "y": 120, "w": 200, "h": 86, "style": "box",
             "lines": ["shipping-service", "dials 127.0.0.1:5432", "(no env vars)"]},
            {"x": 370, "y": 116, "w": 210, "h": 94, "style": "accent",
             "lines": ["postgres-ambassador", "listens 127.0.0.1:5432",
                       "TCP relay"]},
            {"x": 710, "y": 110, "w": 180, "h": 60, "style": "box",
             "lines": ["patterns-postgres", "(UPSTREAM_HOST)"]},
            {"x": 710, "y": 196, "w": 180, "h": 56, "style": "ghost",
             "lines": ["another backend", "(repoint here)"]},
        ],
        edges=[
            {"x1": 260, "y1": 160, "x2": 370, "y2": 160,
             "label": "127.0.0.1:5432"},
            {"x1": 580, "y1": 150, "x2": 710, "y2": 142,
             "label": "UPSTREAM_HOST", "amber": True},
            {"x1": 580, "y1": 180, "x2": 710, "y2": 220,
             "label": "or repoint", "dashed": True},
        ],
        notes=[
            {"x": 460, "y": 44,
             "text": "Ambassador: the app's target never changes",
             "anchor": "middle", "bold": True},
            {"x": 800, "y": 100, "text": "external", "anchor": "middle",
             "size": 10, "color": "#888"},
        ],
    )


def configuration_template():
    g.emit(
        "appendix-20-configuration-template", 900, 300,
        bands=[{"x": 20, "y": 48, "w": 860, "h": 220,
                "label": "render once, before the app starts", "fill": "#fafafa"}],
        nodes=[
            {"x": 40, "y": 74, "w": 170, "h": 46, "style": "box",
             "lines": ["template ConfigMap"]},
            {"x": 40, "y": 150, "w": 170, "h": 46, "style": "box",
             "lines": ["overlay ConfigMap"]},
            {"x": 330, "y": 98, "w": 180, "h": 80, "style": "accent",
             "lines": ["init: render-config", "sed -> /rendered"]},
            {"x": 620, "y": 72, "w": 220, "h": 50, "style": "ink",
             "lines": ["emptyDir: app.conf (rendered)"]},
            {"x": 620, "y": 176, "w": 220, "h": 56, "style": "box",
             "lines": ["main: inventory-service", "reads /config/app"]},
        ],
        edges=[
            {"x1": 210, "y1": 97, "x2": 330, "y2": 128, "label": "template"},
            {"x1": 210, "y1": 173, "x2": 330, "y2": 150, "label": "envFrom"},
            {"x1": 510, "y1": 128, "x2": 620, "y2": 100,
             "label": "writes once", "amber": True},
            {"x1": 620, "y1": 150, "x2": 620, "y2": 176},
        ],
        notes=[{"x": 450, "y": 32,
                "text": "Configuration Template: init renders the file; the app only sees the result",
                "anchor": "middle", "bold": True}],
    )


def immutable_configuration():
    g.emit(
        "appendix-21-immutable-configuration", 900, 300,
        bands=[{"x": 20, "y": 50, "w": 860, "h": 214,
                "label": "a config change is a new resource + a rollout",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 40, "y": 76, "w": 190, "h": 46, "style": "ink",
             "lines": ["gateway-config-v1 (immutable)"]},
            {"x": 40, "y": 152, "w": 190, "h": 46, "style": "ink",
             "lines": ["gateway-config-v2 (immutable)"]},
            {"x": 360, "y": 100, "w": 180, "h": 80, "style": "accent",
             "lines": ["Deployment", "configMapRef", "v1 -> v2"]},
            {"x": 640, "y": 108, "w": 200, "h": 64, "style": "box",
             "lines": ["rolling update", "revision 2"]},
        ],
        edges=[
            {"x1": 230, "y1": 99, "x2": 360, "y2": 128, "label": "was", "dashed": True},
            {"x1": 230, "y1": 175, "x2": 360, "y2": 152, "label": "now", "amber": True},
            {"x1": 540, "y1": 140, "x2": 640, "y2": 140, "label": "oc rollout"},
        ],
        notes=[
            {"x": 450, "y": 34,
             "text": "Immutable Configuration: v1 can't be patched; create v2 and roll",
             "anchor": "middle", "bold": True},
            {"x": 135, "y": 224,
             "text": "in-place patch of v1 -> rejected", "anchor": "middle",
             "size": 10, "color": "#b8650a"},
        ],
    )


def configuration_resource():
    g.emit(
        "appendix-19-configuration-resource", 880, 300,
        bands=[{"x": 20, "y": 50, "w": 840, "h": 214,
                "label": "one resource, two shapes", "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 110, "w": 200, "h": 94, "style": "box",
             "lines": ["ConfigMap + Secret",
                       "keys: service_schema,",
                       "pg_*, payment-service.conf"]},
            {"x": 480, "y": 74, "w": 230, "h": 54, "style": "ink",
             "lines": ["envFrom: every key as env var",
                       "(resolved once at start)"]},
            {"x": 480, "y": 184, "w": 230, "h": 60, "style": "ink",
             "lines": ["volume: keys as files",
                       "(live update, ~60s)"]},
        ],
        edges=[
            {"x1": 250, "y1": 130, "x2": 480, "y2": 101, "label": "envFrom"},
            {"x1": 250, "y1": 180, "x2": 480, "y2": 212,
             "label": "volumeMount", "amber": True},
        ],
        notes=[{"x": 440, "y": 34,
                "text": "Configuration Resource: same ConfigMap/Secret, only the files update live",
                "anchor": "middle", "bold": True}],
    )


def env_var_configuration():
    g.emit(
        "appendix-18-env-var-configuration", 880, 300,
        bands=[{"x": 20, "y": 48, "w": 840, "h": 216,
                "label": "notification-service env (resolved once at start)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 78, "w": 190, "h": 46, "style": "box",
             "lines": ["literal: SERVICE_SCHEMA"]},
            {"x": 50, "y": 148, "w": 190, "h": 46, "style": "box",
             "lines": ["ConfigMap: KAFKA_*"]},
            {"x": 50, "y": 218, "w": 190, "h": 40, "style": "ink",
             "lines": ["Secret: PG_USER/PASSWORD"]},
            {"x": 470, "y": 110, "w": 220, "h": 120, "style": "accent",
             "lines": ["container env", "all plain strings,",
                       "indistinguishable"]},
        ],
        edges=[
            {"x1": 240, "y1": 101, "x2": 470, "y2": 140},
            {"x1": 240, "y1": 171, "x2": 470, "y2": 170, "label": "valueFrom"},
            {"x1": 240, "y1": 238, "x2": 470, "y2": 200},
        ],
        notes=[
            {"x": 440, "y": 32,
             "text": "Env Var Configuration: three sources, one env block",
             "anchor": "middle", "bold": True},
            {"x": 580, "y": 250,
             "text": "edit a source after start -> no effect until restart",
             "anchor": "middle", "size": 10, "color": "#888"},
        ],
    )


def self_awareness():
    g.emit(
        "appendix-17-self-awareness", 900, 320,
        bands=[{"x": 20, "y": 52, "w": 860, "h": 236,
                "label": "the Pod describes itself to its container",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 108, "w": 180, "h": 110, "style": "box",
             "lines": ["Pod object", "metadata / spec", "status / resources"]},
            {"x": 380, "y": 82, "w": 230, "h": 56, "style": "ink",
             "lines": ["env vars (fieldRef /", "resourceFieldRef), once at start"]},
            {"x": 380, "y": 190, "w": 230, "h": 66, "style": "ink",
             "lines": ["/etc/podinfo volume", "labels/annotations/cpu",
                       "updates in place"]},
            {"x": 690, "y": 118, "w": 170, "h": 90, "style": "accent",
             "lines": ["container", "shipping-service"]},
        ],
        edges=[
            {"x1": 230, "y1": 130, "x2": 380, "y2": 110, "label": "once at start"},
            {"x1": 230, "y1": 190, "x2": 380, "y2": 220,
             "label": "kept current", "amber": True},
            {"x1": 610, "y1": 110, "x2": 690, "y2": 150},
            {"x1": 610, "y1": 223, "x2": 690, "y2": 175},
        ],
        notes=[{"x": 450, "y": 36,
                "text": "Self Awareness: the Downward API, as env vars and an updating volume",
                "anchor": "middle", "bold": True}],
    )


def service_discovery():
    g.emit(
        "appendix-16-service-discovery", 920, 320,
        bands=[{"x": 20, "y": 50, "w": 880, "h": 240,
                "label": "reach a name, never a Pod IP", "fill": "#fafafa"}],
        nodes=[
            {"x": 40, "y": 76, "w": 190, "h": 44, "style": "box",
             "lines": ["ClusterIP (CoreDNS)"]},
            {"x": 40, "y": 146, "w": 190, "h": 44, "style": "box",
             "lines": ["Route (edge TLS)"]},
            {"x": 40, "y": 216, "w": 190, "h": 56, "style": "ghost",
             "lines": ["NodePort / LoadBalancer", "(LB <pending> on CRC)"]},
            {"x": 370, "y": 140, "w": 190, "h": 80, "style": "accent",
             "lines": ["shipping-service Pods", "EndpointSlice: 2 ready"]},
            {"x": 690, "y": 108, "w": 190, "h": 44, "style": "box",
             "lines": ["Ingress"]},
            {"x": 690, "y": 184, "w": 190, "h": 44, "style": "ghost",
             "lines": ["auto-created Route"]},
        ],
        edges=[
            {"x1": 230, "y1": 98, "x2": 370, "y2": 160, "label": "internal"},
            {"x1": 230, "y1": 168, "x2": 370, "y2": 180, "label": "external host"},
            {"x1": 230, "y1": 244, "x2": 370, "y2": 200, "dashed": True},
            {"x1": 690, "y1": 130, "x2": 690, "y2": 184,
             "label": "becomes", "amber": True},
            {"x1": 690, "y1": 206, "x2": 560, "y2": 190},
        ],
        notes=[{"x": 460, "y": 34,
                "text": "Service Discovery: ClusterIP + CoreDNS inside, Route outside, Ingress becomes a Route",
                "anchor": "middle", "bold": True}],
    )


def stateful_service():
    g.emit(
        "appendix-15-stateful-service", 900, 340,
        bands=[{"x": 20, "y": 48, "w": 860, "h": 272,
                "label": "StatefulSet shipment-archive (nonroot-v2)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 40, "y": 120, "w": 170, "h": 90, "style": "accent",
             "lines": ["headless Service", "clusterIP: None", "per-Pod DNS"]},
            {"x": 310, "y": 80, "w": 200, "h": 40, "style": "box",
             "lines": ["shipment-archive-0"]},
            {"x": 310, "y": 142, "w": 200, "h": 40, "style": "box",
             "lines": ["shipment-archive-1"]},
            {"x": 310, "y": 204, "w": 200, "h": 40, "style": "box",
             "lines": ["shipment-archive-2"]},
            {"x": 610, "y": 80, "w": 240, "h": 40, "style": "ink",
             "lines": ["archive-data-...-0 (PVC)"]},
            {"x": 610, "y": 142, "w": 240, "h": 40, "style": "ink",
             "lines": ["archive-data-...-1 (PVC)"]},
            {"x": 610, "y": 204, "w": 240, "h": 40, "style": "ink",
             "lines": ["archive-data-...-2 (PVC)"]},
        ],
        edges=[
            {"x1": 210, "y1": 150, "x2": 310, "y2": 100},
            {"x1": 210, "y1": 162, "x2": 310, "y2": 162, "label": "DNS per ordinal"},
            {"x1": 210, "y1": 174, "x2": 310, "y2": 224},
            {"x1": 510, "y1": 100, "x2": 610, "y2": 100, "label": "sticky"},
            {"x1": 510, "y1": 162, "x2": 610, "y2": 162},
            {"x1": 510, "y1": 224, "x2": 610, "y2": 224},
        ],
        notes=[{"x": 450, "y": 32,
                "text": "Stateful Service: ordinal identity + its own PVC, reattached on restart",
                "anchor": "middle", "bold": True}],
    )


def stateless_service():
    g.emit(
        "appendix-14-stateless-service", 900, 320,
        bands=[{"x": 20, "y": 56, "w": 860, "h": 210,
                "label": "payment-service (stateless, replicas: 3)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 112, "w": 160, "h": 80, "style": "accent",
             "lines": ["Service", "any Pod,", "any request"]},
            {"x": 340, "y": 80, "w": 190, "h": 40, "style": "box",
             "lines": ["Pod kd5jb"]},
            {"x": 340, "y": 128, "w": 190, "h": 40, "style": "box",
             "lines": ["Pod l5bgn"]},
            {"x": 340, "y": 176, "w": 190, "h": 44, "style": "ghost",
             "lines": ["Pod cb77p -> gggn2"]},
            {"x": 650, "y": 112, "w": 190, "h": 80, "style": "ink",
             "lines": ["Postgres", "(all shared state)"]},
        ],
        edges=[
            {"x1": 210, "y1": 140, "x2": 340, "y2": 100},
            {"x1": 210, "y1": 150, "x2": 340, "y2": 148, "label": "load-balance"},
            {"x1": 210, "y1": 160, "x2": 340, "y2": 196},
            {"x1": 530, "y1": 148, "x2": 650, "y2": 150, "label": "state external"},
        ],
        notes=[
            {"x": 450, "y": 40,
             "text": "Stateless Service: interchangeable Pods, state lives in Postgres",
             "anchor": "middle", "bold": True},
            {"x": 435, "y": 234, "text": "deleted -> replaced with a new identity, no coordination",
             "anchor": "middle", "size": 10, "color": "#888"},
        ],
    )


def singleton_service():
    g.emit(
        "appendix-13-singleton-service", 900, 320,
        bands=[{"x": 20, "y": 56, "w": 860, "h": 210,
                "label": "replicas: 1 (singleton)", "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 92, "w": 180, "h": 56, "style": "box",
             "lines": ["Eviction API", "drain / autoscaler"]},
            {"x": 330, "y": 86, "w": 190, "h": 66, "style": "ink",
             "lines": ["PodDisruptionBudget", "minAvailable 1 / ALLOWED 0"]},
            {"x": 640, "y": 100, "w": 200, "h": 72, "style": "accent",
             "lines": ["shipping-service", "the only Pod"]},
            {"x": 50, "y": 206, "w": 180, "h": 50, "style": "ghost",
             "lines": ["oc delete pod"]},
        ],
        edges=[
            {"x1": 230, "y1": 120, "x2": 330, "y2": 119, "label": "evict"},
            {"x1": 520, "y1": 119, "x2": 640, "y2": 130,
             "label": "429 refused", "amber": True},
            {"x1": 230, "y1": 228, "x2": 640, "y2": 165,
             "label": "bypasses PDB (succeeds)", "dashed": True},
        ],
        notes=[{"x": 450, "y": 40,
                "text": "Singleton Service: the PDB stops evictions, not a direct delete",
                "anchor": "middle", "bold": True}],
    )


def daemon_service():
    g.emit(
        "appendix-12-daemon-service", 900, 300,
        bands=[{"x": 20, "y": 56, "w": 860, "h": 190,
                "label": "node: crc (one per node; here, one node)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 112, "w": 180, "h": 80, "style": "accent",
             "lines": ["DaemonSet", "1 Pod per node", "(no replicas)"]},
            {"x": 360, "y": 108, "w": 190, "h": 88, "style": "box",
             "lines": ["node-collector Pod", "UID 0, spc_t",
                       "privileged SCC"]},
            {"x": 660, "y": 112, "w": 200, "h": 80, "style": "ink",
             "lines": ["node /var/log/pods", "root:root, var_log_t"]},
        ],
        edges=[
            {"x1": 230, "y1": 152, "x2": 360, "y2": 152, "label": "places 1/node"},
            {"x1": 550, "y1": 152, "x2": 660, "y2": 152,
             "label": "hostPath read", "amber": True},
        ],
        notes=[
            {"x": 450, "y": 40,
             "text": "Daemon Service: one per node, gated by SCC and SELinux",
             "anchor": "middle", "bold": True},
            {"x": 450, "y": 232,
             "text": "restricted-v2 forbids hostPath; privileged SCC + spc_t permits the read",
             "anchor": "middle", "size": 10, "color": "#888"},
        ],
    )


def periodic_job():
    g.emit(
        "appendix-11-periodic-job", 880, 320,
        bands=[{"x": 20, "y": 48, "w": 840, "h": 252,
                "label": "CronJob: one Job per tick (fires once per cluster)",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 120, "w": 180, "h": 80, "style": "accent",
             "lines": ["CronJob", "*/5 * * * *", "Forbid"]},
            {"x": 350, "y": 82, "w": 170, "h": 44, "style": "box",
             "lines": ["Job (tick 0)"]},
            {"x": 350, "y": 138, "w": 170, "h": 44, "style": "box",
             "lines": ["Job (tick 1)"]},
            {"x": 350, "y": 194, "w": 170, "h": 44, "style": "box",
             "lines": ["Job (tick 2)"]},
            {"x": 650, "y": 120, "w": 190, "h": 80, "style": "ink",
             "lines": ["report-*.csv (PVC)", "history: last 3 kept"]},
        ],
        edges=[
            {"x1": 230, "y1": 150, "x2": 350, "y2": 104},
            {"x1": 230, "y1": 160, "x2": 350, "y2": 160, "label": "creates on tick"},
            {"x1": 230, "y1": 170, "x2": 350, "y2": 216},
            {"x1": 520, "y1": 104, "x2": 650, "y2": 150},
            {"x1": 520, "y1": 160, "x2": 650, "y2": 160},
            {"x1": 520, "y1": 216, "x2": 650, "y2": 170},
        ],
        notes=[{"x": 440, "y": 32,
                "text": "Periodic Job: Batch Job with a scheduler in front",
                "anchor": "middle", "bold": True}],
    )


def batch_job():
    g.emit(
        "appendix-10-batch-job", 900, 340,
        bands=[{"x": 20, "y": 48, "w": 860, "h": 272,
                "label": "Indexed Job: completions=3, parallelism=3",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 128, "w": 180, "h": 72, "style": "box",
             "lines": ["shipment_events", "300 rows"]},
            {"x": 360, "y": 86, "w": 180, "h": 46, "style": "accent",
             "lines": ["Pod index 0  (id%3==0)"]},
            {"x": 360, "y": 142, "w": 180, "h": 46, "style": "accent",
             "lines": ["Pod index 1  (id%3==1)"]},
            {"x": 360, "y": 198, "w": 180, "h": 46, "style": "accent",
             "lines": ["Pod index 2  (id%3==2)"]},
            {"x": 670, "y": 128, "w": 190, "h": 72, "style": "ink",
             "lines": ["report-0/1/2.csv", "100 rows each (PVC)"]},
        ],
        edges=[
            {"x1": 230, "y1": 150, "x2": 360, "y2": 109},
            {"x1": 230, "y1": 164, "x2": 360, "y2": 165,
             "label": "JOB_COMPLETION_INDEX"},
            {"x1": 230, "y1": 178, "x2": 360, "y2": 221},
            {"x1": 540, "y1": 109, "x2": 670, "y2": 150},
            {"x1": 540, "y1": 165, "x2": 670, "y2": 164, "label": "disjoint"},
            {"x1": 540, "y1": 221, "x2": 670, "y2": 178},
        ],
        notes=[{"x": 450, "y": 32,
                "text": "Batch Job: the index partitions the data, no coordination service",
                "anchor": "middle", "bold": True}],
    )


def controller():
    g.emit(
        "appendix-22-controller", 920, 340,
        bands=[{"x": 20, "y": 46, "w": 880, "h": 272,
                "label": "observe, diff, act: the same loop twice",
                "fill": "#fafafa"}],
        nodes=[
            {"x": 60, "y": 96, "w": 190, "h": 50, "style": "box",
             "lines": ["ReplicaSet", "watched kind"]},
            {"x": 360, "y": 92, "w": 190, "h": 58, "style": "accent",
             "lines": ["ReplicaSet controller", "(built-in)"]},
            {"x": 660, "y": 96, "w": 190, "h": 50, "style": "ink",
             "lines": ["Pods x2", "owned"]},
            {"x": 60, "y": 216, "w": 190, "h": 50, "style": "box",
             "lines": ["ShippingPolicy", "watched kind"]},
            {"x": 360, "y": 212, "w": 190, "h": 58, "style": "accent",
             "lines": ["ShippingPolicyReconciler", "(custom)"]},
            {"x": 660, "y": 212, "w": 190, "h": 50, "style": "ink",
             "lines": ["Deployment + ConfigMap", "owned"]},
        ],
        edges=[
            {"x1": 250, "y1": 121, "x2": 360, "y2": 121, "label": "watch", "dashed": True},
            {"x1": 550, "y1": 121, "x2": 660, "y2": 121, "label": "create / delete", "amber": True},
            {"x1": 250, "y1": 241, "x2": 360, "y2": 241, "label": "watch", "dashed": True},
            {"x1": 550, "y1": 241, "x2": 660, "y2": 241, "label": "CreateOrUpdate", "amber": True},
        ],
        notes=[
            {"x": 460, "y": 32,
             "text": "Controller: the loop never changes shape, only the watched kind does",
             "anchor": "middle", "bold": True},
            {"x": 755, "y": 290,
             "text": "owner references drive garbage collection", "anchor": "middle",
             "size": 10, "color": "#64748b"},
        ],
    )


def operator():
    g.emit(
        "appendix-25-operator", 900, 330,
        bands=[{"x": 20, "y": 46, "w": 860, "h": 258,
                "label": "a CRD plus a controller is an Operator", "fill": "#fafafa"}],
        nodes=[
            {"x": 50, "y": 108, "w": 200, "h": 90, "style": "accent",
             "lines": ["ShippingPolicy (CRD)", "spec: carrier, replicas",
                       "status: Ready, observed"]},
            {"x": 350, "y": 122, "w": 170, "h": 60, "style": "box",
             "lines": ["Reconcile loop"]},
            {"x": 640, "y": 84, "w": 200, "h": 48, "style": "ink",
             "lines": ["Deployment"]},
            {"x": 640, "y": 176, "w": 200, "h": 48, "style": "ink",
             "lines": ["ConfigMap"]},
        ],
        edges=[
            {"x1": 250, "y1": 152, "x2": 350, "y2": 152, "label": "watch (For)"},
            {"x1": 520, "y1": 140, "x2": 640, "y2": 108, "label": "CreateOrUpdate", "amber": True},
            {"x1": 520, "y1": 164, "x2": 640, "y2": 200, "label": "CreateOrUpdate", "amber": True},
            {"x1": 640, "y1": 120, "x2": 250, "y2": 140, "label": "status.replicas", "dashed": True},
        ],
        notes=[
            {"x": 450, "y": 32,
             "text": "Operator: the CRD gives the domain concept a typed place in the API",
             "anchor": "middle", "bold": True},
            {"x": 740, "y": 266,
             "text": "owner refs cascade a delete to both children", "anchor": "middle",
             "size": 10, "color": "#64748b"},
        ],
    )


def elastic_scale():
    g.emit(
        "appendix-23-elastic-scale", 920, 340,
        bands=[{"x": 20, "y": 46, "w": 880, "h": 272,
                "label": "inside the Pod vs outside the Pod", "fill": "#fafafa"}],
        nodes=[
            {"x": 60, "y": 92, "w": 190, "h": 54, "style": "ink",
             "lines": ["shipping-service Pods"]},
            {"x": 360, "y": 90, "w": 180, "h": 58, "style": "accent",
             "lines": ["HPA + VPA"]},
            {"x": 660, "y": 92, "w": 190, "h": 54, "style": "box",
             "lines": ["replicas 1..5", "(+ recommend)"]},
            {"x": 60, "y": 214, "w": 190, "h": 54, "style": "box",
             "lines": ["cron schedule", "(no Pod needed)"]},
            {"x": 360, "y": 212, "w": 180, "h": 58, "style": "accent",
             "lines": ["KEDA ScaledObject"]},
            {"x": 660, "y": 214, "w": 190, "h": 54, "style": "ink",
             "lines": ["graphql-gateway 0..3"]},
        ],
        edges=[
            {"x1": 250, "y1": 119, "x2": 360, "y2": 119, "label": "read cpu / mem", "dashed": True},
            {"x1": 540, "y1": 119, "x2": 660, "y2": 119, "label": "scale", "amber": True},
            {"x1": 250, "y1": 241, "x2": 360, "y2": 241, "label": "read", "dashed": True},
            {"x1": 540, "y1": 241, "x2": 660, "y2": 241, "label": "scale to zero", "amber": True},
        ],
        notes=[
            {"x": 460, "y": 32,
             "text": "Elastic Scale: resource metrics floor at 1 replica; an external signal reaches 0",
             "anchor": "middle", "bold": True},
            {"x": 755, "y": 162, "text": "floor = 1", "anchor": "middle",
             "size": 10, "color": "#64748b"},
            {"x": 755, "y": 284, "text": "floor = 0", "anchor": "middle",
             "size": 10, "color": "#b8650a"},
        ],
    )


def main():
    predictable_demands()
    declarative_deployment()
    health_probe()
    managed_lifecycle()
    automated_placement()
    init_container()
    sidecar()
    adapter()
    ambassador()
    batch_job()
    periodic_job()
    daemon_service()
    singleton_service()
    stateless_service()
    stateful_service()
    service_discovery()
    self_awareness()
    env_var_configuration()
    configuration_resource()
    configuration_template()
    immutable_configuration()
    controller()
    operator()
    elastic_scale()


if __name__ == "__main__":
    main()
