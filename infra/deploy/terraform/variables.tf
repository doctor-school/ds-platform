# Provisioning parameters for the ds-platform pre-pilot deploy slice.
# Tenancy SSOT: bbm/docs/superpowers/specs/2026-05-12-bbm-ds-infra-tenancy-design.md
# Presets/prices: memory reference_timeweb_terraform_harness (live Timeweb API, 2026-07).

variable "project_id" {
  description = "Timeweb project-scope id for ds-platform. TODO(DSO-100): create/confirm the `ds-platform` project (twc_project or console) — DO NOT reuse bbm-tooling 2512466."
  type        = number
  # default intentionally omitted — must be set explicitly per tenancy SSOT.
}

variable "availability_zone" {
  description = "RF zone for the VPSes, router floating IP, and VPC (single-AZ, ADR-0012). MANDATORY (152-ФЗ) AND must match the preset's node pool: a preset is pinned to its zone, so a wrong zone → 'location_zone not valid' (DSO-100). msk-1 = ru-3 Moscow (chosen: ru-1/ru-3 have live 4/8/80 capacity, Novosibirsk excluded)."
  type        = string
  default     = "msk-1"
}

variable "ubuntu_2404_os_id" {
  description = "OS image id. 99 = Ubuntu 24.04 (GET /api/v1/os/servers)."
  type        = number
  default     = 99
}

variable "api_prod_preset_id" {
  description = "VPS preset for api-prod. 4803 = ru-3 msk 4 vCPU / 8 GB / 80 GB nvme (1800₽/mo, +180₽ IPv4). Node pool msk-kvmnvm, zone msk-1. Price/zone validated on apply."
  type        = number
  default     = 4803
}

variable "data_prod_preset_id" {
  description = "VPS preset for data-prod. 4803 = ru-3 msk 4/8/80 (1800₽/mo, no public IP → egress via twc_router NAT). Upgrade trigger: local disk >70% or on-box backup retention needed → bump to a larger-disk preset (spec §4)."
  type        = number
  default     = 4803
}

variable "router_preset_id" {
  description = "NAT router preset for the private data plane. 2009 = ru-3 msk 1 vCPU / 1 GB, cheapest (450₽/mo) — sufficient to SNAT egress for the 2-server plane. GET /api/v1/presets/routers."
  type        = number
  default     = 2009
}

variable "api_prod_ssh_pubkey_path" {
  description = "Path to the deploy SSH public key for api-prod."
  type        = string
  default     = "~/.ssh/ds-api-prod.pub"
}

variable "data_prod_ssh_pubkey_path" {
  description = "Path to the deploy SSH public key for data-prod."
  type        = string
  default     = "~/.ssh/ds-data-prod.pub"
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to reach SSH (22) on both VPSes. Set to the operator's admin IP/CIDR — NOT 0.0.0.0/0."
  type        = string
  # no default — force an explicit, non-open value.
}

variable "vpc_cidr" {
  description = "Private network CIDR joining api-prod and data-prod. data-prod is reachable only inside it."
  type        = string
  default     = "192.168.0.0/24"
}

variable "vpc_location" {
  description = "REGION code for the twc_vpc (distinct from the per-server availability_zone). A VPC is single-location and takes a region code, not an AZ: ru-3 = Moscow, which contains AZ msk-1 (var.availability_zone). Keep in the same region as the servers' AZ (single-AZ, ADR-0012). The VPC cannot relocate in-place — changing region forces replacement (DSO-100). Region↔AZ mapping: ru-1 SPb (spb-3), ru-2 Novosibirsk (nsk-1), ru-3 Moscow (msk-1). Validated on apply."
  type        = string
  default     = "ru-3"
}

variable "vpc_router_gateway_ip" {
  description = "Gateway address twc_router.ds holds inside the VPC — data-prod's default-route target (rendered into its cloud-init). Timeweb-ASSIGNED at router creation, not chosen by us: verify via GET /api/v1/routers → networks[].gateway after any router recreate and update this value if it moved (observed: 192.168.0.4, DSO-100 2026-07-03). Not exported by the provider (twc_router has no gateway attribute), hence a pinned variable."
  type        = string
  default     = "192.168.0.4"
}

variable "api_prod_private_ip" {
  description = "Static VPC address for api-prod inside var.vpc_cidr. api-prod's DB/Redis clients dial data-prod's private IP; this one is mostly for symmetry/debugging."
  type        = string
  default     = "192.168.0.20"
}

variable "data_prod_private_ip" {
  description = "Static VPC address for data-prod inside var.vpc_cidr. This is the host in api-prod's DATABASE_URL / REDIS_URL (spec §5.4). Static so the on-box api.env is deterministic."
  type        = string
  default     = "192.168.0.10"
}
