# data-prod — persistence plane (spec §2.2). Postgres 17 (pgvector) + Redis + pgbackrest.
# NO public IPv4: reachable only inside twc_vpc.ds. Self-hosted PG (NOT Managed PG)
# because Managed-PG has no pgvector + no superuser (spec §3).
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

  cloud_init = file("${path.module}/../cloud-init/data-prod.yaml")

  # NO twc_server_ip resource for data-prod — it stays private (VPC-only).
  # Join the private VPC with a static address. mode=snat: data-prod has no public
  # IP, so egress (pgbackrest → Timeweb S3, image pulls) is NAT'd out through the
  # VPC; no inbound from the internet. See README → "first-boot egress" caveat:
  # cloud-init that needs the internet before SNAT is up may require a temporary
  # floating_ip_id (provider docs) — validated on apply.
  local_network {
    id   = twc_vpc.ds.id
    ip   = var.data_prod_private_ip
    mode = "snat"
  }

  comment = "ds-platform data-prod (PG17+pgvector, Redis, pgbackrest). PRIVATE, no public IP. DSO-100."
}
