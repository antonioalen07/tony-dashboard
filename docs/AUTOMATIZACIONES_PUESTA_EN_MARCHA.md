# Automatizaciones de BAKO: puesta en marcha

El código incluye comment-to-DM con respuesta pública opcional, contactos,
etiquetas libres, calificación y secuencias de texto o audio. Los envíos reales
quedan pendientes de tu prueba desde otra cuenta de Instagram.

## 1. Base de datos

Pegá `supabase_migration_automations.sql` completo en el SQL Editor de Supabase.
Es reejecutable y también agrega las columnas nuevas sobre la migración v1 del
plan original. Tablas y funciones quedan cerradas a anon/authenticated; la app
y el worker necesitan `SUPABASE_SERVICE_ROLE_KEY`.

Si falta la migración, la pantalla muestra un banner y las APIs devuelven 428.

## 2. Variables de entorno

Cargá en Vercel y en Easypanel las credenciales existentes de Supabase y Meta.
Usá la misma cuenta profesional en ambos:

```
NEXT_PUBLIC_SUPABASE_URL=<tu URL>
SUPABASE_SERVICE_ROLE_KEY=<clave del servidor>
META_ACCESS_TOKEN=<System User token>
META_IG_ACCOUNT_ID=17841476480622974
META_PAGE_ID=1061609440358642
META_MESSAGING_ENDPOINT=page
AUTOMATION_MAX_DM_PER_HOUR=180
```

En Vercel agregá también `META_APP_SECRET` y un `META_WEBHOOK_VERIFY_TOKEN`
aleatorio. No compartas las claves en el navegador. El cupo se comparte entre
Private Replies y seguimientos. `AUTOMATION_MAX_DM_PER_HOUR=0` suspende los envíos.
La variable `PUBLISH_DRY_RUN` del publicador de videos no controla estos mensajes.

## 3. Meta y despliegue

1. Desplegá la app y redeployá el worker en Easypanel con sus variables.
2. En la app profesional de Instagram habilitá acceso a mensajes para herramientas
   conectadas. Verificá los permisos de administrar comentarios y mensajes.
3. En la consola de Meta configurá el objeto Instagram con callback
   `https://<tu-dominio>/api/webhooks/instagram` y el verify token anterior.
   Suscribí `comments` y `messages`. Los mensajes entrantes son necesarios para
   que BAKO pueda calcular la ventana de seguimiento.
4. Con `.env.local` actualizado, ejecutá `node scripts/subscribe_webhooks.mjs`.
   Suscribe la página al campo feed y verifica la suscripción. No envía DMs.
5. Confirmá en los logs del worker que figure el job `automations@15000ms`.

El polling de comentarios queda activo cada 5 minutos si los webhooks no llegan.
No reemplaza el webhook de mensajes entrantes: sin él los seguimientos no se
habilitan. Los permisos y la disponibilidad en modo desarrollo requieren tu
validación en Meta. La implementación no solicita Advanced Access automáticamente.

## 4. Prueba propia

1. En Automatizaciones → Etiquetas, creá B2B, B2C o los nombres que quieras.
2. Creá una automatización para un reel, agregá una palabra clave, el DM y las
   etiquetas que querés asignar. También podés crearla desde el calendario.
3. Comentá esa palabra desde otra cuenta. Revisá el DM, la respuesta pública,
   la actividad y el contacto. El webhook suele detectarlo antes que el polling.
4. Comentá otra vez: con “Un DM por persona” activo, el segundo evento se omite.
5. Respondé al DM desde la cuenta de prueba para abrir la conversación. Marcá
   el contacto como Calificado y creá una secuencia con un paso de pocos minutos.
6. Probá texto y audio por separado. Para audio usá una URL pública de un archivo
   compatible, accesible sin login. BAKO envía un adjunto nativo; el soporte, tamaño
   y formatos aceptados por tu integración de Meta se validan con esta prueba real.
7. Probá pausar, cancelar, responder para detener y quitar una etiqueta requerida.

Para aislar el envío antes de probar el módulo:

```
node scripts/test_private_reply.mjs --list <media_id>
node scripts/test_private_reply.mjs --comment <comment_id> --text "Prueba BAKO"
```

El script imprime el endpoint que funcionó. Si sólo funciona `ig-user-id/messages`,
configurá `META_MESSAGING_ENDPOINT=instagram` en el worker y redeployalo. El worker
no cambia de endpoint ni repite solicitudes ante resultados ambiguos.

## Seguimientos y estados

- Podés inscribir manualmente desde un contacto o activar inscripción automática
  en la secuencia según calificación y todas las etiquetas seleccionadas.
- La inscripción automática requiere un mensaje entrante reciente y ocurre una
  sola vez por contacto/secuencia. No reinscribe una secuencia completada/cancelada.
- Las demoras se acumulan desde el horario de inscripción. Editar pasos afecta
  nuevas inscripciones; las ya creadas conservan los mensajes y horarios guardados.
- Se comprueba una ventana conservadora de 24 horas desde el último DM entrante
  justo antes del envío. Etiquetar un contacto no abre la ventana.
- Un paso bloqueado no se reactiva solo: revisalo y usá Reintentar después de
  resolver la causa. Si el contacto respondió y la inscripción se canceló,
  necesitás una nueva secuencia para volver a inscribirlo.
- Pausar impide nuevos reclamos. Un mensaje que ya estaba en vuelo podría llegar.
- `uncertain` indica que Meta no confirmó el resultado o que el proceso se
  interrumpió al enviar. Revisá Instagram; la UI no habilita reintentos ciegos.
- Los estados se guardan en la base. La retención de videos no borra estos datos.

## Verificación de desarrollo

```
npm run test:automations
npm run lint:automations
npx tsc --noEmit
npm run build
```

Las pruebas simulan Meta y usan PostgreSQL local en memoria; no envían mensajes ni
modifican Supabase. El lint completo del repo tiene errores preexistentes, incluidos
archivos generados de worktrees antiguos. La confirmación real de permisos y
entrega de DMs/audio queda a cargo de la prueba anterior.
