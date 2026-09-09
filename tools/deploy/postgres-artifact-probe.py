"""Read-only, sanitized PostgreSQL deployment evidence; invoked over SSH stdin."""
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import sys

request = json.loads(base64.b64decode(sys.argv[1]))


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError("PostgreSQL evidence command failed: " + args[0])
    return result.stdout.strip()


def inspect(kind, name):
    return json.loads(run("sudo", "docker", kind, "inspect", name))[0]


def environment(obj):
    return dict(value.split("=", 1) for value in obj["Config"]["Env"])


def image_evidence(ref):
    image = inspect("image", ref)
    env = environment(image)
    return {"id": image["Id"], "major": int(env["PG_MAJOR"]),
            "pgdata": env["PGDATA"],
            "sourceHash": (image["Config"].get("Labels") or {}).get("org.doctor-school.postgres-source")}


def container_evidence(name, target):
    container = inspect("container", name)
    env = environment(container)
    pgdata = env["PGDATA"]
    mounts = [m for m in container["Mounts"] if m["Destination"] == target]
    if len(mounts) != 1 or mounts[0]["Type"] != "volume":
        raise RuntimeError("missing/ambiguous named PostgreSQL data mount")
    mount = mounts[0]
    version = run("sudo", "docker", "exec", name, "cat", pgdata + "/PG_VERSION")
    control = run("sudo", "docker", "exec", "-e", "LC_ALL=C", name, "pg_controldata", "-D", pgdata)
    system_id = re.search(r"^Database system identifier:\s*(\d+)\s*$", control, re.M)[1]
    return container, {"major": int(env["PG_MAJOR"]), "systemId": system_id,
                       "pgdata": pgdata, "pgVersion": version,
                       "running": container["State"]["Running"],
                       "mount": {"name": mount["Name"], "target": mount["Destination"], "rw": mount["RW"]}}


try:
    target = request["target"]
    server_name = "ds-data-prod-postgres-1"
    backup_name = "ds-data-prod-pgbackrest-1"
    server, source = container_evidence(server_name, target["mount"]["target"])
    backup, sidecar = container_evidence(backup_name, target["sidecarMount"]["target"])
    row = run("sudo", "docker", "exec", server_name, "psql", "-XAt", "-U", "ds", "-d", "postgres", "-c",
              "SELECT current_setting('server_version_num'), current_setting('data_directory'), system_identifier FROM pg_control_system()")
    version_num, data_directory, system_id = row.split("|")
    if int(version_num) // 10000 != source["major"] or data_directory != source["pgdata"] or system_id != source["systemId"]:
        raise RuntimeError("running SQL server differs from mounted data")
    configs = [run("sudo", "docker", "exec", n, "cat", "/etc/pgbackrest/pgbackrest.conf") for n in [server_name, backup_name]]
    paths = [re.findall(r"^pg1-path\s*=\s*(\S+)\s*$", config, re.M) for config in configs]
    if paths[0] != paths[1] or len(paths[0]) != 1:
        raise RuntimeError("server/sidecar backup config mismatch")
    for container in [server, backup]:
        override = environment(container).get("PGBACKREST_PG1_PATH")
        if override and override != paths[0][0]:
            raise RuntimeError("backup path environment override mismatch")
    info = json.loads(run("sudo", "docker", "exec", backup_name, "gosu", "postgres", "pgbackrest", "--stanza=ds", "--output=json", "info"))
    if len(info) != 1 or info[0]["name"] != "ds" or info[0]["status"]["code"] != 0:
        raise RuntimeError("backup stanza is not healthy")
    db = max(info[0]["db"], key=lambda item: item["id"])
    root = pathlib.Path.home() / "ds-platform/infra/deploy/compose/data-prod"
    hashes = [[p, hashlib.sha256((root / p).read_bytes()).hexdigest() if (root / p).is_file() else None] for p in request["paths"]]
    source_hash = hashlib.sha256(json.dumps(hashes, separators=(",", ":")).encode()).hexdigest()
    state_path = pathlib.Path.home() / "ds-platform-postgres-state.json"
    record = {}
    requested_images = target["images"]
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state["schema"] != 1 or not re.fullmatch(r"[a-f0-9]{64}", state["sourceHash"]):
            raise RuntimeError("invalid durable artifact state")
        source_hash = state["sourceHash"]
        record["recordedSystemId"] = state["systemId"]
        if request.get("preferRecordedImages") and source_hash == request.get("sourceHash"):
            requested_images = state["images"]
    print(json.dumps({"source": source, "sidecar": sidecar, "backupSystemId": str(db["system-id"]),
                      "backupPath": paths[0][0], "sourceHash": source_hash, **record,
                      "images": {"postgres": image_evidence(server["Image"]), "pgbackrest": image_evidence(backup["Image"])},
                      "targetImages": {role: image_evidence(ref) for role, ref in requested_images.items()}}))
except Exception as error:
    print("PostgreSQL evidence unavailable: " + str(error), file=sys.stderr)
    sys.exit(1)
