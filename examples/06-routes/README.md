# Example: Routes and edge TLS (Chapter 6)

Exposes the Chapter 5 web Service to the host with an OpenShift `Route` that
terminates TLS at the edge, and verifies it over HTTPS using the cluster's own
ingress CA.

## Files

- `web-route.yaml` — an edge-TLS `Route` targeting the `web` Service, with HTTP
  redirected to HTTPS.
- `demo.sh` — deploys web (reuses `../05-deploying`), applies the Route, exports
  the ingress CA, and checks the HTTPS response and the HTTP redirect.

## Run

```bash
# Requires a running CRC cluster and the crc-admin context.
./demo.sh
```

## Notes

- Verification uses `curl --cacert`, never `--insecure`: the CRC ingress
  certificate is signed by the cluster CA, so trusting that CA is the correct fix.
- `Route` is an OpenShift API type; there is no `kubectl` verb to create one.

Status: unverified (promoted after a live CRC run; see the repository plans).
