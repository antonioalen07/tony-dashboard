'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ReachChartProps {
  reels: any[];
}

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function buildMonthlyReach(reels: any[]) {
  const buckets = new Map<string, { label: string; reach: number; sort: number }>();
  for (const r of reels) {
    if (!r.published_at) continue;
    const d = new Date(r.published_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const sort = d.getFullYear() * 12 + d.getMonth();
    const value = r.reach || r.views || 0;
    const prev = buckets.get(key);
    if (prev) prev.reach += value;
    else buckets.set(key, { label: `${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, reach: value, sort });
  }
  return Array.from(buckets.values()).sort((a, b) => a.sort - b.sort);
}

const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

export default function ReachChart({ reels }: ReachChartProps) {
  const data = buildMonthlyReach(reels || []);

  return (
    <div className="glass-panel" style={{ height: '300px', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Reach Mes a Mes
      </h3>
      <div style={{ flex: 1, width: '100%' }}>
        {data.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Sincroniza tus reels para ver el reach por mes.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="reachFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--chart-axis)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--chart-axis)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={fmt} width={42} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '8px', color: 'var(--text-primary)' }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={(value: any) => [Number(value).toLocaleString(), 'Reach']}
                cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
              />
              <Area type="monotone" dataKey="reach" stroke="var(--chart-line)" strokeWidth={2.5} fill="url(#reachFill)" dot={false} activeDot={{ r: 5, fill: 'var(--chart-line)' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
