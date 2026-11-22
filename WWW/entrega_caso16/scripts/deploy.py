#!/usr/bin/env python3
"""Wrapper Docker Compose: un perfil de BD explícito y montajes por identidad."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("action", choices=["init", "up", "down", "ps", "logs", "config"])
p.add_argument("--profile", choices=["h2", "oracle"], required=True)
p.add_argument("--runtime")
a = p.parse_args()
runtime = Path(a.runtime or ROOT / (".runtime-docker-" + a.profile)).resolve()
if a.action == "init":
    subprocess.run([sys.executable, str(ROOT / "scripts/setup.py"), "--runtime", str(runtime), "--docker", "--profile", a.profile], check=True)
    raise SystemExit(0)
env = {**os.environ, "BEC_RUNTIME": str(runtime), "BEC_UID": str(os.getuid()), "BEC_GID": str(os.getgid())}
if a.profile == "oracle" and a.action == "up":
    # Solo archivos GENERADOS para Oracle: no se abren secretos a otros usuarios.
    # El UID del usuario oracle en la imagen gvenzl es 54321.
    subprocess.run(["docker", "run", "--rm", "--network", "none", "--user", "0",
        "--entrypoint", "chown", "-v", str(runtime / "oracle") + ":/tls",
        "-v", str(runtime / "setup/01-bec.sql") + ":/init.sql",
        "gvenzl/oracle-free:23-slim@sha256:48a3d9db7fa7c2a2fdbdf5fff7502c93e807349a2d625718fe61668cc3daa844",
        "54321:54321", "/tls", "/tls/server.p12",
        "/tls/trust.p12", "/tls/tls.env", "/init.sql"], check=True)
cmd = ["docker", "compose", "-f", str(ROOT / "compose.yaml")]
if a.profile == "oracle":
    cmd += ["-f", str(ROOT / "compose.oracle.yaml")]
cmd += ["up", "-d", "--build"] if a.action == "up" else [a.action]
subprocess.run(cmd, cwd=ROOT, env=env, check=True)
