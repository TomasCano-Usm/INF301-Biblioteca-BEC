# ADR-004 — Gratuidad, sanción de tiempo y decisiones de negocio explícitas

**Estado:** adaptación justificada de la rúbrica; política temporal propuesta pendiente de aprobación de biblioteca.

La rúbrica solicita un servicio de pagos. Caso16 exige sanción **en tiempo**, no multas, precios de materiales ni pasarela de cobro. Inventar dinero para “mostrar una integración” contradice el dominio.

Se implementa Payments como límite real, persistente e independiente: política MUNICIPAL_FREE, una evaluación EXEMPT/0CLP por préstamo, lectura autorizada, contrato interno idempotente y rechazo422 de toda intención monetaria del frontend. GraphQL lo integra y la saga de entrega recupera su caída. No hay proveedor bancario, webhook ni transacción económica simulada. Un supuesto pago no puede levantar una sanción.

Reglas que el caso no cuantifica y se adoptan explícitamente:

- Cada documento tiene homeDays1–30 y roomHours1–8; sala termina como máximo a23:59:59.999999999 del mismo día en Santiago.
- Retención de solicitud20min; reserva específica hasta90d; máximo5copias por solicitud.
- Atraso: un día de bloqueo por día/fracción de atraso, máximo30d, contado desde devolución. Varias devoluciones consolidan el mayor vencimiento, no cobran ni suman multas. Devolución exactamente al vencimiento no sanciona.
- Material devuelto disponible tras30min exactos, como exige el caso, no una política inventada.
- Un préstamo no puede invadir una reserva de otro lector. La reserva propia de hoy puede consumirse al entregar; una reserva no es entrega ni permite salida.

Estas decisiones están probadas, pero la biblioteca debe aprobar valores antes del uso real. Si la evaluación exige una pasarela monetaria a pesar del caso, debe acordarse un caso de uso adicional explícito; no se afirma haberlo cumplido clandestinamente.
