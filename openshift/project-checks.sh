# shellcheck shell=bash
# project-checks.sh — functional checks for demo (sourced by
# capture-evidence.sh, not run). Replace the example with the project's own
# end-to-end path: seed data, drive one request through a Route, follow the
# event chain, and write each result to $OUT/04-*.txt.
#
# Available from capture-evidence.sh: lib.sh helpers (step, ok, fail,
# wait_for), $OUT, https (curl with the ingress CA), in_pod <deploy> <cmd...>
# (oc exec into the service's own container), route_url <route> [ns].
#
# Rules: drive internal Services with in_pod (the UBI OpenJDK image has
# curl), never with port-forward or a tunnel; call Service names, not pod
# IPs (under STRICT mTLS a pod-IP call is reset); never write a secret.

project_checks() {
    # TODO(demo): replace this example.
    local first="${SERVICES[0]}"
    in_pod "$first" curl -fsS localhost:8080/q/health/ready > "$OUT/04-project.txt" 2>&1 \
        || fail "$first not ready from inside its pod"
    ok "$first answers /q/health/ready in-pod"

    # Event-driven example: wait for a side effect instead of sleeping.
    #   landed() { oc exec -n "$NS" "$RELEASE-postgres-0" -- psql -d "$PROJECT" -tAc \
    #       "select count(*) from my_table where id = '$ID'" | grep -qx '[1-9][0-9]*'; }
    #   wait_for 120 "row for $ID" landed
}
