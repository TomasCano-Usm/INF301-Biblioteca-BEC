# Actualización: frontend React de los compañeros

**Frontend actual:** `WWW/Biblioteca en React`.
**Backend actualizado:** `WWW/entrega_caso16`.
Ambos son hermanos en un `WWW` ubicado en cualquier disco/directorio.

La gestión de colección solicitada ya no utiliza los datos ficticios del prototipo
Figma. El React conserva su diseño y consume el gateway HTTPS. La interfaz
`web/` anterior se conserva como referencia para los demás trámites del caso,
que no se han migrado íntegramente a React.

## Cambios de esta revisión

| Petición | Implementación | Verificación |
|---|---|---|
| Multimedia en alta/edición | Selección obligatoria Audio/Video + CD/Casete/DVD/Blu-ray/Digital; guarda AUDIO/VIDEO y soporte real | T19; R05, R08–R10 |
| Editar el documento elegido | Carga por ID, incluida descripción y cantidad real de ejemplares | R07–R09 |
| Confirmar eliminación | Diálogo con título, Cancelar/Escape sin DELETE; baja lógica solo tras confirmar | R15–R17 |
| Mensajes de alta/edición/eliminación | Ventana de éxito únicamente después del HTTP satisfactorio; errores no se disfrazan de éxito | R06, R08, R10, R17–R19 |
| Seis filtros combinables | Título, autor, tipo, editorial, disponibilidad, subcategoría; servidor filtra antes de paginar | T20; R11–R14 |
| No corromper stock/historial | Crea/retira ejemplares reales; documento+stock atómicos; rechaza material en uso/reservado | T21; R18–R19 |
| Responsive y sesión | Móvil 390 px; bearer en memoria, no local/sessionStorage | R20–R22 |

`description` y `stock` son entradas opcionales nuevas de POST/PUT documentos;
omitirlas en PUT conserva descripción y ejemplares. Stock no es disponibilidad:
no se puede convertir desde el navegador una copia prestada en disponible.
El nuevo soporte `DIGITAL` es metadato, no una plataforma de descarga/streaming.
Los filtros textuales específicos no distinguen tildes ni mayúsculas.

Contratos actuales: [OpenAPI 1.1](openapi.json), [contratos Markdown](contratos.md)
y [JSON](contratos.json). No se agregaron rutas públicas ni credenciales al cliente.
La persistencia sigue siendo JSON/CLOB por agregado y ejemplares separados.

## Evidencia actual frente a la entrega anterior

- **26 pruebas backend, todas correctas:** [JSON saneado](../evidencias/react/pruebas_backend.json)
  y [JUnit sin stdout/secretos](../evidencias/react/junit-limpio.xml).
- **25 comprobaciones React H2 de aquella revisión:** `WWW/Biblioteca en React/evidencias/react.json`,
  capturas y registro de método/ruta/estado sin cabeceras privadas.
- `pnpm typecheck` y `pnpm build` correctos, con Node 22 / pnpm 10.34.3.
- Backend y prueba de navegador se identifican con el mismo SHA-256 del JAR.
- Las pruebas ejecutadas usan **H2 persistente**, no Oracle.
- **No se repitió carga para esta revisión.** `carga.json`, los 23 JUnit, las
  13 comprobaciones de la interfaz anterior y los PDF del informe principal
  documentan la versión anterior y conservan su hash. No son nueva evidencia
  de este React. El ZIP original no se ha sobrescrito.
- Los generadores `evidence.py`, `build_docs.py`, `verify_delivery.py` y
  `package.py` pertenecen a aquella entrega; sus controles de versión impiden
  mezclarlos directamente con esta revisión.

Para recoger y comprobar **esta** evidencia, después de las pruebas actuales:

```bash
python3 scripts/revision_react.py
```

El comando valida, no vuelve a ejecutar las pruebas ni certifica Oracle.

## Oracle

La guía completa está en [README de React](<../../Biblioteca en React/README.md>), sección 2:
Docker/WSL, entorno Oracle separado, proxy del React, CA, usuarios y verificación
SQL del documento y sus ejemplares.

**React → gateway Java → microservicios → JDBC/TCPS → Oracle.**
No se pone un driver ni usuario/clave Oracle en React. Los nuevos campos caben
en el JSON/CLOB existente y no exigen una columna por campo de pantalla.

El despliegue Oracle ya arrancó después de habilitar Docker/WSL y añadir
Java/Oracle PKI a la imagen. Se recuperaron los siete esquemas del volumen
existente, ambos procedimientos quedaron `VALID` y se comprobó el catálogo
y el sembrado mediante la API real. Véase [recuperación Oracle](recuperacion_oracle.md).
Se repitieron las **25 comprobaciones React contra Oracle**, sin errores
JavaScript, y se contrastó el hash del JAR Docker con esa evidencia:
[arranque Oracle](../evidencias/oracle/arranque.json).
Esto no transforma los 26 JUnit H2 ni su carga en evidencia Oracle; el
[protocolo ORA01–ORA12](validacion_oracle.md) distingue lo ejecutado de lo pendiente.
No hay migración automática de H2; se conserva cada entorno.
Correo/huella/salida siguen TEST.

## Traslado a WWW

Vite carga `.env.local` y resuelve runtime/CA desde su propia carpeta.
Los scripts encuentran al frontend/backend hermano sin rutas de una máquina
particular; el hash de fuentes también incluye `config/`.
`pnpm test:paths` cubre seis casos de rutas, directorio de trabajo, espacios
y TLS. `.npmrc` usa `WWW/.pnpm-store`, que no se versiona.

Los enlaces generados de `node_modules` sí pueden requerir reinstalación tras
otro traslado o cambio Windows/WSL. No mover ni regenerar el runtime Oracle
para corregir rutas del frontend. Las evidencias H2 anteriores conservan su
hash; para una validación nueva debe repetirse el E2E correspondiente.
