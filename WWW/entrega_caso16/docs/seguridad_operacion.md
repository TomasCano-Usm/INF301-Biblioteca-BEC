# Anexo C — Seguridad, secretos y operación

## Activos y fronteras

La clave del usuario prueba su identidad ante Auth. La sesión opaca prueba una sesión vigente ante el gateway. La clave dirigida `K_A_B` prueba que la llamada fue emitida por A hacia B. Ninguna reemplaza las otras. Una firma técnica válida no concede automáticamente el rol o el recurso solicitado.

La red privada impide exposición de puertos en Compose; HTTPS protege transporte; HMAC autentica llamadas y liga cuerpo/principal; cada backend impone caller+rol+propiedad+estado. Son controles complementarios. El servidor de secretos es una implementación académica propia, **no HashiCorp Vault** ni un KMS certificado. Su raíz se protege por permisos y montaje exclusivo. Un administrador del host conserva poder sobre procesos y memoria: no se afirma aislamiento ante root.

## Inventario simbólico y ciclo de vida

Nunca sustituir estos nombres por valores reales en el informe.

| Secreto | Emisor / consumidor | Finalidad y almacenamiento | Alcance | Rotación / revocación |
|---|---|---|---|---|
| USER_PASSWORD | Usuario/administrativo → Auth | Solo TLS; PBKDF2-HMAC-SHA256 600000, sal aleatoria16bytes; no se descifra | Una cuenta | Reset administrativo futuro: no implementado como endpoint; alta de personal inicial controlada |
| SESSION_TOKEN | Auth → navegador | 32bytes aleatorios, base64url43; solo memoria JS; SHA256 en Auth | Un usuario/rol,20min | Logout revoca; expiración server-side; no refresh token |
| ACTIVATION_TOKEN | Auth → proveedor TEST → lector | SHA256 para validar; copia AES-GCM mientras está pendiente; enlace un uso24h | Activar una cuenta | Reenvío ADMIN invalida enlace anterior; activación consume; tests T03/T18 |
| BOOTSTRAP_SVC | setup → un proceso | `svc/bootstrap.json`,0600, montaje propio; SHA256 en ACL del manager | GET solo propio paquete | Revocar hash en manager y reiniciarlo; reemplazar token del consumidor y reiniciarlo |
| K_SOURCE_TARGET | setup → SOURCE y TARGET | Paquetes AES-GCM bajo manager; caché5s en cada proceso | Una arista dirigida; firma verbo/URI/cuerpo/principal/tiempo/nonce | Rotación offline coordinada de ambos paquetes; reiniciar consumidores; retirar clave anterior sin período dual en esta versión |
| DATA_KEY_SVC | setup → dueño del dato | AES256GCM para perfil/correo/tokens en reposo; clave fuera de la base | Un servicio | **No reemplazar sin migrar**: requiere reencrypt de datos; runbook futuro con versionado/KMS |
| BIOMETRIC_KEY_CLIENTS | setup → Clients | HMAC de muestra determinista TEST, dentro de perfil AES-GCM | Solo prueba de huella de ese servicio | Reinscripción controlada/versión del adaptador; no es algoritmo biométrico real |
| DB_PASSWORD_SVC | setup / Oracle → dueño | Paquete privado; 7 credenciales, sin compartir esquemas | Solo su esquema, CREATE SESSION/TABLE/PROCEDURE sin grants cruzados | ALTER USER por operador+actualizar paquete+reiniciar dueño; validar sin perder datos |
| TLS_KEY_SVC / TLS_PASSWORD | CA local / setup → propio proceso | PKCS12 privado0600 + truststore CA; validez365d | Certificado SAN del servicio,localhost,loopback | Reemitir antes de vencimiento; cambiar PKCS12+password y reiniciar; en real usar CA municipal |
| MANAGER_MASTER_KEY | setup → secrets exclusivamente | Bootstrap raíz0600; cifra paquetes privados; no lo monta gateway | Desencriptar bundles del manager | Migración offline reencrypt de todos los bundles; respaldo separado cifrado |
| ORACLE_SYS_PASSWORD | Imagen Oracle → operador de BD | `ORACLE_RANDOM_PASSWORD=true`: la imagen genera la clave y puede mostrarla en logs privados de inicialización; nunca se entrega a una aplicación | Administración de BD; bootstrap local por autenticación del SO | Custodiar y cambiar por operador; no publicar logs ni `01-bec.sql`, que contiene las claves de los siete esquemas |

Las aristas existentes se definen en `scripts/setup.py:EDGES`; el resto no recibe llave, por tanto falla cerrado. El gateway no tiene llaves para firmar como Orders ni el token raíz del manager. Se generan algunos campos genéricos no usados en los bundles de gateway/GraphQL; no conceden bases reales ni permisos Oracle a esos procesos.

**Rotación disponible:** `scripts/rotate.py` permite renovar una arista HMAC o un bootstrap en runtime detenido, sin imprimir secretos ni tocar claves de datos. Cuatro pruebas auxiliares (`python3 scripts/test_tools.py`) verifican ambos extremos, ACL, permisos y rechazo de procesos activos/aristas no autorizadas, con claves ficticias. No se ha ensayado una rotación en Oracle. El procedimiento de `DATA_KEY`/raíz/certificados es requisito operacional pendiente, no automatización falsamente implementada.

## Datos y retención efectiva

| Clase | Ejemplos | Protección efectiva | Retención implementada / pendiente |
|---|---|---|---|
| Pública | título,autor,categoría,soporte,disponibles,en sala | DTO explícito; no dueño; TLS | Catálogo hasta archivo lógico |
| Personal restringida | RUN,dirección,email,teléfono,foto | Perfil AES256-GCM; DTO según rol; búsqueda RUN/email por HMAC; no logs | No purga de fichas implementada; política municipal y consentimiento pendientes |
| Biométrica de prueba | muestra determinista | No se guarda muestra cruda: HMAC separado y perfil cifrado; solo comparación test | Hasta baja/reinscripción controlada futura; nunca usar huellas reales en este prototipo |
| Contextual privada | préstamos,reservas,sanciones,ownerId,preferencias inferibles | Propiedad+rol en backend, TLS; BD/archivo privado | Historial persistente sin borrado automático; retención institucional pendiente |
| Credencial | password,token,claves técnicas | Hash adaptativo o SHA256 según entropía; secretos separados; TLS | Sesiones se purgan >1día tras vencimiento; enlaces24h, reemplazables |
| Correo TEST | enlace/destinatario/comprobante | Evento/correo AES-GCM; bandeja soloADMIN/lab | Mail elimina mensajes >7d; Notifications borra cipher al marcar DELIVERED |
| Registros técnicos | servicio,verbo,estado,duración,correlationId | No cuerpos, query, emails,claves ni RUN; acceso al runtime | No logrotate automático; propuesta30d con herramienta de plataforma |

No se afirma cifrado de disco total: las bases H2 y el historial contextual no usan TDE propio. Antes de datos reales, cifrar volúmenes/backups y validar TDE de Oracle según licencia/entorno. El AES de perfiles sí está implementado y probado. La extracción de datos por root o una copia completa de runtime con su master key sigue siendo un riesgo.

## Cliente y sesiones

- **Sí** maneja la contraseña introducida hasta el POST de login/inscripción, el token de sesión en memoria y, al abrir el enlace, el token de activación. **No** recibe secretos de base, Vault/manager, claves HMAC ni llaves AES.
- No localStorage, sessionStorage, cookies persistentes ni token en URL de sesión. El enlace de activación se retira inmediatamente con `history.replaceState`; `Referrer-Policy:no-referrer`.
- Idle del quiosco5min: limpia memoria/interfaz y solicita logout; máxima sesión server20min aun si el JS se manipula. No se renueva automáticamente.
- XSS: escape de texto, CSP self sin scripts inline, sin dependencias de CDN. CORS no se abre a dominios arbitrarios. Sin cookies de autenticación, no se depende de un token CSRF basado en sesión de cookie.
- Dispositivos y proveedor: únicamente adaptadores TEST. `--no-lab` oculta bandeja, **no** convierte mail en entrega real.

## Riesgos y aceptación antes de producción

1. Oracle/PLSQL/TCPS, redes Compose y restauración Oracle no ejecutados en este equipo.
2. Sin proveedor de correo externo ni lector biométrico/RFID; contratos test no son acreditación física.
3. Sin reset de contraseñas ni gestión dinámica de personal/roles; cuentas iniciales solo setup seguro.
4. Sin eliminación/anonimización institucional ni migración rotativa de llaves de datos; no cargar datos reales.
5. Rate limit y cache de nonces son por proceso; para réplicas, usar almacén distribuido y coordinación. El alcance medido es una instancia de cada servicio.
6. La firma HMAC autentica servicio pero no mTLS; TLS verifica servidor. Evolución a mTLS/OIDC según requerimientos municipales.
7. Escaneos de agregados limitados a20000 registros y trabajadores simples no son solución de alta escala; indexar/paginar en BD y medir antes de escalar.
8. Los logs de respuesta llevan correlación; algunos trabajos de reconciliación generan un nuevo ID y no conservan una traza distribuida causal completa. El ID de solicitud/préstamo/evento persistido permite investigar la saga.

## Respaldo y restauración local

Detener con `python3 scripts/run.py stop`. Hacer copia cifrada de TODO el runtime (las 7 bases, secretos, CA/truststores y perfil), separando custodia de la clave de respaldo. Restaurar en una carpeta aislada con permisos0700/0600, ajustar rutas absolutas H2/webRoot si cambió la ruta, iniciar y ejecutar smoke/E2E. No respaldar solo `.mv.db`: sin `DATA_KEY` no se recupera el perfil cifrado. No entregar ese respaldo al docente ni incluirlo en ZIP.

Para Oracle: RMAN/export por esquema y secretos bajo custodia separada; ensayar recuperación y SP sobre una instancia de prueba. Es un procedimiento propuesto, no una recuperación medida. `deploy.py down` conserva el volumen; no usar `down -v` si se quieren preservar los datos.
