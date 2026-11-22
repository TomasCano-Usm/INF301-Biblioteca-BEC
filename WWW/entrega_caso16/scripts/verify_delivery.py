#!/usr/bin/env python3
"""Verifica coherencia documental; no reemplaza las pruebas HTTP ni valida Oracle."""
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlparse

from docx import Document
from jsonschema import Draft4Validator, FormatChecker
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]


def load(relative):
    return json.loads((ROOT / relative).read_text())


def nullable(schema):
    """OpenAPI 3.0 nullable se traduce solo para comprobar ejemplos con JSON Schema."""
    if isinstance(schema, list):
        return [nullable(value) for value in schema]
    if not isinstance(schema, dict):
        return schema
    result = {key: nullable(value) for key, value in schema.items() if key != "nullable"}
    if schema.get("nullable") and isinstance(result.get("type"), str):
        result["type"] = [result["type"], "null"]
    return result


def main():
    checks = []

    def check(name, condition, detail):
        if not condition:
            raise AssertionError(name + ": " + detail)
        checks.append({"check": name, "result": "PASS", "detail": detail})

    jar = hashlib.sha256((ROOT / "target/bec.jar").read_bytes()).hexdigest()
    backend, ui, load_test = [load("evidencias/" + name + ".json")
                              for name in ("pruebas_backend", "interfaz", "carga")]
    check("versión de evidencia", all(e["artifact_sha256"] == jar for e in (backend, ui, load_test)),
          "Backend, interfaz y carga corresponden al JAR distribuido.")
    check("resultado backend", backend["passed"] == backend["total"] == 23 and
          not sum(backend[key] for key in ("failures", "errors", "skipped")),
          "23 pruebas pasaron; Oracle no se ejecutó.")
    check("resultado interfaz", len(ui["checks"]) == 13 and not ui["javascript_errors"] and
          all(c["result"] == "PASS" for c in ui["checks"]), "13 comprobaciones y cero errores JavaScript.")
    check("resultado carga", len(load_test["results"]) == 6 and
          all(r["requests"] > 0 and r["errors"] == 0 for r in load_test["results"]),
          "Seis escenarios H2/HTTPS con solicitudes reales; no comparación gRPC.")
    junit = ET.parse(ROOT / "evidencias/junit-limpio.xml").getroot()
    check("JUnit saneado", len(list(junit.iter("testcase"))) == 23 and
          not list(junit.iter("system-out")) and not list(junit.iter("properties")),
          "Se conservaron casos/resultados, no stdout ni propiedades del entorno privado.")

    contracts = load("docs/contratos.json")
    spec = load("docs/openapi.json")
    operations = contracts["operations"]
    check("catálogo público", len(operations) == 35 and
          len({o["id"] for o in operations}) == 35, "35 identificadores de operaciones únicos.")
    document = nullable(spec)
    for name, schema in document["components"]["schemas"].items():
        Draft4Validator.check_schema(schema)
    def references(value):
        if isinstance(value, dict):
            if "$ref" in value:
                assert value["$ref"].startswith("#/"), "Solo referencias locales en esta entrega."
                target = document
                for segment in value["$ref"][2:].split("/"):
                    target = target[segment.replace("~1", "/").replace("~0", "~")]
            for child in value.values():
                references(child)
        elif isinstance(value, list):
            for child in value:
                references(child)
    references(document)
    for operation in operations:
        actual = spec["paths"][operation["external"]][operation["method"].lower()]
        assert actual["operationId"] == operation["id"]
        if operation["bodySchema"]:
            schema = document["components"]["schemas"][operation["bodySchema"]]
            Draft4Validator(schema, format_checker=FormatChecker()).validate(
                operation["requestExample"])
        schema = document["components"]["schemas"][operation["id"] + "Response"]
        Draft4Validator(schema, format_checker=FormatChecker()).validate(
            operation["responseExample"])
    check("esquemas y ejemplos", True,
          "Ejemplos de entrada/salida de 35 contratos conformes a sus esquemas; no certifica toda la especificación OpenAPI.")

    with (ROOT / "docs/matriz_acceso.csv").open(encoding="utf-8-sig") as source:
        access = list(csv.DictReader(source))
    check("matriz de acceso", len(access) == len({o["external"] for o in operations}) * 4 == 116,
          "29 rutas × GET/POST/PUT/DELETE; distingue permiso, denegación y verbo no aplicable.")
    with (ROOT / "docs/trazabilidad.csv").open(encoding="utf-8-sig") as source:
        trace = list(csv.DictReader(source))
    check("trazabilidad RF/CU", len(trace) == 28 and
          all(any(row["Requisito/CU"] == f"RF{i:02}/CU{i:02}" for row in trace) for i in range(1, 17)),
          "16 RF/CU y 12 condiciones adicionales; pendientes preservados.")
    for row in trace:
        for evidence in row["Evidencia (relativa a evidencias/)"].split(";"):
            assert (ROOT / "evidencias" / evidence.strip()).exists(), evidence
    check("referencias de evidencia", True, "Todas las rutas de evidencia de la matriz existen.")

    pages = {}
    for name in ("informe", "contratos", "contratos_privados", "seguridad_operacion",
                 "validacion_oracle", "manual_usuario", "diagramas"):
        reader = PdfReader(ROOT / "docs" / (name + ".pdf"))
        assert len(reader.pages) > 0
        pages[name] = len(reader.pages)
    report = "\n".join(page.extract_text() or "" for page in PdfReader(ROOT / "docs/informe.pdf").pages)
    check("diez módulos PDF", all(re.search(r"Módulo\s+" + str(i) + r"\s", report) for i in range(1, 11)),
          "Los diez módulos aparecen en el PDF; anexos PDF legibles por el parser.")
    text = (ROOT / "docs/informe.md").read_text()
    check("sin marcadores pendientes de generación", not re.search(r"\{\{[A-Z_]+\}\}", text),
          "Solo permanecen los campos de portada expresamente destinados a los integrantes.")
    for name in ("informe", "contratos", "manual_usuario"):
        doc = Document(ROOT / "docs" / (name + ".docx"))
        assert len(doc.paragraphs) > 0
    check("Word editable", True, "Informe, contratos y manual abren como DOCX.")
    for index in range(1, 7):
        sources = list((ROOT / "docs/diagramas").glob(f"{index:02}_*.puml"))
        assert len(sources) == 1
        assert all(sources[0].with_suffix(ext).is_file() for ext in (".png", ".svg"))
    check("diagramas editables", True, "Seis fuentes PlantUML acompañadas de PNG/SVG y PDF A3.")

    for path in [ROOT / "README.md", *(ROOT / "docs").rglob("*.md")]:
        for destination in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", path.read_text()):
            destination = destination.strip().split('"')[0].strip()
            parsed = urlparse(destination)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            assert (path.parent / unquote(parsed.path)).exists(), str(path) + " -> " + destination
    check("enlaces locales", True, "Enlaces Markdown e imágenes resuelven a archivos distribuidos.")
    check("límites explícitos", backend["oracle_executed"] is False and
          not any(ui[key] for key in ("real_mail_delivery", "physical_biometrics", "physical_rfid")),
          "Oracle pendiente; correo Internet, biometría y RFID físicos no declarados ejecutados.")

    output = {"recorded_at_utc": datetime.now(timezone.utc).isoformat(),
              "artifact_sha256": jar, "scope": "Coherencia estática de la entrega; no sustituye pruebas funcionales.",
              "checks": checks, "pdf_pages": pages, "oracle_executed": False}
    (ROOT / "evidencias/verificacion_entrega.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"PASS: {len(checks)} verificaciones de entrega; {sum(pages.values())} páginas PDF en siete documentos.")


if __name__ == "__main__":
    main()
