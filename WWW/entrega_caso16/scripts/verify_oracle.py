#!/usr/bin/env python3
"""Verifica el Oracle desplegado sin modificar BD/contenedores; genera evidencia saneada."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import ssl
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def command(*args, input=None):
    return subprocess.run(args, input=input, capture_output=True, text=True, check=True)


def frontend_hash(root):
    digest = hashlib.sha256()
    files = sorted((root / "src").rglob("*"))
    files += sorted((root / "config").rglob("*"))
    files += [root / name for name in ("vite.config.ts", "package.json", "pnpm-lock.yaml")]
    for file in files:
        if file.is_file():
            digest.update(file.relative_to(root).as_posix().encode() + b"\0" + file.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".runtime-docker-oracle")
    parser.add_argument("--frontend", type=Path, default=ROOT.parent / "Biblioteca en React")
    parser.add_argument("--output", type=Path, default=ROOT / "evidencias/oracle/arranque.json")
    args = parser.parse_args()
    runtime, frontend = args.runtime.resolve(), args.frontend.resolve()
    profile = json.loads((runtime / "profile.json").read_text())
    assert profile["profile"] == "oracle", "No se acepta evidencia de un perfil H2."
    context = ssl.create_default_context(cafile=str(runtime / "setup/ca.crt"))
    url = f"https://localhost:{profile['ports']['gateway']}/api/catalog?size=1"
    with urllib.request.urlopen(url, context=context, timeout=15) as response:
        catalog_status, catalog = response.status, json.load(response)
    assert catalog_status == 200
    ids = command("docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=bec-caso16").stdout.split()
    assert len(ids) == 11, "Se esperan diez servicios y Oracle."
    services = []
    for item in json.loads(command("docker", "inspect", *ids).stdout):
        state = item["State"]
        service = item["Config"]["Labels"]["com.docker.compose.service"]
        assert state["Status"] == "running" and not state["OOMKilled"], service
        assert service != "oracle" or state.get("Health", {}).get("Status") == "healthy"
        published = item["HostConfig"]["PortBindings"] or {}
        assert service == "gateway" or not published, "Solo el gateway puede publicar puertos."
        services.append({"service": service, "image_id": item["Image"],
            "status": state["Status"], "health": state.get("Health", {}).get("Status"),
            "memory_limit_bytes": item["HostConfig"]["Memory"], "published_ports": published})
    jar_hash = command("docker", "exec", "bec-caso16-inventory-1", "sha256sum", "/app/bec.jar").stdout.split()[0]
    ui = json.loads((frontend / "evidencias-oracle/react.json").read_text())
    assert ui["profile"] == "oracle" and ui["passed"] and len(ui["checks"]) == 25 and not ui["javascript_errors"]
    assert ui["backend_artifact_sha256"] == jar_hash, "El JAR probado debe ser el desplegado."
    assert ui["frontend_source_sha256"] == frontend_hash(frontend), "Las fuentes React cambiaron después de la prueba."
    sql = """SET HEADING OFF FEEDBACK OFF PAGESIZE 0 VERIFY OFF ECHO OFF LINESIZE 240
WHENEVER OSERROR EXIT FAILURE
WHENEVER SQLERROR EXIT FAILURE
ALTER SESSION SET CONTAINER=FREEPDB1;
SELECT banner FROM v$version WHERE banner LIKE 'Oracle%';
SELECT 'BEC_SCHEMAS='||COUNT(*) FROM dba_users WHERE username IN ('BEC_AUTH','BEC_CLIENTS','BEC_INVENTORY','BEC_ORDERS','BEC_PAYMENTS','BEC_NOTIFICATIONS','BEC_MAIL');
SELECT owner||'.'||object_name||'='||status FROM dba_objects WHERE owner IN ('BEC_INVENTORY','BEC_ORDERS') AND object_type='PROCEDURE';
SELECT 'BEC_COMPILATION_ERRORS='||COUNT(*) FROM dba_errors WHERE owner IN ('BEC_AUTH','BEC_CLIENTS','BEC_INVENTORY','BEC_ORDERS','BEC_PAYMENTS','BEC_NOTIFICATIONS','BEC_MAIL');
SELECT 'ACTIVE_DOCUMENTS='||COUNT(*) FROM BEC_INVENTORY.bec_records WHERE kind='DOCUMENT' AND state='ACTIVE';
SELECT 'ACTIVE_COPIES='||COUNT(*) FROM BEC_INVENTORY.bec_records WHERE kind='COPY' AND state<>'RETIRED';
EXIT SUCCESS
"""
    result = command("docker", "exec", "-i", "bec-caso16-oracle-1", "sqlplus", "-s", "/", "as", "sysdba", input=sql)
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    for expected in ("BEC_SCHEMAS=7", "BEC_INVENTORY.BEC_TICK_INVENTORY=VALID",
            "BEC_ORDERS.BEC_TICK_ORDERS=VALID", "BEC_COMPILATION_ERRORS=0",
            f"ACTIVE_DOCUMENTS={catalog['total']}"):
        assert expected in lines, expected
    validation = command("docker", "exec", "bec-caso16-oracle-1", "sqlplus", "-s", "/", "as", "sysdba", "@/opt/bec/validate.sql")
    assert "BEC_SCHEMA_VALIDATION=OK" in validation.stdout
    java = command("docker", "exec", "bec-caso16-oracle-1", "java", "-version")
    guards = command("python3", str(ROOT / "scripts/test_oracle_bootstrap.py"))
    count = re.search(r"Ran (\d+) tests", guards.stdout + guards.stderr)
    assert count and int(count[1]) == 8
    seed = json.loads((runtime / "seed-state.json").read_text())
    sources = ["deploy/oracle/Dockerfile", "deploy/oracle/tls.sh", "deploy/oracle/provision.sh",
        "deploy/oracle/healthcheck.sh", "compose.oracle.yaml", "db/oracle/inventory.sql",
        "db/oracle/orders.sql", "db/oracle/validate.sql", "scripts/test_oracle_bootstrap.py",
        "scripts/verify_oracle.py"]
    record = {"recorded_at_utc": datetime.now(timezone.utc).isoformat(), "profile": "oracle",
        "backend_artifact_sha256": jar_hash, "java": (java.stdout + java.stderr).strip().splitlines(),
        "sql_validation": lines, "schema_validation": "BEC_SCHEMA_VALIDATION=OK",
        "catalog": {"status": catalog_status, "active_titles": catalog["total"]},
        "seed": {"fictional": seed["fictional"], "titles": seed["titles"],
            "copies": seed["copies"], "activated_readers": len(seed["readers"])},
        "containers": sorted(services, key=lambda item: item["service"]),
        "react": {"checks": 25, "passed": True, "javascript_errors": 0,
            "frontend_source_sha256": ui["frontend_source_sha256"],
            "evidence": (frontend / "evidencias-oracle/react.json").relative_to(frontend).as_posix(),
            "frontend_directory": frontend.name},
        "bootstrap_guard_tests": {"passed": 8, "scope": "SQLPlus simulado, no reglas de negocio Oracle."},
        "source_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources},
        "limits": ["No certifica ORA01–ORA12 completos.", "TCPS positivo; CA/DN negativos pendientes.",
            "Sin carga/restauración Oracle, correo Internet ni dispositivos físicos.",
            "Los JUnit y las mediciones H2 anteriores conservan su perfil."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(f"PASS: Oracle, siete esquemas, dos SP VALID, 25 comprobaciones React y ocho guardas. {args.output}")


if __name__ == "__main__":
    main()
