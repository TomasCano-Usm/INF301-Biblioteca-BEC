# ADR-002 — REST interno; gRPC no aplicable aún

**Estado:** aceptada provisionalmente. **Fecha:** 19-11-2026.

## Contexto, volumen y exigencia

Los mensajes son comandos pequeños y consultas paginadas, sin streaming, audio/video transmitido, telemetría de alta frecuencia ni exigencia de microsegundos. El soporte CD/DVD es información catalográfica: no se transmiten archivos audiovisuales. La concurrencia/volumen proyectados se declaran en ADR-001; no hay cifra impuesta por el caso. Una inscripción puede llevar foto de128000bytes, pero no es un canal intensivo continuo.

Incertidumbre: ¿sería imprescindible un transporte binario interno para la latencia de las vistas solicitadas? El spike mide la alternativa realmente implementada (REST interno TLS y agregación GraphQL) con mensajes de respuesta y p95 registrados en `evidencias/carga.json`. No hay implementación gRPC, `.proto` ficticio ni comparación experimental que no se hizo.

## Alternativas y decisión

1. REST/JSON con HTTPS y claves dirigidas: contratos inspeccionables, herramientas simples, suficiente evidencia inicial.
2. gRPC/Protobuf unary: tipado y serialización más compacta, pero nuevos contratos/generación/proxy y política de identidad que no eliminan el costo de BD ni autorizaciones.
3. gRPC streaming: sin flujo de dominio que lo justifique hoy.

Se elige1. A16concurrentes, el baseline final del informe muestra cero errores en el período medido, pero un resumen más lento que un catálogo (hace más trabajo). Esto no prueba que REST sea más rápido que gRPC ni que la carga real municipal esté cubierta. CPU y RSS no son despreciables para diez JVM; optimizar escaneos/batching/round trips precede cambiar protocolo.

## Revisión y prueba futura

Reabrir con >100RPC/s sostenidas en una arista, mensajes >256KiB que deban rediseñarse, necesidad real de streaming o perfil que atribuya >30% del presupuesto a serialización/transporte. Entonces implementar spike comparativo sobre igual dataset/operación/concurrencia/duración, mTLS o token de servicio con audiencia, autorización por método y recursos, deadlines/backpressure y revocación; decidir con p95/CPU/RSS medidos. Esas son condiciones futuras, no funciones entregadas.
