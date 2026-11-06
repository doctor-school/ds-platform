#!/usr/bin/env python3
# rehearse-migration.py — the migration rehearsal of ds-data-prod (Issue #3648; tech
# spec apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md
# §5 «Migration rehearsal.», «Prod read verbs.»).
#
# «What will the migrations of <sha> do to prod», answered on a throw-away restore of
# prod on this box: prod data never leaves ds-data-prod and its backup repository.
# Installed root-owned as /usr/local/lib/ds-platform/rehearse-migration.py by the data
# box's `install` / `converge` (ds-deploy-entrypoint DATA_INSTALL); never takes SQL,
# a script or a path from the client — the one input is the migration archive of a
# SHA contained in `main` (ds-read-entrypoint on ds-api-prod checks that), unpacked
# here member by member.
#
#   start <sha> <archive>  the data verb `rehearse <sha>`, run by ds-deploy-entrypoint
#                          under `flock -n /run/ds-platform/ds-rehearsal.lock`: removes
#                          any leftover, unpacks the archive, reads prod's newest
#                          applied migration (read-only transaction), answers
#                          `no pending migrations` (a report with "pending":0, nothing
#                          restored) or checks the headroom and starts the durable unit
#                          ds-rehearse-<sha12>, which runs outside the lock; prints
#                          one JSON answer
#   start <sha> <archive> --restore-only
#                          the data verb `rehearse-restore <sha>`: the same with the
#                          pending list forced empty — no `no pending migrations`
#                          answer, the headroom check, the unit; its run restores,
#                          checks the copy and applies nothing
#   run <sha>              the unit's body: `pgbackrest check`, restore, the copy, the
#                          apply in one transaction (none when restore-only), the
#                          report with the measured headroom
#   status <sha>           the data verb `rehearsal-status <sha>`: running, the report,
#                          or absent
#   cleanup [<sha>]        the unit's ExecStopPost (rehearse-cleanup): removes every
#                          ds-rehearse-* container and the scratch; with <sha>, records
#                          a failed report when the run left none (the runtime cap, a kill)
#
# Exit codes: 0 the answer · 1 one fixed reason of READ_REASONS on stdout · 2 a bad
# archive or argument · 3 not servable (the reason on stdout).
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

INSTALLED = "/usr/local/lib/ds-platform/rehearse-migration.py"
# Test hooks: a root prefix and a fake for the box tools, honoured only when this file
# runs from anywhere but its installed path.
ROOT = ""
FAKE = None
if os.path.realpath(__file__) != INSTALLED:
    ROOT = os.environ.get("DS_REHEARSE_ROOT", "")
    FAKE = os.environ.get("DS_REHEARSE_FAKE") or None

REHEARSAL_DIR = ROOT + "/var/lib/ds-platform/rehearsal"
SCRATCH_DIR = REHEARSAL_DIR + "/scratch"
COMPOSE = ROOT + "/home/deploy/ds-platform/infra/deploy/compose/data-prod"
PGBACKREST_CONF = COMPOSE + "/pgbackrest/pgbackrest.conf"
STATE_FILE = ROOT + "/home/deploy/ds-platform-postgres-state.json"
DATA_ENV = ROOT + "/etc/ds-platform/data.env"
MEMINFO = ROOT + "/proc/meminfo"
CLEANUP_BIN = ROOT + "/usr/local/lib/ds-platform/rehearse-cleanup"
SELF_BIN = ROOT + INSTALLED if ROOT else INSTALLED
PYTHON_BIN = sys.executable if ROOT else "/usr/bin/python3"

DATABASE = "ds_prod"
SHA_RE = re.compile(r"[0-9a-f]{40}")
SQL_NAME_RE = re.compile(r"[A-Za-z0-9_]{1,128}\.sql")
JOURNAL = "drizzle/meta/_journal.json"
MAX_ARCHIVE_UNPACKED = 16 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 2000
REPORTS_KEPT = 10
RUNTIME_MAX_SEC = 900
GIB = 1024 * 1024 * 1024
# Docker caps of the restore and the copy: an index build hits its own cap, and under
# pressure the kernel's OOM killer picks the copy, never the prod postgres.
CAPS = ["--memory", "768m", "--memory-swap", "768m", "--oom-score-adj", "1000"]
BREAKPOINT = "--> statement-breakpoint"
WAL_SWITCH_RE = re.compile(r"WAL segment ([0-9A-F]{24}) successfully archived")
SQL_ERROR_RE = re.compile(r"ERROR:\s+([0-9A-Z]{5}): (.*)")

# The fixed failure reasons of a read (exit 1): ds-deploy-entrypoint READ_REASONS.
READ_REASONS = (
    "a release step is running",
    "a rehearsal is running",
    "the read-only transaction check failed",
    "the read timed out",
    "insufficient headroom (disk)",
    "insufficient headroom (memory)",
    "copy behind prod",
    "copy exited before promotion",
    "copy did not promote in time",
    "archive check failed",
    "the read failed",
)
# The run's own reasons in a report beside them (never a row value).
UNFINISHED = "the rehearsal did not finish"
STATES = ("running", "succeeded", "failed", "absent")

# The `schema` catalogue of ds-deploy-entrypoint READ_SCHEMA_PY, read here from the
# copy after the commit (tools/deploy/rehearse-migration.test.mjs pins them equal).
NS = ("n.nspname NOT IN ('pg_catalog', 'information_schema')"
      " AND left(n.nspname, 8) <> 'pg_toast' AND left(n.nspname, 8) <> 'pg_temp_'")
TABLES = """(SELECT coalesce(json_agg(t ORDER BY t."schema", t."name"), '[]'::json) FROM (
  SELECT n.nspname AS "schema", c.relname AS "name",
    (SELECT coalesce(json_agg(json_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'notNull', a.attnotnull,
        'default', CASE WHEN a.attgenerated = '' THEN pg_get_expr(d.adbin, d.adrelid) END,
        'identity', CASE a.attidentity WHEN 'a' THEN 'always' WHEN 'd' THEN 'by default' END,
        'generated', CASE WHEN a.attgenerated <> '' THEN pg_get_expr(d.adbin, d.adrelid) END)
        ORDER BY a.attnum), '[]'::json)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS "columns",
    (SELECT coalesce(json_agg(json_build_object(
        'name', i.relname, 'definition', pg_get_indexdef(x.indexrelid)) ORDER BY i.relname), '[]'::json)
      FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = c.oid) AS "indexes",
    (SELECT coalesce(json_agg(json_build_object(
        'name', k.conname,
        'kind', CASE k.contype WHEN 'p' THEN 'primary key' WHEN 'f' THEN 'foreign key'
          WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check' WHEN 'x' THEN 'exclusion'
          WHEN 'n' THEN 'not null' WHEN 't' THEN 'trigger' ELSE k.contype::text END,
        'definition', pg_get_constraintdef(k.oid)) ORDER BY k.conname), '[]'::json)
      FROM pg_constraint k WHERE k.conrelid = c.oid) AS "constraints",
    (SELECT pn.nspname || '.' || p.relname
      FROM pg_inherits h JOIN pg_class p ON p.oid = h.inhparent
        JOIN pg_namespace pn ON pn.oid = p.relnamespace
      WHERE h.inhrelid = c.oid AND c.relispartition) AS "partitionOf"
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND """ + NS + """
) t)"""
ENUMS = """(SELECT coalesce(json_agg(json_build_object(
    'schema', n.nspname, 'name', y.typname,
    'values', (SELECT coalesce(json_agg(e.enumlabel ORDER BY e.enumsortorder), '[]'::json)
               FROM pg_enum e WHERE e.enumtypid = y.oid))
    ORDER BY n.nspname, y.typname), '[]'::json)
  FROM pg_type y JOIN pg_namespace n ON n.oid = y.typnamespace
  WHERE y.typtype = 'e' AND """ + NS + ")"
SEQUENCES = """(SELECT coalesce(json_agg(json_build_object('schema', n.nspname, 'name', c.relname)
    ORDER BY n.nspname, c.relname), '[]'::json)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'S' AND """ + NS + ")"
CATALOGUE_SQL = (
    "BEGIN READ ONLY;\n"
    "SELECT json_build_object('tables', " + TABLES + ",\n'enums', " + ENUMS
    + ",\n'sequences', " + SEQUENCES + ");\n"
    "ROLLBACK;\n"
)
# The newest applied migration, the migrator's pending rule's input: in a read-only
# transaction on ds_prod with the read path's timeouts, the check travelling with it.
NEWEST_SQL = (
    "BEGIN READ ONLY;\n"
    "SET LOCAL statement_timeout = '5s';\n"
    "SET LOCAL lock_timeout = '2s';\n"
    "SELECT json_build_object('database', current_database(), 'readOnly',"
    " current_setting('transaction_read_only') = 'on', 'newest',"
    " (SELECT m.created_at FROM drizzle.__drizzle_migrations m ORDER BY m.created_at DESC LIMIT 1));\n"
    "ROLLBACK;\n"
)
# One reading inside the apply transaction: the clock, the cumulative row counts of
# this transaction per table, the relation locks this backend holds.
READING_SQL = (
    "SELECT '@@READ ' || json_build_object("
    "'at', extract(epoch FROM clock_timestamp()) * 1000, "
    "'rows', (SELECT coalesce(json_object_agg(s.schemaname || '.' || s.relname,"
    " json_build_array(s.n_tup_ins, s.n_tup_upd, s.n_tup_del)), '{}'::json)"
    " FROM pg_stat_xact_user_tables s), "
    "'locks', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_array(n.nspname || '.' || c.relname, l.mode)), '[]'::jsonb)"
    " FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace"
    " WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND " + NS + "))::text;\n"
)
TIMED_OUT = ("statement timeout", "lock timeout", "could not obtain lock")


class Stop(Exception):
    def __init__(self, code, reason):
        super().__init__(reason)
        self.code = code
        self.reason = reason


# --- pure functions (tools/deploy/rehearse-migration.test.mjs) -----------------------

def pending_migrations(journal, newest):
    """The api migrator's rule (drizzle-orm pg-core dialect `migrate`): the journal
    entries whose `when` is newer than the newest applied `created_at`; all of them
    when nothing is applied."""
    entries = journal.get("entries") if isinstance(journal, dict) else None
    if not isinstance(entries, list):
        raise Stop(2, "the journal has no entries")
    out = []
    for e in entries:
        if (not isinstance(e, dict) or not isinstance(e.get("tag"), str)
                or not SQL_NAME_RE.fullmatch(e["tag"] + ".sql")
                or type(e.get("when")) is not int):
            raise Stop(2, "the journal holds a bad entry")
        if newest is None or e["when"] > int(newest):
            out.append({"tag": e["tag"], "when": e["when"]})
    return out


def split_statements(sql):
    """The migrator's split: the file text on `--> statement-breakpoint`, empty
    chunks dropped."""
    return [s for s in sql.split(BREAKPOINT) if s.strip()]


def file_hash(sql):
    """The migrator's `hash`: sha256 of the whole file text."""
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def apply_script(migrations):
    """One psql script: every pending migration in ONE transaction, as the migrator
    does; its `__drizzle_migrations` row after it; a reading before the first and
    after each. A failing statement stops psql (ON_ERROR_STOP) inside the open
    transaction, which the closed session rolls back."""
    lines = ["\\set VERBOSITY verbose", "BEGIN;", READING_SQL.rstrip("\n")]
    for m in migrations:
        lines.append("\\echo @@BEGIN " + m["tag"])
        for stmt in split_statements(m["sql"]):
            lines.append(stmt.strip("\n"))
            lines.append(";")
        lines.append('INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES (\'%s\', %d);'
                     % (m["hash"], m["when"]))
        lines.append(READING_SQL.rstrip("\n"))
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def row_deltas(prev, cur):
    """Rows inserted, updated, deleted per table since the previous reading; tables
    with no change left out."""
    out = {}
    for table in sorted(cur):
        a = prev.get(table, [0, 0, 0])
        b = cur[table]
        d = [int(b[i]) - int(a[i]) for i in range(3)]
        if any(d):
            out[table] = {"inserted": d[0], "updated": d[1], "deleted": d[2]}
    return out


def lock_deltas(prev, cur):
    """The relation locks held now and not at the previous reading."""
    seen = {tuple(x) for x in prev}
    return [{"relation": r, "mode": m} for r, m in sorted({tuple(x) for x in cur} - seen)]


def parse_apply(stdout, stderr, tags, returncode=0):
    """The per-migration readings of one apply run: a reading before the first
    migration and after each. The first migration without its closing reading is the
    failing one, with psql's SQLSTATE and message; a failed COMMIT (a deferred
    constraint) is the last one's. Returns (migrations, failed)."""
    readings = [json.loads(line[len("@@READ "):]) for line in stdout.splitlines()
                if line.startswith("@@READ ")]
    m = None
    for line in stderr.splitlines():
        m = SQL_ERROR_RE.search(line)
        if m:
            break
    error = ({"sqlstate": m.group(1), "message": m.group(2).strip()[:2000]} if m
             else {"sqlstate": None, "message": "the apply failed"})
    out = []
    for i, tag in enumerate(tags):
        if i + 1 < len(readings):
            a, b = readings[i], readings[i + 1]
            out.append({"tag": tag, "ms": round(float(b["at"]) - float(a["at"])),
                        "rows": row_deltas(a["rows"], b["rows"]),
                        "locks": lock_deltas(a["locks"], b["locks"]), "error": None})
            continue
        out.append({"tag": tag, "ms": None, "rows": {}, "locks": [], "error": error})
        return out, True
    if returncode != 0:
        if out:
            out[-1]["error"] = error
        return out, True
    return out, False


def report(sha, *, pending, state, backup=None, recovered_to=None, migrations=(),
           catalogue_after=None, reason=None, restore_only=False, headroom=None, copy_exit=None):
    """The report shape of spec «Report.»."""
    if state not in ("succeeded", "failed"):
        raise ValueError(state)
    return {"verb": "rehearse", "sha": sha, "backup": backup, "recoveredTo": recovered_to,
            "pending": pending, "migrations": list(migrations), "catalogueAfter": catalogue_after,
            "state": state, "reason": reason, "restoreOnly": bool(restore_only), "headroom": headroom,
            "copyExit": copy_exit}


def headroom_required(db_size):
    """The scratch bytes the check demands: 1.5 x the database size + 2 GiB."""
    return int(1.5 * db_size + 2 * GIB)


def headroom_reason(db_size, free_bytes, mem_available):
    """None, or the fixed refusal: 1.5 x the database size + 2 GiB free on the scratch
    filesystem, 1 GiB MemAvailable."""
    if free_bytes < headroom_required(db_size):
        return "insufficient headroom (disk)"
    if mem_available < GIB:
        return "insufficient headroom (memory)"
    return None


def latest_backup(info):
    """The newest backup of `pgbackrest info --output=json`: label, stop time, size."""
    try:
        stanza = next(s for s in info if s.get("name") == "ds")
        b = stanza["backup"][-1]
        stop = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(b["timestamp"]["stop"])))
        return {"label": str(b["label"]), "stopAt": stop}, int(b["info"]["size"])
    except (StopIteration, KeyError, IndexError, TypeError, ValueError):
        raise Stop(1, "the read failed")


# --- the box -------------------------------------------------------------------------

def tool(name):
    return [sys.executable, FAKE, name] if FAKE else [name]


def run(argv, *, stdin=b"", timeout=60, cwd=None):
    try:
        return subprocess.run(argv, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        raise Stop(1, "the read timed out")
    except OSError:
        raise Stop(1, "the read failed")


def docker(*args, **kw):
    return run(tool("docker") + list(args), **kw)


def sha12(sha):
    return sha[:12]


def scratch(sha):
    return os.path.join(SCRATCH_DIR, sha12(sha))


def report_path(sha):
    return os.path.join(REHEARSAL_DIR, sha + ".json")


def repo_env(base):
    """The copy's env file: only the PGBACKREST_* lines of data.env (repository, S3 and
    cipher settings that `pgbackrest restore` and the copy's `archive-get` read), so a
    container on the default bridge never holds the database or other credentials.
    Root-only (0600) in the scratch directory, which the cleanup removes."""
    try:
        with open(DATA_ENV, encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if l.startswith("PGBACKREST_") and "=" in l]
    except OSError:
        raise Stop(1, "the read failed")
    path = os.path.join(base, "repo.env")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("".join(l + "\n" for l in lines))
    return path


def write_report(sha, value):
    """Root-only (0600), whole or not at all; the newest REPORTS_KEPT kept."""
    os.makedirs(REHEARSAL_DIR, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=REHEARSAL_DIR, prefix=".report.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(value, separators=(",", ":")) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, report_path(sha))
    reports = sorted((p for p in os.listdir(REHEARSAL_DIR) if re.fullmatch(r"[0-9a-f]{40}\.json", p)),
                     key=lambda p: os.stat(os.path.join(REHEARSAL_DIR, p)).st_mtime, reverse=True)
    for old in reports[REPORTS_KEPT:]:
        os.unlink(os.path.join(REHEARSAL_DIR, old))


def psql_json(prefix, sql, *, timeout=60):
    """One psql script whose one output line is a JSON value."""
    done = run(prefix + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "ds", "-d", DATABASE, "-f", "-"],
               stdin=sql.encode("utf-8"), timeout=timeout, cwd=COMPOSE)
    if done.returncode != 0:
        text = done.stderr.decode("utf-8", "replace")
        raise Stop(1, "the read timed out" if any(m in text for m in TIMED_OUT) else "the read failed")
    try:
        return json.loads(done.stdout.decode("utf-8"))
    except ValueError:
        raise Stop(1, "the read failed")


LIVE = tool("docker") + ["compose", "exec", "-T", "-e", "PGCLIENTENCODING=UTF8", "postgres"]
# The live pgBackRest sidecar: the recorded pgbackrest image (data-env's
# .postgres-artifacts.json), as `backup-info` reaches it.
SIDECAR = tool("docker") + ["compose", "exec", "-T", "pgbackrest", "gosu", "postgres", "pgbackrest", "--stanza=ds"]


def copy_prefix(sha):
    return tool("docker") + ["exec", "-i", "-e", "PGCLIENTENCODING=UTF8", "ds-rehearse-" + sha12(sha)]


def newest_applied(prefix):
    envelope = psql_json(prefix, NEWEST_SQL)
    if (not isinstance(envelope, dict) or envelope.get("database") != DATABASE
            or envelope.get("readOnly") is not True):
        raise Stop(1, "the read-only transaction check failed")
    newest = envelope.get("newest")
    if newest is not None and not (isinstance(newest, (int, str)) and str(newest).isdigit()):
        raise Stop(1, "the read failed")
    return None if newest is None else int(newest)


def unpack(archive, dest):
    """The migration archive of ds-read-entrypoint, checked member by member: only
    `drizzle/<tag>.sql` and `drizzle/meta/_journal.json`, regular files, bounded."""
    total, files = 0, {}
    try:
        with tarfile.open(archive, mode="r:gz") as tar:
            for i, m in enumerate(tar):
                if i >= MAX_ARCHIVE_ENTRIES:
                    raise Stop(2, "the migration archive holds too many entries")
                name = m.name
                if m.isdir() and name.rstrip("/") in ("drizzle", "drizzle/meta"):
                    continue
                parts = name.split("/")
                ok = m.isreg() and (name == JOURNAL or (
                    len(parts) == 2 and parts[0] == "drizzle" and SQL_NAME_RE.fullmatch(parts[1])))
                if not ok:
                    raise Stop(2, "the migration archive holds an unexpected member")
                total += m.size
                if total > MAX_ARCHIVE_UNPACKED:
                    raise Stop(2, "the migration archive exceeds 16 MiB")
                files[name] = tar.extractfile(m).read()
    except (tarfile.TarError, EOFError, OSError):
        raise Stop(2, "the migration archive is not a readable gzip tar stream")
    if JOURNAL not in files:
        raise Stop(2, "the migration archive has no journal")
    os.makedirs(os.path.join(dest, "drizzle", "meta"), mode=0o700)
    for name, data in files.items():
        with open(os.path.join(dest, name), "wb") as f:
            f.write(data)


def load_migrations(base, pending):
    out = []
    for p in pending:
        path = os.path.join(base, "drizzle", p["tag"] + ".sql")
        if not os.path.isfile(path):
            raise Stop(2, "the migration archive lacks " + p["tag"] + ".sql")
        with open(path, "rb") as f:
            sql = f.read().decode("utf-8")
        out.append({"tag": p["tag"], "when": p["when"], "sql": sql, "hash": file_hash(sql)})
    return out


def read_journal(base):
    try:
        with open(os.path.join(base, JOURNAL), "rb") as f:
            return json.loads(f.read().decode("utf-8"))
    except (OSError, ValueError):
        raise Stop(2, "the journal is not JSON")


def remove_leftovers():
    """Every ds-rehearse-* container and every scratch directory of an earlier run;
    the reports one level up stay."""
    done = docker("ps", "-aq", "--filter", "name=^ds-rehearse-")
    for cid in done.stdout.decode("utf-8", "replace").split():
        if re.fullmatch(r"[0-9a-f]{6,64}", cid):
            docker("rm", "-f", cid)
    if os.path.isdir(SCRATCH_DIR):
        for name in os.listdir(SCRATCH_DIR):
            shutil.rmtree(os.path.join(SCRATCH_DIR, name), ignore_errors=True)


def backup_info():
    done = run(SIDECAR + ["info", "--output=json"],
               timeout=60, cwd=COMPOSE)
    if done.returncode != 0:
        raise Stop(1, "the read failed")
    try:
        return latest_backup(json.loads(done.stdout.decode("utf-8")))
    except ValueError:
        raise Stop(1, "the read failed")


def free_bytes():
    override = os.environ.get("DS_REHEARSE_FREE_BYTES") if ROOT else None
    return int(override) if override else shutil.disk_usage(REHEARSAL_DIR).free


def disk_used(path):
    """Bytes the tree under `path` occupies (allocated blocks; the apparent size where
    the platform reports none), for the report's measured headroom."""
    total = 0
    for top, dirs, files in os.walk(path):
        for name in dirs + files:
            try:
                st = os.lstat(os.path.join(top, name))
            except OSError:
                continue
            blocks = getattr(st, "st_blocks", None)
            total += blocks * 512 if blocks is not None else st.st_size
    return total


def mem_available():
    try:
        with open(MEMINFO, encoding="ascii") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    raise Stop(1, "the read failed")


def unit_active(sha):
    done = run(tool("systemctl") + ["is-active", "ds-rehearse-" + sha12(sha) + ".service"], timeout=30)
    return done.stdout.decode("utf-8", "replace").strip() in ("active", "activating", "deactivating")


def other_unit_active(sha):
    done = run(tool("systemctl") + ["list-units", "--type=service", "--state=active,activating,deactivating",
                                    "--plain", "--no-legend", "ds-rehearse-*"], timeout=30)
    mine = "ds-rehearse-" + sha12(sha) + ".service"
    units = [line.split()[0] for line in done.stdout.decode("utf-8", "replace").splitlines() if line.strip()]
    return any(u != mine for u in units)


def answer(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")


def cmd_start(sha, archive, restore_only=False):
    """The data verb `rehearse <sha>` (`rehearse-restore <sha>` with restore_only), under
    the rehearsal lock."""
    verb = "rehearse-restore" if restore_only else "rehearse"
    if unit_active(sha):
        return answer({"verb": verb, "sha": sha, "state": "running"})
    if other_unit_active(sha):
        raise Stop(1, "a rehearsal is running")
    remove_leftovers()
    base = scratch(sha)
    os.makedirs(SCRATCH_DIR, mode=0o700, exist_ok=True)
    try:
        unpack(archive, base)
        newest = newest_applied(LIVE)
        pending = [] if restore_only else pending_migrations(read_journal(base), newest)
        load_migrations(base, pending)
        if os.path.exists(report_path(sha)):
            os.unlink(report_path(sha))
        if not pending and not restore_only:
            write_report(sha, report(sha, pending=0, state="succeeded"))
            shutil.rmtree(base, ignore_errors=True)
            return answer({"verb": "rehearse", "sha": sha, "state": "no pending migrations", "pending": 0})
        backup, size = backup_info()
        free, mem = free_bytes(), mem_available()
        reason = headroom_reason(size, free, mem)
        if reason:
            raise Stop(1, reason)
        headroom = {"dbSize": size, "scratchFree": free, "memAvailable": mem,
                    "required": headroom_required(size)}
        with open(os.path.join(base, "plan.json"), "w", encoding="utf-8") as f:
            json.dump({"newest": newest, "pending": pending, "backup": backup,
                       "restoreOnly": restore_only, "headroom": headroom}, f)
    except Stop:
        shutil.rmtree(base, ignore_errors=True)
        raise
    unit = "ds-rehearse-" + sha12(sha)
    done = run(tool("systemd-run") + [
        "--unit=" + unit, "--collect", "--quiet",
        "--description=DS Platform migration rehearsal of " + sha12(sha),
        "-p", "RuntimeMaxSec=%d" % RUNTIME_MAX_SEC,
        "-p", "ExecStopPost=" + CLEANUP_BIN + " " + sha,
        # No lock in the unit: the entrypoint's lock serialises the starts, and the running
        # unit itself excludes another (unit_active / other_unit_active above), so a same-SHA
        # call answers `running` (spec «Durable unit.»).
        "--", PYTHON_BIN, "-I", SELF_BIN, "run", sha,
    ], timeout=30)
    if done.returncode != 0:
        shutil.rmtree(base, ignore_errors=True)
        raise Stop(1, "the read failed")
    return answer({"verb": verb, "sha": sha, "state": "started", "pending": len(pending)})


def promote_deadline(started):
    """The copy's promotion deadline: 120 s of the unit's runtime cap stay for the apply
    and the report. A test root may shorten the wait (DS_REHEARSE_PROMOTE_SEC)."""
    override = os.environ.get("DS_REHEARSE_PROMOTE_SEC") if ROOT else None
    return time.monotonic() + float(override) if override else started + RUNTIME_MAX_SEC - 120


def copy_exit(sha):
    """The stopped copy's exit code and OOM kill (aggregates of `docker inspect`, never
    its log), or None when the state does not read."""
    done = docker("inspect", "-f", "{{.State.ExitCode}} {{.State.OOMKilled}}", "ds-rehearse-" + sha12(sha),
                  timeout=30)
    m = re.fullmatch(r"(-?[0-9]{1,5}) (true|false)", done.stdout.decode("utf-8", "replace").strip())
    if done.returncode != 0 or not m:
        return None
    return {"exitCode": int(m.group(1)), "oomKilled": m.group(2) == "true"}


def wait_promoted(sha, deadline, ctx):
    """Until the copy has replayed the archive and promoted (pg_is_in_recovery() = f).
    A stopped copy records its exit in ctx before the teardown removes the container."""
    while time.monotonic() < deadline:
        done = run(copy_prefix(sha) + ["psql", "-X", "-qAt", "-U", "ds", "-d", DATABASE, "-c",
                                       "SELECT pg_is_in_recovery()"], timeout=30)
        if done.returncode == 0 and done.stdout.decode("utf-8", "replace").strip() == "f":
            return
        state = docker("inspect", "-f", "{{.State.Running}}", "ds-rehearse-" + sha12(sha), timeout=30)
        if state.stdout.decode("utf-8", "replace").strip() != "true":
            ctx["copy_exit"] = copy_exit(sha)
            raise Stop(1, "copy exited before promotion")
        time.sleep(2)
    raise Stop(1, "copy did not promote in time")


def cmd_run(sha):
    """The unit's body: report on every exit; the container and the scratch go in
    `finally` here and again in ExecStopPost."""
    base = scratch(sha)
    started = time.monotonic()
    try:
        with open(os.path.join(base, "plan.json"), encoding="utf-8") as f:
            plan = json.load(f)
    except (OSError, ValueError):
        write_report(sha, report(sha, pending=None, state="failed", reason="the read failed"))
        return 1
    pending, backup = plan["pending"], plan["backup"]
    restore_only = plan.get("restoreOnly") is True
    ctx = {"backup": backup, "recovered_to": None, "migrations": [], "copy_exit": None}

    def measured():
        # The plan's headroom inputs plus the scratch the run occupies now, read before
        # each report, so a failure after the restore still states what it used.
        if not isinstance(plan.get("headroom"), dict):
            return None
        return dict(plan["headroom"], scratchUsed=disk_used(base))

    def done_report(state, **kw):
        write_report(sha, report(sha, pending=len(pending), state=state, backup=backup,
                                 recovered_to=ctx["recovered_to"], restore_only=restore_only,
                                 headroom=measured(), copy_exit=ctx["copy_exit"], **kw))

    try:
        migrations = load_migrations(base, pending)
        with open(STATE_FILE, encoding="utf-8") as f:
            images = json.load(f)["images"]
        pg_image, br_image = images["postgres"], images["pgbackrest"]
        # The open WAL segment can hold the last migrate (prod sets no archive_timeout):
        # check switches it and waits until it is in the repository.
        done = run(SIDECAR + ["check"],
                   timeout=180, cwd=COMPOSE)
        text = (done.stdout + done.stderr).decode("utf-8", "replace")
        switch = WAL_SWITCH_RE.search(text)
        if done.returncode != 0 or not switch:
            raise Stop(1, "archive check failed")
        pgdata = os.path.join(base, "pgdata")
        os.makedirs(pgdata, mode=0o700)
        if not ROOT:
            os.chown(pgdata, 999, 999)  # postgres in both images
        mounts = ["--env-file", repo_env(base), "-v", PGBACKREST_CONF + ":/etc/pgbackrest/pgbackrest.conf:ro",
                  "-v", pgdata + ":/var/lib/postgresql/data"]
        # Docker's default bridge (outbound only, for the S3 repository), never the
        # compose network, no published port.
        done = docker("run", "--rm", "--name", "ds-rehearse-" + sha12(sha) + "-restore", *CAPS, *mounts,
                      "--user", "postgres", "--entrypoint", "pgbackrest", br_image,
                      "--stanza=ds", "--log-level-file=off", "--type=default", "--archive-mode=off", "restore",
                      timeout=600)
        if done.returncode != 0:
            raise Stop(1, "the read failed")
        # No --rm: a copy that stops stays inspectable for its exit; the `finally` below,
        # rehearse-cleanup and the next start's remove_leftovers remove it.
        # hot_standby=off: with hot standby on, recovery requires max_connections & co.
        # to be >= the primary's values recorded in WAL and aborts or pauses otherwise
        # (PostgreSQL 17 docs §26.4.3 hot-standby.html#HOT-STANDBY-ADMIN; the check runs
        # only under `ArchiveRecoveryRequested && EnableHotStandby`, xlog.c
        # CheckRequiredParameterValues). The copy is never queried before promotion
        # (wait_promoted tolerates a failed psql), so the small settings stay.
        done = docker("run", "-d", "--name", "ds-rehearse-" + sha12(sha), *CAPS, *mounts,
                      pg_image, "postgres", "-c", "listen_addresses=", "-c", "archive_mode=off",
                      "-c", "hot_standby=off", "-c", "shared_buffers=128MB", "-c", "max_connections=10",
                      timeout=60)
        if done.returncode != 0:
            raise Stop(1, "the read failed")
        wait_promoted(sha, promote_deadline(started), ctx)
        # The copy replayed WAL past the backup end up to the switch `check` forced.
        logs = docker("logs", "ds-rehearse-" + sha12(sha), timeout=60)
        replayed = ('restored log file "%s" from archive' % switch.group(1)) in (
            logs.stdout + logs.stderr).decode("utf-8", "replace")
        if not replayed:
            raise Stop(1, "copy behind prod")
        ctx["recovered_to"] = psql_json(copy_prefix(sha), "SELECT to_json(pg_last_xact_replay_timestamp());\n")
        if newest_applied(copy_prefix(sha)) != plan["newest"]:
            raise Stop(1, "copy behind prod")
        if restore_only:
            done_report("succeeded", catalogue_after=psql_json(copy_prefix(sha), CATALOGUE_SQL, timeout=120))
            return 0
        done = run(copy_prefix(sha) + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "ds", "-d", DATABASE,
                                       "-f", "-"],
                   stdin=apply_script(migrations).encode("utf-8"),
                   timeout=max(30, int(started + RUNTIME_MAX_SEC - 60 - time.monotonic())))
        result, failed = parse_apply(done.stdout.decode("utf-8", "replace"), done.stderr.decode("utf-8", "replace"),
                                     [m["tag"] for m in migrations], done.returncode)
        ctx["migrations"] = result
        if failed:
            done_report("failed", migrations=result)
            return 1
        done_report("succeeded", migrations=result,
                    catalogue_after=psql_json(copy_prefix(sha), CATALOGUE_SQL, timeout=120))
        return 0
    except Stop as e:
        reason = e.reason if e.reason in READ_REASONS else "the read failed"
        done_report("failed", migrations=ctx["migrations"], reason=reason)
        return 1
    finally:
        for name in ("ds-rehearse-" + sha12(sha), "ds-rehearse-" + sha12(sha) + "-restore"):
            try:
                docker("rm", "-f", name, timeout=60)
            except Stop:
                pass
        shutil.rmtree(base, ignore_errors=True)


def cmd_status(sha):
    if unit_active(sha):
        return answer({"verb": "rehearsal-status", "sha": sha, "state": "running"})
    try:
        with open(report_path(sha), encoding="utf-8") as f:
            value = json.load(f)
    except FileNotFoundError:
        return answer({"verb": "rehearsal-status", "sha": sha, "state": "absent"})
    except (OSError, ValueError):
        raise Stop(1, "the read failed")
    if not isinstance(value, dict) or value.get("state") not in STATES:
        raise Stop(1, "the read failed")
    return answer(value)


def cmd_cleanup(sha=None):
    plan = {}
    if sha:
        # Read before the scratch goes: the unfinished report still says what ran.
        try:
            with open(os.path.join(scratch(sha), "plan.json"), encoding="utf-8") as f:
                plan = json.load(f)
        except (OSError, ValueError):
            plan = {}
        if not isinstance(plan, dict):
            plan = {}
    remove_leftovers()
    if sha and not os.path.exists(report_path(sha)):
        headroom = plan.get("headroom") if isinstance(plan.get("headroom"), dict) else None
        write_report(sha, report(sha, pending=None, state="failed", reason=UNFINISHED,
                                 restore_only=plan.get("restoreOnly") is True, headroom=headroom))


def main(argv):
    try:
        if (len(argv) in (3, 4) and argv[0] == "start" and SHA_RE.fullmatch(argv[1])
                and argv[3:] in ([], ["--restore-only"])):
            cmd_start(argv[1], argv[2], restore_only=len(argv) == 4)
            return 0
        if len(argv) == 2 and argv[0] == "run" and SHA_RE.fullmatch(argv[1]):
            return cmd_run(argv[1])
        if len(argv) == 2 and argv[0] == "status" and SHA_RE.fullmatch(argv[1]):
            cmd_status(argv[1])
            return 0
        if argv[:1] == ["cleanup"] and len(argv) <= 2 and all(SHA_RE.fullmatch(a) for a in argv[1:]):
            cmd_cleanup(*argv[1:])
            return 0
        raise Stop(2, "usage: rehearse-migration.py start <sha> <archive> [--restore-only] | run <sha> | status <sha> | cleanup [<sha>]")
    except Stop as e:
        sys.stdout.write(e.reason + "\n")
        return e.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
