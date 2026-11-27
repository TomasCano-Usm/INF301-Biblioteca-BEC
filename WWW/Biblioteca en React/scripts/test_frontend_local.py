#!/usr/bin/env python3
"""Ejecuta el E2E completo con un backend H2 descartable y puertos aislados."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request

FRONTEND = Path(__file__).resolve().parents[1]
WORKSPACE = FRONTEND.parent
BACKEND_PATHS = [
    "WWW/entrega_caso16/pom.xml",
    "WWW/entrega_caso16/src",
    "WWW/entrega_caso16/web",
    "WWW/entrega_caso16/scripts/setup.py",
    "WWW/entrega_caso16/scripts/seed.py",
]
SERVICES = ["secrets", "auth", "clients", "inventory", "orders", "payments", "notifications", "graphql", "mail", "gateway"]


def free_port_block(count: int) -> int:
    for base in range(24000, 56000 - count, count + 3):
        sockets = []
        try:
            for port in range(base, base + count):
                sock = socket.socket()
                sock.bind(("127.0.0.1", port))
                sockets.append(sock)
            return base
        except OSError:
            pass
        finally:
            for sock in sockets:
                sock.close()
    raise RuntimeError("No se encontró un bloque de puertos local libre para el entorno de prueba.")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_health(runtime: Path, name: str, timeout: float = 25) -> None:
    profile = json.loads((runtime / "profile.json").read_text())
    context = ssl.create_default_context(cafile=str(runtime / "setup/ca.crt"))
    url = f"https://localhost:{profile['ports'][name]}/health"
    deadline = time.monotonic() + timeout
    last_error = "sin respuesta"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, context=context, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as error:  # Servicio todavía iniciando.
            last_error = str(error)
            time.sleep(.15)
    raise RuntimeError(f"{name} no respondió a /health: {last_error}")


def start_services(runtime: Path, jar: Path, backend_source: Path, temp: Path):
    logs = temp / "service-logs"
    logs.mkdir()
    processes: list[subprocess.Popen] = []
    for name in SERVICES:
        log = (logs / f"{name}.log").open("w", encoding="utf-8")
        process = subprocess.Popen(
            ["java", "-Xms24m", "-Xmx160m", "-XX:ActiveProcessorCount=2", "-jar", str(jar), name, str(runtime)],
            cwd=backend_source,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        log.close()
        processes.append(process)
        try:
            wait_health(runtime, name)
        except Exception:
            stop_services(processes)
            log_path = logs / f"{name}.log"
            detail = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
            raise RuntimeError(f"El servicio local {name} no inició. {detail[-4000:]}")
    return processes


def stop_services(processes):
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    for process in reversed(processes):
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def wait_frontend(process: subprocess.Popen, url: str, log_path: Path, timeout: float = 40):
    context = ssl._create_unverified_context()  # Solo readiness probe contra el certificado efímero de test.
    deadline = time.monotonic() + timeout
    last_error = "sin respuesta"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        try:
            with urllib.request.urlopen(url, context=context, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as error:
            last_error = str(error)
            time.sleep(.2)
    detail = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
    raise RuntimeError(f"Vite de prueba no inició ({last_error}). {detail[-5000:]}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=FRONTEND / "evidencias/frontend-redesign")
    parser.add_argument("--skip-build", action="store_true", help="Reutiliza el artefacto backend ubicado en --jar.")
    parser.add_argument("--jar", type=Path, help="JAR de test ya compilado; si se omite, se compila en un directorio temporal.")
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="bec-react-e2e-") as temp_name:
        temp = Path(temp_name)
        runtime = temp / "runtime"
        backend_source = temp / "backend-source"
        frontend_source = temp / "frontend-source"
        local_m2 = Path(os.environ.get("BEC_TEST_MAVEN_REPO", str(Path(tempfile.gettempdir()) / "bec-frontend-test-m2"))).resolve()
        backend_source.mkdir()
        shutil.copytree(
            FRONTEND,
            frontend_source,
            ignore=shutil.ignore_patterns("node_modules", "dist", ".pnpm-store", ".env.local", ".runtime*", ".tmp-*", "evidencias", "evidencias-oracle"),
        )
        archive = subprocess.check_output(["git", "archive", "--format=tar", "HEAD", *BACKEND_PATHS], cwd=WORKSPACE.parent)
        subprocess.run(["tar", "-xf", "-", "--strip-components=2", "-C", str(backend_source)], input=archive, check=True)
        if args.jar:
            jar = args.jar.resolve()
        else:
            if args.skip_build:
                raise SystemExit("--skip-build requiere --jar; no se buscará un artefacto dentro de entrega_caso16/.")
            command = [
                "mvn", "-B", "-ntp", "-f", str(backend_source / "pom.xml"),
                f"-Dmaven.repo.local={local_m2}", "-Dmaven.test.skip=true", "package",
            ]
            print("Compilando un snapshot temporal de los servicios para el test; no se escribe en entrega_caso16/…", flush=True)
            subprocess.run(command, cwd=backend_source, check=True)
            jar = backend_source / "target/bec.jar"
        if not jar.is_file():
            raise SystemExit(f"No existe el JAR de prueba indicado: {jar}")

        base_port = free_port_block(10)
        gateway_port = base_port + 9
        setup = [
            sys.executable, str(backend_source / "scripts/setup.py"), "--profile", "h2",
            "--runtime", str(runtime), "--base-port", str(base_port), "--gateway-port", str(gateway_port),
        ]
        print("Creando runtime H2 temporal con puertos exclusivos…", flush=True)
        subprocess.run(setup, cwd=backend_source, check=True)
        gateway_bootstrap = runtime / "gateway/bootstrap.json"
        gateway_settings = json.loads(gateway_bootstrap.read_text())
        gateway_settings["loginRate"] = 10000
        gateway_bootstrap.write_text(json.dumps(gateway_settings, indent=2) + "\n")
        gateway_bootstrap.chmod(0o600)

        processes = []
        vite = None
        try:
            processes = start_services(runtime, jar, backend_source, temp)
            print("Cargando datos ficticios en la base H2 temporal…", flush=True)
            subprocess.run([sys.executable, str(backend_source / "scripts/seed.py"), "--runtime", str(runtime), "--titles", "12"], cwd=backend_source, check=True)

            frontend_port = free_port()
            url = f"https://localhost:{frontend_port}"
            env = os.environ.copy()
            env.update({
                "BEC_RUNTIME": str(runtime),
                "BEC_BACKEND_URL": f"https://localhost:{gateway_port}",
                "PORT": str(frontend_port),
                "FIGMA_DEV_SERVER_HOST": "127.0.0.1",
                "npm_config_cache": str(temp / "npm-cache"),
            })
            print("Instalando dependencias Linux en la copia desechable del frontend…", flush=True)
            subprocess.run([
                "npm", "exec", "--yes", "--package=pnpm@12.9.1", "--", "pnpm", "install", "--frozen-lockfile",
            ], cwd=frontend_source, env=env, check=True)
            vite_log_path = temp / "vite.log"
            vite_log = vite_log_path.open("w", encoding="utf-8")
            vite = subprocess.Popen(
                ["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(frontend_port), "--strictPort"],
                cwd=frontend_source,
                env=env,
                stdout=vite_log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            vite_log.close()
            wait_frontend(vite, url, vite_log_path)

            print(f"Ejecutando UI real contra Gateway temporal en {url}…", flush=True)
            subprocess.run([
                sys.executable, str(FRONTEND / "scripts/test_ui.py"),
                "--runtime", str(runtime), "--backend-artifact", str(jar), "--url", url, "--output", str(args.output),
            ], cwd=FRONTEND, check=True)
            subprocess.run([
                sys.executable, str(FRONTEND / "scripts/test_frontend_workflows.py"),
                "--runtime", str(runtime), "--url", url, "--output", str(args.output),
            ], cwd=FRONTEND, check=True)
            print(f"PASS: pruebas completas. Los datos H2 y credenciales se borrarán al cerrar el runtime temporal. Evidencias: {args.output}", flush=True)
        finally:
            if vite and vite.poll() is None:
                vite.terminate()
                try:
                    vite.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    vite.kill(); vite.wait(timeout=5)
            stop_services(processes)


if __name__ == "__main__":
    main()
