#!/bin/bash
# Reanuda el caso concreto «BD creada, bootstrap BEC aún no ejecutado».
# Nunca borra usuarios, tablas, datos ni cambia contraseñas existentes.
set -euo pipefail
umask 077
ready=/tmp/bec-oracle-ready
bootstrap=/run/bec-bootstrap/01-bec.sql
rm -f "$ready"

result=$(sqlplus -s / as sysdba <<'SQL'
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 VERIFY OFF ECHO OFF
WHENEVER OSERROR EXIT FAILURE
WHENEVER SQLERROR EXIT FAILURE
ALTER SESSION SET CONTAINER = FREEPDB1;
SELECT 'BEC_USER_COUNT=' || COUNT(*) FROM dba_users
 WHERE username IN ('BEC_AUTH','BEC_CLIENTS','BEC_INVENTORY','BEC_ORDERS',
                    'BEC_PAYMENTS','BEC_NOTIFICATIONS','BEC_MAIL');
EXIT
SQL
)
count=$(printf '%s\n' "$result" | sed -n 's/^BEC_USER_COUNT=\([0-9]*\)[[:space:]]*$/\1/p')
case "$count" in
  0)
    echo 'BEC: creando los siete esquemas pendientes con las credenciales del runtime existente.'
    # El SQL contiene claves. No se publica en docker logs, tampoco si falla.
    log=$(mktemp /tmp/bec-provision.XXXXXX)
    trap 'rm -f "$log"' EXIT
    if ! sqlplus -s / as sysdba >"$log" 2>&1 <<'SQL'
SET ECHO OFF VERIFY OFF
WHENEVER OSERROR EXIT FAILURE
WHENEVER SQLERROR EXIT FAILURE
@/run/bec-bootstrap/01-bec.sql
EXIT
SQL
    then
      echo 'BEC: falló el bootstrap. Se conservan el volumen y las credenciales.'
      grep -Eo 'ORA-[0-9]{5}|PLS-[0-9]{5}|SP2-[0-9]{4}' "$log" | sort -u || true
      exit 1
    fi
    rm -f "$log"
    trap - EXIT
    ;;
  7)
    echo 'BEC: esquemas existentes; se comprueban sin recrearlos ni cambiar sus claves.'
    ;;
  *)
    echo 'BEC: aprovisionamiento parcial o estado desconocido. Se requiere recuperación dirigida; no se borra ni reinicializa nada.'
    exit 1
    ;;
esac

# Reparar únicamente procedimientos BEC ausentes/INVALID o V002 pendiente.
# Las tablas y los registros existentes no se recrean ni se vacían.
pending=$(sqlplus -s / as sysdba <<'SQL'
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 VERIFY OFF ECHO OFF
WHENEVER OSERROR EXIT FAILURE
WHENEVER SQLERROR EXIT FAILURE
ALTER SESSION SET CONTAINER = FREEPDB1;
SELECT 'BEC_PENDING_INVENTORY=' || CASE
 WHEN EXISTS (SELECT 1 FROM dba_objects WHERE owner='BEC_INVENTORY'
               AND object_name='BEC_TICK_INVENTORY' AND object_type='PROCEDURE' AND status='VALID')
  AND EXISTS (SELECT 1 FROM BEC_INVENTORY.bec_schema_version WHERE version=2)
 THEN '0' ELSE '1' END FROM dual;
SELECT 'BEC_PENDING_ORDERS=' || CASE
 WHEN EXISTS (SELECT 1 FROM dba_objects WHERE owner='BEC_ORDERS'
               AND object_name='BEC_TICK_ORDERS' AND object_type='PROCEDURE' AND status='VALID')
  AND EXISTS (SELECT 1 FROM BEC_ORDERS.bec_schema_version WHERE version=2)
 THEN '0' ELSE '1' END FROM dual;
EXIT
SQL
)
inventory=$(printf '%s\n' "$pending" | sed -n 's/^BEC_PENDING_INVENTORY=\([01]\)[[:space:]]*$/\1/p')
orders=$(printf '%s\n' "$pending" | sed -n 's/^BEC_PENDING_ORDERS=\([01]\)[[:space:]]*$/\1/p')
if [[ ! "$inventory" =~ ^[01]$ || ! "$orders" =~ ^[01]$ ]]; then
  echo 'BEC: no se pudo determinar el estado de V002; no se altera el esquema.'
  exit 1
fi
if [ "$inventory$orders" != "00" ]; then
  migration=$(mktemp /tmp/bec-migration.XXXXXX)
  log=$(mktemp /tmp/bec-migration-log.XXXXXX)
  trap 'rm -f "$migration" "$log"' EXIT
  {
    printf '%s\n' 'SET ECHO OFF VERIFY OFF DEFINE OFF' \
      'WHENEVER OSERROR EXIT FAILURE' 'WHENEVER SQLERROR EXIT FAILURE'
    for service in inventory orders; do
      if [ "${!service}" = "1" ]; then
        owner="BEC_${service^^}"
        # Se reutiliza la credencial existente; no se inventa ni restablece una clave.
        awk -v owner="$owner" 'index($0,"CONNECT " owner "/")==1 {print; found++}
          END {if(found!=1) exit 1}' "$bootstrap"
        printf '%s\n' "@/opt/bec/$service.sql"
      fi
    done
    printf '%s\n' 'EXIT SUCCESS'
  } >"$migration"
  echo 'BEC: aplicando solo los procedimientos V002 pendientes con sus propietarios.'
  if ! sqlplus -s / as sysdba @"$migration" >"$log" 2>&1; then
    echo 'BEC: fallo de compilación V002; se conservan usuarios, datos y claves.'
    grep -Eo 'ORA-[0-9]{5}|PLS-[0-9]{5}|SP2-[0-9]{4}' "$log" | sort -u || true
    exit 1
  fi
fi

sqlplus -s / as sysdba @/opt/bec/validate.sql
# El marcador corresponde a este arranque, no a otro proceso anterior.
awk '{print $22}' /proc/1/stat >"$ready"
echo 'BEC: esquemas y procedimientos válidos; inicialización completada.'
