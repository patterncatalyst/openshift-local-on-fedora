#!/usr/bin/env bash
#
# install-platform.sh — the whole platform tier on top of a deployed core,
# in order: mesh (with a canary), autoscaling, tracing, the AI tier, a
# native build, then GitOps. Each step is its own script and can run alone;
# drop the lines this project does not need.
#
#   ./openshift/platform/install-platform.sh [gitops-revision]   # default: main
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
P="$OPENSHIFT_DIR/platform"

require_crc
# Measured with everything below on: 12 vCPU / 32 GiB (Ollama requests
# 4 GiB, the native build pod up to 8 GiB).
require_crc_size 12 32768
run() { local start; start=$(date +%s); "$@" || fail "$(basename "$1") failed"; ok "$(basename "$1") done in $(( $(date +%s) - start ))s"; }
run "$P/install-mesh.sh" --canary
run "$P/install-keda.sh"
run "$P/install-observability.sh"
run "$P/install-ai.sh"
run "$P/build-native.sh"
run "$OPENSHIFT_DIR/deploy.sh" --set native.enabled=true
run "$P/install-gitops.sh" "${1:-main}"
