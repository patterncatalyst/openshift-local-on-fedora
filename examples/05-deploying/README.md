# Example: Deploying applications (Chapter 5)

A UBI httpd Deployment and Service that run under OpenShift's default
`restricted-v2` security context (an arbitrary non-root UID, no fixed
`runAsUser`).

## Files

- `httpd-deployment.yaml` — a 2-replica `Deployment` and a `Service` on port 8080.
- `demo.sh` — applies it, shows the assigned UID, reaches the Service from inside
  the cluster, scales to 3, and cleans up.

## Run

```bash
# Requires a running CRC cluster and the crc-admin context.
./demo.sh
```

## Notes

- The container listens on 8080, not 80: an unprivileged process cannot bind a
  port below 1024, and the UBI httpd image runs non-root by design.
- Exposing this Service to the host with a Route is the Chapter 6 example.

Status: unverified (promoted after a live CRC run; see the repository plans).
