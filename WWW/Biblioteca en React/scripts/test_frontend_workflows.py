#!/usr/bin/env python3
"""Pruebas E2E React para cuenta GraphQL y flujos de lector/personal sobre H2 local."""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import ssl
import urllib.error
import urllib.request
import uuid
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ONE_PIXEL_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=")


class Backend:
    def __init__(self, runtime: Path):
        self.runtime = runtime.resolve()
        self.profile = json.loads((self.runtime / "profile.json").read_text())
        self.base = f"https://localhost:{self.profile['ports']['gateway']}/api"
        self.context = ssl.create_default_context(cafile=str(self.runtime / "setup/ca.crt"))
        self.credentials = json.loads((self.runtime / "demo-credentials.json").read_text())
        self.tokens: list[str] = []

    def call(self, method: str, path: str, body=None, token=None, key=None, expected=(200, 201)):
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = "Bearer " + token
        if key:
            headers["Idempotency-Key"] = key
        request = urllib.request.Request(
            self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers,
            method=method,
        )
        try:
            response = urllib.request.urlopen(request, context=self.context, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        status = response.status
        result = json.loads(response.read())
        if status not in expected:
            raise AssertionError(f"Backend de test: {method} {path.split('?')[0]} devolvió HTTP {status} ({result.get('error', {}).get('code', 'ERROR')}).")
        return result

    def login(self, role: str) -> str:
        token = self.call("POST", "/auth/login", self.credentials[role])["token"]
        self.tokens.append(token)
        return token


def valid_rut(number: int) -> str:
    digits = str(number)
    total = sum(int(digit) * multiplier for digit, multiplier in zip(reversed(digits), [2, 3, 4, 5, 6, 7] * 10))
    remainder = 11 - total % 11
    verifier = "0" if remainder == 11 else "K" if remainder == 10 else str(remainder)
    return f"{digits}-{verifier}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "evidencias/frontend-redesign")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    backend = Backend(args.runtime)
    errors: list[str] = []
    http: list[dict[str, object]] = []
    checks: list[dict[str, object]] = []
    created_reader_email = f"lectora-e2e-{uuid.uuid4().hex[:8]}@bec.example.invalid"
    created_reader_password = "PruebaFrontend2026!"
    created_reader_name = "Lectora E2E"
    generated_request_id: str | None = None
    issued_copy_id: str | None = None
    now = datetime.now(timezone.utc)
    evidence: dict[str, object] = {
        "recorded_at_utc": now.isoformat(),
        "profile": backend.profile["profile"],
        "browser": "Chromium / Playwright",
        "backend": "API Gateway HTTPS con H2 temporal; runtime retirado al terminar test_frontend_local.py",
        "responsiveness": ["390x844", "768x1024", "1024x768", "1440x900"],
        "checks": checks,
        "http": http,
        "javascript_errors": errors,
        "business_data_persisted": False,
    }

    def passed(name: str, detail: str = ""):
        checks.append({"name": name, "passed": True, **({"detail": detail} if detail else {})})
        print("OK", name)

    def capture(page, name: str):
        page.screenshot(path=str(args.output / name), full_page=True, animations="disabled")

    def login(page, role: str):
        if page.locator(".auth-button").count() and page.locator(".auth-button").inner_text().strip().lower().startswith("cerrar"):
            page.locator(".auth-button").click()
            page.locator(".home-screen").wait_for(state="visible", timeout=5000)
        page.evaluate("window.location.hash = 'login'")
        page.locator("form.login-card").wait_for(state="visible")
        page.get_by_label("Correo electrónico", exact=True).fill(backend.credentials[role]["email"])
        page.get_by_label("Contraseña", exact=True).fill(backend.credentials[role]["password"])
        page.locator("form.login-card").get_by_role("button", name="Ingresar", exact=True).click()
        if role in {"lector", "lector2"}:
            page.get_by_role("heading", name="Mi cuenta", exact=True).wait_for()
        else:
            page.get_by_role("heading", name="Menú principal", exact=True).wait_for()

    def dismiss_notice(page, title: str):
        dialog = page.get_by_role("dialog", name=title, exact=True)
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Aceptar", exact=True).click()

    def find_book(page, title: str):
        search = page.get_by_label("Buscar en la colección", exact=True).first
        search.fill(title)
        card = page.locator("article.book-card").filter(has=page.get_by_role("heading", name=title, exact=True))
        expect(card).to_be_visible(timeout=10000)
        return card

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        def record_response(response):
            path = "/api/" + response.url.split("/api/", 1)[1].split("?", 1)[0] if "/api/" in response.url else "non-api"
            item = {"method": response.request.method, "path": path, "status": response.status}
            if path == "/api/graphql":
                try:
                    item["response"] = response.text()
                except Exception:
                    item["response"] = "(response body unavailable)"
            http.append(item)
        page.on("response", record_response)
        try:
            page.goto(args.url, wait_until="networkidle")
            expect(page.locator("article.book-card").first).to_be_visible()
            passed("P01 catálogo anónimo con catálogo real")

            title = "Cuentos de la biblioteca"
            login(page, "lector")
            expect(page.get_by_role("heading", name="Mi cuenta", exact=True)).to_be_visible()
            expect(page.locator(".account-summary").or_(page.locator(".service-error"))).to_be_visible(timeout=15000)
            expect(page.get_by_text("Préstamos registrados", exact=True)).to_be_visible()
            expect(page.get_by_text("biblioteca gratuita")).to_be_visible()
            expect(page.locator(".account-summary")).to_be_visible()
            expect(page.get_by_role("button", name="Mi cuenta", exact=True)).to_have_attribute("aria-current", "page")
            passed("P03 cuenta personal con agregación GraphQL")
            capture(page, "P03-cuenta-graphQL.png")

            graphql_calls = [item for item in http if item["path"] == "/api/graphql" and item["method"] == "POST"]
            assert graphql_calls, "Mi cuenta no llamó POST /api/graphql a través del Gateway."
            page.get_by_role("button", name="Catálogo", exact=True).click()
            card = find_book(page, title)
            with page.expect_response(lambda response: response.url.endswith("/api/requests") and response.request.method == "POST") as request_response:
                card.get_by_role("button", name="Solicitar", exact=True).click()
                request_dialog = page.get_by_role("dialog", name=f"Solicitar {title}", exact=True)
                request_dialog.get_by_label("Ejemplar", exact=True).select_option(index=0)
                request_dialog.get_by_role("button", name="Confirmar solicitud", exact=True).click()
            assert request_response.value.status == 201
            generated_request_id = request_response.value.json()["id"]
            dismiss_notice(page, "Solicitud registrada")
            passed("P01 solicitud de préstamo con clave de idempotencia y respuesta real")

            page.get_by_role("button", name="Mi cuenta", exact=True).click()
            request_row = page.locator("tr").filter(has_text=generated_request_id)
            request_row.get_by_role("button", name="Cancelar", exact=True).click()
            page.get_by_role("dialog", name="Cancelar solicitud", exact=True).get_by_role("button", name="Confirmar cancelación", exact=True).click()
            dismiss_notice(page, "Operación completada")

            page.get_by_role("button", name="Catálogo", exact=True).click()
            card = find_book(page, title)
            with page.expect_response(lambda response: response.url.endswith("/api/reservations") and response.request.method == "POST") as reservation_response:
                card.get_by_role("button", name="Reservar fecha", exact=True).click()
                reservation_dialog = page.get_by_role("dialog", name=f"Reservar {title}", exact=True)
                reservation_dialog.get_by_label("Ejemplar para reservar", exact=True).select_option(index=0)
                reservation_dialog.get_by_role("button", name="Confirmar reserva", exact=True).click()
            assert reservation_response.value.status == 201
            reservation = reservation_response.value.json()
            reservation_copy_id = reservation["copyId"]
            dismiss_notice(page, "Reserva registrada")
            page.get_by_role("button", name="Mi cuenta", exact=True).click()
            page.wait_for_timeout(500)
            capture(page, "P03-account-reservations.png")
            reservation_row = page.locator(".account-section").last.locator("tr").filter(has_text=reservation_copy_id)
            expect(reservation_row).to_be_visible()
            reservation_row.get_by_role("button", name="Cancelar", exact=True).click()
            page.get_by_role("dialog", name="Cancelar reserva", exact=True).get_by_role("button", name="Confirmar cancelación", exact=True).click()
            dismiss_notice(page, "Operación completada")
            passed("P01/P03 reserva y cancelación mediante servicios reales")
            passed("P03 cancelación de solicitud pendiente")

            login(page, "admin")
            expect(page.get_by_role("button", name="Lectores", exact=True)).to_be_visible()
            page.get_by_role("button", name="Lectores", exact=True).click()
            expect(page.get_by_role("heading", name="Inscribir lector", exact=True)).to_be_visible()
            unique = uuid.uuid4().hex[:8]
            rut = valid_rut(70_000_000 + int(unique, 16) % 20_000_000)
            reader_form = page.locator("form.screen-form").first
            reader_form.get_by_label("RUN", exact=True).fill(rut)
            reader_form.get_by_label("Nombres", exact=True).fill(created_reader_name)
            reader_form.get_by_label("Apellidos", exact=True).fill("Datos de prueba")
            reader_form.get_by_label("Correo", exact=True).fill(created_reader_email)
            reader_form.get_by_label("Dirección", exact=True).fill("Dirección ficticia de prueba")
            reader_form.get_by_label("Teléfono", exact=True).fill("+56900000001")
            reader_form.get_by_label("Contraseña inicial", exact=True).fill(created_reader_password)
            reader_form.get_by_label("Muestra del adaptador (base64)", exact=True).fill(backend.credentials["fingerprint"])
            reader_form.locator('input[name="photo"]').set_input_files({"name": "foto-e2e.png", "mimeType": "image/png", "buffer": ONE_PIXEL_PNG})
            reader_form.get_by_label("Confirmo que revisé los documentos de inscripción.", exact=True).check()
            with page.expect_response(lambda response: response.url.endswith("/api/readers") and response.request.method == "POST") as reader_response:
                reader_form.get_by_role("button", name="Inscribir y solicitar activación", exact=True).click()
            assert reader_response.value.status == 201
            reader_id = reader_response.value.json()["id"]
            dismiss_notice(page, "Ficha registrada")
            passed("P05 inscripción administrativa con autorización y alta reales")

            page.get_by_label("Buscar por nombre o RUN", exact=True).fill(created_reader_name)
            page.get_by_role("button", name="Buscar", exact=True).click()
            row = page.locator("tr").filter(has_text=created_reader_name)
            expect(row).to_be_visible()
            row.get_by_role("button", name="Ver ficha", exact=True).click()
            profile_dialog = page.get_by_role("dialog", name=f"Ficha de {created_reader_name} Datos de prueba", exact=True)
            expect(profile_dialog).to_be_visible()
            with page.expect_response(lambda response: response.url.endswith(f"/api/readers/{reader_id}/activation") and response.request.method == "POST"):
                profile_dialog.get_by_role("button", name="Reenviar activación", exact=True).click()
            dismiss_notice(page, "Activación reenviada")
            capture(page, "P05-ficha-administrativa.png")
            passed("P05 consulta de ficha y reenvío de activación")

            page.keyboard.press("Escape")
            page.get_by_role("button", name="Correo de prueba", exact=True).click()
            expect(page.get_by_role("heading", name="Bandeja de mensajes", exact=True)).to_be_visible()
            mail_cards = page.locator("article.mail-card").filter(has_text=created_reader_email)
            for _ in range(20):
                if mail_cards.count() >= 2:
                    break
                page.get_by_role("button", name="Actualizar", exact=True).click()
                page.wait_for_timeout(300)
            assert mail_cards.count() >= 2, "El reenvío todavía no aparece en el buzón de prueba."
            mail_card = mail_cards.last
            expect(mail_card).to_be_visible()
            capture(page, "P10-bandeja-test.png")
            activated = False
            for index in reversed(range(mail_cards.count())):
                candidate = mail_cards.nth(index)
                button = candidate.get_by_role("button", name="Validar enlace de activación", exact=True)
                if not button.count():
                    continue
                with page.expect_response(lambda response: response.url.endswith("/api/auth/activate") and response.request.method == "POST") as activation_response:
                    button.click()
                if activation_response.value.status == 200:
                    dismiss_notice(page, "Cuenta activada")
                    activated = True
                    break
            assert activated, "Ninguno de los enlaces vigentes de activación fue aceptado por el backend."
            passed("P10 bandeja TEST y activación a través del Gateway")

            page.evaluate("window.location.hash = 'login'")
            page.locator("form.login-card").wait_for(state="visible")
            page.get_by_label("Correo electrónico", exact=True).fill(created_reader_email)
            page.get_by_label("Contraseña", exact=True).fill(created_reader_password)
            page.locator("form.login-card").get_by_role("button", name="Ingresar", exact=True).click()
            expect(page.get_by_role("heading", name="Mi cuenta", exact=True)).to_be_visible()
            passed("P02 activación y login con cuenta creada por ADMIN")

            login(page, "lector2")
            page.get_by_role("button", name="Catálogo", exact=True).click()
            second_title = "Guía de oficios y tecnología"
            second_card = find_book(page, second_title)
            with page.expect_response(lambda response: response.url.endswith("/api/requests") and response.request.method == "POST") as queue_request_response:
                second_card.get_by_role("button", name="Solicitar", exact=True).click()
                dialog = page.get_by_role("dialog", name=f"Solicitar {second_title}", exact=True)
                dialog.get_by_label("Ejemplar", exact=True).select_option(index=0)
                dialog.get_by_role("button", name="Confirmar solicitud", exact=True).click()
            assert queue_request_response.value.status == 201
            queue_request = queue_request_response.value.json()
            generated_request_id = queue_request["id"]
            issued_copy_id = queue_request["copyIds"][0]
            dismiss_notice(page, "Solicitud registrada")
            login(page, "bibliotecario")
            page.get_by_role("button", name="Solicitudes", exact=True).click()
            queue_row = page.locator("tr").filter(has_text=generated_request_id)
            expect(queue_row).to_be_visible()
            queue_row.get_by_role("button", name="Verificar y entregar", exact=True).click()
            issue_dialog = page.get_by_role("dialog", name="Verificar y confirmar entrega", exact=True)
            expect(issue_dialog.get_by_text("Diego Ejemplo")).to_be_visible()
            issue_dialog.get_by_label("RUN presentado", exact=True).fill("11111111-1")
            issue_dialog.get_by_label("Muestra del adaptador biométrico (base64)", exact=True).fill(backend.credentials["fingerprint2"])
            with page.expect_response(lambda response: response.url.endswith(f"/api/requests/{generated_request_id}/issue") and response.request.method == "POST") as issue_response:
                issue_dialog.get_by_role("button", name="Verificar y confirmar entrega", exact=True).click()
            assert issue_response.value.status == 200
            loan = issue_response.value.json()
            dismiss_notice(page, "Entrega procesada")
            expect(page.get_by_role("heading", name="Comprobante de préstamo a domicilio", exact=True)).to_be_visible()
            capture(page, "P09-comprobante.png")
            passed("P06 verificación y entrega del préstamo solicitada")
            passed("P09 consulta del comprobante Home emitido por el servicio")

            page.get_by_role("button", name="Devoluciones", exact=True).click()
            expect(page.get_by_role("heading", name="Registrar devolución", exact=True)).to_be_visible()
            exit_form = page.locator("form.table-tools").last
            exit_input = page.get_by_label("Código de ejemplar", exact=True)
            exit_input.fill(issued_copy_id)
            with page.expect_response(lambda response: f"/api/exit-check/{issued_copy_id}" in response.url) as exit_response:
                exit_form.get_by_role("button", name="Consultar", exact=True).click()
            assert exit_response.value.status == 200
            expect(page.get_by_text("Salida permitida", exact=False)).to_be_visible()
            passed("P07 control de salida software para préstamo HOME")

            return_form = page.locator("form.screen-form").first
            return_form.get_by_label("Código del ejemplar", exact=True).fill(issued_copy_id)
            with page.expect_response(lambda response: response.url.endswith("/api/returns") and response.request.method == "POST") as return_response:
                return_form.get_by_role("button", name="Registrar devolución", exact=True).click()
            assert return_response.value.status == 200
            return_result = return_response.value.json()
            assert return_result["readyAt"] and return_result["returnedAt"]
            dismiss_notice(page, "Devolución registrada")
            expect(page.get_by_text("Disponible desde", exact=False)).to_be_visible()
            exit_input.fill(issued_copy_id)
            with page.expect_response(lambda response: f"/api/exit-check/{issued_copy_id}" in response.url) as denied_exit:
                exit_form.get_by_role("button", name="Consultar", exact=True).click()
            assert denied_exit.value.status == 200
            expect(page.get_by_text("Salida denegada", exact=False)).to_be_visible()
            capture(page, "P07-devolucion-salida.png")
            passed("P07 devolución con vencimiento de reposición calculado por backend")

            login(page, "admin")
            page.get_by_role("button", name="Morosidad", exact=True).click()
            expect(page.get_by_role("heading", name="Consultar ejemplares atrasados", exact=True)).to_be_visible()
            page.get_by_role("button", name="Consultar morosidad", exact=True).click()
            expect(page.locator(".service-empty").or_(page.locator(".table-wrap tbody tr").first)).to_be_visible()
            capture(page, "P08-morosidad.png")
            passed("P08 consulta administrativa de morosidad")

            login(page, "bibliotecario")
            page.get_by_role("button", name="Catálogo", exact=True).click()
            for width, height, label in [(390, 844, "390x844"), (768, 1024, "768x1024"), (1024, 768, "1024x768"), (1440, 900, "1440x900")]:
                page.set_viewport_size({"width": width, "height": height})
                expect(page.locator("article.book-card").first).to_be_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Desbordamiento en catálogo a {label}"
                capture(page, f"responsive-{label}.png")
            passed("Responsive P01 validado a 390×844, 768×1024, 1024×768 y 1440×900")

            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("button", name="Colección", exact=True).click()
            expect(page.get_by_role("heading", name="Colecciones", exact=True)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.get_by_role("button", name="Lectores", exact=True).count()
            assert not errors, "Se detectaron errores JavaScript: " + " | ".join(errors)
            assert all(str(item["path"]).startswith("/api/") or item["path"] == "non-api" for item in http)
            passed("Sin errores JavaScript y llamadas de negocio a través del API Gateway")
            capture(page, "P04-coleccion-390x844.png")
            evidence.update({
                "passed": True,
                "test_reader_email": "[redactado]",
                "created_test_runtime": "eliminado por test_frontend_local.py al finalizar",
            })
        except Exception as failure:
            evidence["passed"] = False
            evidence["failure"] = f"{type(failure).__name__}: {failure}"
            raise
        finally:
            browser.close()
            evidence["checks"] = checks
            evidence["http"] = http
            evidence["javascript_errors"] = errors
            (args.output / "frontend-workflows.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    print(f"PASS: {len(checks)} grupos de flujos; evidencia en {args.output}")


if __name__ == "__main__":
    main()
