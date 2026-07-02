# api-prod — public plane (spec §2.1). Runs Caddy (TLS) + api + portal + Zitadel.
# One public IPv4. Base hardening on first boot via cloud-init.
# TODO(DSO-100): confirm VPC-attach + firewall-bind attribute names on `validate`.

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

  # TODO(DSO-100): attach to twc_vpc.ds (confirm arg: vpc_id / network block).
  # TODO(DSO-100): bind twc_firewall.api_prod (confirm arg name).

  comment = "ds-platform api-prod (Caddy+api+portal+Zitadel). project ds-platform. nsk-1. DSO-100."
}

# Public IPv4 — separate paid resource (+180₽/mo); the preset does NOT include it.
resource "twc_server_ip" "api_prod_ipv4" {
  source_server_id = tonumber(twc_server.api_prod.id)
  type             = "ipv4"
  ptr              = "api.doctor.school"
}
