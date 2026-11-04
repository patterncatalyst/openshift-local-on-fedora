#!/usr/bin/env bash
#
# build-and-push.sh — build the appendix's shipping-service images with podman
# and push them to the CRC integrated registry, into the `patterns` project.
#
# The pattern examples deploy from the integrated registry (the CRC build path
# from §17), not a local image load. This script does the one-time build the
# appendix index describes. Run it once; the pattern chapters then apply their
# manifests against the pushed images.
#
# Service sources come from the data-mesh reference architecture, the source of
# truth for the shared service code:
#   https://github.com/patterncatalyst/datamesh-reference-arch-python
# Set DATAMESH_DIR to its examples/lgtm-datamesh checkout.
#
# Usage:
#   ./scripts/build-and-push.sh [service ...]
# With no arguments, builds the three the foundational family needs:
#   shipping-service inventory-service notification-service
#
# Prerequisites: a running CRC, logged in as a user who can patch the image
# registry config (kubeadmin), and podman on the host.

set -euo pipefail

NS="patterns"
DATAMESH_DIR="${DATAMESH_DIR:-$HOME/Dev/datamesh-reference-arch-python/examples/lgtm-datamesh}"
SERVICES=("$@")
[[ ${#SERVICES[@]} -eq 0 ]] && SERVICES=(shipping-service inventory-service notification-service)

command -v oc >/dev/null     || { echo "ERROR: oc not on PATH (eval \"\$(crc oc-env)\")" >&2; exit 1; }
command -v podman >/dev/null  || { echo "ERROR: podman not on PATH" >&2; exit 1; }
[[ -d "$DATAMESH_DIR/services" ]] || { echo "ERROR: set DATAMESH_DIR to the lgtm-datamesh checkout (got $DATAMESH_DIR)" >&2; exit 1; }

echo "==> exposing the integrated registry and creating the $NS project"
oc patch configs.imageregistry.operator.openshift.io/cluster \
  --type merge -p '{"spec":{"defaultRoute":true}}' >/dev/null
sleep 3
REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
oc new-project "$NS" >/dev/null 2>&1 || oc project "$NS" >/dev/null

echo "==> podman login to $REG"
podman login -u "$(oc whoami)" -p "$(oc whoami -t)" --tls-verify=false "$REG" >/dev/null

for svc in "${SERVICES[@]}"; do
  ctx="$DATAMESH_DIR/services/$svc"
  [[ -f "$ctx/Containerfile" ]] || { echo "ERROR: $ctx/Containerfile not found" >&2; exit 1; }
  echo "==> building + pushing $svc:v1"
  podman build -q -t "$svc:v1" -f "$ctx/Containerfile" "$ctx" >/dev/null
  podman tag "$svc:v1" "$REG/$NS/$svc:v1"
  podman push --tls-verify=false "$REG/$NS/$svc:v1" >/dev/null
  echo "    pushed $NS/$svc:v1"
done

echo "==> done. Manifests reference image-registry.openshift-image-registry.svc:5000/$NS/<svc>:v1"
