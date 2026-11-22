#!/usr/bin/env python3
"""Flujo E2E de UI real con Chromium. Solo datos ficticios y runtime de laboratorio."""
import argparse
from datetime import date, timedelta, datetime, timezone
import hashlib
import json
from pathlib import Path
import secrets
import time
from playwright.sync_api import sync_playwright
from seed import Api

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--runtime", default=".runtime")
p.add_argument("--output", default="evidencias")
a = p.parse_args()
api = Api(a.runtime)
assert (api.runtime / "seed-state.json").exists(), "Ejecute seed.py en un runtime ficticio primero"
suffix = secrets.token_hex(4).upper()
title, code1, code2 = "Cuentos E2E " + suffix, "UI-" + suffix + "-1", "UI-" + suffix + "-2"
bib_token = api.login("bibliotecario")
doc = api.call("POST", "/documents", {"title": title, "author": "Autora Ficticia", "type": "BOOK", "medium": "PAPER",
    "publisher": "Editorial Demo", "edition": "1", "year": 2026, "shelf": "E2E-1", "category": "Prueba de interfaz",
    "homeDays": 3, "roomHours": 2}, bib_token)
for code in (code1, code2):
    api.call("POST", "/documents/" + doc["id"] + "/copies", {"code": code, "shelf": "E2E-1"}, bib_token)
output = Path(a.output);output.mkdir(parents=True, exist_ok=True)
checks, failures = [], []
def check(name, condition=True):
    assert condition, name
    checks.append({"id": name, "result": "PASS"})

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    # Solo el navegador de pruebas ignora la CA local. HttpClient y Api sí la verifican.
    context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 1040})
    page = context.new_page()
    page.on("pageerror", lambda error: failures.append(str(error)))
    def shot(name, mask=None):
        page.screenshot(path=str(output / name), full_page=True, mask=mask or [])
    def login(role):
        if page.locator("#session-button").inner_text() == "Cerrar sesión":
            page.locator("#session-button").click()
            page.locator("#session-button").filter(has_text="Ingresar").wait_for()
        page.locator("#session-button").click()
        page.locator('#login [name="email"]').fill(api.credentials[role]["email"])
        page.locator('#login [name="password"]').fill(api.credentials[role]["password"])
        page.locator("#login button").click()
        page.locator("#session-button").filter(has_text="Cerrar sesión").wait_for()
    def search_copy(title, code):
        page.locator('#search [name="q"]').fill(title)
        with page.expect_response(lambda res: "/api/catalog?q=" in res.url) as response:
            page.locator("#search button").click()
        for _ in range(10):
            first = response.value.json()["items"][0]["id"]
            page.wait_for_function("(id) => state.catalog[0]?.id === id", arg=first)
            if page.locator(f'[data-copy="{code}"]').count():
                return
            with page.expect_response(lambda res: "/api/catalog?q=" in res.url) as response:
                page.locator('[data-action="catalog-page"]').filter(has_text="Siguiente").click()
        raise AssertionError("No se encontró el ejemplar ficticio en la paginación")
    page.goto(api.base.removesuffix("/api"), wait_until="networkidle")
    page.get_by_role("heading", name="Colección disponible").wait_for()
    check("UI01_catalogo_anonimo")
    shot("P01_catalogo_desktop.png")
    page.locator("#session-button").click()
    page.locator("#login").wait_for();shot("P02_acceso.png")
    page.locator('#login [name="email"]').fill(api.credentials["lector"]["email"])
    page.locator('#login [name="password"]').fill(api.credentials["lector"]["password"])
    page.locator("#login button").click()
    page.get_by_role("heading", name="Mis préstamos").wait_for()
    check("UI02_login_y_resumen_GraphQL")
    page.locator('[data-page="catalog"]').click()
    # Buscar evita depender del orden UUID del catálogo.
    search_copy(title, code1)
    page.locator(f'[data-copy="{code1}"]').check()
    with page.expect_response(lambda res: res.url.endswith("/api/requests") and res.request.method == "POST") as response:
        page.locator('[data-action="request"]').click()
    request_id = response.value.json()["id"]
    page.get_by_role("heading", name="Mis solicitudes").wait_for()
    check("UI03_solicitud_de_ejemplar", response.value.status == 201)
    login("bibliotecario")
    page.get_by_role("heading", name="Cola de solicitudes").wait_for()
    shot("P06_preparacion.png")
    page.locator(f'[data-action="prepare"][data-id="{request_id}"]').click()
    page.locator('#issue [name="rut"]').fill("12345678-5")
    page.locator('#issue [name="fingerprint"]').fill(api.credentials["fingerprint"])
    with page.expect_response(lambda res: res.url.endswith("/issue")) as response:
        page.locator("#issue button").click()
    loan_id = response.value.json()["id"]
    page.get_by_role("heading", name="Préstamo a domicilio").wait_for()
    check("UI04_verificacion_y_entrega", response.value.status == 200)
    shot("P09_comprobante.png")
    page.pdf(path=str(output / "comprobante_ejemplo.pdf"), format="A4", print_background=True)
    login("lector")
    page.get_by_role("heading", name="Mis préstamos").wait_for()
    page.get_by_text("EXEMPT", exact=False).first.wait_for()
    check("UI05_cuenta_con_inventario_y_pago_exento")
    shot("P03_cuenta_GraphQL.png")
    page.locator('[data-action="test-payment"]').click()
    page.locator("#notice").filter(has_text="NO_MONETARY_PAYMENTS").wait_for()
    check("UI06_cobro_manipulado_rechazado")
    page.locator('[data-page="catalog"]').click()
    search_copy(title, code2)
    form = page.locator(".reserve").filter(has=page.locator(f'option:has-text("{code2}")')).first
    form.locator('[name="copyId"]').select_option(code2)
    form.locator('[name="date"]').fill(str(date.today() + timedelta(days=4)))
    form.locator("button").click()
    page.locator("#notice").filter(has_text="Reserva registrada").wait_for()
    page.locator('[data-page="account"]').click()
    page.locator('[data-action="cancel-reservation"]').first.click()
    page.locator("#notice").filter(has_text="Reserva cancelada").wait_for()
    check("UI07_reserva_y_cancelacion")
    login("bibliotecario")
    page.locator('[data-page="inventory"]').click()
    page.get_by_role("heading", name="Administración de la colección", exact=False).wait_for()
    shot("P04_coleccion.png")
    page.locator('[data-page="returns"]').click()
    page.locator('#exit [name="copyId"]').fill(code1);page.locator("#exit button").click()
    page.locator("#exit-result").filter(has_text="Salida permitida").wait_for()
    check("UI08_antirrobo_software_HOME")
    page.locator('#return [name="copyId"]').fill(code1);page.locator("#return button").click()
    page.locator("#return-result").filter(has_text="Disponible desde").wait_for()
    check("UI09_devolucion_con_buffer")
    shot("P07_devolucion.png")
    login("admin")
    page.get_by_role("heading", name="Fichas de lectores", exact=False).wait_for()
    shot("P05_fichas.png")
    page.locator('[data-page="mailbox"]').click()
    page.get_by_role("heading", name="Proveedor de correo de prueba", exact=False).wait_for()
    check("UI10_bandeja_proveedor_prueba")
    shot("P10_correo_prueba.png", [page.locator(".mail")])
    page.locator('[data-page="overdue"]').click()
    page.get_by_role("heading", name="Administración de morosidad", exact=False).wait_for()
    shot("P08_morosidad.png")
    check("UI11_consulta_administrativa")
    mobile = browser.new_context(ignore_https_errors=True, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m = mobile.new_page();m.goto(api.base.removesuffix("/api"), wait_until="networkidle")
    m.get_by_role("heading", name="Colección disponible").wait_for()
    check("UI12_responsive_390px", m.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    m.screenshot(path=str(output / "P01_catalogo_movil.png"), full_page=True)
    check("UI13_sin_errores_JavaScript", not failures)
    browser.close()
result = {"recorded_at_utc": datetime.now(timezone.utc).isoformat(),
          "artifact_sha256": hashlib.sha256((Path(__file__).resolve().parents[1] / "target/bec.jar").read_bytes()).hexdigest(),
          "engine": "Chromium / Playwright", "profile": api.profile["profile"], "browser_tls": "ignora solo CA local de laboratorio",
          "checks": checks, "javascript_errors": failures, "real_mail_delivery": False, "physical_biometrics": False, "physical_rfid": False}
(output / "interfaz.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
print(json.dumps({"passed": len(checks), "javascript_errors": len(failures)}))
