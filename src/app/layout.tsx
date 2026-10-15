import type { Metadata, Viewport } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'BAKO',
  description: 'Inteligencia de contenido de Instagram',
  // Instalable desde el teléfono (en iPhone, las notificaciones sólo andan así).
  appleWebApp: { capable: true, title: 'BAKO', statusBarStyle: 'black' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#070708' };

// Se ejecuta antes del primer paint para evitar parpadeo de tema.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>
          <div className="app-container">
            <Sidebar />
            <main className="main-content">{children}</main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
