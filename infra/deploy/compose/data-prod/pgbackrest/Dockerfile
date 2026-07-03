# DS Platform data-prod — pgbackrest scheduled-backup sidecar (DSO-100 spec §6.3).
#
# FROM postgres:17-bookworm (NOT a bare Debian) on purpose: it already carries the
# `postgres` OS user at uid/gid 999 — matching the pgvector base of the data-layer
# image — plus libpq/gosu. That uid parity is what lets pgbackrest read the shared
# PGDATA volume and connect to Postgres over the shared unix socket. Adds pgbackrest
# + cron for the schedule (the postgres container itself also carries pgbackrest, for
# archive_command). Built on-box, no registry.
FROM postgres:17-bookworm


# ca-certificates is REQUIRED: the postgres:17-bookworm base ships no TLS trust
# store, so pgbackrest's OpenSSL cannot verify the (publicly-valid GlobalSign)
# cert on the Timeweb S3 endpoint — stanza-create/check/backup all fail with
# error 19 "self-signed certificate in certificate chain" (DSO-100 on-box find).
RUN apt-get update \
    && apt-get install -y --no-install-recommends pgbackrest cron ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/log/pgbackrest /var/spool/pgbackrest \
    && chown -R postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY backup.sh /usr/local/bin/backup.sh
# User-crontab format (no user column) — installed into ROOT's crontab, which the
# `cron -f` daemon (entrypoint) reads. Not placed in /etc/cron.d (that needs a user
# column + would be double-processed).
COPY crontab /etc/pgbackrest.crontab
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh \
    && crontab /etc/pgbackrest.crontab

# cron must run as root (it drops to `postgres` via gosu per job — see backup.sh).
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
