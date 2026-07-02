# DS Platform — pre-pilot deploy slice (DSO-100). Timeweb Cloud provider.
# Own harness / own state / own TWC_TOKEN, same Timeweb account as bbm but
# project-scope `ds-platform` (tenancy SSOT). Template: bbm/infra/timeweb/terraform.
# Spec: apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md

terraform {
  required_version = ">= 1.6"
  required_providers {
    twc = {
      source  = "timeweb-cloud/timeweb-cloud"
      version = "~> 1.0"
    }
  }
}

# Token read from env TWC_TOKEN (see infra/deploy/.env — gitignored).
provider "twc" {}
