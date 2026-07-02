# pgbackrest backup repository — Timeweb Object Storage (spec §6.3, ADR-0003 §2.4).
# WAL archive (continuous) + daily basebackup land here. Beget S3 offsite is
# DEFERRED (OUT list, spec §8) — Timeweb primary only for this slice.
# ⚠ Timeweb S3 has no Terraform-modelled lifecycle (bbm postmortem 2026-06-12);
# retention is pgbackrest-side (repo1-retention-full=7), not bucket lifecycle.

resource "twc_s3_bucket" "pgbackrest" {
  name       = "ds-prod-pgbackrest"
  type       = "private"
  preset_id  = 2669 # TODO(DSO-100): confirm a HOT pay-as-you-go preset (~50 GB). Cold penalizes churny WAL retrieval.
  project_id = var.project_id
}
