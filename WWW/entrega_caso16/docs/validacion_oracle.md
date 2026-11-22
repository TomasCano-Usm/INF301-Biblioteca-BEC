# Protocolo de aceptación Oracle — ejecución parcial comprobada

**Actualización 21-11-2026:** Docker/WSL ya está habilitado. Se construyó la
imagen con Java/Oracle PKI, se recuperó el volumen original y se comprobaron
los siete esquemas, V001/V002, ambos procedimientos `VALID`, JDBC/TCPS positivo,
sembrado y **25 comprobaciones del React contra Oracle**. Evidencia:
[arranque y validación saneada](../evidencias/oracle/arranque.json) y
`WWW/Biblioteca en React/evidencias-oracle/react.json`.

La aceptación completa no está cerrada: la tabla distingue pruebas completas,
parciales y pendientes. Los JUnit H2, la interfaz anterior y las mediciones
históricas conservan su perfil; no se convierten en resultados Oracle.

## Preparación

1. Instalar Docker Engine/Compose compatible, JDK 21, Python y las dependencias del README. Reservar al menos 6 GB para aplicaciones y Oracle.
2. Detener el laboratorio local si ocupa el puerto 8443. No reutilizar `.runtime` H2.
3. Ejecutar desde la raíz:

```bash
python3 scripts/deploy.py init --profile oracle
python3 scripts/deploy.py config --profile oracle
python3 scripts/deploy.py up --profile oracle
python3 scripts/deploy.py ps --profile oracle
```

`init` se ejecuta **solo si el runtime no existe**; no repetirlo para recuperar
el volumen actual. Genera `.runtime-docker-oracle`, secretos por consumidor,
certificados, wallet PKCS12 y SQL con claves aleatorias. `up` ajusta únicamente
los archivos **generados para Oracle** al UID 54321. No se necesita introducir
una contraseña Oracle manual. Véase [recuperación y credenciales](recuperacion_oracle.md).
No publicar el runtime ni logs iniciales que puedan contener la clave administrativa.

El bootstrap SQL crea siete usuarios `BEC_AUTH`, `BEC_CLIENTS`, `BEC_INVENTORY`, `BEC_ORDERS`, `BEC_PAYMENTS`, `BEC_NOTIFICATIONS`, `BEC_MAIL`; se conecta como cada propietario antes de crear sus objetos. No otorga `SELECT ANY TABLE`, DBA ni acceso cruzado. Gateway y GraphQL no reciben usuario Oracle ni red de datos.

## Lista de aceptación con evidencia obligatoria

| ID | Prueba a ejecutar | Resultado exigido | Estado actual |
|---|---|---|---|
| ORA01 | Versión de imagen/Oracle, `compose ps`, registro de digest y recursos | Imagen descargada, Oracle y diez aplicaciones estables | COMPROBADO: arranque; digest, límites y 11 contenedores en arranque.json. No es un soak de producción |
| ORA02 | Consultar objetos y errores de compilación | Siete repositorios V001, V002 inventory/orders, procedimientos VALID y sin errores | COMPROBADO: validate.sql y cero errores de compilación |
| ORA03 | JDBC por TCPS/2484 con CA y DN CN=oracle | Conexión válida; CA incorrecta o DN incorrecto falla | PARCIAL: camino positivo comprobado; CA/DN negativos pendientes |
| ORA04 | Con credencial BEC_CLIENTS intentar leer BEC_ORDERS.BEC_RECORDS | ORA-00942/ORA-01031; no acceso cruzado | PENDIENTE |
| ORA05 | Inscripción/activación/login, catálogo y solicitud mediante HTTPS | Persistencia real en esquemas Oracle, validaciones y titularidad intactas | PARCIAL: seed y 25 pruebas React cubren inscripción/activación/login, CRUD/filtros y solicitud; titularidad cruzada completa pendiente |
| ORA06 | Entrega HOME y ROOM con RUN/muestra TEST, devolución y recibo | Plazos por ítem; HOME autorizado para salida software y ROOM no | PENDIENTE |
| ORA07 | `bec_tick_inventory` en sandbox con tiempos de frontera | A los 1799 s RESHELVING; a los 1800 s AVAILABLE; sin liberación temprana | PENDIENTE |
| ORA08 | `bec_tick_orders` repetido en sandbox con préstamo HOME vencido | Una entrada OVERDUE por préstamo/día; outbox leído y correo TEST enviado una vez | PENDIENTE |
| ORA09 | Reinicio de contenedores sin eliminar volumen | Identificadores, préstamos, sanciones y deduplicación conservados | PARCIAL: reinicio real conserva catálogo, cuentas y claves; préstamos/sanciones pendientes |
| ORA10 | Desde el host, probar puertos de backend/BD y ruta privada sin firma | Sin publicación de puertos internos; llamada privada sin identidad 403 desde red autorizada | PARCIAL: solo gateway publicado según Docker inspect; pruebas negativas de red pendientes |
| ORA11 | Detener payments/inventory/secrets y recuperar | 502/503 controlado; saga/outbox reanuda, sin stock ni evaluación duplicados | PENDIENTE |
| ORA12 | Repetir carga, restauración y flujos con perfil Oracle | Métricas propias de Oracle, respaldo restaurable y aceptación documentada | PENDIENTE |

### Inspección SQL de solo lectura

Desde la raíz del backend, abrir una consola local dentro del contenedor; no escribir contraseñas en un historial de comandos. Estas variables deben coincidir con el runtime creado por `deploy.py`:

```bash
export BEC_RUNTIME="$PWD/.runtime-docker-oracle"
export BEC_UID="$(id -u)"
export BEC_GID="$(id -g)"
docker compose -f compose.yaml -f compose.oracle.yaml exec oracle sqlplus / as sysdba
```

En SQL*Plus:

```sql
ALTER SESSION SET CONTAINER = FREEPDB1;
SELECT owner, object_name, status
  FROM dba_objects
 WHERE owner IN ('BEC_INVENTORY','BEC_ORDERS')
   AND object_type='PROCEDURE';
SELECT owner, name, line, position, text
  FROM dba_errors
 WHERE owner LIKE 'BEC_%'
 ORDER BY owner, name, sequence;
SELECT owner, table_name
  FROM dba_tables
 WHERE owner LIKE 'BEC_%'
 ORDER BY owner, table_name;
```

Solo el operador de aceptación usa SYS para inspección. La aplicación nunca lo usa. Registrar versiones de `BEC_SCHEMA_VERSION` conectándose como cada propietario. `SHOW ERRORS` en el bootstrap es informativo: verificar **explícitamente** que no queden objetos INVALID antes de aceptar el despliegue.

### Sembrado y pruebas web

Con los servicios sanos, sembrar **solo si ese runtime no tiene seed-state.json**:

```bash
python3 scripts/seed.py --runtime .runtime-docker-oracle --titles 12
python3 scripts/verify_oracle.py
```

El segundo comando contrasta el JAR desplegado, SQL de solo lectura, catálogo,
estado Docker y la evidencia React Oracle ya generada. No ejecuta por sí solo
todo el E2E: para repetirlo, seguir el README de React, copiar `/app/bec.jar`
desde el contenedor y pasarlo a `test_ui.py --backend-artifact`.
No confundirlo con `target/bec.jar`, que puede tener otro hash.

El sembrado de 12 títulos/24 ejemplares/dos lectores y los 25 checks React ya
se ejecutaron. Las pruebas ORA restantes siguen siendo un plan. `seed.py`
funciona por la API pública. `load.py` suma `/proc` de los diez PID locales:
para Docker debe adaptarse el monitor a `docker stats`/cgroups; no usar cifras
de procesos locales como si fueran contenedores Oracle.

### Fronteras de tiempo en sandbox

Los procedimientos reciben un instante ISO-8601 y **no hacen COMMIT**; el worker Java los invoca automáticamente cada segundo dentro de una transacción con el cerrojo `BEC_LOCK`. No requieren permisos `DBMS_SCHEDULER`. Para ORA07/08 preparar datos **solo en una BD descartable**, detener los workers de inventory/orders y ejecutar como el dueño correspondiente:

```sql
SELECT id FROM bec_lock WHERE id=1 FOR UPDATE;
EXEC bec_tick_inventory('2026-11-20T15:29:59Z');
-- Inspeccionar estado/payload del ejemplar con readyAt=15:30:00Z.
EXEC bec_tick_inventory('2026-11-20T15:30:00Z');
-- Debe cambiar a AVAILABLE exactamente en esta frontera.
ROLLBACK;
```

Análogo para `bec_tick_orders` dos veces con el mismo día y préstamo vencido, comprobando un único OUTBOX. Adaptar instantes al fixture real y conservar consultas/estados antes y después. No ejecutar un tiempo futuro artificial sobre datos de biblioteca en uso.

### Puertos, recuperación y cierre

- Solo `127.0.0.1:8443` está publicado. `private` y `data` son redes internas; gateway no está en `data`.
- La BD escucha TCPS/2484 para aplicaciones; el TCP local de inicialización no está publicado al host. Verificar listener, DN y confianza real antes de ORA03.
- `healthcheck.sh` del contenedor no sustituye la conexión JDBC ni la aceptación de cada servicio.
- Guardar evidencia saneada: fecha UTC, digest JAR/imagen, versiones, pruebas, estados y conteos. **Eliminar** contraseñas, tokens, foto, huella y SQL de bootstrap antes de adjuntar.
- Finalizar con `python3 scripts/deploy.py down --profile oracle`. No usar `down -v` ni borrar el volumen para “arreglar” una migración sin respaldo y autorización.

Si falla la wallet, la sintaxis Oracle JSON, la imagen o el arranque, conservar el resultado como fallo y corregirlo/repetirlo: no sustituir silenciosamente Oracle por H2. Al aprobar ORA01–12, actualizar ADR-003 y la matriz de trazabilidad con evidencia nueva.
