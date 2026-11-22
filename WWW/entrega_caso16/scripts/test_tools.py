#!/usr/bin/env python3
"""Pruebas auxiliares de rotación offline, con secretos ficticios y sin tocar runtime real."""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import unittest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT=Path(__file__).resolve().parents[1]

class OfflineRotationTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="bec-rotation-")
        self.runtime=Path(self.temp.name)
        self.master=secrets.token_bytes(32)
        self.old=base64.b64encode(secrets.token_bytes(32)).decode()
        for name in ("secrets/master","gateway","inventory"):
            (self.runtime/name).mkdir(parents=True,exist_ok=True)
        self.manager={"masterKey":base64.b64encode(self.master).decode(),
            "acl":{"gateway":hashlib.sha256(b"fake-old-token").hexdigest()}}
        (self.runtime/"secrets/bootstrap.json").write_text(json.dumps(self.manager))
        (self.runtime/"gateway/bootstrap.json").write_text(json.dumps({"bootstrapToken":"fake-old-token"}))
        self.write_bundle("gateway",{"outbound":{"inventory":self.old},"inbound":{},"dataKey":"UNCHANGED_FAKE"})
        self.write_bundle("inventory",{"inbound":{"gateway":self.old},"outbound":{},"dataKey":"UNCHANGED_FAKE"})
    def tearDown(self):
        self.temp.cleanup()
    def write_bundle(self,name,data):
        iv=secrets.token_bytes(12);cipher=AESGCM(self.master).encrypt(iv,json.dumps(data).encode(),None)
        (self.runtime/"secrets/master"/(name+".enc")).write_text(base64.b64encode(iv).decode()+"."+base64.b64encode(cipher).decode())
    def read_bundle(self,name):
        iv,cipher=(self.runtime/"secrets/master"/(name+".enc")).read_text().split(".")
        return json.loads(AESGCM(self.master).decrypt(base64.b64decode(iv),base64.b64decode(cipher),None))
    def run_rotate(self,*args,confirm=True):
        cmd=[sys.executable,str(ROOT/"scripts/rotate.py"),"--runtime",str(self.runtime)]
        if confirm:cmd.append("--offline-confirmed")
        return subprocess.run(cmd+list(args),capture_output=True,text=True)
    def test_edge_updates_both_ends_without_data_key_change(self):
        result=self.run_rotate("edge","gateway","inventory")
        self.assertEqual(0,result.returncode)
        source,target=self.read_bundle("gateway"),self.read_bundle("inventory")
        new=source["outbound"]["inventory"]
        self.assertNotEqual(self.old,new);self.assertEqual(new,target["inbound"]["gateway"])
        self.assertEqual("UNCHANGED_FAKE",source["dataKey"])
        self.assertNotIn(new,result.stdout+result.stderr)
        self.assertEqual(0o600,(self.runtime/"secrets/master/gateway.enc").stat().st_mode&0o777)
    def test_bootstrap_changes_token_and_matching_acl(self):
        self.assertEqual(0,self.run_rotate("bootstrap","gateway").returncode)
        token=json.loads((self.runtime/"gateway/bootstrap.json").read_text())["bootstrapToken"]
        acl=json.loads((self.runtime/"secrets/bootstrap.json").read_text())["acl"]["gateway"]
        self.assertNotEqual("fake-old-token",token);self.assertEqual(hashlib.sha256(token.encode()).hexdigest(),acl)
        self.assertEqual(0o600,(self.runtime/"gateway/bootstrap.json").stat().st_mode&0o777)
    def test_confirmation_and_registered_live_process_block_rotation(self):
        self.assertNotEqual(0,self.run_rotate("edge","gateway","inventory",confirm=False).returncode)
        (self.runtime/"pids.json").write_text(json.dumps({"fake":os.getpid()}))
        self.assertNotEqual(0,self.run_rotate("edge","gateway","inventory").returncode)
        self.assertEqual(self.old,self.read_bundle("gateway")["outbound"]["inventory"])
    def test_unknown_edge_never_creates_new_permission(self):
        self.assertNotEqual(0,self.run_rotate("edge","gateway","notifications").returncode)
        self.assertEqual({"inventory":self.old},self.read_bundle("gateway")["outbound"])

if __name__=="__main__":
    unittest.main(verbosity=2)
