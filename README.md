# Biblioteca BEC — workspace WWW

Las dos aplicaciones son carpetas hermanas; `WWW` puede estar en cualquier
disco/directorio. No hay que conservar `E:\` ni `/mnt/e/`.

```text
WWW/
├── Biblioteca en React/     # React, Vite y configuración del proxy HTTPS
├── entrega_caso16/          # Backend Java, gateway, Oracle y documentación
└── .pnpm-store/             # Caché local; NO subir a GitHub
```

## Iniciar una instalación existente

Desde `WWW`, en Linux/WSL con Docker Desktop integrado:

```bash
python3 entrega_caso16/scripts/deploy.py up --profile oracle
python3 entrega_caso16/scripts/deploy.py ps --profile oracle
```

En otra terminal, desde `WWW`, usando Node/pnpm del mismo sistema operativo:

```bash
pnpm --dir "Biblioteca en React" install --frozen-lockfile
pnpm --dir "Biblioteca en React" dev
```

En este equipo se reparó la instalación con **Node de Windows**; iniciar el
frontend desde **PowerShell o CMD**. No ejecutar esa misma instalación con
Node de Linux/WSL sin reinstalar las dependencias para Linux.

Abrir **https://localhost:5173**. El gateway está en **https://localhost:8443**.
Vite encuentra el runtime hermano por defecto; `.env.local` permite cambiarlo.
Las rutas `BEC_RUNTIME` y `BEC_CA_CERT` relativas se interpretan **desde la carpeta
React**, independientemente de la terminal.

No repetir `init` ni `seed` si ya existen el runtime y los datos. Las credenciales
de aplicación se consultan **privadamente** en
`entrega_caso16/.runtime-docker-oracle/demo-credentials.json`.
No se introducen credenciales de Oracle en React.

## Después de mover la carpeta o cambiar de sistema

`.npmrc` del frontend mantiene la caché en `WWW/.pnpm-store`. Los enlaces generados
de `node_modules` pueden apuntar a la ubicación anterior: reinstalar con pnpm
del mismo sistema en que se ejecutará Node:

```bash
pnpm --dir "Biblioteca en React" install --force --frozen-lockfile
```

No compartir la misma instalación `node_modules` entre Windows y WSL/Linux.
No editar a mano `.modules.yaml` ni mover o borrar la caché para corregir enlaces.
Node 22.12+ compatible (o 24) y pnpm 10.34.3.
Durante este traslado se conservó la instalación anterior en
`.pnpm-store/relocation-backups/` y se reinstaló con pnpm de Windows,
reutilizando la caché, sin modificar el lockfile.

## Clonar en otro equipo

El clon no incluye las claves ni los datos del equipo original. En un entorno
nuevo, instalar los requisitos del [backend](entrega_caso16/README.md), las
dependencias Python y ejecutar desde `WWW`:

```bash
python3 entrega_caso16/scripts/deploy.py init --profile oracle
python3 entrega_caso16/scripts/deploy.py up --profile oracle
python3 entrega_caso16/scripts/seed.py --runtime entrega_caso16/.runtime-docker-oracle --titles 12
pnpm --dir "Biblioteca en React" install --frozen-lockfile
pnpm --dir "Biblioteca en React" dev
```

`init` y `seed` son solo para una instalación **nueva**. Confiar en la CA pública
local de ese runtime para el navegador de laboratorio; nunca distribuir su clave
privada. Oracle guarda los datos en un volumen Docker: mover o clonar el código
no copia automáticamente ese volumen. No usar `down -v` para resolver rutas.

## Comprobar las rutas y el frontend

```bash
pnpm --dir "Biblioteca en React" test:paths
pnpm --dir "Biblioteca en React" typecheck
pnpm --dir "Biblioteca en React" build
python3 entrega_caso16/scripts/verify_oracle.py
```

El último comando requiere Oracle activo y evidencia E2E del React actual;
no reemplaza las pruebas de navegador. Véase el
[README de React](<Biblioteca en React/README.md>) para repetirlas.

### Verificación del traslado, 22-11-2026

- Seis pruebas de rutas correctas en Node de Windows y Linux.
- TypeScript y compilación React correctos en la carpeta real de Windows,
  incluidos `pnpm --dir` y Vite ejecutado con la terminal en `WWW`.
- 26 pruebas backend correctas en H2 de archivo; no se presentan como Oracle.
- 25 comprobaciones React repetidas contra Oracle, sin errores JavaScript.
  [Evidencia actual](<Biblioteca en React/evidencias-oracle/react.json>) y
  [contraste de Oracle](entrega_caso16/evidencias/oracle/arranque.json).
- Caché pnpm en `WWW`, enlaces reparados, lockfile sin cambios y exclusiones
  Git comprobadas sin inicializar el repositorio de este workspace.

## Subir a GitHub

Usar `WWW` como raíz del repositorio. Los `.gitignore` excluyen `.pnpm-store`,
`node_modules`, `dist`, `target`, `.env.local`, `.runtime*`, claves, BD y logs.
Subir `.env.example`, `.npmrc`, `pnpm-lock.yaml`, código, migraciones, configuración
y documentación. No subir secretos ni el volumen Oracle.

Antes de publicar, revisar `git status` y `git diff --cached`. `.gitignore` no
retira archivos que ya estén versionados. No se ha inicializado ni publicado
un repositorio automáticamente.

Los PDF, ZIP y evidencias históricas anteriores conservan sus versiones; no son
una certificación de nuevas ejecuciones. Correo, biometría y salida física
siguen siendo adaptadores TEST; el proyecto no se declara listo para producción.
