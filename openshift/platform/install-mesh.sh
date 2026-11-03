#!/usr/bin/env bash
#
# install-mesh.sh — OpenShift Service Mesh 3 for the demo project:
# the OSSM 3 and Kiali operators, the IstioCNI and Istio control plane
# (pinned), the chart's mesh flag (native sidecars via the istio.io/rev
# label, STRICT mTLS, PERMISSIVE for Route-facing services) and, with
# --canary, a v2 Deployment behind a weighted VirtualService.
#
#   ./openshift/platform/install-mesh.sh [--canary]
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
PLATFORM="$OPENSHIFT_DIR/platform"

# Newest CSVs in their channels when written; re-check (references/versions.md).
OSSM_CSV="servicemeshoperator3.v3.4.3"
KIALI_CSV="kiali-operator.v2.27.5"

CANARY=false
[[ "${1:-}" == "--canary" ]] && CANARY=true

require_crc
helm status "$RELEASE" -n "$NS" --kube-context "$OCP_CONTEXT" >/dev/null 2>&1 || fail "core not deployed: run deploy.sh first"

step "1/4 Operators"
install_operator "$PLATFORM/subscriptions/servicemesh.yaml" openshift-operators servicemeshoperator3 "$OSSM_CSV"
install_operator "$PLATFORM/subscriptions/kiali.yaml" openshift-operators kiali-ossm "$KIALI_CSV"

step "2/4 Istio control plane"
oc apply -f "$PLATFORM/mesh/istio.yaml" >/dev/null || fail "apply Istio/IstioCNI"
oc wait istiocni/default --for=condition=Ready --timeout=300s >/dev/null || fail "IstioCNI not Ready"
ok "IstioCNI Ready"
oc wait istio/default --for=condition=Ready --timeout=600s >/dev/null || fail "Istio not Ready"
ok "Istio $(oc get istio default -o jsonpath='{.spec.version}') Ready (revision $(oc get istio default -o jsonpath='{.status.activeRevisionName}'))"

step "3/4 Sidecars and mTLS"
"$OPENSHIFT_DIR/deploy.sh" --set mesh.enabled=true --set mesh.canary.enabled="$CANARY" >/dev/null \
    || fail "deploy.sh with mesh.enabled failed"
ok "release upgraded with mesh.enabled=true, canary=$CANARY"

step "4/4 Kiali"
sed "s/__NAMESPACE__/$NS/g" "$PLATFORM/mesh/kiali.yaml" | oc apply -f - >/dev/null || fail "apply Kiali"
wait_for 600 "Kiali deployment created" oc get deployment kiali -n istio-system
oc rollout status deployment/kiali -n istio-system --timeout=600s >/dev/null || fail "Kiali not Ready"
ok "Kiali https://$(oc get route kiali -n istio-system -o jsonpath='{.spec.host}')"
