# pgbackrest backup repository — Timeweb Object Storage (spec §6.3, ADR-0003 §2.4).
# WAL archive (continuous) + daily basebackup land here. Beget S3 offsite is
# DEFERRED (OUT list, spec §8) — Timeweb primary only for this slice.
# ⚠ Timeweb S3 has no Terraform-modelled lifecycle (bbm postmortem 2026-06-12);
# retention is pgbackrest-side (repo1-retention-full=7), not bucket lifecycle.

resource "twc_s3_bucket" "pgbackrest" {
  name = "ds-prod-pgbackrest"
  type = "private"
  # 2669 = S3 Hot v2, auto-upgradable (bbm precedent: bbm-zoom-rotation-buffer,
  # ~79₽/mo at 10 GB base). HOT is the right class — pgbackrest WAL retrieval is
  # churny and cold storage penalizes early-delete + per-retrieval; auto-upgrade
  # grows past the base as basebackups accumulate toward the ~50 GB in spec §4.
  # Preset price/size validated on apply.
  preset_id  = 2669
  project_id = var.project_id
}
