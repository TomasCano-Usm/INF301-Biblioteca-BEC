#!/usr/bin/env python3
"""Genera identidades/CA y secretos NUEVOS. Nunca sobreescribe un runtime existente."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SERVICES = ["secrets", "auth", "clients", "inventory", "orders", "payments", "notifications", "graphql", "mail", "gateway"]
EDGES = {
    "gateway": ["auth", "clients", "inventory", "orders", "payments", "graphql", "mail"],
    "auth": ["clients", "notifications"],
    "clients": ["auth"],
    "orders": ["clients", "inventory", "payments", "notifications"],
    "graphql": ["clients", "orders", "inventory", "payments"],
    "notifications": ["clients", "mail"],
}

def b64(size=32):
    return base64.b64encode(secrets.token_bytes(size)).decode()

def password_hash(value):
    salt = secrets.token_bytes(16)
    hashed = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, 600000)
    return "pbkdf2-sha256$600000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(hashed).decode()

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    path.chmod(0o600)

def setup(runtime, base=9100, gateway=8443, docker=False, profile="h2", test=False, lab=True):
    runtime = Path(runtime).resolve()
    if runtime.exists():
        raise SystemExit(f"No se reemplaza {runtime}. Use otro directorio o conserve los datos existentes.")
    os.umask(0o077)
    runtime.mkdir(parents=True, mode=0o700)
    authority = runtime / "setup"
    authority.mkdir()
    run("openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(authority / "ca.key"))
    run("openssl", "req", "-x509", "-new", "-sha256", "-days", "365", "-key", str(authority / "ca.key"),
        "-out", str(authority / "ca.crt"), "-subj", "/CN=BEC CA LOCAL DE LABORATORIO")
    ports = {name: base + i for i, name in enumerate(SERVICES[:-1])}
    ports["gateway"] = gateway
    targets = {name: f"https://{name if docker else 'localhost'}:{port}" for name, port in ports.items()}
    edges = {(source, target): b64() for source, dests in EDGES.items() for target in dests}
    tokens = {name: secrets.token_urlsafe(32) for name in SERVICES if name != "secrets"}
    master = secrets.token_bytes(32)
    root = Path(__file__).resolve().parents[1]
    credentials = {role: {"email": role + "@bec.example.invalid", "password": secrets.token_urlsafe(15) + "aA1!"}
                   for role in ["admin", "bibliotecario", "lector", "lector2"]}
    credentials["fingerprint"] = base64.b64encode(b"MUESTRA-DETERMINISTA-LECTOR-16-0001").decode()
    credentials["fingerprint2"] = base64.b64encode(b"MUESTRA-DETERMINISTA-LECTOR-16-0002").decode()
    write(runtime / "demo-credentials.json", credentials)
    db_credentials = {}
    for name in SERVICES + (["oracle"] if profile == "oracle" else []):
        folder = runtime / name
        folder.mkdir()
        tls_password = secrets.token_urlsafe(24)
        cert = authority / (name + ".crt")
        key = authority / (name + ".key")
        csr = authority / (name + ".csr")
        ext = authority / (name + ".ext")
        ext.write_text(f"subjectAltName=DNS:{name},DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\n")
        run("openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key))
        run("openssl", "req", "-new", "-key", str(key), "-out", str(csr), "-subj", "/CN=" + name)
        run("openssl", "x509", "-req", "-in", str(csr), "-CA", str(authority / "ca.crt"), "-CAkey", str(authority / "ca.key"),
            "-CAcreateserial", "-out", str(cert), "-days", "365", "-sha256", "-extfile", str(ext))
        run("openssl", "pkcs12", "-export", "-inkey", str(key), "-in", str(cert), "-certfile", str(authority / "ca.crt"),
            "-out", str(folder / "server.p12"), "-passout", "pass:" + tls_password, "-name", name)
        run("keytool", "-importcert", "-noprompt", "-alias", "bec-ca", "-file", str(authority / "ca.crt"),
            "-keystore", str(folder / "trust.p12"), "-storetype", "PKCS12", "-storepass", tls_password)
        if name == "oracle":
            (folder / "tls.env").write_text("BEC_TLS_PASSWORD='" + tls_password + "'\n")
            continue
        bootstrap = {"port": ports[name], "bind": "0.0.0.0" if docker else "127.0.0.1",
                     "tlsPassword": tls_password, "targets": targets, "labMode": lab,
                     "webRoot": "/app/web" if docker else str(root / "web"), "publicUrl": f"https://localhost:{gateway}",
                     "apiRate": 6000, "loginRate": 10000 if test else 10, "secretCacheSeconds": 0 if test else 5,
                     "manualJobs": test}
        if name == "secrets":
            bootstrap["masterKey"] = base64.b64encode(master).decode()
            bootstrap["acl"] = {n: hashlib.sha256(t.encode()).hexdigest() for n, t in tokens.items()}
            (folder / "master").mkdir()
        else:
            bootstrap["bootstrapToken"] = tokens[name]
            db_password = secrets.token_urlsafe(24)
            db_user = "BEC_" + name.upper()
            db_credentials[name] = {"user": db_user, "password": db_password}
            (folder / "data").mkdir()
            data_dir = "/runtime/" + name + "/data" if docker else str(folder)
            secret = {
                "inbound": {s: k for (s, t), k in edges.items() if t == name},
                "outbound": {t: k for (s, t), k in edges.items() if s == name},
                "dataKey": b64(), "biometricKey": b64(),
                "dbUrl": 'jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=oracle)(PORT=2484))(CONNECT_DATA=(SERVICE_NAME=FREEPDB1))(SECURITY=(SSL_SERVER_DN_MATCH=YES)(SSL_SERVER_CERT_DN="CN=oracle")))' if profile == "oracle" else
                         "jdbc:h2:file:" + data_dir + "/db;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
                "dbUser": db_user, "dbPassword": db_password,
            }
            if name == "auth":
                secret["initialAccounts"] = [
                    {"id": "staff-admin", "role": "ADMIN", "email": credentials["admin"]["email"], "passwordHash": password_hash(credentials["admin"]["password"])},
                    {"id": "staff-librarian", "role": "LIBRARIAN", "email": credentials["bibliotecario"]["email"], "passwordHash": password_hash(credentials["bibliotecario"]["password"])},
                ]
            iv = secrets.token_bytes(12)
            ciphertext = AESGCM(master).encrypt(iv, json.dumps(secret).encode(), None)
            (runtime / "secrets" / "master" / (name + ".enc")).write_text(base64.b64encode(iv).decode() + "." + base64.b64encode(ciphertext).decode())
        write(folder / "bootstrap.json", bootstrap)
    if profile == "oracle":
        # Entrada efímera para init, solo el proceso de Oracle; no se distribuye.
        statements = ["SET ECHO OFF", "WHENEVER SQLERROR EXIT SQL.SQLCODE", "ALTER SESSION SET CONTAINER = FREEPDB1;"]
        for name, db in db_credentials.items():
            if name in ("gateway", "graphql"):
                continue
            statements += [
                f'CREATE USER {db["user"]} IDENTIFIED BY "{db["password"]}" DEFAULT TABLESPACE USERS QUOTA 100M ON USERS;',
                f'GRANT CREATE SESSION, CREATE TABLE, CREATE PROCEDURE TO {db["user"]};',
            ]
        for name, db in db_credentials.items():
            if name in ("gateway", "graphql"):
                continue
            # CONNECT evita crear accidentalmente procedimientos con propietario SYS.
            statements += [f'CONNECT {db["user"]}/"{db["password"]}"@//localhost:1521/FREEPDB1', "@/opt/bec/schema.sql"]
            if name in ("inventory", "orders"):
                statements.append(f"@/opt/bec/{name}.sql")
        statements += ["CONNECT / AS SYSDBA"]
        (authority / "01-bec.sql").write_text("\n".join(statements) + "\n")
    write(runtime / "profile.json", {"profile": profile, "docker": docker, "ports": ports, "createdFor": "Caso16", "testSettings": test})
    print(f"Runtime {profile} generado: {runtime}. Secretos fuera del código; NO compartir este directorio.")
    return runtime

if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runtime", default=".runtime")
    p.add_argument("--base-port", type=int, default=9100)
    p.add_argument("--gateway-port", type=int, default=8443)
    p.add_argument("--docker", action="store_true")
    p.add_argument("--profile", choices=["h2", "oracle"], default="h2")
    p.add_argument("--test", action="store_true", help="Solo pruebas: caché de secretos 0 y límite login elevado.")
    p.add_argument("--no-lab", action="store_true", help="Oculta la bandeja de correo; NO habilita un proveedor real.")
    a = p.parse_args()
    setup(a.runtime, a.base_port, a.gateway_port, a.docker, a.profile, a.test, not a.no_lab)
