# Instagram y conocimiento del AI Chat

Activación: ejecutar `supabase_migration_reel_curation.sql` en el SQL Editor de
Supabase. Es re-ejecutable y no borra publicaciones ni métricas. Sin la migración
las lecturas siguen funcionando y las nuevas acciones muestran un aviso 428.

## Organizar publicaciones

- **Ocultar del panel** conserva la publicación y sus métricas. Se encuentra en
  Ocultos y puede restaurarse. Se excluye de las listas principales y de la IA.
- **Marcar repetido** conserva las métricas, permite señalar el original y borra
  la transcripción, el análisis y la mejora de esa copia. Se encuentra en
  Repetidos y queda excluido de IA y de la generación automática.
- **Borrar transcripción** elimina también el análisis y la mejora derivados;
  desactiva la generación y excluye esa pieza del conocimiento del chat hasta
  habilitarla explícitamente.
- **Restaurar** vuelve a habilitar la pieza. No recupera textos borrados: pueden
  generarse nuevamente con sus botones o en la siguiente sincronización.

Los totales de métricas conservan todas las publicaciones del rango. La
sincronización actualiza los datos de Instagram sin sobrescribir las marcas.
Los handlers verifican las marcas antes de transcribir/analizar y al guardar
el resultado. El trigger SQL protege también ante escritores anteriores.

La marca de repetido es manual: no se infiere identidad de video por título o
caption. El contexto del chat sí agrupa automáticamente transcripciones
iguales, normalizando mayúsculas, espacios y Unicode; muestra cada narración
una vez y conserva las métricas separadas de sus publicaciones. No compara
imágenes ni audios ni borra automáticamente transcripciones existentes.

## Qué recibe el modelo

En cada consulta lee los bloques actuales de `ai_settings/default`. Una clave
ausente hereda el valor original, un texto lo reemplaza y un string vacío apaga
ese bloque. El entrenamiento configura instrucciones; no modifica los pesos
del modelo. Los cambios se aplican a la siguiente respuesta, sin rehacer
respuestas ni análisis históricos.

El dossier aporta guiones y métricas reales, con una muestra de mayor alcance
y otra de contraste. Las vistas bajas no se etiquetan automáticamente como
fracasos. Las agendas y los leads calificados se incluyen cuando están cargados.
Reels ocultos, repetidos y con transcripción desactivada quedan excluidos.

El contexto y el historial tienen límites explícitos para controlar el costo.
La cobertura visible en el chat informa cuántos guiones/publicaciones entraron
y qué quedó afuera. No equivale a enviar todos los videos en cada turno.
El preview de Entrenamiento muestra las instrucciones, no todo el dossier.

`GET /api/chat/context` permite revisar la cobertura y la versión del
entrenamiento con sesión, sin llamar al modelo ni devolver guiones privados.
`npm run inspect:knowledge` consulta sólo la base y muestra conteos y estado
del entrenamiento; no modifica datos ni llama a la IA.

Validación local sin servicios pagos: `npm run test:reels`.
