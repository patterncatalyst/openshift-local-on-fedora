# shellcheck shell=bash
# evidence.sh — platform-tier checks for capture-evidence.sh (sourced, not
# run). Each section runs only when its feature is installed and writes
# $OUT/1N-*.txt; every check fails the capture on a miss. Expects lib.sh,
# $OUT, https(), in_pod() and route_url() from capture-evidence.sh.
#
# Project-specific load (an order burst for KEDA, a request that produces a
# trace) goes in the TODO hooks; the generic checks need no app knowledge.

# Pinned image with curl for the out-of-mesh probe (same as the S2I base).
PROBE_IMAGE="${PROBE_IMAGE:-registry.access.redhat.com/ubi10/openjdk-25:1.24-15}"

mesh_on()   { oc get istio default >/dev/null 2>&1; }
keda_on()   { [[ -n "$(oc get scaledobject -n "$NS" -o name 2>/dev/null)" ]]; }
otel_on()   { oc get instrumentation "$RELEASE-java" -n "$NS" >/dev/null 2>&1; }
ai_on()     { oc get deployment ollama -n "$NS" >/dev/null 2>&1; }
native_on() { oc get deployment -n "$NS" -o jsonpath='{.items[*].spec.template.spec.containers[0].image}' 2>/dev/null | grep -q -- '-native:'; }
gitops_on() { oc get application "$RELEASE" -n openshift-gitops >/dev/null 2>&1; }

# istio_requests_total seen by one pod's sidecar from a given source workload.
inbound_from() {
    oc exec -n "$NS" "$1" -c istio-proxy -- pilot-agent request GET stats/prometheus 2>/dev/null \
        | grep '^istio_requests_total{' | grep 'reporter="destination"' | grep 'request_protocol="http"' \
        | grep "source_workload=\"$2\"" | awk '{s+=$NF} END {print s+0}'
}

evidence_mesh() {
    step "P1 Service mesh (OSSM 3)"
    local f="$OUT/11-mesh.txt" target plain
    # Meshed pods carry the istio.io/rev label on the pod template.
    meshed_apps() { oc get pods -n "$NS" -l "app.kubernetes.io/part-of=$PROJECT,istio.io/rev" \
        -o jsonpath='{range .items[*]}{.metadata.labels.app\.kubernetes\.io/name}{"\n"}{end}' 2>/dev/null | sort -u; }
    target="$(meshed_apps | head -1)"
    [[ -n "$target" ]] || target="${SERVICES[0]}"
    {
        oc get istio default -o jsonpath='Istio {.spec.version}, revision {.status.activeRevisionName}, Ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}'
        oc get csv -n openshift-operators -o custom-columns='CSV:.metadata.name,PHASE:.status.phase' | grep -E 'CSV|servicemesh|kiali'
        printf '\n-- pods: init containers (istio-proxy runs as a native sidecar)\n'
        oc get pods -n "$NS" -l "app.kubernetes.io/part-of=$PROJECT" --field-selector=status.phase=Running \
            -o custom-columns='POD:.metadata.name,REV:.metadata.labels.istio\.io/rev,VERSION:.metadata.labels.version,INIT:.spec.initContainers[*].name'
        printf '\n-- PeerAuthentication\n'
        oc get peerauthentication -n "$NS" -o custom-columns='NAME:.metadata.name,MODE:.spec.mtls.mode'
    } > "$f" 2>&1
    # STRICT: plaintext from a pod outside the mesh (no istio.io/rev label)
    # to a meshed Service is reset. Service name, never a pod IP.
    plain=$(oc run mtls-probe -n "$NS" --image="$PROBE_IMAGE" --restart=Never --rm -i --quiet \
        --command -- bash -c "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://$target:8080/q/health/ready; echo \" exit=\$?\"" 2>/dev/null)
    printf '\n-- plaintext from an unmeshed pod to %s: %s\n' "$target" "$plain" >> "$f"
    [[ "$plain" == 200*"exit=0"* ]] && fail "STRICT mTLS not enforced: plaintext call succeeded"
    ok "STRICT mTLS rejects plaintext from outside the mesh"

    local canary v1 v2 a1 a2 src
    canary="$(helm_values_json | jq -r '.mesh.canary.service // empty')"
    if [[ -n "$canary" ]] && oc get deployment "$canary-v2" -n "$NS" >/dev/null 2>&1; then
        # Drive 100 calls from a meshed caller; TODO(demo): pick the real caller.
        src="${CANARY_CALLER:-$(meshed_apps | grep -vx "$canary" | head -1)}"
        v1=$(oc get pod -n "$NS" -l "app.kubernetes.io/name=$canary,version=v1" --field-selector=status.phase=Running -o name | head -1)
        v2=$(oc get pod -n "$NS" -l "app.kubernetes.io/name=$canary,version=v2" --field-selector=status.phase=Running -o name | head -1)
        a1=$(inbound_from "$v1" "$src"); a2=$(inbound_from "$v2" "$src")
        in_pod "$src" bash -c "for i in \$(seq 100); do curl -s -o /dev/null http://$canary:8080/q/health/ready; done"
        a1=$(( $(inbound_from "$v1" "$src") - a1 )); a2=$(( $(inbound_from "$v2" "$src") - a2 ))
        printf '\n-- canary: 100 requests from %s -> v1=%s v2=%s\n' "$src" "$a1" "$a2" >> "$f"
        (( a1 + a2 == 100 && a2 > 0 && a2 < 30 )) || fail "canary split off: v1=$a1 v2=$a2"
        ok "canary split v1=$a1 v2=$a2"
    fi
    if oc get route kiali -n istio-system >/dev/null 2>&1; then
        local tls
        tls=$(https "$(route_url kiali istio-system)/api/namespaces/$NS/tls" | jq -r .status)
        printf '\n-- Kiali: namespace TLS %s\n' "$tls" >> "$f"
        [[ "$tls" == MTLS_ENABLED ]] || fail "Kiali reports $tls for $NS"
        ok "Kiali: $NS MTLS_ENABLED"
    fi
}

evidence_keda() {
    step "P2 Autoscaling (Custom Metrics Autoscaler)"
    local f="$OUT/12-keda.txt"
    oc get scaledobject -n "$NS" \
        -o custom-columns='NAME:.metadata.name,TARGET:.spec.scaleTargetRef.name,MIN:.spec.minReplicaCount,MAX:.spec.maxReplicaCount,READY:.status.conditions[?(@.type=="Ready")].status,ACTIVE:.status.conditions[?(@.type=="Active")].status' \
        > "$f" 2>&1
    awk 'NR>1 && $5 != "True"' "$f" | grep -q . && fail "a ScaledObject is not Ready (see $f)"
    ok "ScaledObjects Ready"
    # TODO(demo): drive lag (produce N messages), then record replicas
    # every 5 s until the target goes 0 -> N -> 0, and fail if it never does.
}

evidence_otel() {
    step "P3 Tracing (OpenTelemetry Java agent -> otel-lgtm)"
    local f="$OUT/13-tracing.txt" code
    {
        printf -- '-- pods with the injected agent\n'
        oc get pods -n "$NS" -l "app.kubernetes.io/part-of=$PROJECT" --field-selector=status.phase=Running \
            -o custom-columns='POD:.metadata.name,INIT:.spec.initContainers[*].name' | grep -E 'POD|opentelemetry-auto-instrumentation'
        printf '\n-- recent traces (Tempo)\n'
        # TODO(demo): send one request through a Route first, then
        # assert the trace has spans from each service on the path. Tempo 3 needs
        # start/end; narrow with tags=service.name%3D<svc>. New traces index with a delay.
        in_pod lgtm curl -s "localhost:3200/api/search?limit=20&start=$(( $(date +%s) - 3600 ))&end=$(date +%s)" | jq -r '.traces[]? | "\(.rootServiceName): \(.rootTraceName)"' | sort | uniq -c
    } > "$f" 2>&1
    grep -q opentelemetry-auto-instrumentation "$f" || fail "no pod carries the injected Java agent"
    code=$(https -o /dev/null -w '%{http_code}' "$(route_url grafana)/api/health")
    printf '\nGrafana /api/health through its Route: %s\n' "$code" >> "$f"
    [[ "$code" == 200 ]] || fail "Grafana Route returned $code"
    ok "agent injected; Grafana Route 200"
}

evidence_ai() {
    step "P4 AI tier (Ollama)"
    local f="$OUT/14-ai.txt" model
    model="$(helm_values_json | jq -r '.ai.model // empty')"
    oc exec -n "$NS" deploy/ollama -c ollama -- ollama list > "$f" 2>&1
    [[ -z "$model" ]] || grep -q "^$model" "$f" || fail "ollama does not list $model"
    ok "ollama serves ${model:-its default model}"
    # TODO(demo): call each AI service in-pod with fixed inputs and
    # assert the expected answers.
}

evidence_native() {
    step "P5 Native image"
    local f="$OUT/15-native.txt" svc pod node
    svc="$(helm_values_json | jq -r '.native.service // empty')"
    [[ -n "$svc" ]] || return 0
    pod=$(oc get pod -n "$NS" -l "app.kubernetes.io/name=$svc" --field-selector=status.phase=Running -o name | grep -v -- '-v2-' | head -1)
    node=$(oc get node -o jsonpath='{.items[0].metadata.name}')
    {
        oc get builds -n "$NS" -l "buildconfig=$svc-native" -o custom-columns='BUILD:.metadata.name,STATUS:.status.phase,DURATION:.status.duration' 2>/dev/null
        printf '\n-- startup\n'
        oc logs -n "$NS" "$pod" -c "$svc" | grep -m1 'started in'
        printf '\n-- working set (kubelet stats)\n'
        oc get --raw "/api/v1/nodes/$node/proxy/stats/summary" | jq -r --arg ns "$NS" --arg s "$svc" '.pods[] | select(.podRef.namespace==$ns)
            | select(.podRef.name|startswith($s)) | .podRef.name as $p | .containers[] | select(.name==$s)
            | "\($p): \(.memory.workingSetBytes/1048576|floor) MiB"'
    } > "$f" 2>&1
    grep -q ' native (powered by Quarkus' "$f" || fail "$svc is not running the native binary"
    ok "native $svc: $(grep -o 'started in [0-9.]*s' "$f" | head -1)"
}

evidence_gitops() {
    step "P6 GitOps (Argo CD)"
    local f="$OUT/16-gitops.txt" start cm="$RELEASE-app-config"
    {
        oc get application "$RELEASE" -n openshift-gitops -o jsonpath='Application {.metadata.name}: {.spec.source.repoURL} @ {.spec.source.targetRevision} path {.spec.source.path}{"\n"}sync={.status.sync.status} health={.status.health.status} revision={.status.sync.revision}{"\n"}'
        oc delete configmap "$cm" -n "$NS" >/dev/null
        start=$(date +%s)
        until oc get configmap "$cm" -n "$NS" >/dev/null 2>&1; do sleep 2; (( $(date +%s) - start > 300 )) && break; done
        printf 'self-heal: deleted ConfigMap %s; restored after %ss\n' "$cm" "$(( $(date +%s) - start ))"
    } > "$f" 2>&1
    grep -q 'sync=Synced' "$f" || fail "Application not Synced"
    grep -q 'restored after' "$f" && oc get configmap "$cm" -n "$NS" >/dev/null 2>&1 || fail "Argo CD did not restore the ConfigMap"
    ok "Argo CD Synced; $(grep -o 'restored after [0-9]*s' "$f")"
}

platform_evidence() {
    mesh_on && evidence_mesh
    keda_on && evidence_keda
    otel_on && evidence_otel
    ai_on && evidence_ai
    native_on && evidence_native
    gitops_on && evidence_gitops
    return 0
}
