#!/bin/bash
# No basta con que FREEPDB1 esté abierto: TLS y los esquemas deben estar listos.
set -euo pipefail
test -r /tmp/bec-oracle-ready
test "$(cat /tmp/bec-oracle-ready)" = "$(awk '{print $22}' /proc/1/stat)"
healthcheck.sh
"$ORACLE_HOME/bin/lsnrctl" status BEC_TLS >/dev/null 2>&1
