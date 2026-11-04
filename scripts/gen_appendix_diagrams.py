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


def main():
    predictable_demands()
    declarative_deployment()


if __name__ == "__main__":
    main()
