// frontend/src/pages/StatsPage.tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

interface TimeSeriesPoint {
  date: string;
  clicks: number;
}

export function StatsPage() {
  const { id } = useParams();

  const summary = useQuery({
    queryKey: ['stats', id, 'summary'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/urls/${id}/stats`);
      return data;
    },
  });

  const timeSeries = useQuery({
    queryKey: ['stats', id, 'timeseries'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/urls/${id}/stats/timeseries`);
      return data as TimeSeriesPoint[];
    },
  });

  const referrers = useQuery({
    queryKey: ['stats', id, 'referrers'],
    queryFn: async () => {
      const { data } = await apiClient.get(`/api/v1/urls/${id}/stats/referrers`);
      return data as { referrer: string; count: number }[];
    },
  });

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        {summary.data && (
          <p className="text-muted-foreground mt-2">
            Overview for the lifetime of this link
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Youtube Studio Big Metric Card */}
        <div className="md:col-span-1 rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col justify-center">
          <h2 className="font-semibold text-muted-foreground">Total Views (Clicks)</h2>
          {summary.data ? (
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-bold">{summary.data.clickCount.toLocaleString()}</span>
              <span className="text-green-500 font-medium text-sm flex items-center">
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 stroke-current mr-1">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                Active
              </span>
            </div>
          ) : (
            <div className="mt-4 h-12 w-24 bg-muted animate-pulse rounded-md"></div>
          )}
        </div>

        {/* Chart */}
        <section className="md:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-6 font-semibold">Views over time</h2>
          {timeSeries.data && timeSeries.data.length > 0 ? (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeries.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ff0000" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#ff0000" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="date" stroke="#888" tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})} tickMargin={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#888" allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#212121', border: '1px solid #3f3f3f', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                    labelFormatter={(l) => new Date(l).toLocaleDateString()}
                  />
                  <Area type="monotone" dataKey="clicks" stroke="#ff0000" strokeWidth={3} fillOpacity={1} fill="url(#colorClicks)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground">
              Not enough data to show this report
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden mt-8">
        <div className="p-6 border-b border-border">
          <h2 className="font-semibold">Top traffic sources</h2>
        </div>
        {referrers.data && referrers.data.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50 bg-muted/20">
                <th className="py-3 px-6 font-medium">Source type</th>
                <th className="py-3 px-6 font-medium text-right w-32">Views</th>
                <th className="py-3 px-6 font-medium text-right w-32">% of total</th>
              </tr>
            </thead>
            <tbody>
              {referrers.data.map((r: any, i: number) => {
                const totalClicks = summary.data?.clickCount || 1;
                const percentage = Math.round((r.clicks / totalClicks) * 100);
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-4 px-6 flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 stroke-foreground">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                      </div>
                      <span className="font-medium">{r.name || 'Direct or unknown'}</span>
                    </td>
                    <td className="py-4 px-6 text-right tabular-nums">{r.clicks}</td>
                    <td className="py-4 px-6 text-right text-muted-foreground">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${percentage}%` }}></div>
                        </div>
                        <span className="w-8 text-right">{percentage}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            No traffic sources data available
          </div>
        )}
      </section>
    </div>
  );
}
