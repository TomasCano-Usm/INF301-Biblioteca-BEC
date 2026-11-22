#!/usr/bin/env python3
"""Recoge JUnit y verifica la revisión React, sin reemplazar la evidencia histórica."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", type=Path, default=ROOT.parent / "Biblioteca en React")
    args = parser.parse_args()
    frontend = args.frontend.resolve()
    ui = json.loads((frontend / "evidencias/react.json").read_text())
    artifact = sha(ROOT / "target/bec.jar")
    assert ui["backend_artifact_sha256"] == artifact, "La UI probó otro JAR."
    files = sorted((frontend / "src").rglob("*"))
    files += sorted((frontend / "config").rglob("*"))
    files += [frontend / name for name in ("vite.config.ts", "package.json", "pnpm-lock.yaml")]
    digest = hashlib.sha256()
    for file in files:
        if file.is_file():
            digest.update(file.relative_to(frontend).as_posix().encode() + b"\0" + file.read_bytes())
    assert ui["frontend_source_sha256"] == digest.hexdigest(), "Hay cambios React posteriores al E2E."
    assert ui["passed"] and len(ui["checks"]) == 25 and all(c["passed"] for c in ui["checks"])
    assert not ui["javascript_errors"] and ui["profile"] == "h2"
    clean = ET.Element("testsuites")
    suites, tests = [], []
    reports = sorted((ROOT / "target/surefire-reports").glob("TEST-*.xml"))
    for path in reports:
        source = ET.parse(path).getroot()
        attrs = {k: source.attrib[k] for k in ("name", "tests", "failures", "errors", "skipped", "time")}
        suite = ET.SubElement(clean, "testsuite", attrs)
        suites.append(attrs)
        for case in source.findall("testcase"):
            assert not any(case.find(tag) is not None for tag in ("failure", "error", "skipped"))
            attrs = {k: case.attrib[k] for k in ("name", "classname", "time")}
            ET.SubElement(suite, "testcase", attrs)
            tests.append(attrs | {"result": "PASS"})
    assert len(tests) == 26, "Revisar el recuento y la documentación de esta revisión."
    output = ROOT / "evidencias/react"
    output.mkdir(parents=True, exist_ok=True)
    data = {
        "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
        "artifact_sha256": artifact, "profile": "H2 FILE; siete BD; diez listeners HTTPS en JVM de pruebas",
        "java": "21", "total": len(tests), "passed": len(tests),
        "failures": 0, "errors": 0, "skipped": 0, "oracle_executed": False,
        "suites": suites, "tests": tests,
        "source_reports_mtime_utc": {p.name: datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat() for p in reports},
        "react_checks": len(ui["checks"]), "frontend_source_sha256": digest.hexdigest(),
        "react_evidence": "evidencias/react.json", "frontend_directory": frontend.name,
        "historical_evidence": "evidencias/{pruebas_backend,interfaz,carga}.json pertenece al JAR anterior; no prueba esta revisión.",
    }
    (output / "pruebas_backend.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    ET.indent(clean)
    ET.ElementTree(clean).write(output / "junit-limpio.xml", encoding="utf-8", xml_declaration=True)
    print("PASS: 26 pruebas backend y 25 comprobaciones React de las fuentes/JAR actuales. Oracle no ejecutado.")


if __name__ == "__main__":
    main()
