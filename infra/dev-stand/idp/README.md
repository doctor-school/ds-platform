# IdP CI readiness

Both `api-e2e` and `admin-e2e` run `node infra/dev-stand/idp/wait-ready.mjs`
after reading the bootstrap PAT and before calling [provision.sh](./provision.sh).
The helper reads the existing `IDP_ISSUER` and `IDP_SERVICE_TOKEN` environment
variables. It requires an HTTP(S) origin without credentials, a path, query or
fragment; redirects are refused. It never mutates the IdP.

Discovery and `/debug/ready` alone did not establish management readiness:
in CI run 34011243603, job 101427374135, `/debug/ready` passed and the next
`GET /admin/v1/instances/me` returned HTTP 503 because the internal gRPC listener
refused a connection. The helper polls that authenticated identity endpoint,
requiring HTTP 200 with a nonzero decimal string `instance.id` in valid JSON.
Three consecutive matching identities, two seconds apart, avoid accepting a
single early success. Errors or an identity change reset the sequence.

The total wait is bounded to 120 seconds, each request (including reading its
body) to five seconds, and each response body to 16 KiB. Waiting and timeout
diagnostics include elapsed time and the last response, limited to 512 characters
with the PAT redacted. Failure exits nonzero and stops provisioning.

This is a startup precondition, not a guarantee against a later service crash.
The provisioner's independent origin/identity validation remains in place;
provisioning writes and product requests are not retried here. Issue #1887 still
requires **five consecutive PR CI runs** without provisioning or admin-session
readiness failures. The separate provisioning-convergence scope remains #1910.

Fixture coverage runs in `pnpm test:tools` or, focused:
`node --test tools/scripts/idp-readiness.test.mjs`. No live stand is needed.
Bootstrap and provisioner operations: [bootstrap.md](./bootstrap.md).
