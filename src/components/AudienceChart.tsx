'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function AudienceChart() {
  const [data, setData] = useState<{ country: string; users: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audience')
      .then((r) => r.json())
      .then((res) => setData(Array.isArray(res.data) ? res.data : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="glass-panel" style={{ height: '300px', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Audiencia Por País
      </h3>
      <div style={{ flex: 1, width: '100%' }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Cargando…
          </div>
        ) : data.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '0 1rem', lineHeight: 1.5 }}>
            La demografía por país requiere permisos de Instagram Insights. Se mostrará aquí en cuanto estén disponibles.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="country" type="category" axisLine={false} tickLine={false} stroke="var(--chart-axis)" fontSize={12} width={40} />
              <Tooltip
                cursor={{ fill: 'var(--chart-cursor)' }}
                contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                formatter={(value: any) => [Number(value).toLocaleString(), 'Seguidores']}
              />
              <Bar dataKey="users" radius={[0, 4, 4, 0]} barSize={12}>
                {data.map((_, i) => (
                  <Cell key={i} fill="var(--chart-line)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
