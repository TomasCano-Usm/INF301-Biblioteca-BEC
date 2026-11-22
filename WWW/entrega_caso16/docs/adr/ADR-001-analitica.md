# ADR-001 — No incorporar una plataforma analítica separada

**Estado:** aceptada provisionalmente para el prototipo; revisar tras validación municipal y Oracle. **Fecha:** 19-11-2026.

## Contexto y conductor

RF13/RF14 requieren morosidad actual de sala/domicilio para actuar sobre devoluciones. No solicitan minería histórica, modelos predictivos, consultas multidimensionales, retención masiva ni una bodega de datos. La municipalidad es interesada, no un rol con acceso implícito a RUN e historial. Introducir analítica por el solo nombre de una rúbrica aumentaría exposición y duplicación de datos.

## Incertidumbre y spike

Pregunta: ¿el catálogo y el resumen operativo agregado requieren ya un almacén analítico para alcanzar una latencia académica razonable? Se implementó REST sobre datos operacionales y GraphQL sobre cuatro subsistemas; se midieron concurrencias1/8/16,10s por escenario, con CA real verificada,10 JVM y H2 en archivo. `evidencias/carga.json` contiene dataset, p50/p95, tasa, errores, CPU/RSS y entorno; el informe reproduce los valores.

La proyección inicial, **no medida ni extraída del caso**, es 500lectores activos,10000títulos/30000copias,1000préstamos/día,16usuarios concurrentes de catálogo y8de cuenta,20consultas/s de catálogo y2de cuenta. Se propone p95<1s para cuenta y<300ms para catálogo como umbral de revisión, no como SLA contratado.

## Alternativas

| Alternativa | Valor | Costo/riesgo |
|---|---|---|
| Consulta operacional acotada + BFF GraphQL | Resuelve vistas presentes sin duplicar bases | Escaneos de agregados, no diseñada para millones de filas |
| Tabla/proyección materializada de morosidad | Reduce costo repetido si se demuestra cuello de botella | Frescura y reconciliación adicionales |
| Data warehouse/ETL + dashboards | Adecuada para análisis histórico autorizado | Sin requerimiento actual; nuevas copias de datos personales, gobierno y costo |

## Decisión y consecuencias

Se elige la primera. `/overdue` es consulta operacional, **no se la presenta como plataforma analítica**. No se implementa microservicio analítico decorativo. La falta de analítica se justifica, no se esconde. La prueba de carga no mide una bodega ni demuestra comportamiento en10000títulos: solo da evidencia inicial sobre el dataset realmente registrado.

Revisar si se requiere historia agregada anonimizada municipal, cruces mensuales, >100000registros operacionales, p95 de reportes>1s sostenido o ventanas de consulta que perjudiquen préstamos. Antes, paginar/filtrar en SQL, medir Oracle y definir minimización/retención.
