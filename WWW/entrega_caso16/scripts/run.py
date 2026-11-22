#!/usr/bin/env python3
"""Lanza/detiene diez JVM independientes. El perfil local se identifica como H2."""
import argparse
import json
import os
from pathlib import Path
import signal
import ssl
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORDER = ["secrets", "auth", "clients", "inventory", "orders", "payments", "notifications", "graphql", "mail", "gateway"]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["start", "stop", "status"])
    p.add_argument("--runtime", default=str(ROOT / ".runtime"))
    a = p.parse_args()
    runtime = Path(a.runtime).resolve()
    profile = json.loads((runtime / "profile.json").read_text())
    pids_file = runtime / "pids.json"
    if a.action == "start":
        if pids_file.exists():
            raise SystemExit("Existe pids.json. Compruebe status/stop antes de iniciar.")
        context = ssl.create_default_context(cafile=str(runtime / "setup/ca.crt"))
        processes = {}
        try:
            for name in ORDER:
                log = (runtime / name / "service.log").open("a")
                process = subprocess.Popen(["java", "-Xms24m", "-Xmx160m", "-XX:ActiveProcessorCount=2", "-jar", str(ROOT / "target/bec.jar"), name, str(runtime)],
                                           cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
                log.close()
                processes[name] = process.pid
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError(f"{name} terminó; vea su service.log")
                    try:
                        with urllib.request.urlopen(f"https://localhost:{profile['ports'][name]}/health", context=context, timeout=1) as response:
                            if response.status == 200:
                                break
                    except Exception:
                        time.sleep(.1)
                else:
                    raise RuntimeError(f"{name} no respondió a health")
            pids_file.write_text(json.dumps(processes, indent=2))
            pids_file.chmod(0o600)
            print(f"Servicios independientes iniciados ({profile['profile']}). https://localhost:{profile['ports']['gateway']}")
            print("Credenciales ficticias generadas en", runtime / "demo-credentials.json")
        except Exception:
            for pid in processes.values():
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            raise
    elif a.action == "stop":
        if pids_file.exists():
            for pid in reversed(list(json.loads(pids_file.read_text()).values())):
                try:
                    # No mata un PID reciclado que no corresponda al artefacto.
                    cmd = Path(f"/proc/{pid}/cmdline").read_bytes()
                    if b"bec.jar" in cmd and str(runtime).encode() in cmd:
                        os.kill(pid, signal.SIGTERM)
                except (ProcessLookupError, FileNotFoundError):
                    pass
            pids_file.unlink()
        print("Se solicitó el cierre. Los datos y secretos se conservan.")
    else:
        for name, pid in (json.loads(pids_file.read_text()) if pids_file.exists() else {}).items():
            print(name, pid, "ACTIVO" if Path(f"/proc/{pid}").exists() else "DETENIDO")

if __name__ == "__main__":
    main()
