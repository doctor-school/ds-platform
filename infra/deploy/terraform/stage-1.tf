# stage-1 — the STAGE stand box (tech spec 2026-09-08-staging-previews-and-regression-contour-en.md
# §3 «Box», §8 step 1; Issue #2061). ONE VPS that carries the whole shared
# `stg-infra` service set (Postgres 17 + pgvector, Redis, Zitadel + login, Cerbos,
# MinIO, Mailpit, sms-sink, sms-aero-adapter, Caddy) plus every live preview slot
# (`main` + `pr-*`), each slot running the whole `api-prod` service set from images
# pulled from GHCR — nothing is built on the box, and no CI agent runs here.
#
# Resource shapes are the ones already verified against timeweb-cloud/timeweb-cloud
# provider schema v1.7.1 for the production plane (see network.tf's header): a server
# joins a VPC via a `local_network {id, ip, mode}` block; `twc_firewall` carries NO
# project_id and binds to a server via `link {id, type}`; `twc_firewall_rule` takes
# {firewall_id, direction, protocol, port, cidr}. This file introduces no new shape.
#
# ISOLATION FROM PRODUCTION — BY THE ABSENCE OF A ROUTE, NOT BY A DENY RULE.
# The Timeweb firewall model is ALLOW-ONLY: `twc_firewall` has no deny rule, and the
# DSO-125 finding recorded in network.tf proved the cloud firewall does not even
# filter the private VPC interface. So a preview slot running arbitrary PR code could
# never be kept away from production Postgres/Redis by a rule. It is kept away because
# `stage-1` sits in its OWN VPC (`twc_vpc.stage`, var.stage_vpc_cidr) with:
#   - no membership in twc_vpc.ds (its `local_network` names twc_vpc.stage only),
#   - no peering and no route between the two networks (Timeweb offers none here, and
#     none is declared),
#   - no `twc_router` on this VPC (the box egresses through its OWN public IPv4, the
#     way api-prod does; only the IP-less data-prod needs the NAT router).
# Consequence, and the C1 acceptance: from the box, 192.168.0.10:5432 is UNROUTABLE
# (no route to host), not a timeout on an open path. Anything that would create a
# route — adding this server to twc_vpc.ds, peering, a VPN, an SSH tunnel from a slot
# — breaks the isolation this whole stand rests on.
#
# WHAT IS NOT HERE: the box holds no production credential of any kind (its env set is
# infra/deploy/stage.env.example, sinks + test keys — spec §3 «Secrets and side
# effects»), no pgbackrest (the box carries no unique state; it is recreated by
# `apply` and rebuilt from the repo — spec §9 «Box down»), and no S3 bucket.
#
# The owner runs `terraform apply` (AGENTS.md §6 live-infra rule: every provider write
# action is owner-gated). This file is Phase A — repository artifact only.

# Own private network for the stand. Single-member today (`stage-1`); it exists so the
# staging plane has an address space that is DISJOINT from var.vpc_cidr and can never
# be confused with it, and so a future second staging host joins here rather than in
# twc_vpc.ds. Same region as production (ru-3 Moscow, 152-ФЗ / ADR-0012 single-AZ) —
# the same REGION code, which is not the per-server availability_zone (see
# variables.tf → vpc_location).
resource "twc_vpc" "stage" {
  name        = "ds-stage-vpc"
  subnet_v4   = var.stage_vpc_cidr
  location    = var.vpc_location
  description = "ds-platform STAGE private net (stage-1 only). No route to ds-prod-vpc. #2061."
}

resource "twc_ssh_key" "stage_1" {
  name       = "ds-stage-1"
  body       = trimspace(file(pathexpand(var.stage_1_ssh_pubkey_path)))
  is_default = false
}

resource "twc_server" "stage_1" {
  name       = "ds-stage-1"
  os_id      = var.ubuntu_2404_os_id
  preset_id  = var.stage_1_preset_id
  project_id = var.project_id

  availability_zone = var.availability_zone # 152-ФЗ + preset is pinned to its node pool.

  ssh_keys_ids              = [tonumber(twc_ssh_key.stage_1.id)]
  is_root_password_required = false

  # First-boot bootstrap: the api-prod hardening set (deploy user, ufw, Docker with
  # the reserved-space build-cache GC policy) plus `git`, and nothing more — the
  # provider hard-resets a new box mid-first-boot, so a long runcmd never finishes
  # (#2121). See ../cloud-init/stage-1.yaml.
  # templatefile: injects the operator public key so the non-root `deploy` user is
  # reachable from first boot (Timeweb installs the key for root only).
  cloud_init = templatefile("${path.module}/../cloud-init/stage-1.yaml", {
    deploy_ssh_pubkey = trimspace(file(pathexpand(var.stage_1_ssh_pubkey_path)))
  })

  # Join the STAGE VPC (never twc_vpc.ds). mode=no_nat: the port carries VPC-local
  # traffic only; all public in/out rides the server's own public IPv4 below — the
  # api-prod pattern, and the reason this VPC needs no twc_router.
  local_network {
    id   = twc_vpc.stage.id
    ip   = var.stage_1_private_ip
    mode = "no_nat"
  }

  comment = "ds-platform stage-1 (stg-infra + preview slots + Actions runner). Own VPC, no route to prod. #2061."
}

# Public IPv4 — a separate paid resource (+180₽/mo), as for api-prod; the preset does
# not include one. This is the A-record target of the `*.stage.doctor.school` wildcard
# the owner creates in step 2 (#2062).
resource "twc_server_ip" "stage_1_ipv4" {
  source_server_id = tonumber(twc_server.stage_1.id)
  type             = "ipv4"
  ptr              = "stage.doctor.school"
}

# stage-1 firewall: the api-prod public model — web open (Caddy terminates TLS for
# every slot vhost and challenges with basic auth, step 2), SSH from the operator
# allowlist only. NOTHING opens the box to CI: the GitHub Actions runner registers
# OUTBOUND (it long-polls github.com), so there is no inbound CI path and no deploy
# key — the §10 lead decision the owner may veto.
resource "twc_firewall" "stage_1" {
  name        = "ds-stage-1-fw"
  description = "stage-1: web open (Caddy basic-auth vhosts), SSH admin-only, no inbound CI path. #2061."

  link {
    id   = twc_server.stage_1.id
    type = "server"
  }
}

resource "twc_firewall_rule" "stage_1_http" {
  firewall_id = twc_firewall.stage_1.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 80
  cidr        = "0.0.0.0/0"
}

resource "twc_firewall_rule" "stage_1_https" {
  firewall_id = twc_firewall.stage_1.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 443
  cidr        = "0.0.0.0/0"
}

resource "twc_firewall_rule" "stage_1_ssh" {
  firewall_id = twc_firewall.stage_1.id
  direction   = "ingress"
  protocol    = "tcp"
  port        = 22
  cidr        = var.admin_ssh_cidr
}
