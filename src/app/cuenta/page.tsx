import CuentaForm from './CuentaForm';

export const dynamic = 'force-dynamic';

export default async function CuentaPage({ searchParams }: { searchParams: Promise<{ forzar?: string }> }) {
  const { forzar } = await searchParams;
  return <CuentaForm forced={forzar === '1'} />;
}
