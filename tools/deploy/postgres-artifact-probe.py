"""Read-only, sanitized PostgreSQL deployment evidence; invoked over SSH stdin."""
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import sys

# The service keys removed before the compose is hashed (v2, #3419) — the same list
# as RUNTIME_ONLY_SERVICE_KEYS in tools/deploy/postgres-guard.mjs, which says why.
RUNTIME_ONLY = ("logging", "restart", "healthcheck", "depends_on", "ports")


def canonical_compose(value):
    # postgres-guard.mjs canonicalJson: sorted keys, no whitespace, integers only.
    def check(v):
        if isinstance(v, float):
            raise RuntimeError("compose carries a non-integer number")
        for item in v.values() if isinstance(v, dict) else v if isinstance(v, list) else []:
            check(item)
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def source_hash_v2(root, paths):
    """postgresSourceHash (v2) of the tree at `root`; a missing file hashes as null."""
    def digest(p):
        path = root / p
        if not path.is_file():
            return None
        data = path.read_bytes()
        if p == "compose.yml":
            compose = json.loads(data)
            for service in (compose.get("services") or {}).values():
                if isinstance(service, dict):
                    for key in RUNTIME_ONLY:
                        service.pop(key, None)
            data = canonical_compose(compose).encode()
        return hashlib.sha256(data).hexdigest()
    hashes = [[p, digest(p)] for p in paths]
    return hashlib.sha256(json.dumps(hashes, separators=(",", ":")).encode()).hexdigest()


def run(*args, stdin=None):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=45)
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
    root = pathlib.Path.home() / "ds-platform/infra/deploy/compose/data-prod"
    topology = []
    for item in container["Mounts"]:
        source = item.get("Name") if item["Type"] == "volume" else item.get("Source")
        if item["Type"] == "bind":
            # Match actual Docker bind sources to the committed contract, not
            # merely the container destination whose bytes could be redirected.
            source = pathlib.Path(source).relative_to(root).as_posix()
        topology.append({"type": item["Type"], "source": source,
                         "target": item["Destination"], "rw": item["RW"]})
    version = run("sudo", "docker", "exec", name, "cat", pgdata + "/PG_VERSION")
    control = run("sudo", "docker", "exec", "-e", "LC_ALL=C", name, "pg_controldata", "-D", pgdata)
    system_id = re.search(r"^Database system identifier:\s*(\d+)\s*$", control, re.M)[1]
    return container, {"major": int(env["PG_MAJOR"]), "systemId": system_id,
                       "pgdata": pgdata, "pgVersion": version,
                       "running": container["State"]["Running"], "mounts": topology,
                       "mount": {"name": mount["Name"], "target": mount["Destination"], "rw": mount["RW"]}}


def main():
    request = json.loads(base64.b64decode(sys.argv[1]))
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
    expected_settings = {"data_directory": source["pgdata"], "hba_file": source["pgdata"] + "/pg_hba.conf",
                         "ident_file": source["pgdata"] + "/pg_ident.conf", "unix_socket_directories": "/var/run/postgresql",
                         "config_file": "/etc/postgresql/postgresql.conf"}
    names = ",".join("'" + name + "'" for name in expected_settings)
    settings = run("sudo", "docker", "exec", server_name, "psql", "-XAt", "-U", "ds", "-d", "postgres", "-c",
                   "SELECT name,setting FROM pg_settings WHERE name IN (" + names + ")")
    if dict(line.split("|", 1) for line in settings.splitlines()) != expected_settings:
        raise RuntimeError("live effective configuration paths mismatch")
    pending = run("sudo", "docker", "exec", server_name, "psql", "-XAt", "-U", "ds", "-d", "postgres", "-c",
                  "SELECT name,setting,coalesce(error,'') FROM pg_file_settings WHERE name IN (" + names + ") OR error IS NOT NULL")
    for line in pending.splitlines():
        name, value, error = line.split("|", 2)
        if error or expected_settings.get(name) != value:
            raise RuntimeError("pending PostgreSQL configuration is unsafe or unknown")
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
    state_path = pathlib.Path.home() / "ds-platform-postgres-state.json"
    requested_images = target["images"]
    if not state_path.exists():
        # No record yet (first adoption): the live tree's own v2 hash (#3419).
        source_hash = source_hash_v2(root, request["paths"])
        record = {"hashVersion": 2}
    else:
        state = json.loads(state_path.read_text())
        if (state["schema"] != 1 or state.get("hashVersion", 1) not in (1, 2)
                or not re.fullmatch(r"[a-f0-9]{64}", state["sourceHash"])):
            raise RuntimeError("invalid durable artifact state")
        source_hash = state["sourceHash"]
        # An absent hashVersion is a v1 record (#3419: postgres-guard.mjs migrates it).
        record = {"hashVersion": 2} if state.get("hashVersion") == 2 else {}
        record["recordedSystemId"] = state["systemId"]
        if request.get("preferRecordedImages") and source_hash == request.get("sourceHash"):
            requested_images = state["images"]
    # Let Compose parse its own env-file syntax. This config-only request never
    # starts/pulls scratch; secret values remain inside this process on the host.
    env_config = json.dumps({"services": {"guard": {"image": "scratch", "env_file": ["/etc/ds-platform/data.env"]}}})
    env_values = json.loads(run("sudo", "docker", "compose", "-f", "-", "config", "--format", "json", stdin=env_config))["services"]["guard"].get("environment", {})
    activation = {}
    for role, ref in requested_images.items():
        merged = {**environment(inspect("image", ref)), **env_values, **target["environment"][role]}
        if merged.get("PGBACKREST_PG1_PATH", paths[0][0]) != paths[0][0]:
            raise RuntimeError("pending backup env-file path override")
        activation[role] = (merged["PGDATA"], int(merged["PG_MAJOR"]))
    if activation["postgres"] != activation["pgbackrest"]:
        raise RuntimeError("pending sidecar data environment mismatch")
    print(json.dumps({"source": source, "sidecar": sidecar, "backupSystemId": str(db["system-id"]),
                      "backupPath": paths[0][0], "sourceHash": source_hash, **record,
                      "activationPgdata": activation["postgres"][0], "activationMajor": activation["postgres"][1],
                      "images": {"postgres": image_evidence(server["Image"]), "pgbackrest": image_evidence(backup["Image"])},
                      "targetImages": {role: image_evidence(ref) for role, ref in requested_images.items()}}))


try:
    if __name__ == "__main__":
        main()
except Exception as error:
    print("PostgreSQL evidence unavailable: " + str(error), file=sys.stderr)
    sys.exit(1)
