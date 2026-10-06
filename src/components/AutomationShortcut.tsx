'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Automation } from '@/lib/automation-types';
let cache: {at: number; promise: Promise<Automation[]>}|undefined;
function linkedAutomations() {
    if (!cache || Date.now() - cache.at > 10000) cache = {at: Date.now(), promise: fetch('/api/automations').then((r) => r.ok ? r.json() : []).catch(() => [])};
    return cache.promise;
}
export default function AutomationShortcut({ queueId, caption }: {
    queueId: string;
    caption: string | null;
}) {
    const [linked, setLinked] = useState<Automation | null>(null);
    const keyword = caption?.match(/(?:coment[aá]|escrib[ií])\s+[\'"‘’“”]([^\'"‘’“”]{2,20})[\'"‘’“”]/i)?.[1] || caption?.match(/[\'"‘’“”]([^\'"‘’“”]{2,20})[\'"‘’“”]\s+y\s+(?:te\s+lo\s+paso|lo\s+ten[eé]s)/i)?.[1];
    useEffect(() => { let cancelled = false; linkedAutomations().then((rows: Automation[]) => { if (!cancelled)
        setLinked(rows.find((a) => a.publish_queue_id === queueId) || null); }).catch(() => { }); return () => { cancelled = true; }; }, [queueId]);
    if (!keyword && !linked)
        return null;
    return <Link href={linked ? '/automatizaciones' : `/automatizaciones?queue=${encodeURIComponent(queueId)}&keyword=${encodeURIComponent(keyword || '')}`} title={linked ? 'Ver automatización' : 'Crear automatización'}>⚡ {linked ? `Automatización ${linked.active ? 'activa' : 'pausada'}` : `Crear automatización para ${keyword}`}</Link>;
}
