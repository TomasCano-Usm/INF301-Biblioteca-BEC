#!/usr/bin/env python3
"""Prueba React contra el gateway REAL. Solo crea/archiva sus documentos ficticios."""
import argparse
import hashlib
import json
from pathlib import Path
import ssl
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class Backend:
    def __init__(self, runtime):
        self.context = ssl.create_default_context(cafile=str(runtime / "setup/ca.crt"))
        profile = json.loads((runtime / "profile.json").read_text())
        self.base = "https://localhost:" + str(profile["ports"]["gateway"])
        self.credentials = json.loads((runtime / "demo-credentials.json").read_text())
        self.private = []

    def call(self, method, path, body=None, token=None, key=None, expected=(200, 201)):
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = "Bearer " + token
        if key:
            headers["Idempotency-Key"] = key
        request = urllib.request.Request(self.base + "/api" + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, context=self.context, timeout=15) as response:
                status, result = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status, result = error.code, json.load(error)
        assert status in expected, f"API {method} {path}: HTTP {status}"
        return result

    def login(self, role):
        token = self.call("POST", "/auth/login", self.credentials[role])["token"]
        self.private.append(token)
        return token


def source_hash():
    files = sorted((ROOT / "src").rglob("*"))
    files += sorted((ROOT / "config").rglob("*"))
    files += [ROOT / name for name in ("vite.config.ts", "package.json", "pnpm-lock.yaml")]
    digest = hashlib.sha256()
    for file in files:
        if file.is_file():
            digest.update(file.relative_to(ROOT).as_posix().encode() + b"\0" + file.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", type=Path, default=ROOT.parent / "entrega_caso16")
    parser.add_argument("--backend-artifact", type=Path,
        help="JAR realmente desplegado; para Docker, copiar /app/bec.jar a una ruta local.")
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--url", default="https://localhost:5173")
    parser.add_argument("--output", type=Path, default=ROOT / "evidencias/frontend-redesign")
    args = parser.parse_args()
    runtime = (args.runtime or args.backend / ".runtime").resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    backend = Backend(runtime)
    bib = backend.login("bibliotecario")
    reader = backend.login("lector2")
    suffix = uuid.uuid4().hex[:7]
    prefix = "React Ensayo " + suffix
    first_title, second_title = prefix + " audio", prefix + " video"
    checks, requests, errors, created = [], [], [], []
    held_request = None
    result = {"recorded_at_utc": datetime.now(timezone.utc).isoformat(),
        "profile": json.loads((runtime / "profile.json").read_text())["profile"],
        "backend_artifact_sha256": hashlib.sha256((args.backend_artifact or args.backend / "target/bec.jar").read_bytes()).hexdigest(),
        "frontend_source_sha256": source_hash(), "browser": "Chromium / Playwright",
        "tls": "API y proxy verifican la CA; navegador automatizado acepta la CA local de laboratorio.",
        "checks": checks, "http": requests, "javascript_errors": errors}

    def passed(name):
        checks.append({"name": name, "passed": True})
        print("OK", name)

    def failure(error):
        message = str(error)
        for secret in backend.private + [value["password"] for value in backend.credentials.values() if isinstance(value, dict)]:
            message = message.replace(secret, "[REDACTADO]")
        return {"type": type(error).__name__, "message": message}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("response", lambda response: requests.append({
            "method": response.request.method, "path": response.url.split("/api", 1)[1].split("?", 1)[0],
            "status": response.status}) if "/api/" in response.url else None)

        def login():
            page.get_by_label("Correo electrónico", exact=True).wait_for()
            page.get_by_label("Correo electrónico", exact=True).fill(backend.credentials["bibliotecario"]["email"])
            page.get_by_label("Contraseña", exact=True).fill(backend.credentials["bibliotecario"]["password"])
            page.locator("form.login-card").get_by_role("button", name="Ingresar", exact=True).click()
            expect(page.get_by_role("heading", name="Menú principal", exact=True)).to_be_visible()
            page.get_by_role("button", name="Colección", exact=True).click()
            expect(page.get_by_role("heading", name="Colecciones", exact=True)).to_be_visible()

        def accept(title):
            dialog = page.get_by_role("dialog", name=title, exact=True)
            expect(dialog).to_be_visible()
            page.screenshot(path=str(output / ("react_mensaje_" + title.lower().replace(" ", "_") + ".png")))
            dialog.get_by_role("button", name="Aceptar", exact=True).click()

        def edit(document_id):
            page.evaluate("(id) => { window.location.hash = 'edit/' + id; }", document_id)
            expect(page.locator("form.document-form")).to_be_visible()
            expect(page.get_by_label("Título", exact=True)).not_to_have_value("")

        def form_values(title, stock):
            form = page.locator("form.document-form")
            form.get_by_label("Título", exact=True).fill(title)
            form.get_by_label("Autor", exact=True).fill("Lucía Autora React")
            form.get_by_label("Subcategoría", exact=True).fill("Ensayo Sonoro")
            form.get_by_label("Descripción", exact=True).fill("Descripción persistente para pruebas.")
            form.get_by_label("Stock", exact=True).fill(str(stock))
            form.get_by_label("Editorial", exact=True).fill("Editorial Prueba React")
            form.get_by_label("Ubicación / estante", exact=True).fill("REACT-01")
            return form

        def filters(**values):
            form = page.get_by_role("form", name="Filtros de la colección")
            for key, value in values.items():
                locator = form.get_by_label(key, exact=True)
                if locator.evaluate("(node) => node.tagName") == "SELECT":
                    locator.select_option(value)
                else:
                    locator.fill(value)
            with page.expect_response(lambda response: "/api/catalog?" in response.url and response.request.method == "GET"):
                form.get_by_role("button", name="Aplicar filtros", exact=True).click()
            expect(page.locator(".results-count")).not_to_have_text("Cargando colección…")

        def count(value):
            expect(page.locator(".results-count")).to_have_text(f"{value} documentos encontrados")

        try:
            page.goto(args.url)
            expect(page.locator(".results-count")).not_to_have_text("Cargando catálogo…")
            expect(page.locator(".book-card").first).to_be_visible()
            passed("R01 Catálogo anónimo con documentos reales del API")
            page.evaluate("window.location.hash = 'collections'")
            page.screenshot(path=str(output / "R02-protected-route.png"), full_page=True)
            expect(page.get_by_role("heading", name="Ingresar a la biblioteca")).to_be_visible()
            passed("R02 Gestión protegida sin sesión")
            page.get_by_label("Correo electrónico", exact=True).fill("inexistente@bec.example.invalid")
            page.get_by_label("Contraseña", exact=True).fill("ClaveFicticiaIncorrecta123")
            page.locator("form.login-card").get_by_role("button", name="Ingresar", exact=True).click()
            expect(page.get_by_role("alert")).to_be_visible()
            passed("R03 Credenciales incorrectas rechazadas por el backend")
            login()
            passed("R04 Autenticación real de bibliotecario")
            page.get_by_role("button", name="Añadir documento", exact=True).last.click()
            form = form_values(first_title, 2)
            expect(form.get_by_label("Tipo de multimedia", exact=True)).to_have_count(0)
            form.get_by_label("Tipo de documento", exact=True).select_option("MULTIMEDIA")
            expect(form.get_by_label("Tipo de multimedia", exact=True)).to_be_visible()
            expect(form.get_by_label("Formato", exact=True)).to_be_visible()
            before = len([row for row in requests if row["method"] == "POST" and row["path"] == "/documents"])
            form.get_by_role("button", name="Añadir documento", exact=True).click()
            assert form.evaluate("(node) => node.checkValidity()") is False
            assert before == len([row for row in requests if row["method"] == "POST" and row["path"] == "/documents"])
            passed("R05 Multimedia muestra audio/video y formato y exige ambos")
            form.get_by_label("Tipo de documento", exact=True).select_option("BOOK")
            expect(form.get_by_label("Formato", exact=True)).to_have_count(0)
            with page.expect_response(lambda response: response.url.endswith("/api/documents") and response.request.method == "POST") as pending:
                form.get_by_role("button", name="Añadir documento", exact=True).click()
            assert pending.value.status == 201
            first = pending.value.json()
            created.append(first["id"])
            assert first["type"] == "BOOK" and first["medium"] == "PAPER" and first["total"] == 2
            accept("Documento añadido")
            passed("R06 Alta de libro persistente y ventana de éxito tras HTTP 201")
            edit(first["id"])
            expect(page.get_by_label("Título", exact=True)).to_have_value(first_title)
            expect(page.get_by_label("Stock", exact=True)).to_have_value("2")
            passed("R07 Editar carga el documento seleccionado y su stock real")
            form = page.locator("form.document-form")
            form.get_by_label("Tipo de documento", exact=True).select_option("MULTIMEDIA")
            form.get_by_label("Tipo de multimedia", exact=True).select_option("AUDIO")
            form.get_by_label("Formato", exact=True).select_option("DIGITAL")
            assert form.get_by_label("Descripción", exact=True).input_value() == "Descripción persistente para pruebas."
            with page.expect_response(lambda response: "/api/documents/" in response.url and response.request.method == "PUT") as pending:
                form.get_by_role("button", name="Confirmar edición", exact=True).click()
            assert pending.value.status == 200
            accept("Documento actualizado")
            saved = backend.call("GET", "/catalog/" + first["id"])
            assert saved["type"] == "AUDIO" and saved["medium"] == "DIGITAL" and saved["description"] == "Descripción persistente para pruebas.", repr(saved.get("description"))
            passed("R08 Libro a audio digital, descripción guardada y confirmación real")
            page.reload()
            login()
            edit(first["id"])
            expect(page.get_by_label("Tipo de documento", exact=True)).to_have_value("MULTIMEDIA")
            expect(page.get_by_label("Tipo de multimedia", exact=True)).to_have_value("AUDIO")
            expect(page.get_by_label("Formato", exact=True)).to_have_value("DIGITAL")
            expect(page.get_by_label("Descripción", exact=True)).to_have_value("Descripción persistente para pruebas.")
            passed("R09 Recarga conserva datos; la sesión no se guarda en el navegador")
            page.screenshot(path=str(output / "react_multimedia.png"), full_page=True)
            page.evaluate("window.location.hash = 'add'")
            form = form_values(second_title, 0)
            form.get_by_label("Tipo de documento", exact=True).select_option("MULTIMEDIA")
            form.get_by_label("Tipo de multimedia", exact=True).select_option("VIDEO")
            form.get_by_label("Formato", exact=True).select_option("DVD")
            with page.expect_response(lambda response: response.url.endswith("/api/documents") and response.request.method == "POST") as pending:
                form.get_by_role("button", name="Añadir documento", exact=True).click()
            assert pending.value.status == 201
            second = pending.value.json()
            created.append(second["id"])
            accept("Documento añadido")
            passed("R10 Alta de video DVD sin stock y confirmación")
            filters(**{"Título": prefix, "Autor": "lucia", "Tipo de documento": "MULTIMEDIA", "Editorial": "prueba react", "Disponibilidad": "AVAILABLE", "Subcategoría": "sonoro"})
            count(1)
            expect(page.locator("tbody")).to_contain_text(first_title)
            passed("R11 Los seis filtros combinados usan disponibilidad real")
            filters(**{"Disponibilidad": "UNAVAILABLE"})
            count(1)
            expect(page.locator("tbody")).to_contain_text(second_title)
            passed("R12 Filtro sin disponibilidad distingue documento sin ejemplares")
            filters(**{"Disponibilidad": "", "Tipo de documento": "VIDEO"})
            count(1)
            passed("R13 Filtro por tipo de documento")
            for key in ("Título", "Autor", "Editorial", "Subcategoría"):
                previous = {"Título": prefix, "Autor": "lucia", "Editorial": "prueba react", "Subcategoría": "sonoro"}[key]
                filters(**{key: "sin-coincidencia-" + suffix})
                count(0)
                filters(**{key: previous})
                count(1)
                passed("R14 Filtro individual: " + key)
            filters(**{"Tipo de documento": "MULTIMEDIA"})
            count(2)
            page.screenshot(path=str(output / "react_filtros.png"), full_page=True)
            edit(second["id"])
            page.get_by_role("button", name="Eliminar de colección", exact=True).click()
            dialog = page.get_by_role("dialog", name="Confirmar eliminación", exact=True)
            expect(dialog).to_contain_text(second_title)
            deletes = len([row for row in requests if row["method"] == "DELETE"])
            dialog.get_by_role("button", name="Cancelar", exact=True).click()
            assert deletes == len([row for row in requests if row["method"] == "DELETE"])
            backend.call("GET", "/catalog/" + second["id"])
            passed("R15 Cancelar eliminación no envía DELETE ni cambia datos")
            page.get_by_role("button", name="Eliminar de colección", exact=True).click()
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog")).to_have_count(0)
            assert deletes == len([row for row in requests if row["method"] == "DELETE"])
            passed("R16 Escape cancela la confirmación")
            page.get_by_role("button", name="Eliminar de colección", exact=True).click()
            page.screenshot(path=str(output / "react_confirmar_eliminacion.png"), full_page=True)
            with page.expect_response(lambda response: response.request.method == "DELETE" and "/api/documents/" in response.url) as pending:
                page.get_by_role("dialog").get_by_role("button", name="Confirmar eliminación", exact=True).click()
            assert pending.value.status == 200
            accept("Documento eliminado")
            backend.call("GET", "/catalog/" + second["id"], expected=(404,))
            passed("R17 Confirmar elimina de colección y muestra éxito después del backend")
            held = backend.call("POST", "/requests", {"copyIds": [first["copies"][0]["id"]], "mode": "ROOM"}, reader, uuid.uuid4().hex)
            held_request = held["id"]
            edit(first["id"])
            page.get_by_label("Stock", exact=True).fill("0")
            page.get_by_label("Título", exact=True).fill("NO DEBE GUARDARSE " + suffix)
            page.locator("form.document-form").get_by_role("button", name="Confirmar edición", exact=True).click()
            expect(page.get_by_role("alert")).to_contain_text("stock")
            expect(page.get_by_role("dialog")).to_have_count(0)
            assert backend.call("GET", "/catalog/" + first["id"])["title"] == first_title
            passed("R18 Edición rechazada hace rollback y nunca muestra éxito")
            page.get_by_role("button", name="Eliminar de colección", exact=True).click()
            page.get_by_role("dialog").get_by_role("button", name="Confirmar eliminación", exact=True).click()
            expect(page.get_by_role("dialog").get_by_role("alert")).to_be_visible()
            expect(page.get_by_role("dialog", name="Documento eliminado", exact=True)).to_have_count(0)
            passed("R19 Eliminación en uso rechazada sin confirmación falsa")
            page.get_by_role("dialog").get_by_role("button", name="Cancelar", exact=True).click()
            backend.call("DELETE", "/requests/" + held_request, token=reader)
            held_request = None
            page.evaluate("window.location.hash = 'collections'")
            expect(page.get_by_role("heading", name="Colecciones", exact=True)).to_be_visible()
            edit(first["id"])
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(output / "react_multimedia_movil.png"), full_page=True)
            page.evaluate("window.location.hash = 'collections'")
            expect(page.get_by_role("heading", name="Colecciones", exact=True)).to_be_visible()
            expect(page.locator(".results-count")).not_to_have_text("Cargando colección…")
            expect(page.locator("tbody tr").first).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(output / "react_colecciones_movil.png"), full_page=True)
            page.evaluate("window.location.hash = 'home'")
            for width, height, name in [
                (390, 844, "390x844"),
                (768, 1024, "768x1024"),
                (1024, 768, "1024x768"),
                (1440, 900, "1440x900"),
            ]:
                page.set_viewport_size({"width": width, "height": height})
                expect(page.locator(".book-card").first).to_be_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Desbordamiento en {name}"
                page.screenshot(path=str(output / f"responsive_{name}.png"), full_page=True)
            passed("R20 Formulario y filtros a 390 px sin desbordamiento de página")
            assert page.evaluate("localStorage.length === 0 && sessionStorage.length === 0")
            passed("R21 Ningún token persistido en localStorage o sessionStorage")
            assert not errors
            passed("R22 Sin errores JavaScript")
            result["passed"] = True
        except Exception as error:
            result["passed"] = False
            result["failure"] = failure(error)
        finally:
            cleanup = ([("/requests/" + held_request, reader)] if held_request else [])
            cleanup += [("/documents/" + document_id, bib) for document_id in created]
            for path, token in cleanup:
                try:
                    backend.call("DELETE", path, token=token)
                except Exception as error:
                    result["passed"] = False
                    result.setdefault("cleanup_errors", []).append(failure(error))
            browser.close()
            (output / "react.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["passed"]:
        raise SystemExit("Falló la interfaz; consulta evidencias/react.json (sin credenciales).")
    print(f"{len(checks)} comprobaciones de React correctas; datos ficticios de prueba archivados.")


if __name__ == "__main__":
    main()
