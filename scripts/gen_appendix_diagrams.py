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


def main():
    predictable_demands()
    declarative_deployment()
    health_probe()


if __name__ == "__main__":
    main()
