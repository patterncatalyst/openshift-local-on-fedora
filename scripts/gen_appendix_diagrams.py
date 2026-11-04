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


def main():
    predictable_demands()


if __name__ == "__main__":
    main()
