#!/usr/bin/env bash
# Chapter 5 — Deploying applications.
# Deploys a UBI httpd Deployment + Service, shows the assigned non-root UID,
# scales, and cleans up. Assumes a running CRC cluster and the crc-admin context.
set -euo pipefail
cd "$(dirname "$0")"

NS=deploy-demo

oc config use-context crc-admin
oc new-project "$NS" 2>/dev/null || oc project "$NS"

echo "== apply Deployment + Service =="
kubectl apply -f httpd-deployment.yaml
kubectl rollout status deployment/web --timeout=180s

echo "== two Pods, each a random non-root UID =="
kubectl get pods -l app=web -o wide
kubectl get pods -l app=web \
  -o jsonpath='{range .items[*]}{.metadata.name}{"  uid="}{.spec.securityContext.runAsUser}{"\n"}{end}'

echo "== reach the Service from inside the cluster =="
kubectl run curl --image=registry.access.redhat.com/ubi9/ubi-minimal --rm -i --restart=Never -- \
  curl -s http://web:8080 >/dev/null && echo "service reachable on :8080"

echo "== scale to 3 and re-roll =="
kubectl scale deployment/web --replicas=3
kubectl rollout status deployment/web --timeout=180s

echo "== clean up =="
oc delete project "$NS"
echo "done."
