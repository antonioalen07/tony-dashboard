import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Política de privacidad | BAKO',
  description: 'Cómo Crevy trata los datos en BAKO y cómo solicitar su eliminación.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidad" updatedAt="9 de octubre de 2026">
      <p>
        Esta política describe el tratamiento de datos en BAKO, el panel de gestión de
        contenido y conversaciones de Instagram operado por <strong>Crevy</strong>.
        La integración de Meta utilizada por BAKO se llama <strong>Marca Tony Dashboard</strong>.
        Para consultas sobre privacidad, escribí a{' '}
        <a href="mailto:automatizaciones@crevy.net">automatizaciones@crevy.net</a>.
      </p>

      <section aria-labelledby="datos">
        <h2 id="datos">Qué información tratamos</h2>
        <ul>
          <li>
            Datos de las cuentas profesionales conectadas: identificadores, nombre de
            usuario, publicaciones, imágenes, videos, captions, fechas y métricas de rendimiento.
          </li>
          <li>
            Interacciones con esas cuentas que Meta pone a disposición de la integración:
            identificadores y nombres de usuario, comentarios, mensajes directos,
            respuestas a historias, fechas y referencias a publicaciones o historias.
            Los mensajes pueden incluir texto y referencias o enlaces a audios, imágenes
            u otros adjuntos.
          </li>
          <li>
            Información registrada por los operadores: nombres de contactos, etiquetas,
            notas, calificación comercial, preferencias de seguimiento y contenido de
            respuestas manuales o automáticas.
          </li>
          <li>
            Archivos, guiones, transcripciones, instrucciones y conversaciones ingresados
            en las herramientas de creación y análisis de contenido.
          </li>
          <li>
            Datos de acceso de los operadores del panel, como nombre, correo, contraseña
            almacenada mediante hash, sesiones y registros de seguridad. Estos registros
            pueden incluir dirección IP, navegador, fechas y resultados de acceso.
          </li>
        </ul>
        <p>
          Los datos se reciben mediante las API y notificaciones de Meta, consultas a
          esas API y la información que ingresan los operadores. Las herramientas de
          investigación de contenido también pueden consultar publicaciones públicas.
          BAKO no solicita la contraseña de Instagram de las personas que comentan o
          escriben a la cuenta conectada.
        </p>
      </section>

      <section aria-labelledby="finalidades">
        <h2 id="finalidades">Para qué los usamos</h2>
        <ul>
          <li>Mostrar y responder conversaciones y consultas dirigidas a la cuenta conectada.</li>
          <li>
            Enviar respuestas a comentarios o historias y seguimientos configurados por
            los operadores, sujetos a los permisos y límites de mensajería de Meta.
          </li>
          <li>
            Organizar contactos mediante etiquetas y notas, registrar preferencias y
            evitar respuestas duplicadas o seguimientos no deseados.
          </li>
          <li>
            Crear, editar, programar y publicar contenido, analizar su rendimiento y
            generar sugerencias cuando un operador utiliza esas herramientas.
          </li>
          <li>Administrar el acceso, detectar errores y mantener la seguridad del servicio.</li>
        </ul>
        <p>
          La clasificación de contactos corresponde a la gestión comercial de consultas.
          Podés solicitar que se detengan los seguimientos escribiendo al correo de contacto.
        </p>
      </section>

      <section aria-labelledby="proveedores">
        <h2 id="proveedores">Quiénes pueden tratar los datos</h2>
        <p>
          Los operadores autorizados de Crevy utilizan el panel. Para prestar el servicio,
          intervienen Meta, Vercel para el alojamiento web, Supabase para la base de datos
          y almacenamiento, y el servidor de Contabo administrado mediante Easypanel,
          donde se ejecutan los procesos de publicación y automatización.
          Estos servicios pueden procesar datos en países
          distintos del país de la persona que interactúa con la cuenta.
        </p>
        <p>
          Cuando un operador utiliza funciones de inteligencia artificial, el texto,
          las transcripciones, las métricas y las instrucciones necesarias para esa
          función pueden enviarse a OpenAI o a OpenRouter, según la configuración.
          Apify puede intervenir en la consulta y obtención de contenido público, y
          ElevenLabs en la transcripción de videos. Si un operador conecta Google Drive,
          BAKO consulta los archivos autorizados para importar los que seleccione.
          La bandeja de conversaciones y las respuestas por palabras clave no envían
          automáticamente los mensajes de los contactos a un modelo de inteligencia artificial.
        </p>
        <p>
          Los archivos que deben entregarse a Instagram, incluidos audios de respuesta,
          se alojan mediante enlaces accesibles para quien los tenga. El contenido enviado
          por Instagram también queda sujeto a las políticas y opciones de privacidad de Meta.
        </p>
        <p>
          Las páginas utilizan Google Fonts para cargar tipografías. Algunas imágenes
          externas pasan por el servicio wsrv.nl para su visualización o edición.
          Estas solicitudes pueden compartir con esos proveedores la dirección IP y
          los datos técnicos del navegador necesarios para entregar el recurso.
        </p>
      </section>

      <section aria-labelledby="conservacion">
        <h2 id="conservacion">Conservación y seguridad</h2>
        <p>
          Los contactos, mensajes, notas y registros de automatización se conservan para
          gestionar las interacciones y su historial. No tienen un plazo de eliminación
          automática por antigüedad. Su eliminación se gestiona a solicitud de la persona
          o del responsable de la cuenta cuando dejan de ser necesarios.
          La limpieza automática de archivos de edición de video es independiente del
          historial de conversaciones.
        </p>
        <p>
          El panel requiere autenticación y verifica las notificaciones de Meta mediante
          firma. Las credenciales de la integración se utilizan en el servidor.
          El acceso de los operadores puede revocarse. Ningún sistema garantiza seguridad absoluta.
        </p>
      </section>

      <section aria-labelledby="derechos">
        <h2 id="derechos">Consultas, correcciones y eliminación</h2>
        <p>
          Podés consultar sobre tus datos, solicitar su corrección, pedir la eliminación
          o solicitar que se detengan los seguimientos escribiendo a{' '}
          <a href="mailto:automatizaciones@crevy.net">automatizaciones@crevy.net</a>.
          Indicá tu usuario de Instagram y la cuenta con la que interactuaste. Para
          proteger los datos, podemos pedir una confirmación de que la cuenta te pertenece.
          No envíes contraseñas ni tokens.
        </p>
        <p>
          Las solicitudes se revisan y gestionan manualmente. Las{' '}
          <a href="/eliminacion-datos">instrucciones de eliminación de datos</a>{' '}
          explican qué información comprende la solicitud y cómo darle seguimiento.
          Esta política se actualizará en esta página cuando cambie el tratamiento descrito.
        </p>
      </section>
    </LegalPage>
  );
}
