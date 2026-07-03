# data-prod — persistence plane (spec §2.2). Postgres 17 (pgvector) + Redis + pgbackrest.
# NO public IPv4 at all: the host is reachable only inside the VPC and egresses through
# the network-level NAT router (twc_router.ds in network.tf). This is the exact config
# that came up healthy before (server booted with main_ipv4=None). Inbound is closed by
# the default-deny firewall (only 5432/6379 + SSH from the VPC CIDR — SSH via api-prod as
# a bastion). Self-hosted PG (NOT Managed PG) because Managed-PG has no pgvector + no
# superuser (spec §3).
# VPC-attach + firewall-bind shapes verified against provider schema v1.7.1
# (see network.tf): server joins the VPC via `local_network`; the firewall binds
# from its side via `link` (twc_firewall.data_prod in network.tf).

resource "twc_ssh_key" "data_prod" {
  name       = "ds-data-prod"
  body       = trimspace(file(pathexpand(var.data_prod_ssh_pubkey_path)))
  is_default = false
}

resource "twc_server" "data_prod" {
  name       = "ds-data-prod"
  os_id      = var.ubuntu_2404_os_id
  preset_id  = var.data_prod_preset_id
  project_id = var.project_id

  availability_zone = var.availability_zone # 152-ФЗ + same zone as api-prod (single VPC).

  ssh_keys_ids              = [tonumber(twc_ssh_key.data_prod.id)]
  is_root_password_required = false

  # templatefile: injects the NAT-router gateway for the host's default route
  # (data-prod has no public IP — egress exists only via the router; the route
  # must be applied before any first-boot package work, see the yaml NOTE).
  cloud_init = templatefile("${path.module}/../cloud-init/data-prod.yaml", {
    router_gateway_ip = var.vpc_router_gateway_ip
  })

  # Join the private VPC with a static address. mode=no_nat: "only local network
  # traffic allowed" on this port — data-prod has no public IP of its own, so its
  # internet egress comes from the network router NATing the VPC (twc_router.ds in
  # network.tf), not from this port. The private NIC carries VPC-local traffic to
  # api-prod (PG/Redis) plus router-provided egress.
  local_network {
    id   = twc_vpc.ds.id
    ip   = var.data_prod_private_ip
    mode = "no_nat"
  }

  comment = "ds-platform data-prod (PG17+pgvector, Redis, pgbackrest). No public IP; inbound-private (fw default-deny), egress via twc_router NAT. msk-1. DSO-100."
}
