# ADR-003 — Oracle objetivo y perfil H2 explícito de prueba

**Estado actual:** arranque, esquemas, PL/SQL, TCPS positivo y sembrado comprobados
en Oracle; aceptación completa pendiente. **Revisión:** 21-11-2026.

Después de habilitar Docker/WSL se añadió Java/Oracle PKI a una imagen derivada
con la misma base fijada por digest. Se recuperó la inicialización pendiente
sin eliminar el volumen ni cambiar las claves y se corrigieron los errores
PL/SQL reales de V002. Véanse [recuperación](../recuperacion_oracle.md) y
[aceptación por prueba](../validacion_oracle.md). Las pruebas y mediciones H2
anteriores no se reclasifican como Oracle.

## Decisión original, 19-11-2026

El caso exige Oracle y procesamiento automatizado mediante procedimientos almacenados. Se entregan JDBC Oracle, esquema V001 por dueño, procedimientos V002 de Inventory y Orders, bootstrap conectado como dueño real, wallet/TCPS y Compose específico. Los workers invocan esos SP cuando `Store.oracle=true`; los SP escriben estado/outbox y no intentan enviar HTTP desde PL/SQL.

En este WSL no funciona Docker ni existe un servidor Oracle accesible. No se ha ejecutado ninguna migración PL/SQL, wallet, listenerTCPS ni contenedor de Oracle. En lugar de fingir, las pruebas usan H2 **en archivo**, no memoria. Ese perfil ejecuta la lógica alternativa Java de mantenimiento y sí prueba persistencia, HTTP/TLS, reglas y sagas.

Alternativas: detener toda la entrega por falta de motor; sustituir Oracle sin decirlo; entregar Oracle como objetivo verificable y H2 claramente delimitado. Se elige la tercera. Consecuencia: el requisito Oracle está **PENDIENTE**, no aprobado por23tests H2. SQL JSON/PLSQL y TCPS deben corregirse si la validación de aceptación detecta diferencias reales.

Revisión obligatoria: ejecutar `docs/validacion_oracle.md` en Docker/Oracle funcional, archivar evidencia sin secretos y realizar recuperación sobre la base real. No reutilizar el runtime H2 como si fuera Oracle.
