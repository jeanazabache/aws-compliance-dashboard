# Requisitos — Auditoría de Fluent Bit en servicios ECS

## Introducción

Nueva auditoría (`UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit`) que recorre todos los
clusters de Amazon ECS de la cuenta donde se ejecuta e identifica qué servicios
tienen, en la definición de tarea (task definition) que están corriendo, un
contenedor de Fluent Bit (típicamente llamado `agent-fluentbit`). El objetivo es
verificar el cumplimiento del estándar de observabilidad: todo servicio ECS debe
enviar sus logs mediante el sidecar de Fluent Bit.

El Lambda se despliega en las 3 cuentas (DEV, QA, PRD), escribe sus reportes al
bucket S3 central con prefijo por `account_id`, y el dashboard lo muestra como un
tab nuevo. La ejecución es **cada 4 horas** (no diaria), por lo que la duración del
escaneo no es una restricción crítica.

Este documento define el comportamiento esperado del Lambda y su integración con el
dashboard. El detalle técnico (APIs, estructuras de datos, despliegue) se aborda en
la fase de diseño.

### Contexto técnico relevante

- Patrón de proyecto existente: `script` único, reporte JSON con `summary` +
  `results`, manifest común `reports/index.json`, prefijo `account_id` para
  multi-cuenta.
- Nomenclatura: `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit` (siguiente NN disponible).
- El contenedor objetivo en el ejemplo del usuario se llama `agent-fluentbit` y su
  imagen es un ECR propio (`...amazonaws.com/utp-a275-ecr-fl...`). Existen otros
  sidecars en la misma tarea (ej. `datadog-agent`) que NO deben confundirse.

---

## Requisitos

### Requisito 1 — Descubrimiento de clusters y servicios ECS

**Historia de usuario:** Como ingeniero de operaciones, quiero que el Lambda
descubra automáticamente todos los clusters ECS y sus servicios en la cuenta, para
no tener que mantener una lista manual de qué auditar.

#### Criterios de aceptación

1. CUANDO el Lambda se ejecuta ENTONCES el sistema DEBE listar todos los clusters ECS
   de la cuenta en todas las regiones habilitadas.
2. CUANDO se procesa un cluster ENTONCES el sistema DEBE listar todos los servicios
   de ese cluster.
3. CUANDO un cluster no tiene servicios ENTONCES el sistema DEBE registrar el cluster
   con cero servicios y continuar sin error.
4. CUANDO una región no tiene clusters ECS ENTONCES el sistema DEBE continuar con las
   demás regiones sin fallar.
5. CUANDO la cantidad de clusters o servicios excede el límite de paginación de la API
   ENTONCES el sistema DEBE paginar para cubrir el inventario completo.

### Requisito 2 — Detección del contenedor Fluent Bit

**Historia de usuario:** Como ingeniero de operaciones, quiero que el Lambda
inspeccione la task definition de cada servicio e identifique si incluye el
contenedor de Fluent Bit, para saber qué servicios cumplen el estándar de logging.

#### Criterios de aceptación

1. CUANDO se evalúa un servicio ENTONCES el sistema DEBE inspeccionar la task
   definition que el servicio tiene configurada (`taskDefinition` del servicio).
2. CUANDO la task definition contiene un contenedor cuyo nombre es exactamente
   `agent-fluentbit` ENTONCES el sistema DEBE marcar el servicio como `Compliant`.
3. CUANDO la task definition NO contiene un contenedor llamado `agent-fluentbit`
   ENTONCES el sistema DEBE marcar el servicio como `Non-compliant`.
4. El nombre del contenedor a buscar es exactamente `agent-fluentbit`. La comparación
   DEBE ser exacta (no substring), aunque el valor DEBE ser configurable vía variable
   de entorno (`FLUENTBIT_CONTAINER_NAME`, default `agent-fluentbit`) por si el
   estándar cambia en el futuro.
5. CUANDO una tarea tiene otros sidecars (ej. `datadog-agent`) pero no
   `agent-fluentbit` ENTONCES el sistema DEBE marcarla como `Non-compliant` (no
   confundir sidecars).
6. CUANDO un servicio cumple ENTONCES el reporte DEBE incluir, como evidencia, los
   nombres de todos los contenedores de la tarea (para verificar visualmente que el
   sidecar está presente junto al contenedor principal).

### Requisito 3 — Manejo de servicios y casos borde

**Historia de usuario:** Como ingeniero de operaciones, quiero que la auditoría
maneje correctamente servicios sin tareas, definiciones inaccesibles y otros casos
borde, para que el reporte sea confiable y no tenga falsos positivos/negativos.

#### Criterios de aceptación

1. CUANDO un servicio tiene `desiredCount` en 0 (sin tareas) ENTONCES el sistema
   DEBE auditar igualmente su task definition configurada y reflejar su estado, pero
   marcarlo de forma distinguible (ej. flag `desired_count: 0`).
2. CUANDO no se puede describir una task definition (error o permiso) ENTONCES el
   sistema DEBE registrar el servicio con estado `Skipped` y un detalle del motivo,
   sin abortar la ejecución global.
3. CUANDO la API de ECS devuelve throttling ENTONCES el sistema DEBE reintentar con
   backoff (config de boto3) sin fallar la corrida completa.
4. El reporte DEBE distinguir entre tres estados por servicio: `Compliant`,
   `Non-compliant`, `Skipped`.

### Requisito 4 — Generación del reporte (contrato del proyecto)

**Historia de usuario:** Como mantenedor del dashboard, quiero que el reporte siga
el contrato JSON estándar del proyecto, para que el manifest y el dashboard lo
consuman sin cambios estructurales.

#### Criterios de aceptación

1. CUANDO el Lambda finaliza ENTONCES el sistema DEBE producir un JSON con
   `script = "audit_ecs_fluentbit"`, `timestamp` ISO UTC, `account_id`, y un objeto
   `summary` con `total`, `compliant`, `needs_action`, `skipped`.
2. `summary.total` DEBE contar el número de servicios ECS evaluados.
3. `summary.compliant` DEBE contar los servicios con Fluent Bit, `needs_action` los
   `Non-compliant`, y `skipped` los no evaluables.
4. El reporte DEBE incluir un array `results` donde cada elemento represente un
   servicio con al menos: cluster, servicio, región, task definition (familia:revisión),
   estado, nombre del contenedor Fluent Bit (si existe), `desired_count`.
5. El reporte DEBE incluir un agregado por cluster (similar al agregado por servicio/
   región de las auditorías 02 y 03) para vista resumida.
6. CUANDO el Lambda escribe en S3 ENTONCES DEBE guardar el reporte en
   `reports/audit_ecs_fluentbit/<account_id>/<timestamp>.json` y actualizar
   `reports/index.json` con una entrada nueva al inicio.

### Requisito 5 — Despliegue multi-cuenta y programación

**Historia de usuario:** Como ingeniero de operaciones, quiero desplegar el mismo
Lambda en DEV, QA y PRD y que se ejecute cada 4 horas, para tener visibilidad
continua del cumplimiento en los 3 entornos.

#### Criterios de aceptación

1. El Lambda DEBE poder desplegarse en las cuentas DEV (792654060327),
   QA (213698163176) y PRD (503134114226) usando el mismo código.
2. CADA despliegue DEBE escribir al bucket central `utp-aope-reportes-de-auditoria`
   bajo su propio prefijo de `account_id`.
3. La bucket policy cross-account DEBE autorizar el nuevo prefijo
   `reports/audit_ecs_fluentbit/*` para las 3 cuentas.
4. CADA cuenta DEBE tener una regla de EventBridge que dispare el Lambda cada 4 horas.
5. Las ejecuciones de las 3 cuentas DEBEN estar desfasadas algunos minutos entre sí
   para evitar colisiones al actualizar el manifest común.
6. El rol IAM del Lambda DEBE seguir la nomenclatura
   `UTP-AOPE-LA-04-Reporte-de-ECS-Fluentbit-Role` y otorgar los permisos mínimos de
   ECS (listar/describir) más escritura S3 al bucket central.

### Requisito 6 — Visualización en el dashboard

**Historia de usuario:** Como usuario del dashboard, quiero un tab nuevo que muestre
el cumplimiento de Fluent Bit por servicio ECS, para identificar rápidamente qué
servicios no están enviando logs correctamente.

#### Criterios de aceptación

1. CUANDO el dashboard carga ENTONCES DEBE mostrar un tab nuevo para
   `audit_ecs_fluentbit` con su icono y color de acento propios.
2. El tab DEBE mostrar el % de cumplimiento agregado (servicios con Fluent Bit /
   total) sumando las cuentas, consistente con cómo se calculan los otros tabs
   multi-cuenta.
3. La vista de detalle DEBE mostrar tarjetas resumen (total servicios, compliant,
   non-compliant, skipped) que funcionen como filtros al hacer click.
4. La vista DEBE incluir un agregado por cluster con su nivel de cumplimiento.
5. La tabla de detalle DEBE listar por servicio: cluster, servicio, región, task
   definition, contenedor Fluent Bit detectado y estado, con búsqueda y paginación
   consistentes con la vista de CloudWatch Logs.
6. La vista DEBE soportar los filtros de cuenta y fecha existentes en el dashboard.
7. El dashboard NO DEBE requerir cambios estructurales más allá de registrar el nuevo
   `script` en el despachador y agregar el tab y el componente de detalle.
