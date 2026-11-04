#!/usr/bin/env bash
#
# install-ai.sh — the AI tier on OpenShift Local: builds the AI services in
# the cluster (pass their Maven module names; each is a `services:` entry
# with `ai: true`), then the chart's ai flag deploys Ollama under
# restricted-v2, pulls the model with a Job and starts those services.
#
#   ./openshift/platform/install-ai.sh [ai-service...]
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

AI_SERVICES=("$@")

require_crc
helm status "$RELEASE" -n "$NS" --kube-context "$OCP_CONTEXT" >/dev/null 2>&1 || fail "core not deployed: run deploy.sh first"

step "1/3 Build the AI services in the cluster"
if (( ${#AI_SERVICES[@]} )); then
    "$OPENSHIFT_DIR/build-images.sh" "${AI_SERVICES[@]}" >/dev/null || fail "build-images.sh failed for ${AI_SERVICES[*]}"
    ok "${AI_SERVICES[*]} built"
else
    ok "no AI services named: Ollama only"
fi

step "2/3 Ollama and the model"
"$OPENSHIFT_DIR/deploy.sh" --set ai.enabled=true >/dev/null || fail "deploy.sh with ai.enabled failed"
# A plain Job, not a Helm hook, so helm does not block on a multi-GB pull.
oc wait job/ollama-pull-model -n "$NS" --for=condition=Complete --timeout=1200s >/dev/null \
    || fail "model pull did not complete (oc logs job/ollama-pull-model -n $NS)"
model="$(helm get values "$RELEASE" -n "$NS" --kube-context "$OCP_CONTEXT" -a -o json | jq -r .ai.model)"
oc exec -n "$NS" deploy/ollama -c ollama -- ollama list | grep -q "^${model}" || fail "model $model not listed by ollama"
ok "ollama serves $model"

step "3/3 AI services"
for d in "${AI_SERVICES[@]}"; do
    oc rollout status "deployment/$d" -n "$NS" --timeout=600s >/dev/null || fail "$d not Ready"
    ok "$d Ready"
done
