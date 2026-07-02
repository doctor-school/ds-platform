# Private network + firewall (spec §5.1).
#
# Attribute shapes verified against timeweb-cloud/timeweb-cloud provider schema
# v1.7.1 (`terraform providers schema -json`, DSO-100 2026-07-02) + the provider
# docs. Confirmed: twc_vpc takes {name, subnet_v4, location}; twc_firewall has NO
# project_id and binds to servers via `link {id,type}` blocks (NOT a server-side
# arg); twc_firewall_rule takes {firewall_id, direction="ingress", protocol, port,
# cidr}; a server joins the VPC via a `local_network {id,ip,mode}` block (see
# api-prod.tf / data-prod.tf).

# Private network — data-prod is reachable ONLY here (no public IP). A twc_vpc is
# single-location: its `location` is the REGION code (e.g. "ru-2"), distinct from
# the per-server `availability_zone` ("nsk-1"). nsk-1 ⊂ ru-2 (Novosibirsk), so the
# VPC region and both servers' AZ are co-located (single-AZ, ADR-0012).
resource "twc_vpc" "ds" {
  name        = "ds-prod-vpc"
  subnet_v4   = var.vpc_cidr
  location    = var.vpc_location
  description = "ds-platform prod private net (api-prod ⟷ data-prod). DSO-100."
}

# api-prod firewall: public web (80/443) + SSH from the admin CIDR only.
# Binds to the api-prod server via `link` (twc_firewall has no project_id — the
# firewall inherits the project from the linked server).
resource "twc_firewall" "api_prod" {
  name        = "ds-api-prod-fw"
  description = "api-prod: web open, SSH admin-only. DSO-100."

  link {
    id   = twc_server.api_prod.id
    type = "server"
  }
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
# admin-only (or via api-prod as a bastion). Binds to the data-prod server.
resource "twc_firewall" "data_prod" {
  name        = "ds-data-prod-fw"
  description = "data-prod: VPC-only PG/Redis, SSH admin-only, no public web. DSO-100."

  link {
    id   = twc_server.data_prod.id
    type = "server"
  }
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
