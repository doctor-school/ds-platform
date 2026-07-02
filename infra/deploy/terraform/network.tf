# Private network + firewall (spec §5.1).
#
# ⚠ SKELETON — the exact twc_vpc / twc_firewall / twc_firewall_rule attribute
# names + how a server attaches to a VPC and how a firewall binds to a server
# MUST be validated against the installed provider schema on `terraform init` +
# `terraform validate` (the bbm harness does not yet use these resources).
# TODO(DSO-100): confirm attribute shapes, then remove this notice.

# Private network — data-prod is reachable ONLY here (no public IP). Single
# location (VPC is single-zone) → both VPSes pinned to var.availability_zone.
resource "twc_vpc" "ds" {
  name          = "ds-prod-vpc"
  subnet_v4     = var.vpc_cidr
  location      = var.availability_zone # TODO: confirm attribute name (location vs availability_zone)
  description   = "ds-platform prod private net (api-prod ⟷ data-prod). DSO-100."
}

# api-prod firewall: public web (80/443) + SSH from the admin CIDR only.
resource "twc_firewall" "api_prod" {
  name        = "ds-api-prod-fw"
  description = "api-prod: web open, SSH admin-only. DSO-100."
  project_id  = var.project_id
}

resource "twc_firewall_rule" "api_http" {
  firewall_id = twc_firewall.api_prod.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 80
  cidr        = "0.0.0.0/0"
}

resource "twc_firewall_rule" "api_https" {
  firewall_id = twc_firewall.api_prod.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 443
  cidr        = "0.0.0.0/0"
}

resource "twc_firewall_rule" "api_ssh" {
  firewall_id = twc_firewall.api_prod.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 22
  cidr        = var.admin_ssh_cidr
}

# data-prod firewall: NO public web. Postgres/Redis only inside the VPC; SSH
# admin-only (or via api-prod as a bastion).
resource "twc_firewall" "data_prod" {
  name        = "ds-data-prod-fw"
  description = "data-prod: VPC-only PG/Redis, SSH admin-only, no public web. DSO-100."
  project_id  = var.project_id
}

resource "twc_firewall_rule" "data_pg" {
  firewall_id = twc_firewall.data_prod.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 5432
  cidr        = var.vpc_cidr
}

resource "twc_firewall_rule" "data_redis" {
  firewall_id = twc_firewall.data_prod.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 6379
  cidr        = var.vpc_cidr
}

resource "twc_firewall_rule" "data_ssh" {
  firewall_id = twc_firewall.data_prod.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 22
  cidr        = var.admin_ssh_cidr
}
