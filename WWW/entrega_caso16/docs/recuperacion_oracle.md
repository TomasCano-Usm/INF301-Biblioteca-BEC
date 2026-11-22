# Oracle: Java, credenciales y recuperación de la inicialización

## Qué se corrigió

La imagen `gvenzl/oracle-free:23-slim` no incluye un JRE ni `jlib/oraclepki.jar`.
Por eso `orapki` no podía crear la wallet TCPS aunque la base ya hubiera abierto.

`deploy/oracle/Dockerfile` genera ahora `bec-oracle-java:1.0` con:

- La **misma base fijada por digest** que creó el volumen; no actualiza la
  versión del motor para reparar Java.
- OpenJDK 21 instalado dentro del contenedor y `JAVA_HOME` configurado.
- Oracle PKI 23.26.4.0.0 de Maven Central, con SHA-256 verificado durante el build.
- El usuario de ejecución `oracle`, no root.

No se desactiva TLS y no se publican los puertos SQL al host.

## ¿Hay que introducir alguna credencial?

**No para el Oracle local de este proyecto.** `deploy.py init --profile oracle`
ya genera lo necesario:

| Uso | Origen y almacenamiento | ¿Hay que rellenarlo? |
|---|---|---|
| Siete usuarios Oracle `BEC_*` | Claves aleatorias en los bundles cifrados de `.runtime-docker-oracle/secrets/master/`; bootstrap SQL privado | No |
| Contraseña administrativa Oracle | La imagen la genera con `ORACLE_RANDOM_PASSWORD=true` | No; el operador puede usar autenticación local dentro del contenedor |
| Wallet, certificados y confianza | `.runtime-docker-oracle/oracle/` y `setup/` | No |
| Acceso a la aplicación | `.runtime-docker-oracle/demo-credentials.json` | Consultar localmente para iniciar sesión |

La aplicación **no utiliza SYS**. No se copia ninguna clave Oracle a React,
`.env.local`, código fuente, capturas ni mensajes de chat. Los logs iniciales
de la imagen pueden contener la contraseña administrativa: no publicarlos.
El runtime es privado y no debe incluirse en el ZIP.

Una instalación Oracle externa sí requiere que su administrador proporcione
host, servicio, TCPS, CA/DN y usuarios autorizados. No es el perfil local descrito aquí.

## Reintentar conservando el volumen y las claves

Si `init` ya terminó correctamente, **no volver a ejecutarlo**. Desde `WWW`:

```bash
cd entrega_caso16
python3 scripts/deploy.py up --profile oracle
python3 scripts/deploy.py ps --profile oracle
curl --cacert .runtime-docker-oracle/setup/ca.crt \
  "https://localhost:8443/api/catalog?size=1"
```

El hook `provision.sh` corre tanto en el primer arranque como al reiniciar:

- Si la BD abrió pero no existe ninguno de los siete usuarios BEC, ejecuta
  el bootstrap pendiente **con las claves del runtime existente**.
- Si existen los siete, valida tablas, versiones, cerrojos y procedimientos,
  sin recrear usuarios ni cambiar contraseñas.
- Si únicamente falta V002 o alguno de los dos procedimientos está `INVALID`,
  reaplica solo ese procedimiento con su propietario. La versión se registra
  de forma idempotente y solo después de comprobar la compilación.
- Si hay un estado parcial distinto, se detiene y pide recuperación dirigida.
  No borra objetos para ocultar un error.

El `healthcheck` no considera listo Oracle hasta terminar TLS y validar los
esquemas. Un contenedor en `healthy` no sustituye la prueba JDBC desde la API.

La primera compilación real detectó además `PLS-00201` en V002:
`TO_UTC_TIMESTAMP_TZ` es una función SQL y no puede llamarse directamente como
función PL/SQL. Los procedimientos corregidos la invocan mediante
`SELECT ... INTO ... FROM dual`. La reparación no cambia las tablas ni los datos.

Solo después de obtener una respuesta correcta del catálogo, y si todavía
no se sembró este runtime:

```bash
python3 scripts/seed.py --runtime .runtime-docker-oracle --titles 12
```

La configuración de Vite es:

```dotenv
BEC_RUNTIME=../entrega_caso16/.runtime-docker-oracle
BEC_BACKEND_URL=https://localhost:8443
```

Reiniciar Vite y confiar únicamente en la CA de laboratorio de este runtime.
Los usuarios y datos del entorno H2 son independientes; no hay migración automática.

## Límites de la comprobación

El arranque reparado debe contrastarse con [ORA01–ORA12](validacion_oracle.md).
Las evidencias H2 anteriores conservan su perfil y no se convierten en pruebas
Oracle por instalar Java. No usar `down -v`, borrar el volumen ni regenerar
claves para resolver un error de aprovisionamiento.

Prueba auxiliar de los guardas (sin Docker, con SQLPlus simulado y claves falsas):

```bash
python3 scripts/test_oracle_bootstrap.py
```

Son ocho pruebas de creación pendiente, reinicio sin recreación, reparación
selectiva, rechazo de estados parciales y no publicación de claves en errores.
No se presentan como pruebas de conexión Oracle real.

## Resultado comprobado el 21-11-2026

- Oracle AI Database 26ai Free, versión 23.26.4.0.0; OpenJDK 21 dentro del contenedor.
- Volumen y claves originales conservados: siete esquemas, V001/V002,
  `BEC_TICK_INVENTORY` y `BEC_TICK_ORDERS` válidos, cero errores de compilación.
- Gateway → inventario → JDBC/TCPS → Oracle: catálogo HTTP 200.
- Carga por API: 12 títulos, 24 ejemplares y dos lectores ficticios activados.
- **25 comprobaciones React contra Oracle**, sin errores JavaScript: multimedia,
  CRUD, seis filtros, persistencia, cancelación y rechazo de cambios en material en uso.
- Reinicio real del despliegue conservó el catálogo, las cuentas y las claves.
  Se archivaron únicamente los fixtures creados por las pruebas.
- Once contenedores activos y solo el gateway publicado al host.

La primera ejecución de React se interrumpió por un apagado general de los
contenedores; no se contabilizó como aprobada. Tras reanudar el mismo volumen,
la repetición completó los 25 checks. No se usó H2 como sustituto durante esta
comprobación.

Evidencia saneada: [evidencias/oracle/arranque.json](../evidencias/oracle/arranque.json)
y `WWW/Biblioteca en React/evidencias-oracle/react.json`. Para contrastarla:

```bash
python3 scripts/verify_oracle.py
```

El verificador solo lee contenedores/SQL y genera el JSON; las ocho pruebas
auxiliares usan fixtures temporales y SQLPlus simulado. No certifica las partes
pendientes de [ORA01–ORA12](validacion_oracle.md), especialmente CA/DN incorrectos,
préstamos completos, fronteras temporales de SP, fallas, carga y restauración.
