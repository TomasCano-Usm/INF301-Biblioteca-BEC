#!/usr/bin/env python3
"""Carga datos FICTICIOS mediante APIs públicas; no escribe bases ni secretos."""
import argparse
import json
from pathlib import Path
import re
import ssl
import time
import urllib.error
import urllib.request

PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII="

class Api:
    def __init__(self, runtime):
        self.runtime = Path(runtime).resolve()
        self.profile = json.loads((self.runtime / "profile.json").read_text())
        self.base = f"https://localhost:{self.profile['ports']['gateway']}/api"
        self.context = ssl.create_default_context(cafile=str(self.runtime / "setup/ca.crt"))
        self.credentials = json.loads((self.runtime / "demo-credentials.json").read_text())

    def call(self, method, path, body=None, token=None, key=None, expected=(200, 201)):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if key:
            headers["Idempotency-Key"] = key
        request = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
        try:
            response = urllib.request.urlopen(request, context=self.context, timeout=15)
        except urllib.error.HTTPError as e:
            response = e
        data = json.loads(response.read())
        if response.status not in expected:
            # Nunca imprime cuerpo de login, tokens ni datos personales.
            raise RuntimeError(f"{method} {path.split('?')[0]} -> {response.status}: {data.get('error',{}).get('code','ERROR')}")
        return data

    def login(self, role):
        return self.call("POST", "/auth/login", self.credentials[role])["token"]

def seed(runtime, titles=12):
    api = Api(runtime)
    state_file = api.runtime / "seed-state.json"
    if state_file.exists():
        print("La carga ya existe. No se reemplaza.", state_file)
        return json.loads(state_file.read_text())
    admin, bib = api.login("admin"), api.login("bibliotecario")
    readers = []
    for role, rut, sample, names in [("lector", "12345678-5", "fingerprint", "Andrea Ejemplo"), ("lector2", "11111111-1", "fingerprint2", "Diego Ejemplo")]:
        c = api.credentials[role]
        body = dict(rut=rut, names=names, surnames="Datos Ficticios", address="Dirección ficticia 100, Estación Central",
                    email=c["email"], telephone="+56900000000", photo=PHOTO, fingerprint=api.credentials[sample],
                    password=c["password"], documentsChecked=True)
        readers.append(api.call("POST", "/readers", body, admin)["id"])
    activated = set()
    deadline = time.monotonic() + 30
    while len(activated) < 2 and time.monotonic() < deadline:
        for mail in api.call("GET", "/lab/mailbox?size=20", token=admin)["items"]:
            match = re.search(r"\?activation=([A-Za-z0-9_-]{43})", mail["text"])
            if match and match[1] not in activated:
                api.call("POST", "/auth/activate", {"token": match[1]}, expected=(200, 409))
                activated.add(match[1])
        if len(activated) < 2:
            time.sleep(.25)
    if len(activated) < 2:
        raise RuntimeError("La activación no finalizó. Revise los workers y el proveedor de prueba.")
    fixtures = [
        ("Cuentos de la biblioteca", "Literatura", "BOOK", "PAPER", 7),
        ("Guía de oficios y tecnología", "Aprendizaje", "TECHNICAL", "PAPER", 14),
        ("Memorias de Estación Central", "Patrimonio", "VIDEO", "DVD", 3),
        ("Voces del barrio", "Patrimonio", "AUDIO", "CD", 3),
        ("Jardines para nuestra comunidad", "Naturaleza", "BOOK", "PAPER", 7),
        ("Introducción a las ciencias", "Ciencias", "BOOK", "PAPER", 10),
    ]
    documents = []
    for i in range(titles):
        title, category, kind, medium, days = fixtures[i % len(fixtures)]
        body = dict(title=title + (f" · tomo {i // 6 + 1}" if i >= 6 else ""), author="Equipo BEC (autor ficticio)",
                    type=kind, medium=medium, publisher="Edición comunitaria ficticia", edition="1", year=2026,
                    shelf=f"Estante {i + 1:02d}", category=category, homeDays=days, roomHours=3)
        doc = api.call("POST", "/documents", body, bib)
        for n in (1, 2):
            api.call("POST", f"/documents/{doc['id']}/copies", {"code": f"BEC-{i + 1:04d}-{n}", "shelf": body["shelf"]}, bib)
        documents.append(doc["id"])
    result = {"readers": readers, "documents": documents, "titles": titles, "copies": titles * 2, "fictional": True}
    state_file.write_text(json.dumps(result, indent=2))
    state_file.chmod(0o600)
    print(f"Carga ficticia lista: {titles} títulos, {titles*2} ejemplares, 2 lectores activados.")
    return result

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runtime", default=".runtime")
    p.add_argument("--titles", type=int, default=12)
    a = p.parse_args()
    seed(a.runtime, a.titles)
