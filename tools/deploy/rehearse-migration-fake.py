# The box tools of rehearse-migration.py under test (tools/deploy/rehearse-migration.test.mjs):
# docker, systemctl and systemd-run, answering from the scenario JSON in
# $FAKE_SCENARIO and logging every call as one JSON line to $FAKE_LOG. The harness
# reaches it only through its test hook DS_REHEARSE_FAKE (never on the box).
import json
import os
import re
import sys

tool, args = sys.argv[1], sys.argv[2:]
with open(os.environ["FAKE_SCENARIO"], encoding="utf-8") as f:
    sc = json.load(f)
stdin = sys.stdin.read() if "-f" in args or "-i" in args else ""
call = {"tool": tool, "args": args, "stdin": stdin}
if "--env-file" in args:  # what a container would receive
    with open(args[args.index("--env-file") + 1], encoding="utf-8") as f:
        call["envFile"] = f.read()
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps(call) + "\n")
SEG = "000000010000000A00000042"


def out(text, rc=0, err=""):
    sys.stdout.write(text)
    sys.stderr.write(err)
    sys.exit(rc)


def newest(value):
    out(json.dumps({"database": "ds_prod", "readOnly": True, "newest": value}) + "\n")


def reading(n):
    rows = {"drizzle.__drizzle_migrations": [n, 0, 0]}
    if n >= 1:
        rows["public.users"] = [0, 3 * n, 0]
    locks = [["drizzle.__drizzle_migrations", "RowExclusiveLock"]]
    if n >= 1:
        locks.append(["public.users", "AccessExclusiveLock"])
    return "@@READ " + json.dumps({"at": 1000.0 + 250 * n, "rows": rows, "locks": locks}) + "\n"


if tool == "systemctl":
    if args[0] == "is-active":
        out(("active" if sc.get("unitActive") else "inactive") + "\n", 0 if sc.get("unitActive") else 3)
    out("".join(u + " loaded active running x\n" for u in sc.get("otherUnits", [])))
if tool == "systemd-run":
    out("", sc.get("systemdRunRc", 0))
if tool != "docker":
    out("", 127)

if args[:2] == ["ps", "-aq"]:
    out("".join(i + "\n" for i in sc.get("leftovers", [])))
if args[0] == "rm":
    out("")
if args[0] == "inspect":
    exited = sc.get("copyExits")
    if "{{.State.Running}}" in args:
        out("false\n" if exited else "true\n")
    if exited and exited.get("garbled"):
        out("<no value> x\n")
    exited = exited or {"exitCode": 0, "oomKilled": False}
    out("%d %s\n" % (exited["exitCode"], "true" if exited["oomKilled"] else "false"))
if args[0] == "logs":
    out("", 0, "" if sc.get("noReplay") else 'LOG:  restored log file "%s" from archive\n' % SEG)
if args[:2] == ["compose", "exec"]:
    if "pgbackrest" in args and "info" in args:
        out(json.dumps([{"name": "ds", "backup": [
            {"label": "20261101-000000F", "timestamp": {"start": 1793000000, "stop": 1793000100},
             "info": {"size": 100}},
            {"label": "20261105-000000F_20261105-090000I", "timestamp": {"start": 1793350000, "stop": 1793350023},
             "info": {"size": sc.get("dbSize", 1024 * 1024 * 1024)}}]}]))
    if "pgbackrest" in args and "check" in args:
        if sc.get("checkRc"):
            out("", sc["checkRc"], "ERROR: [082]: WAL segment was not archived before the 60000ms timeout\n")
        out("", 0, "" if sc.get("noSwitch") else "INFO: WAL segment %s successfully archived\n" % SEG)
    if "psql" in args:
        newest(sc.get("liveNewest"))
if args[0] == "run":
    out("" if "-d" not in args else "c0ffee\n", sc.get("restoreRc", 0) if "-d" not in args else 0)
if args[0] == "exec":
    if "-c" in args:
        out("t\n" if sc.get("neverPromotes") or sc.get("copyExits") else "f\n")
    if "VERBOSITY verbose" in stdin:
        tags = re.findall(r"^\\echo @@BEGIN (\S+)$", stdin, re.M)
        text = reading(0)
        for i, tag in enumerate(tags):
            if tag == sc.get("failTag"):
                out(text, 3,
                    'psql:<stdin>:9: ERROR:  42P07: relation "users_email_idx" already exists\nLOCATION:  x\n')
            text += reading(i + 1)
        out(text, sc.get("commitRc", 0),
            "" if not sc.get("commitRc") else "psql:<stdin>:20: ERROR:  23503: insert or update violates foreign key\n")
    if "pg_last_xact_replay_timestamp" in stdin:
        out('"2026-11-05T09:30:00.123+00:00"\n')
    if "'tables'" in stdin:
        out(json.dumps({"tables": [{"schema": "public", "name": "users"}], "enums": [], "sequences": []}) + "\n")
    if "__drizzle_migrations" in stdin:
        newest(sc.get("copyNewest", sc.get("liveNewest")))
out("", 99, "fake: unexpected call\n")
