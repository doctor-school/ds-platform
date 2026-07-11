# Outputs consumed by the DNS runbook (Beget A-records), SSH aliases, and the
# on-box .env provisioning (spec §5.3, §5.4, §6.3).

output "api_prod_public_ip" {
  description = "api-prod public IPv4 — set Beget A-records api./app./id.doctor.school to this (spec §5.3)."
  value       = twc_server_ip.api_prod_ipv4.ip
}

output "api_prod_server_id" {
  description = "api-prod server id — for the recovery runbook + power-control API."
  value       = twc_server.api_prod.id
}

output "data_prod_server_id" {
  description = "data-prod server id (no public IP; inbound-private via default-deny fw, egress via router NAT)."
  value       = twc_server.data_prod.id
}

output "data_prod_egress_ip" {
  description = "Floating IPv4 the router NATs data-prod's egress from. NOT an inbound/DNS target — data-prod accepts no public inbound."
  value       = twc_floating_ip.data_egress.ip
}

# Private IPs of both hosts inside twc_vpc.ds — DATABASE_URL/REDIS_URL on api-prod
# point at data-prod's private IP. Sourced from the server's `local_network` block
# (verified attribute, provider v1.7.1); static per var.*_private_ip.
output "data_prod_private_ip" {
  description = "data-prod private (VPC) IPv4 — value of the DB/Redis host in api-prod's api.env (spec §5.4)."
  value       = twc_server.data_prod.local_network[0].ip
}

output "api_prod_private_ip" {
  description = "api-prod private (VPC) IPv4 — for VPC-side debugging / bastion routing."
  value       = twc_server.api_prod.local_network[0].ip
}

output "pgbackrest_bucket" {
  description = "Requested pgbackrest bucket name."
  value       = twc_s3_bucket.pgbackrest.name
}

output "pgbackrest_bucket_full_name" {
  description = "Real (account-prefixed) bucket name — the S3 path-style repo target for pgbackrest."
  value       = twc_s3_bucket.pgbackrest.full_name
}

output "pgbackrest_s3_hostname" {
  description = "S3 endpoint host of the pgbackrest bucket."
  value       = twc_s3_bucket.pgbackrest.hostname
}

output "pgbackrest_s3_access_key" {
  value     = twc_s3_bucket.pgbackrest.access_key
  sensitive = true
}

output "pgbackrest_s3_secret_key" {
  value     = twc_s3_bucket.pgbackrest.secret_key
  sensitive = true
}

# --- uploads bucket (webinars wave-1, #729 / spec §6.3) — feeds api.env S3_* ---

output "uploads_bucket_full_name" {
  description = "Real (account-prefixed) uploads bucket name — api.env S3_BUCKET_UPLOADS."
  value       = twc_s3_bucket.uploads.full_name
}

output "uploads_s3_hostname" {
  description = "S3 endpoint host of the uploads bucket — api.env S3_ENDPOINT is https://<this> (path-style)."
  value       = twc_s3_bucket.uploads.hostname
}

# Timeweb-generated bucket creds — same DD-6 pattern as pgbackrest above:
# `sensitive` suppresses CLI display only; the values DO sit in the gitignored
# tfstate (spec §5.4 DD-6, accepted + mitigated). Consumed via
# `terraform output -raw` into api.env (S3_ACCESS_KEY / S3_SECRET_KEY) — never
# rendered into any committed file.
output "uploads_s3_access_key" {
  value     = twc_s3_bucket.uploads.access_key
  sensitive = true
}

output "uploads_s3_secret_key" {
  value     = twc_s3_bucket.uploads.secret_key
  sensitive = true
}
