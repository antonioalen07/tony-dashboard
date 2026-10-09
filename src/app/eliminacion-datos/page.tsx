import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Eliminación de datos | BAKO',
  description: 'Cómo solicitar a Crevy la eliminación de tus datos de BAKO.',
};

export default function DataDeletionPage() {
  return (
    <LegalPage title="Eliminación de datos" updatedAt="9 de octubre de 2026">
      <p>
        Podés solicitar la eliminación de tus datos de BAKO y de su integración de Meta,
        <strong> Marca Tony Dashboard</strong>, contactando a <strong>Crevy</strong>.
        No necesitás tener acceso al panel para hacer la solicitud.
      </p>

      <section aria-labelledby="solicitud">
        <h2 id="solicitud">Cómo solicitarla</h2>
        <ol>
          <li>
            Enviá un correo a{' '}
            <a href="mailto:automatizaciones@crevy.net?subject=Eliminaci%C3%B3n%20de%20datos%20BAKO">
              automatizaciones@crevy.net
            </a>{' '}
            con el asunto <strong>Eliminación de datos BAKO</strong>.
          </li>
          <li>
            Indicá tu usuario de Instagram, la cuenta de Instagram con la que
            interactuaste y que solicitás la eliminación de tus datos. Si sos operador
            del panel, indicá también el correo de tu cuenta de BAKO.
          </li>
          <li>
            Crevy revisará la solicitud y podrá pedir una confirmación de titularidad
            para evitar borrar o divulgar información de otra persona.
          </li>
        </ol>
        <p>No envíes contraseñas, tokens de acceso ni documentos de identidad en el correo inicial.</p>
      </section>

      <section aria-labelledby="alcance">
        <h2 id="alcance">Qué comprende la eliminación</h2>
        <p>
          La solicitud comprende los datos asociados a tu identidad que BAKO mantiene:
          el contacto, mensajes y referencias a adjuntos, etiquetas, notas, registros
          de comentarios y automatización, seguimientos pendientes y archivos asociados
          que correspondan. Se revisan estos registros en conjunto; borrar solamente
          una ficha de contacto no equivale a eliminar todo el historial.
        </p>
        <p>
          El proceso se gestiona manualmente. Podés consultar su estado respondiendo
          al mismo correo. Si algún dato debe conservarse por una obligación legal
          aplicable, se informará la razón y el alcance de esa conservación.
        </p>
      </section>

      <section aria-labelledby="instagram">
        <h2 id="instagram">Datos que permanecen en Instagram</h2>
        <p>
          La eliminación en BAKO no borra automáticamente tus comentarios, mensajes
          o publicaciones dentro de Instagram, ni los datos que Meta administra.
          Para gestionar esos datos, utilizá las opciones de privacidad y eliminación
          de Instagram o Facebook.
        </p>
        <p>
          Si administrás una cuenta conectada, también podés revocar el acceso de
          Marca Tony Dashboard desde las opciones de aplicaciones o integraciones
          de Meta. La revocación del acceso y la eliminación del historial almacenado
          en BAKO son solicitudes independientes.
        </p>
        <p>Consultá la <a href="/privacidad">política de privacidad</a> para conocer el tratamiento de datos.</p>
      </section>
    </LegalPage>
  );
}
