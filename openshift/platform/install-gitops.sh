#!/usr/bin/env bash
#
# install-gitops.sh — hand the demo release to Argo CD (OpenShift
# GitOps). The Application renders openshift/helm/demo from git with
# the values the running release already has, adopts its resources, and from
# then on keeps the cluster equal to git (automated sync, prune, self-heal).
# The chart must be pushed to REPO_URL at REVISION first.
#
#   ./openshift/platform/install-gitops.sh [revision]   # default: main
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
PLATFORM="$OPENSHIFT_DIR/platform"

GITOPS_CSV="openshift-gitops-operator.v1.22.1"
REVISION="${1:-main}"
REPO_URL="${REPO_URL:-https://github.com/patterncatalyst/openshift-local-on-fedora.git}"
CHART_PATH="${CHART_PATH:-openshift/helm/$PROJECT}"

require_crc
helm status "$RELEASE" -n "$NS" --kube-context "$OCP_CONTEXT" >/dev/null 2>&1 || fail "release $RELEASE missing: run deploy.sh first"

step "1/3 OpenShift GitOps operator"
install_operator "$PLATFORM/subscriptions/gitops.yaml" openshift-gitops-operator \
    openshift-gitops-operator "$GITOPS_CSV"
wait_for 600 "default Argo CD instance Available" \
    bash -c '[[ "$(oc get argocd openshift-gitops -n openshift-gitops -o jsonpath={.status.phase})" == Available ]]'

step "2/3 Let Argo CD manage project $NS"
oc label namespace "$NS" argocd.argoproj.io/managed-by=openshift-gitops --overwrite >/dev/null || fail "label namespace"
ok "namespace labelled argocd.argoproj.io/managed-by=openshift-gitops"

step "3/3 Application $RELEASE ($REPO_URL @ $REVISION)"
APP="$(mktemp --suffix=.json)"; trap 'rm -f "$APP"' EXIT
values="$(helm_values_json)"
jq -n --arg repo "$REPO_URL" --arg rev "$REVISION" --arg path "$CHART_PATH" \
      --arg ns "$NS" --arg rel "$RELEASE" --arg part "$PROJECT" --argjson values "$values" '{
  apiVersion: "argoproj.io/v1alpha1", kind: "Application",
  metadata: {name: $rel, namespace: "openshift-gitops",
             labels: {"app.kubernetes.io/part-of": $part},
             finalizers: ["resources-finalizer.argocd.argoproj.io"]},
  spec: {
    project: "default",
    source: {repoURL: $repo, targetRevision: $rev, path: $path,
             helm: {releaseName: $rel, valuesObject: $values}},
    destination: {server: "https://kubernetes.default.svc", namespace: $ns},
    # Argo CD renders with helm template, where lookup returns nothing, so the
    # chart would mint a new generated password on every sync. Never touch it.
    ignoreDifferences: [{kind: "Secret", name: ($rel + "-postgres-app"), jsonPointers: ["/data/password"]}],
    syncPolicy: {automated: {prune: true, selfHeal: true},
                 syncOptions: ["RespectIgnoreDifferences=true", "ApplyOutOfSyncOnly=true"]}
  }}' > "$APP"
oc apply -f "$APP" >/dev/null || fail "apply Application"
synced_healthy() {
    [[ "$(oc get application "$RELEASE" -n openshift-gitops -o jsonpath='{.status.sync.status}/{.status.health.status}')" == Synced/Healthy ]]
}
wait_for 900 "Application $RELEASE Synced/Healthy" synced_healthy
ok "Argo CD https://$(oc get route openshift-gitops-server -n openshift-gitops -o jsonpath='{.spec.host}')"
