# DS Platform data-prod — pgbackrest scheduled-backup sidecar (DSO-100 spec §6.3).
#
# FROM postgres:17-bookworm (NOT a bare Debian) on purpose: it already carries the
# `postgres` OS user at uid/gid 999 — matching the pgvector base of the data-layer
# image — plus libpq/gosu. That uid parity is what lets pgbackrest read the shared
# PGDATA volume and connect to Postgres over the shared unix socket. Adds pgbackrest
# + cron for the schedule (the postgres container itself also carries pgbackrest, for
# archive_command). Built by `tools/deploy/postgres-artifact-prepare.mjs` on the
# approved build host and certified before release (tools/deploy/README.md).
#
# Build inputs are pinned (#3992): the base by digest (the `postgres:17.11-bookworm`
# digest — PostgreSQL 17.11, the same server build as the pgvector base of
# ../postgres) and pgbackrest by exact package version. Unpinned, each rebuild took
# whatever PGDG published that day, and the two prod containers ended up on
# different pgBackRest builds. PGDG keeps earlier builds in the bookworm-pgdg index
# (`apt-cache madison pgbackrest`).
# Bump PGBACKREST_PACKAGE together with the one in ../postgres/Dockerfile — both
# containers read the same repository, so they run the same pgBackRest. Locked
# buckets need pgBackRest >= 2.59.2 (infra/deploy/RECOVERY.md §1.4). Bump the base
# digest with the ../postgres base, to the same PostgreSQL patch release.
FROM postgres:17-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994

ARG PGBACKREST_PACKAGE=2.60.0-1.pgdg12+1

# ca-certificates is REQUIRED: the postgres:17-bookworm base ships no TLS trust
# store, so pgbackrest's OpenSSL cannot verify the (publicly-valid GlobalSign)
# cert on the Timeweb S3 endpoint — stanza-create/check/backup all fail with
# error 19 "self-signed certificate in certificate chain" (DSO-100 on-box find).
# openssh-client is the repo2-tunnel service's (#4287, ../repo2-tunnel/tunnel.sh): that
# service runs this same certified image with its own entrypoint, so the forward to
# IDrive needs no further image; Debian's security updates own its version.
# The version step fails the build unless the pgbackrest on PATH is the pinned one.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       "pgbackrest=${PGBACKREST_PACKAGE}" \
       cron \
       ca-certificates \
       openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && v="$(pgbackrest version)" \
    && { [ "$v" = "pgBackRest ${PGBACKREST_PACKAGE%%-*}" ] \
         || { echo "pgbackrest on PATH is '$v', pinned ${PGBACKREST_PACKAGE}" >&2; exit 1; }; } \
    && mkdir -p /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest/conf.d \
       /etc/pgbackrest/offsite \
    && chown -R postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest \
       /etc/pgbackrest/conf.d /etc/pgbackrest/offsite

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY backup.sh /usr/local/bin/backup.sh
# #3670 / #4298: each offsite repo's own config and WAL spool, pgBackRest under that
# config, the spool's pusher, and the data-secret rotation's verdict.
COPY pgbackrest-offsite.sh /usr/local/bin/pgbackrest-offsite.sh
COPY pgbackrest-repo.sh /usr/local/bin/pgbackrest-repo.sh
COPY wal-offsite-push.sh /usr/local/bin/wal-offsite-push.sh
COPY repo-check.sh /usr/local/bin/repo-check.sh
# User-crontab format (no user column) — installed into ROOT's crontab, which the
# `cron -f` daemon (entrypoint) reads. Not placed in /etc/cron.d (that needs a user
# column + would be double-processed).
COPY crontab /etc/pgbackrest.crontab
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh \
       /usr/local/bin/pgbackrest-offsite.sh /usr/local/bin/pgbackrest-repo.sh \
       /usr/local/bin/wal-offsite-push.sh /usr/local/bin/repo-check.sh \
    && crontab /etc/pgbackrest.crontab

# cron must run as root (it drops to `postgres` via gosu per job — see backup.sh).
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
