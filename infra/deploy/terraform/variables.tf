# Provisioning parameters for the ds-platform pre-pilot deploy slice.
# Tenancy SSOT: bbm/docs/superpowers/specs/2026-05-12-bbm-ds-infra-tenancy-design.md
# Presets/prices: memory reference_timeweb_terraform_harness (live Timeweb API, 2026-07).

variable "project_id" {
  description = "Timeweb project-scope id for ds-platform. TODO(DSO-100): create/confirm the `ds-platform` project (twc_project or console) — DO NOT reuse bbm-tooling 2512466."
  type        = number
  # default intentionally omitted — must be set explicitly per tenancy SSOT.
}

variable "availability_zone" {
  description = "RF zone for BOTH VPSes and the VPC (single-AZ, ADR-0012). MANDATORY (152-ФЗ): without it the provider defaults to ams-1 (outside RF) even on an RF preset. nsk-1 = ru-2 Novosibirsk."
  type        = string
  default     = "nsk-1"
}

variable "ubuntu_2404_os_id" {
  description = "OS image id. 99 = Ubuntu 24.04 (GET /api/v1/os/servers)."
  type        = number
  default     = 99
}

variable "api_prod_preset_id" {
  description = "VPS preset for api-prod. 3019 = ru-2 nsk 4 vCPU / 8 GB / 80 GB nvme, cheapest 4/8/80 (~1210₽/mo, +180₽ IPv4). Price validated on apply."
  type        = number
  default     = 3019
}

variable "data_prod_preset_id" {
  description = "VPS preset for data-prod. 3019 = ru-2 nsk 4/8/80 (~1210₽/mo, no public IP → no +180₽). Upgrade trigger: local disk >70% or on-box backup retention needed → bump to a larger-disk preset (spec §4)."
  type        = number
  default     = 3019
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
