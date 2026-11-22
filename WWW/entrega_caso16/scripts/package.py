#!/usr/bin/env python3
"""Empaqueta solo una allowlist pública, crea SHA-256 y comprueba que no filtre runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]
DIRECTORIES=("src","web","db","deploy","docs","evidencias","scripts")
ROOT_FILES=("README.md","pom.xml","compose.yaml","compose.oracle.yaml",".gitignore",".dockerignore")
FORBIDDEN_EXTENSIONS={".key",".p12",".pem",".token",".db",".log",".enc"}

def selected():
    files=[ROOT/name for name in ROOT_FILES]
    for folder in DIRECTORIES:
        for path in (ROOT/folder).rglob("*"):
            if not path.is_file() or "__pycache__" in path.parts or path.suffix==".pyc":
                continue
            relative=path.relative_to(ROOT)
            assert not any(p.startswith(".runtime") for p in relative.parts)
            assert path.suffix.lower() not in FORBIDDEN_EXTENSIONS, "Archivo privado inesperado: "+str(relative)
            assert path.name not in ("demo-credentials.json","bootstrap.json","pids.json","seed-state.json")
            files.append(path)
    files.append(ROOT/"target/bec.jar")
    return sorted(files,key=lambda p:p.relative_to(ROOT).as_posix())

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output",default=str(ROOT.parent/"Entrega_Caso16_Biblioteca_BEC.zip"))
    args=p.parse_args()
    output=Path(args.output).resolve()
    files=selected()
    manifest=ROOT/"MANIFEST.sha256"
    manifest.write_text("".join(hashlib.sha256(f.read_bytes()).hexdigest()+"  "+f.relative_to(ROOT).as_posix()+"\n" for f in files))
    files.append(manifest)
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for f in files:
            archive.write(f,"entrega_caso16/"+f.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist())==len(set(archive.namelist()))
        assert not any(".runtime" in name or "__pycache__" in name for name in archive.namelist())
    jar=hashlib.sha256((ROOT/"target/bec.jar").read_bytes()).hexdigest()
    for name in ("pruebas_backend","interfaz","carga"):
        assert json.loads((ROOT/"evidencias"/(name+".json")).read_text())["artifact_sha256"]==jar
    print(json.dumps({"archive":str(output),"files":len(files),"bytes":output.stat().st_size,
        "sha256":hashlib.sha256(output.read_bytes()).hexdigest(),"private_runtime_included":False},indent=2))

if __name__=="__main__":
    main()
