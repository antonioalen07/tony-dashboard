import type { ReactNode } from 'react';
import Logo from '@/components/Logo';
import styles from './LegalPage.module.css';

type LegalPageProps = {
    title: string;
    updatedAt: string;
    children: ReactNode;
};

export function LegalPage({ title, updatedAt, children }: LegalPageProps) {
    return <div className={styles.page}>
        <header className={styles.header}>
            <div className={styles.brand}><Logo size={36} /><span>BAKO</span></div>
            <nav className={styles.navigation} aria-label="Documentos legales">
                <a href="/privacidad">Privacidad</a>
                <a href="/eliminacion-datos">Eliminación de datos</a>
            </nav>
        </header>
        <article className={styles.document}>
            <div className={styles.heading}>
                <h1>{title}</h1>
                <p>Última actualización: {updatedAt}</p>
            </div>
            <div className={styles.content}>{children}</div>
        </article>
        <footer className={styles.footer}>BAKO</footer>
    </div>;
}
