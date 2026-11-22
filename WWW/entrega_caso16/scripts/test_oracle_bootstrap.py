#!/usr/bin/env python3
"""Prueba los guardas del hook sin Docker, BD real ni credenciales del runtime."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BootstrapGuardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bec-bootstrap-")
        self.folder = Path(self.temp.name)
        self.ready = self.folder / "ready"
        self.trace = self.folder / "calls.jsonl"
        self.repair = self.folder / "repair.sql"
        self.hook = self.folder / "provision.sh"
        # Solo se redirigen archivos efímeros; el control de flujo es el del hook real.
        source = (ROOT / "deploy/oracle/provision.sh").read_text()
        source = source.replace("ready=/tmp/bec-oracle-ready", f"ready='{self.ready}'")
        source = source.replace("mktemp /tmp/bec-provision.", f"mktemp {self.folder}/bec-provision.")
        source = source.replace("mktemp /tmp/bec-migration.", f"mktemp {self.folder}/bec-migration.")
        source = source.replace("mktemp /tmp/bec-migration-log.", f"mktemp {self.folder}/bec-migration-log.")
        bootstrap = self.folder / "bootstrap.sql"
        bootstrap.write_text('CONNECT BEC_INVENTORY/"FAKE_PRIVATE_CREDENTIAL_NEVER_PUBLISH"@local\n'
                             'CONNECT BEC_ORDERS/"FAKE_PRIVATE_CREDENTIAL_NEVER_PUBLISH"@local\n')
        source = source.replace("bootstrap=/run/bec-bootstrap/01-bec.sql", f"bootstrap='{bootstrap}'")
        self.hook.write_text(source)
        sqlplus = self.folder / "sqlplus"
        sqlplus.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
text = sys.stdin.read()
stage = ('validate' if any(x.endswith('/validate.sql') for x in sys.argv)
         else 'repair' if any('/bec-migration.' in x for x in sys.argv)
         else 'bootstrap' if '@/run/bec-bootstrap/01-bec.sql' in text
         else 'pending' if 'BEC_PENDING_INVENTORY=' in text else 'query')
with open(os.environ['TRACE'], 'a') as file:
    file.write(json.dumps(stage) + '\\n')
if stage == 'query':
    print('BEC_USER_COUNT=' + os.environ['COUNT'])
elif stage == 'pending':
    print('BEC_PENDING_INVENTORY=' + os.environ.get('PENDING', '0'))
    print('BEC_PENDING_ORDERS=0')
elif stage == os.environ.get('FAIL_STAGE'):
    print('FAKE_PRIVATE_CREDENTIAL_NEVER_PUBLISH')
    print('ORA-20001: simulated failure')
    sys.exit(1)
else:
    if stage == 'repair':
        Path(os.environ['REPAIR']).write_text(Path(sys.argv[-1][1:]).read_text())
    print('OK')
""")
        sqlplus.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def run_hook(self, count, fail="", pending="0"):
        env = {**os.environ, "PATH": str(self.folder) + os.pathsep + os.environ["PATH"],
               "TRACE": str(self.trace), "COUNT": str(count), "FAIL_STAGE": fail,
               "PENDING": pending, "REPAIR": str(self.repair)}
        result = subprocess.run(["bash", str(self.hook)], env=env, capture_output=True, text=True)
        calls = [json.loads(line) for line in self.trace.read_text().splitlines()]
        return result, calls

    def test_pending_bootstrap_runs_once_then_validates(self):
        result, calls = self.run_hook(0)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(["query", "bootstrap", "pending", "validate"], calls)
        self.assertTrue(self.ready.is_file())
        self.assertEqual([], list(self.folder.glob("bec-provision.*")))

    def test_existing_schemas_are_never_recreated(self):
        result, calls = self.run_hook(7)
        self.assertEqual(0, result.returncode)
        self.assertEqual(["query", "pending", "validate"], calls)
        self.assertTrue(self.ready.is_file())

    def test_partial_state_fails_without_modifying_schemas(self):
        result, calls = self.run_hook(3)
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(["query"], calls)
        self.assertFalse(self.ready.exists())

    def test_unknown_state_fails_closed(self):
        result, calls = self.run_hook("unexpected")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(["query"], calls)
        self.assertFalse(self.ready.exists())

    def test_bootstrap_failure_does_not_publish_credentials(self):
        result, calls = self.run_hook(0, "bootstrap")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(["query", "bootstrap"], calls)
        self.assertNotIn("FAKE_PRIVATE_CREDENTIAL_NEVER_PUBLISH", result.stdout + result.stderr)
        self.assertIn("ORA-20001", result.stdout)
        self.assertFalse(self.ready.exists())
        self.assertEqual([], list(self.folder.glob("bec-provision.*")))

    def test_validation_failure_never_marks_database_ready(self):
        result, calls = self.run_hook(7, "validate")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(["query", "pending", "validate"], calls)
        self.assertFalse(self.ready.exists())

    def test_only_invalid_procedure_is_repaired_without_recreating_tables(self):
        result, calls = self.run_hook(7, pending="1")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(["query", "pending", "repair", "validate"], calls)
        sql = self.repair.read_text()
        self.assertIn("CONNECT BEC_INVENTORY/", sql)
        self.assertIn("@/opt/bec/inventory.sql", sql)
        self.assertNotIn("CONNECT BEC_ORDERS/", sql)
        self.assertNotIn("CREATE USER", sql)
        self.assertNotIn("schema.sql", sql)
        self.assertNotIn("FAKE_PRIVATE_CREDENTIAL_NEVER_PUBLISH", result.stdout + result.stderr)
        self.assertEqual([], list(self.folder.glob("bec-migration*")))

    def test_failed_repair_is_private_and_not_ready(self):
        result, calls = self.run_hook(7, "repair", pending="1")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(["query", "pending", "repair"], calls)
        self.assertFalse(self.ready.exists())
        self.assertNotIn("FAKE_PRIVATE_CREDENTIAL_NEVER_PUBLISH", result.stdout + result.stderr)
        self.assertEqual([], list(self.folder.glob("bec-migration*")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
