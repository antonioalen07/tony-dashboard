import type { MetadataRoute } from 'next';

/** Instalable en el teléfono: en iPhone las notificaciones sólo funcionan desde la pantalla de inicio. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'BAKO',
        short_name: 'BAKO',
        description: 'Inteligencia de contenido de Instagram',
        start_url: '/automatizaciones?tab=inbox',
        scope: '/',
        display: 'standalone',
        background_color: '#070708',
        theme_color: '#070708',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}
