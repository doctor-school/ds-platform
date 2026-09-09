# Terraform provider compatibility

The lock selects `timeweb-cloud/timeweb-cloud` **1.8.2**. The constraint
`>= 1.8.2, < 2.0` excludes older providers lacking the configured router
`networks.nat_ip` attribute. The operational provisioning runbook remains
[../README.md](../README.md); its 1.7.1 validation references are historical.

## Verification (2026-09-09, #2110 / #2111)

Real Terraform 1.15.5 on Windows amd64 ran these commands in this directory:

```text
terraform init -backend=false -input=false -lockfile=readonly -no-color
terraform providers schema -json
terraform validate -no-color
terraform init -backend=false -input=false -upgrade -no-color
terraform providers lock -platform=windows_amd64 -platform=linux_amd64 -platform=darwin_arm64 -no-color
terraform providers schema -json
terraform validate -no-color
terraform fmt -check -diff -no-color
```

Both 1.7.1 baseline and 1.8.2 final configuration validated successfully.
Terraform generated all hashes. Windows, Linux amd64 and Apple Silicon have
explicit platform checksums (signing key `F4926F3278E716C3`). Provider execution
was verified on Windows; Linux/macOS packages were locked, not executed.

## Used schema comparison

Compared both full `terraform providers schema -json` outputs, ignoring prose,
for all nine used resource types: `twc_ssh_key`, `twc_server`, `twc_server_ip`,
`twc_vpc`, `twc_floating_ip`, `twc_router`, `twc_firewall`, `twc_firewall_rule`,
`twc_s3_bucket`.

| Changed contract                                                                                              | Effect on this configuration                                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Firewall rule `port`: number to string                                                                        | All seven numeric ports validate via conversion; all rule plans are no-op.                    |
| Router `networks`: list to set                                                                                | One block; no indexed references. Explicit DHCP/NAT configuration preserves the live network. |
| Router `networks.nat_ip`: optional/computed addition                                                          | Uses the existing floating-IP resource reference. See RED/GREEN below.                        |
| Router `ips`: maximum one block                                                                               | Exactly one block; legacy binding remains unchanged.                                          |
| Removed computed `twc_ssh_key.created_at`, `twc_server.start_at`                                              | Neither referenced.                                                                           |
| Server `bandwidth` now computed; `is_ddos_guard` now optional                                                 | Neither configured or referenced.                                                             |
| Server IP optional `is_ddos_guard`; firewall computed `policy`                                                | Neither configured or referenced.                                                             |
| S3 metadata additions, optional/computed `is_allow_auto_upgrade` and `max_size_mb`, optional `website_config` | None configured or referenced; both bucket plans are no-op.                                   |
| Provider optional `base_url`                                                                                  | Unconfigured; default endpoint retained.                                                      |

S3 computed additions: `avatar_link`, `parent_services`, `rate_id`,
`storage_class`, and `disk_stats.is_unlimited`/`limit`. Other configured arguments,
nested blocks and referenced output attributes retain their schemas. VPC and
floating-IP resource schemas have no structural changes.

Primary evidence:
[registry metadata](https://registry.terraform.io/v1/providers/timeweb-cloud/timeweb-cloud)
reported latest 1.8.2; [release notes](https://github.com/timeweb-cloud/terraform-provider-timeweb-cloud/releases/tag/v1.8.2)
report S3 preset fixes and removal of unused legacy `db_preset`.
The [router documentation at 1.8.2](https://github.com/timeweb-cloud/terraform-provider-timeweb-cloud/blob/v1.8.2/docs/resources/router.md)
models DHCP and SNAT in the `networks` set and describes `nat_ip` removal as
turning off SNAT. The public release tree provides documentation, not provider
implementation source; actual refreshed plans are the compatibility evidence.

## Read-only plan regression

Used the documented local-state harness with actual ignored tfvars and existing
credentials. Each plan used an identical snapshot of the actual state in a
private temporary directory; the source state was never passed as an output.
Refresh was enabled (normal plan), with no `-refresh=false` or refresh command:

```text
terraform plan -json -input=false -lock=false -detailed-exitcode -state=<private-state-copy> -var-file=<actual-tfvars> -out=<private-plan>
terraform show -json <private-plan>
```

The placeholders above name private operational inputs, not replacement values.
Only resource addresses, actions and changed attribute names were retained;
private state/plan files were deleted. Terraform warned that `-state` is
deprecated; it remains supported for this local backend.

| Configuration                                    | Observed resource actions                                         |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| 1.7.1, original configuration (baseline)         | 18 no-op; one in-place `twc_server.api_prod.cloud_init` update.   |
| 1.8.2, original configuration (RED)              | 17 no-op; same server update plus `twc_router.ds` update.         |
| 1.8.2, explicit existing DHCP/NAT intent (GREEN) | 18 no-op; only the identical baseline server drift; router no-op. |

RED changed `networks.0.is_dhcp_enabled` from disabled to unset and made
`networks.0.nat_ip` unknown, while legacy `ips` stayed identical. This was not
proof of an outage, but it prevented a compatibility claim. GREEN explicitly
keeps DHCP disabled and sources `nat_ip` from `twc_floating_ip.data_egress.ip`:
no copied operational addresses, self-reference or new infrastructure resource.

All plans returned exit 2 (changes present), with no create/delete/replacement.
The pre-existing server `cloud_init` drift was not applied or fixed by this
provider update. This is baseline-equivalent compatibility, not a globally
clean plan. No apply, import, source-state write, cloud resource change or
service operation was performed; this change authorizes none of those actions.
