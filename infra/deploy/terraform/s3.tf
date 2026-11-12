# pgbackrest backup repository — Timeweb Object Storage (spec §6.3, ADR-0003 §2.4).
# WAL archive (continuous) + daily basebackup land here. Beget S3 offsite is
# DEFERRED (OUT list, spec §8) — Timeweb primary only for this slice.
# ⚠ Timeweb S3 has no Terraform-modelled lifecycle (bbm postmortem 2026-06-12):
# backup retention is pgbackrest-side (repo1-retention-full=7). The bucket's
# versioning, Object Lock and lifecycle rules are set with the S3 API outside
# Terraform — infra/deploy/RECOVERY.md §1.4 «One provider». The box's S3 key is a
# restricted user's key, not this bucket's generated keys (infra/deploy/README.md).

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

# Program-PDF uploads bucket — webinars wave-1 (#729 / DSO-134, spec §6.3). The
# api's object-storage adapter (S3_* keys in api.env) serves program-PDF
# uploads/downloads from here. SEPARATE from the pgbackrest repo on purpose:
# backup creds never enter api.env, upload creds never enter data.env (spec §6.3).
# Timeweb generates this bucket's access/secret keys — the DD-6 state caveat
# applies identically (sensitive outputs land in the gitignored tfstate; the
# operator copies them into api.env via `terraform output -raw`, README wave-1
# step). Same Hot v2 class: PDFs are small, read-churny (doctors fetch per
# webinar), and cold storage penalizes per-retrieval.
resource "twc_s3_bucket" "uploads" {
  name       = "ds-prod-uploads"
  type       = "private"
  preset_id  = 2669
  project_id = var.project_id
}
