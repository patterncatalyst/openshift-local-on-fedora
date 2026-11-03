#!/usr/bin/env bash
# Chapter 6 — Routes and edge TLS.
# Deploys web, exposes it with an edge-TLS Route, and verifies over HTTPS using
# the cluster ingress CA (never --insecure). Assumes a running CRC cluster.
set -euo pipefail
cd "$(dirname "$0")"

NS=route-demo
CA=/tmp/crc-ingress-ca.crt

oc config use-context crc-admin
oc new-project "$NS" 2>/dev/null || oc project "$NS"

echo "== deploy web (Deployment + Service) =="
kubectl apply -f ../05-deploying/httpd-deployment.yaml
kubectl rollout status deployment/web --timeout=180s

echo "== create the edge-TLS Route =="
oc apply -f web-route.yaml
HOST=$(oc get route web -o jsonpath='{.spec.host}')
echo "route host: $HOST"

echo "== export the cluster ingress CA =="
oc get configmap default-ingress-cert -n openshift-config-managed \
  -o jsonpath='{.data.ca-bundle\.crt}' > "$CA"

echo "== verify HTTPS (CA trusted) and the HTTP->HTTPS redirect =="
code_https=$(curl -sS --cacert "$CA" "https://$HOST" -o /dev/null -w '%{http_code}')
code_http=$(curl -sS "http://$HOST" -o /dev/null -w '%{http_code}')
echo "https: $code_https   http: $code_http (expect 200 and a 3xx redirect)"

echo "== clean up =="
oc delete project "$NS"
rm -f "$CA"
echo "done."
