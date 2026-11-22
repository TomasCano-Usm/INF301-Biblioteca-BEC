#!/usr/bin/env python3
"""Rotación OFFLINE de una arista o bootstrap; nunca reescribe claves de datos."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from setup import EDGES, SERVICES

def atomic(path, data):
    temporary=path.with_suffix(path.suffix+".new")
    temporary.write_text(data)
    temporary.chmod(0o600)
    os.replace(temporary,path)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--runtime",default=".runtime")
    p.add_argument("--offline-confirmed",action="store_true",help="Confirma que detuvo TODOS los procesos/contenedores de este runtime.")
    sub=p.add_subparsers(dest="action",required=True)
    edge=sub.add_parser("edge");edge.add_argument("source",choices=SERVICES);edge.add_argument("target",choices=SERVICES)
    bootstrap=sub.add_parser("bootstrap");bootstrap.add_argument("service",choices=SERVICES[1:])
    a=p.parse_args()
    runtime=Path(a.runtime).resolve()
    if not a.offline_confirmed:
        raise SystemExit("Detenga el runtime; la rotación coordinada exige --offline-confirmed.")
    if (runtime/"pids.json").exists():
        pids=json.loads((runtime/"pids.json").read_text())
        if any(Path(f"/proc/{pid}").exists() for pid in pids.values()):
            raise SystemExit("Hay procesos locales registrados. Deténgalos con run.py stop.")
    os.umask(0o077)
    root=runtime/"secrets"/"bootstrap.json"
    manager=json.loads(root.read_text())
    key=base64.b64decode(manager["masterKey"])
    def read_bundle(service):
        path=runtime/"secrets"/"master"/(service+".enc")
        iv,cipher=path.read_text().split(".")
        return json.loads(AESGCM(key).decrypt(base64.b64decode(iv),base64.b64decode(cipher),None))
    def write_bundle(service,bundle):
        iv=secrets.token_bytes(12)
        cipher=AESGCM(key).encrypt(iv,json.dumps(bundle).encode(),None)
        atomic(runtime/"secrets"/"master"/(service+".enc"),base64.b64encode(iv).decode()+"."+base64.b64encode(cipher).decode())
    if a.action=="edge":
        if a.target not in EDGES.get(a.source,[]):
            raise SystemExit("Arista no autorizada. No se crean permisos nuevos con esta herramienta.")
        source,target=read_bundle(a.source),read_bundle(a.target)
        new=base64.b64encode(secrets.token_bytes(32)).decode()
        source["outbound"][a.target]=new;target["inbound"][a.source]=new
        write_bundle(a.source,source);write_bundle(a.target,target)
    else:
        path=runtime/a.service/"bootstrap.json"
        consumer=json.loads(path.read_text())
        token=secrets.token_urlsafe(32)
        consumer["bootstrapToken"]=token
        manager["acl"][a.service]=hashlib.sha256(token.encode()).hexdigest()
        atomic(path,json.dumps(consumer,indent=2))
        atomic(root,json.dumps(manager,indent=2))
    print("Rotación completada sin mostrar valores. Inicie el runtime y ejecute las pruebas de acceso.")
if __name__=="__main__":
    main()
