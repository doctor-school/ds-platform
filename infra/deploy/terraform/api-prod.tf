# api-prod — public plane (spec §2.1). Runs Caddy (TLS) + api + portal + Zitadel.
# One public IPv4. Base hardening on first boot via cloud-init.
# VPC-attach + firewall-bind shapes verified against provider schema v1.7.1
# (see network.tf): server joins the VPC via a `local_network` block; the
# firewall binds from its side via `link` (twc_firewall.api_prod in network.tf).

resource "twc_ssh_key" "api_prod" {
  name       = "ds-api-prod"
  body       = trimspace(file(pathexpand(var.api_prod_ssh_pubkey_path)))
  is_default = false
}

resource "twc_server" "api_prod" {
  name       = "ds-api-prod"
  os_id      = var.ubuntu_2404_os_id
  preset_id  = var.api_prod_preset_id
  project_id = var.project_id

  availability_zone = var.availability_zone # 152-ФЗ: MUST be explicit (see variables.tf).

  ssh_keys_ids              = [tonumber(twc_ssh_key.api_prod.id)]
  is_root_password_required = false

  # Base VPS hardening on first boot (non-root deploy user, ufw, docker+compose).
  cloud_init = file("${path.module}/../cloud-init/api-prod.yaml")

  # Join the private VPC with a static address. mode=no_nat: api-prod reaches the
  # internet (ACME, image pulls) through its own public IPv4 (twc_server_ip below);
  # the private NIC carries only VPC-local traffic to data-prod (PG/Redis).
  local_network {
    id   = twc_vpc.ds.id
    ip   = var.api_prod_private_ip
    mode = "no_nat"
  }

  comment = "ds-platform api-prod (Caddy+api+portal+Zitadel). project ds-platform. nsk-1. DSO-100."
}

# Public IPv4 — separate paid resource (+180₽/mo); the preset does NOT include it.
resource "twc_server_ip" "api_prod_ipv4" {
  source_server_id = tonumber(twc_server.api_prod.id)
  type             = "ipv4"
  ptr              = "api.doctor.school"
}
