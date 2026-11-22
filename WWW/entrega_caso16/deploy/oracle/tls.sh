#!/bin/bash
# Configuración TCPS de laboratorio; requiere Java dentro de la imagen de Oracle.
set -euo pipefail
rm -f /tmp/bec-oracle-ready
source /run/bec-oracle/tls.env
wallet=/opt/oracle/oradata/bec-wallet
if [ ! -f "$wallet/cwallet.sso" ]; then
  mkdir -p "$wallet"
  "$ORACLE_HOME/bin/orapki" wallet create -wallet "$wallet" -pwd "$BEC_TLS_PASSWORD" -auto_login
  "$ORACLE_HOME/bin/orapki" wallet import_pkcs12 -wallet "$wallet" -pwd "$BEC_TLS_PASSWORD" \
    -pkcs12file /run/bec-oracle/server.p12 -pkcs12pwd "$BEC_TLS_PASSWORD"
fi
"$ORACLE_HOME/bin/orapki" wallet display -wallet "$wallet" -pwd "$BEC_TLS_PASSWORD" \
  | grep 'Subject:.*CN=oracle' >/dev/null
cat > "$ORACLE_HOME/network/admin/sqlnet.ora" <<EOF
WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=$wallet)))
SSL_CLIENT_AUTHENTICATION=FALSE
SSL_VERSION=1.2
SQLNET.AUTHENTICATION_SERVICES=(BEQ)
EOF
if ! grep -q 'BEC_TLS' "$ORACLE_HOME/network/admin/listener.ora"; then
  cat >> "$ORACLE_HOME/network/admin/listener.ora" <<EOF

BEC_TLS=(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=0.0.0.0)(PORT=2484))))
WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=$wallet)))
SSL_CLIENT_AUTHENTICATION=FALSE
EOF
fi
if ! "$ORACLE_HOME/bin/lsnrctl" status BEC_TLS >/dev/null 2>&1; then
  "$ORACLE_HOME/bin/lsnrctl" start BEC_TLS
fi
sqlplus -s / as sysdba <<'SQL'
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SYSTEM SET LOCAL_LISTENER='(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=1521))(ADDRESS=(PROTOCOL=TCPS)(HOST=localhost)(PORT=2484)))' SCOPE=BOTH;
ALTER SYSTEM REGISTER;
EXIT
SQL
