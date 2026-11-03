#!/usr/bin/env bash
#
# build-native.sh — one service as a native executable, compiled inside
# OpenShift Local. The host only runs Maven with
# -Dquarkus.native.sources-only (the jar, its libraries and
# native-image.args); a Docker-strategy binary build then runs native-image
# in the Mandrel builder image and pushes ImageStream tag
# <service>-native:$IMAGE_TAG. No container engine and no native-image on
# the host; the cluster never pulls from Maven Central.
#
#   ./openshift/platform/build-native.sh [service]   # default: NATIVE_SERVICE
#   NATIVE_BUILD_ARGS='-J-Dsome.static.init.property=value' ./openshift/platform/build-native.sh
#
# Then: ./openshift/deploy.sh --set native.enabled=true --set native.service=<service>
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
PLATFORM="$OPENSHIFT_DIR/platform"

SVC="${1:-${NATIVE_SERVICE:-${SERVICES[0]}}}"
# System properties that a class reads in a static initializer that Quarkus
# runs at image build time must reach the native-image builder's JVM (-J-D);
# a -D or JAVA_TOOL_OPTIONS on the running binary arrives too late.
# Example (Avro's ClassSecurityValidator allow-list):
#   NATIVE_BUILD_ARGS='-J-Dorg.apache.avro.SERIALIZABLE_PACKAGES=com.example.events.v1'
NATIVE_BUILD_ARGS="${NATIVE_BUILD_ARGS:-}"

require_crc
oc get project "$NS" >/dev/null 2>&1 || fail "project $NS missing: run install-infra.sh first"
command -v mvn >/dev/null 2>&1 || fail "mvn not on PATH"

step "1/3 native-image sources for $SVC on the host"
mvn_args=(-B -q -pl "$SVC" -am package -DskipTests -Pnative -Dquarkus.native.sources-only=true)
[[ -n "$NATIVE_BUILD_ARGS" ]] && mvn_args+=("-Dquarkus.native.additional-build-args=$NATIVE_BUILD_ARGS")
( cd "$MAVEN_DIR" && mvn "${mvn_args[@]}" ) || fail "mvn -Dquarkus.native.sources-only=true failed"
SRC="$(find "$MAVEN_DIR" -path "*/$SVC/target/native-sources" -type d | head -1)"
[[ -n "$SRC" && -f "$SRC/native-image.args" ]] || fail "no $SVC/target/native-sources/native-image.args"
if [[ -n "$NATIVE_BUILD_ARGS" ]]; then
    # Prove each build-time argument (comma-separated) reached native-image.
    IFS=',' read -r -a nargs <<<"$NATIVE_BUILD_ARGS"
    for a in "${nargs[@]}"; do
        grep -qF -- "${a#-J}" "$SRC/native-image.args" || fail "$a did not reach native-image.args"
    done
fi
ok "$(du -sh "$SRC" | cut -f1) of native sources (GraalVM $(cat "$SRC/graalvm.version" 2>/dev/null || echo '?'))"

step "2/3 BuildConfig $SVC-native"
if ! oc get bc "$SVC-native" -n "$NS" >/dev/null 2>&1; then
    oc new-build --name="$SVC-native" --binary --strategy=docker \
        --to="$SVC-native:$IMAGE_TAG" -n "$NS" >/dev/null || fail "oc new-build"
fi
# native-image needs memory: give the build pod room, and name the
# Containerfile explicitly.
oc patch bc "$SVC-native" -n "$NS" --type merge -p \
    '{"spec":{"resources":{"requests":{"cpu":"2","memory":"4Gi"},"limits":{"memory":"8Gi"}},"strategy":{"dockerStrategy":{"dockerfilePath":"Containerfile"}}}}' >/dev/null
CTX="$(mktemp -d)"; LOG="$(mktemp)"; trap 'rm -rf "$CTX" "$LOG"' EXIT
cp -r "$SRC/." "$CTX/" && cp "$PLATFORM/native/Containerfile" "$CTX/Containerfile"
ok "build context ready"

step "3/3 native-image in the cluster"
start=$(date +%s)
oc start-build "$SVC-native" --from-dir="$CTX" --follow --wait -n "$NS" > "$LOG" 2>&1 \
    || { tail -30 "$LOG" >&2; fail "native build failed"; }
ok "$SVC-native:$IMAGE_TAG in $(( $(date +%s) - start ))s"
