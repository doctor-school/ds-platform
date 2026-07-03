# Private network + NAT router + firewalls (spec §5.1).
#
# Attribute shapes verified against timeweb-cloud/timeweb-cloud provider schema
# v1.7.1 (`terraform providers schema -json`, DSO-100 2026-07-03) + provider docs.
# Confirmed: twc_vpc takes {name, subnet_v4, location}; twc_router takes {name,
# preset_id, project_id, networks{id}, ips{ip, nat{id}}}; twc_firewall has NO
# project_id and binds to servers via `link {id,type}` blocks (NOT a server-side
# arg); twc_firewall_rule takes {firewall_id, direction="ingress", protocol, port,
# cidr}; a server joins the VPC via a `local_network {id,ip,mode}` block (see
# api-prod.tf / data-prod.tf).

# Private network — data-prod is reachable ONLY here (it has no public IP). A
# twc_vpc is single-location: its `location` is the REGION code ("ru-3", Moscow),
# distinct from the per-server `availability_zone` ("msk-1"). msk-1 ⊂ ru-3, so the
# VPC region and both servers' AZ are co-located (single-AZ, ADR-0012).
#
# This VPC is created FRESH every rebuild and never reused: a Timeweb VPC port's
# `nat_mode` is sticky — once a port flips to `dnat_and_snat` it cannot be reset
# in place (the per-port PATCH 404s), so a contaminated network must be destroyed
# and recreated rather than repaired (DSO-100 2026-07-03).
resource "twc_vpc" "ds" {
  name        = "ds-prod-vpc"
  subnet_v4   = var.vpc_cidr
  location    = var.vpc_location
  description = "ds-platform prod private net (api-prod ⟷ data-prod). DSO-100."
}

# Egress for the IP-less data-prod comes from a network-level NAT router, per
# Timeweb support's explicit recommendation: the provider implements no per-server
# `snat` on a local network, so a private (public-IP-less) host reaches the internet
# only through a router that NATs the whole VPC subnet. api-prod keeps its own public
# IPv4 and its VPC port stays `no_nat` (local-only) — per the provider's `no_nat`
# semantics the router does not rewrite a `no_nat` port's mode, so api-prod's public
# path is untouched while data-prod borrows the router's floating IP for egress.
#
# The router needs a floating IPv4 to SNAT from; it is bound to the VPC via the
# nested `nat { id = <vpc id> }` block.
resource "twc_floating_ip" "data_egress" {
  availability_zone = var.availability_zone
  comment           = "ds data-prod egress NAT IP (twc_router.ds). DSO-100."
}

resource "twc_router" "ds" {
  name       = "ds-prod-router"
  preset_id  = var.router_preset_id
  project_id = var.project_id

  # The VPC this router manages (the private data plane).
  networks {
    id = twc_vpc.ds.id
  }

  # Floating IP used as the NAT source, bound to the managed VPC. This is the
  # egress path for data-prod (no_nat, no public IP of its own).
  ips {
    ip = twc_floating_ip.data_egress.ip

    nat {
      id = twc_vpc.ds.id
    }
  }
}

# api-prod firewall: public web (80/443) from anywhere + SSH from the admin CIDR.
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

# data-prod firewall: NO public web. Postgres/Redis reachable only inside the VPC.
# SSH is VPC-CIDR-only too — data-prod has no public IP, so an operator reaches it
# by jumping through api-prod as a bastion (its SSH source is then a VPC address,
# not the admin's public CIDR). Binds to the data-prod server.
resource "twc_firewall" "data_prod" {
  name        = "ds-data-prod-fw"
  description = "data-prod: VPC-only PG/Redis + SSH (via api-prod bastion), no public web. DSO-100."

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
  cidr        = var.vpc_cidr
}
