# Biblioteca BEC — React de Figma conectado al backend

Este es el frontend de los compañeros, **no una sustitución por la interfaz anterior**.
Se conservan el diseño gris/blanco, la navegación, las portadas, los recursos y los
plugins de Figma. La colección, el acceso y las solicitudes ahora usan HTTP real;
se retiraron las filas y confirmaciones ficticias.

## Ubicación portable

```text
WWW/
├── Biblioteca en React/
├── entrega_caso16/
└── .pnpm-store/             # Caché local, ignorada por Git
```

Las rutas se calculan desde `vite.config.ts`, no desde el disco ni desde la
terminal. `.env.local` se carga desde este proyecto; los valores relativos de
`BEC_RUNTIME` y `BEC_CA_CERT` también se resuelven desde aquí. El valor por
defecto es `../entrega_caso16/.runtime-docker-oracle`.

Desde `WWW` se puede ejecutar `pnpm --dir "Biblioteca en React" dev`.
`.npmrc` mantiene la caché en `../.pnpm-store`. Si se mueve nuevamente todo
`WWW`, regenerar los enlaces con `pnpm install --force --frozen-lockfile`
desde el frontend, usando pnpm/Node del mismo sistema operativo.
Véase el [README del workspace](../README.md) para GitHub y un clon nuevo.

## Cambios solicitados

- En **Añadir / Editar documento → Tipo de documento → Multimedia** aparecen
  **Tipo de multimedia: Audio / Video** y **Formato: CD, Casete, DVD, Blu-ray, Digital**.
  Ambos son obligatorios. Al volver a Libro se ocultan y el backend recibe `BOOK/PAPER`.
- **Editar** carga el documento seleccionado por su ID, no un formulario genérico.
- **Eliminar de colección** abre una confirmación con el título. Cancelar o Escape
  no envían `DELETE`. Solo confirmar hace la petición.
- Después de alta, edición o eliminación, aparece una ventana de éxito **solo si
  el backend confirmó la operación**. Un error se muestra como error, no como éxito.
- **Colecciones** tiene filtros combinables por título, autor, tipo de documento,
  editorial, disponibilidad y subcategoría, además de búsqueda y limpiar filtros.
  Se filtra en el servidor **antes de paginar**, no solo las diez filas visibles.
- Stock = ejemplares no retirados. No se pueden retirar prestados, retenidos,
  reservados ni en reposición. Alta/edición y ajuste de stock son una transacción.
- Sesión real por rol, sin contraseñas de ejemplo en el código ni tokens persistidos.

`Multimedia` se guarda como `AUDIO` o `VIDEO`; `Digital` como `DIGITAL`;
`Subcategoría` corresponde a `category`. Digital describe el soporte del ejemplar
gestionado; **no implementa descarga de archivos ni licencias de streaming**.
La eliminación es baja lógica: conserva el historial.

## 1. Ejecutar con el laboratorio H2 existente

Requisitos: Node.js 22, pnpm 10.34.3, backend Java 21 y las dependencias del
[backend](../entrega_caso16/README.md). Usa Node/pnpm del mismo sistema;
no mezcles `node_modules` de Windows con ejecutables Linux.

Desde `WWW`, en WSL, iniciar el backend H2 solo si Oracle no ocupa el puerto 8443:

```bash
cd entrega_caso16
# Solo si no hay runtime: python3 scripts/setup.py --profile h2
# Nunca vuelvas a generar un runtime que ya contiene datos.
python3 scripts/run.py start
```

Si recompilas Java, detén antes sus procesos (`python3 scripts/run.py stop`),
ejecuta `mvn -B -ntp package` y vuelve a iniciar. El JDK debe ser 21.
Si faltan datos de demostración, ejecuta una sola vez:

```bash
python3 scripts/seed.py --titles 12
```

Después, en otra terminal desde `WWW`:

```bash
cd "Biblioteca en React"
pnpm install --frozen-lockfile
# Crear .env.local desde .env.example SOLO si aún no existe.
# Para este perfil H2, establecer BEC_RUNTIME=../entrega_caso16/.runtime.
pnpm typecheck
pnpm dev
```

Si ya tienes `.env.local`, **edítalo en lugar de reemplazarlo**.
Abre **https://localhost:5173**. El gateway sigue en **https://localhost:8443**.
En Windows puedes ejecutar los comandos pnpm desde `WWW\Biblioteca en React`;
los comandos Python/Docker de este documento están escritos para WSL.

Para usar un build:

```bash
pnpm build
pnpm preview
```

Vite/preview usa el certificado local del gateway **solo para el laboratorio**.
El navegador debe confiar en la CA pública `runtime/setup/ca.crt`; no distribuyas
`ca.key`, `server.p12`, `bootstrap.json` ni todo el runtime. El proxy también
verifica la CA del backend: no usa `secure: false`. En un despliegue real, sirve
`dist/` con un servidor HTTPS y reverse proxy `/api` hacia el gateway, con
certificados y claves propios; `vite preview` no es un servidor de producción.

Para ingresar como bibliotecario consulta **privadamente**
`../entrega_caso16/.runtime/demo-credentials.json`, entrada `bibliotecario`.
No grabes ni publiques ese archivo. La sesión se borra al recargar; los
documentos permanecen en la base de datos.

## 2. Integrarlo con Oracle

### Arquitectura correcta

```text
Navegador React (HTTPS :5173)
  → proxy /api de Vite o reverse proxy HTTPS
  → API Gateway Java (HTTPS :8443)
  → microservicios privados
  → JDBC por TCPS :2484
  → Oracle FREEPDB1, un esquema por servicio
```

**React no abre conexiones SQL ni lleva usuario/contraseña de Oracle.**
No hay que instalar un driver Oracle en React. El driver JDBC ya está en el
backend; cambiar de base de datos no cambia las llamadas `fetch("/api/...")`.

### A. Habilitar Docker en WSL

En Docker Desktop: **Settings → Resources → WSL Integration**, habilita tu
distribución y aplica. Usa contenedores Linux. En WSL comprueba:

```bash
docker version
docker compose version
java -version
```

`docker version` debe mostrar **Client y Server**, no solo un ejecutable.
Reserva al menos 6 GB para Oracle y los servicios. Instala las dependencias
Python del backend en un entorno virtual, como explica su README.

### B. Crear el entorno Oracle separado e iniciar

Desde `WWW` en una terminal nueva:

```bash
cd entrega_caso16
python3 scripts/run.py stop
python3 scripts/deploy.py init --profile oracle
python3 scripts/deploy.py up --profile oracle
python3 scripts/deploy.py ps --profile oracle
```

- `init` se ejecuta **una vez**: genera `.runtime-docker-oracle` con identidades,
  contraseñas aleatorias, certificados y SQL de inicialización.
- `up` construye el backend y la imagen Oracle con Java 21/Oracle PKI, tablas y
  procedimientos. La etiqueta base fijada resolvió Oracle AI Database 26ai Free,
  versión 23.26.4.0.0.
- Se crean `BEC_AUTH`, `BEC_CLIENTS`, `BEC_INVENTORY`, `BEC_ORDERS`,
  `BEC_PAYMENTS`, `BEC_NOTIFICATIONS`, `BEC_MAIL`; cada servicio solo accede al suyo.
- El gateway es el único backend publicado al host. Oracle permanece privado.
- Si el runtime ya existe, no repitas `init`; conserva el mismo runtime junto
  con su volumen Oracle. El hook puede completar el bootstrap pendiente o
  reparar V002, pero no recrea usuarios existentes ni restablece contraseñas.
- **Los datos H2 no se migran automáticamente**. Es otro entorno/base.
  No borres un volumen existente para forzar la inicialización.

Comprobar el camino real gateway → inventario → BD:

```bash
curl --cacert .runtime-docker-oracle/setup/ca.crt \
  "https://localhost:8443/api/catalog?size=1"
```

Un catálogo vacío con HTTP 200 es correcto antes de cargar datos. Un `health`
del gateway por sí solo no prueba que Oracle funcione.

### C. Cargar datos ficticios e indicar a Vite el runtime Oracle

```bash
python3 scripts/seed.py --runtime .runtime-docker-oracle --titles 12
```

Edita `WWW/Biblioteca en React/.env.local`:

```dotenv
BEC_RUNTIME=../entrega_caso16/.runtime-docker-oracle
BEC_BACKEND_URL=https://localhost:8443
```

Detén Vite con Ctrl+C y vuelve a ejecutar `pnpm dev`. Confía en la **nueva CA**
de `.runtime-docker-oracle/setup/ca.crt` e ingresa con las credenciales de
`.runtime-docker-oracle/demo-credentials.json`, no las de H2.

Las variables `BEC_*` las lee exclusivamente Vite/Node para su proxy y TLS;
no se incluyen en el JavaScript entregado al navegador. No crees variables
`VITE_DB_PASSWORD`, `VITE_ORACLE_USER` ni equivalentes.

### D. Verificar que el alta quedó realmente en Oracle

Crea un documento con un título ficticio reconocible en React y conserva el ID
de la respuesta `POST /api/documents` en Network. Desde el backend, solo como
operador de la instalación:

```bash
export BEC_RUNTIME="$PWD/.runtime-docker-oracle"
export BEC_UID="$(id -u)"
export BEC_GID="$(id -g)"
docker compose -f compose.yaml -f compose.oracle.yaml exec oracle sqlplus / as sysdba
```

Dentro de SQL*Plus:

```sql
ALTER SESSION SET CONTAINER = FREEPDB1;

SELECT owner, object_name, status
  FROM dba_objects
 WHERE owner IN ('BEC_INVENTORY','BEC_ORDERS')
   AND object_type = 'PROCEDURE';

SELECT id,
       JSON_VALUE(payload, '$.title') AS titulo,
       JSON_VALUE(payload, '$.type') AS tipo,
       JSON_VALUE(payload, '$.medium') AS formato,
       JSON_VALUE(payload, '$.description') AS descripcion
  FROM BEC_INVENTORY.bec_records
 WHERE kind = 'DOCUMENT'
   AND id = 'd-REEMPLAZA-CON-EL-ID-REAL';

SELECT id, state, JSON_VALUE(payload, '$.documentId') AS documento
  FROM BEC_INVENTORY.bec_records
 WHERE kind = 'COPY'
   AND JSON_VALUE(payload, '$.documentId') = 'd-REEMPLAZA-CON-EL-ID-REAL';
```

Los procedimientos deben quedar `VALID`. Las nuevas propiedades `description`
y `DIGITAL` se guardan en el agregado JSON/CLOB; el stock se representa con
registros `COPY`. **Esta actualización no exige columnas nuevas**. No se crea
una tabla distinta por componente React.

La aplicación **nunca** usa SYS. Las consultas anteriores son de diagnóstico
del operador. Comprueba además edición, filtros, archivo y persistencia tras
reinicio, y completa el [protocolo Oracle ORA01–ORA12](../entrega_caso16/docs/validacion_oracle.md).

Para detener sin perder la BD:

```bash
python3 scripts/deploy.py down --profile oracle
```

No uses `down -v` sin respaldo y autorización.

### Estado real de Oracle

**Arranque y sembrado comprobados.** Docker/WSL ya está habilitado y la imagen
incluye Java/Oracle PKI. Se recuperó el volumen existente, sin borrar datos ni
cambiar claves: siete esquemas, ambos procedimientos `VALID`, catálogo vía
JDBC/TCPS y 12 títulos/24 ejemplares/dos lectores ficticios sembrados por API.
No hace falta introducir credenciales Oracle para este perfil local.
El [registro de recuperación](../entrega_caso16/docs/recuperacion_oracle.md)
separa las comprobaciones reales de la aceptación todavía pendiente.
También pasaron los **25 checks de este React contra Oracle**, sin errores
JavaScript; se guardan aparte en `evidencias-oracle/`, con el hash del JAR Docker.
Las evidencias H2 anteriores conservan su perfil.
Si ya tienes una instalación Oracle externa, hace falta adaptar host, puerto
TCPS, nombre de servicio, CA/DN y secretos de cada servicio con su administrador;
no basta con cambiar `.env.local`.

## 3. Pruebas reproducibles

Backend, desde `WWW`:

```bash
cd entrega_caso16
mvn -B -ntp test
```

React, en otra terminal desde `WWW`:

```bash
cd "Biblioteca en React"
pnpm test:paths
pnpm typecheck
pnpm build
# En un entorno Python de pruebas:
pip install playwright==1.55.0
python -m playwright install chromium
python scripts/test_ui.py --runtime ../entrega_caso16/.runtime
```

El último comando requiere el backend iniciado y sembrado y React sirviendo en
`https://localhost:5173`. Comprueba los HTTP reales, recarga, multimedia, los seis
filtros, confirmación/cancelación, errores de negocio sin falso éxito y móvil.
Solo archiva los documentos ficticios que crea; no borra la colección existente.
El navegador automatizado acepta el certificado local; API y proxy verifican la CA.
Los resultados nuevos se guardan en `evidencias/react.json` con el hash del JAR
y de las fuentes React; no deben confundirse con las evidencias del frontend anterior.

Para probar Oracle sin atribuirle por error el hash del JAR local H2, desde la
raíz del backend copiar primero el artefacto realmente desplegado:

```bash
docker cp bec-caso16-inventory-1:/app/bec.jar /ruta/privada/bec-oracle-running.jar
```

Después, desde este frontend:

```bash
python scripts/test_ui.py \
  --runtime ../entrega_caso16/.runtime-docker-oracle \
  --backend-artifact /ruta/privada/bec-oracle-running.jar \
  --output evidencias-oracle
```

Vite también debe apuntar a ese runtime. No declares el perfil Oracle aprobado
solo por haber generado su configuración.

## Alcance de esta actualización

La gestión de colección usa este React. El frontend anterior del backend se
conserva como referencia para los otros trámites del caso (fichas, entrega con
identidad, devoluciones, morosidad, cuenta GraphQL, etc.); **esta corrección no
afirma que todos esos formularios se hayan migrado a React**. Aquí se conectaron
catálogo, login, solicitud de lector, cola de solicitudes y CRUD de documentos.
Correo, huella y dispositivo de salida mantienen las limitaciones TEST ya
documentadas; esta modificación no las convierte en integraciones físicas.
