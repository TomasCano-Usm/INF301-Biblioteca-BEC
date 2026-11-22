# Caso 16 · Biblioteca Municipal BEC

**Entrega académica funcional: backend Java 21, frontend responsive, API Gateway HTTPS y microservicios privados.**

## Leer primero

**Actualización React:** se integró el frontend de los compañeros en
`WWW/Biblioteca en React` con multimedia, confirmaciones y seis filtros.
Véase [cambios y evidencia actual](docs/actualizacion_react.md) y
[README de React](<../Biblioteca en React/README.md>) para ejecutarlo e integrarlo con Oracle.
La revisión pasó **26 pruebas backend y 25 comprobaciones React**.
Los PDF, capturas y mediciones listados a continuación corresponden a la
entrega anterior, con su propio hash; no prueban esta revisión.

Las aplicaciones son hermanas dentro de `WWW`; las rutas de los scripts se
resuelven desde sus archivos. No dependen de `E:\` ni de `/mnt/e/`.
El [README raíz](../README.md) explica cómo iniciar desde `WWW`, reinstalar
los enlaces pnpm tras un traslado y clonar sin publicar credenciales.

- **Informe de los diez módulos:** [`docs/informe.pdf`](docs/informe.pdf), [Word editable](docs/informe.docx) y [Markdown](docs/informe.md).
- **Contratos actuales de las 35 operaciones:** [Markdown](docs/contratos.md) y [OpenAPI 1.1](docs/openapi.json). El [PDF anterior](docs/contratos.pdf) no incluye los campos/filtros nuevos.
- **Diagramas:** [PDF A3](docs/diagramas.pdf) y [fuentes PlantUML, SVG y PNG](docs/diagramas/).
- **Trazabilidad:** [`docs/trazabilidad.csv`](docs/trazabilidad.csv). Resultados reales en [`evidencias/`](evidencias/).
- **Manual de usuario:** [`docs/manual_usuario.pdf`](docs/manual_usuario.pdf) o `https://localhost:8443/help.html` al iniciar.

**Oracle actualizado:** Docker/WSL ya está habilitado. Se añadió Java y Oracle PKI
a la imagen y se recuperó la inicialización sin borrar el volumen ni cambiar
credenciales. Se comprobaron los siete esquemas, ambos procedimientos `VALID`,
el catálogo mediante JDBC/TCPS y la carga de 12 títulos, 24 ejemplares y dos
lectores ficticios. También pasaron **25 comprobaciones React contra Oracle**,
con evidencia separada en [arranque Oracle](evidencias/oracle/arranque.json).
Véase [recuperación y credenciales](docs/recuperacion_oracle.md).
La aceptación completa [ORA01–ORA12](docs/validacion_oracle.md) sigue delimitada
por sus pruebas; los JUnit y la carga anteriores siguen siendo evidencia **H2**.
Correo, huella y antirrobo usan adaptadores **de prueba**, no Internet ni
dispositivos físicos. No se cobran multas: las sanciones son de tiempo.

La primera entrega creó `web/` antes de recibir el React de los compañeros.
Ahora la gestión de colección utiliza ese React; `web/` conserva los demás
trámites como referencia. Los nombres de integrantes y datos de portada deben
completarse en el informe; no se inventaron.

## 1. Requisitos

Linux/WSL con **JDK 21** (incluye `keytool`), Maven **3.9.x**, Python **3.10+**, OpenSSL **3.x**, acceso a Maven Central para compilar y los puertos locales 8443, 9100–9108 libres. Docker Engine y Compose v2 son necesarios **solo** para contenedores/Oracle. Para laboratorio, reservar aproximadamente 3 GB de RAM; Oracle agrega al menos 3 GB.

Versiones de bibliotecas fijadas en `pom.xml` y `scripts/requirements*.txt`.
El backend no necesita Node; el frontend React requiere Node 22 y pnpm 10.34.3.

## 2. Inicio local reproducible — H2 explícito

Desde la raíz del proyecto, con `java`, `keytool`, `mvn`, `python3` y `openssl` en `PATH`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt
mvn -B -ntp package
python3 scripts/setup.py --profile h2 --runtime .runtime
python3 scripts/run.py start
python3 scripts/seed.py --titles 100
```

El compilado `target/bec.jar` también está incluido. Para usarlo sin recompilar, omitir `mvn`, pero **no** la generación del runtime.

El gateway y la interfaz anterior están en **https://localhost:8443**; el React
se inicia aparte en **https://localhost:5173**, como explica su README.
Instalar como confiable la CA local **solo en un perfil de navegador de laboratorio**: `.runtime/setup/ca.crt`. No usar esa CA en producción. Las credenciales aleatorias se consultan **localmente** en `.runtime/demo-credentials.json`; nunca se incluyen en el ZIP, los informes ni los logs. `seed.py` activa dos lectores ficticios mediante la API del proveedor de correo de prueba.

Los diez procesos son independientes. Solo el gateway debe usarse desde el navegador. En ejecución local los puertos internos escuchan exclusivamente en `127.0.0.1`; un usuario del mismo host puede intentar conectarse, pero sin identidad técnica obtiene 403. El despliegue Oracle ya se ejecutó con redes Docker internas y solo el gateway publicado; las pruebas negativas completas de aislamiento se separan en ORA10.

```bash
python3 scripts/run.py status
curl --cacert .runtime/setup/ca.crt https://localhost:8443/api/health
curl --cacert .runtime/setup/ca.crt 'https://localhost:8443/api/catalog?size=10&q=historia'
python3 scripts/run.py stop
```

`stop` conserva datos y claves. `setup.py` **se niega a sobrescribir** un runtime existente. Para un laboratorio nuevo, elegir otro directorio y puertos; no borrar datos de una instalación utilizada. No ejecutar los perfiles local y Docker sobre los mismos archivos H2.

## 3. Pruebas

```bash
mvn -B -ntp test
```

26 pruebas JUnit: 21 de integración/seguridad/negocio/fallas y cinco unitarias.
Se generan certificados y siete BD H2 en archivo dentro de un runtime temporal exclusivo. Las pruebas HTTP/TLS arrancan diez listeners en una JVM de pruebas; el arranque anterior y las mediciones usan diez JVM independientes. El reloj simulado y los jobs manuales existen solo en las pruebas, no como endpoints de la aplicación.

Con backend H2 y React iniciados y sembrados, repetir `scripts/test_ui.py` del
frontend antes de recoger la evidencia. El colector rechaza fuentes modificadas
desde el E2E; las evidencias H2 previas al traslado no se cambian a mano:

```bash
python3 scripts/revision_react.py
```

Para Oracle usar el E2E con `--backend-artifact` del README React y después
`python3 scripts/verify_oracle.py`; no atribuirle el JAR ni los resultados H2.

Herramientas de la **línea base anterior** (sus generadores documentales y de
ZIP comprueban hashes de aquella versión; no mezclar evidencias):

```bash
pip install -r scripts/requirements-docs.txt
python3 -m playwright install chromium
python3 scripts/browser_test.py
python3 scripts/load.py --seconds 10 --concurrency 1 8 16
python3 scripts/evidence.py
python3 scripts/test_tools.py
python3 scripts/contracts.py
python3 scripts/build_docs.py
python3 scripts/verify_delivery.py
```

El E2E crea un título y dos ejemplares ficticios por ejecución; la carga registra el tamaño efectivo del catálogo. No ejecutar estos generadores contra datos reales. Playwright ignora únicamente la CA local del navegador; los clientes API y Java verifican el certificado.

## 4. Contenedores y Oracle

```bash
python3 scripts/deploy.py init --profile h2
python3 scripts/deploy.py config --profile h2
python3 scripts/deploy.py up --profile h2
python3 scripts/deploy.py ps --profile h2
python3 scripts/deploy.py down --profile h2
```

Oracle utiliza un **runtime distinto**:

```bash
python3 scripts/deploy.py init --profile oracle
python3 scripts/deploy.py up --profile oracle
```

`init` es **solo para un runtime nuevo**. Si `.runtime-docker-oracle` ya existe,
ejecutar únicamente `up`; no borrar el volumen ni regenerar las claves.
No hay que rellenar credenciales Oracle para este perfil local: los siete
usuarios se generan automáticamente. El acceso a la aplicación se consulta
localmente en `.runtime-docker-oracle/demo-credentials.json`.

No dar por aprobado todo Oracle al arrancar el contenedor. Completar el
[protocolo de aceptación](docs/validacion_oracle.md): TCPS negativo, permisos,
persistencia, jobs, fallas y flujos reales. `down` no elimina volúmenes.
`deploy/oracle/Dockerfile` deriva una base fijada por digest, añade OpenJDK 21
y una biblioteca Oracle PKI con SHA-256 verificado, manteniendo el usuario
`oracle` y la conexión TCPS.

`--no-lab` en `setup.py` oculta la bandeja de prueba, **no** instala un proveedor de correo real. El proyecto no está declarado listo para producción.

## 5. Estructura y operación

| Ruta | Contenido |
|---|---|
| `src/main/java/cl/bec/` | Transporte seguro, gateway, servicios, dominio, repositorio y adaptadores |
| `src/main/resources/schema.graphqls` | Esquema real del BFF privado |
| `src/test/java/cl/bec/` | Pruebas automáticas |
| `web/` | Interfaz y ayuda, sin credenciales ni dependencias CDN |
| `db/oracle/` | Migración V001 y procedimientos V002 |
| `compose*.yaml`, `deploy/` | Despliegue por proceso/contenedor y TCPS Oracle |
| `scripts/` | Setup, arranque, seed, carga, E2E, contratos, evidencias y documentación |
| `docs/`, `evidencias/` | Informe, anexos, decisiones, capturas y resultados verificables |
| `.runtime/` | **Privado; generado, no distribuido**: BD, claves, certificados, credenciales y logs |

Respaldo, revocación, rotación offline, clasificación y límites: [`docs/seguridad_operacion.md`](docs/seguridad_operacion.md). Logs estructurados contienen servicio, verbo, estado, duración y correlación, no cuerpos ni contraseñas. `/health` indica vida del proceso, no disponibilidad de todas las dependencias.

El ZIP original se generó con `scripts/package.py` y se conserva sin sobrescribir.
Ese generador exige las evidencias coincidentes de la entrega original. Los
cambios React actuales están aplicados en las dos carpetas indicadas al inicio;
no se incluyen automáticamente en aquel ZIP.
