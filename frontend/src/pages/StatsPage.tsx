import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { GlassCard } from "../components/ui";

interface StatsData {
  totalClicks: number;
  timeSeries: { date: string; clicks: number }[];
  referrers: { name: string; clicks: number }[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{payload[0].value.toLocaleString()} clicks</p>
    </div>
  );
};

export function StatsPage() {
  const { id } = useParams();
  const { data, isLoading } = useQuery<StatsData>({
    queryKey: ["stats", id],
    queryFn: async () => {
      const [statsRes, timeSeriesRes, referrersRes] = await Promise.all([
        apiClient.get(`/api/v1/urls/${id}/stats`),
        apiClient.get(`/api/v1/urls/${id}/stats/timeseries`),
        apiClient.get(`/api/v1/urls/${id}/stats/referrers`),
      ]);
      return {
        totalClicks: statsRes.data.clickCount || 0,
        timeSeries: timeSeriesRes.data || [],
        referrers: referrersRes.data || [],
      };
    },
  });

  const totalClicks = data?.totalClicks ?? 0;
  const timeSeries = data?.timeSeries ?? [];
  const referrers = data?.referrers ?? [];
  const totalReferrerClicks = referrers.reduce((sum, r) => sum + r.clicks, 0);

  return (
    <div className="animate-fade-in">
      {/* Back + Header */}
      <div className="mb-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to links
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Lifetime performance for this link</p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="h-40 rounded-2xl shimmer" />
          <div className="h-40 rounded-2xl shimmer lg:col-span-2" />
          <div className="h-64 rounded-2xl shimmer lg:col-span-3" />
        </div>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {/* Bento Row 1: Hero Metric + Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Hero Metric */}
            <GlassCard className="p-6 relative overflow-hidden" glow>
              <div className="relative z-10">
                <p className="text-sm text-muted-foreground font-medium mb-1">Total Clicks</p>
                <div className="text-5xl font-bold gradient-text tracking-tight">
                  {totalClicks.toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                    </svg>
                    Active
                  </span>
                </div>
              </div>
              {/* Background accent */}
              <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-gradient-to-br from-violet-500/10 to-blue-500/10 rounded-full blur-2xl" />
            </GlassCard>

            {/* Chart */}
            <GlassCard className="p-6 lg:col-span-2">
              <p className="text-sm text-muted-foreground font-medium mb-4">Clicks over time</p>
              {timeSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={timeSeries}>
                    <defs>
                      <linearGradient id="clickGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="clicks"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fill="url(#clickGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[180px] text-muted-foreground text-sm">
                  Not enough data to show this report
                </div>
              )}
            </GlassCard>
          </div>

          {/* Bento Row 2: Referrers */}
          <GlassCard className="p-6">
            <p className="text-sm text-muted-foreground font-medium mb-4">Top traffic sources</p>
            {referrers.length > 0 ? (
              <div className="space-y-3">
                {referrers.map((ref, i) => {
                  const pct = totalReferrerClicks > 0 ? (ref.clicks / totalReferrerClicks) * 100 : 0;
                  return (
                    <div key={i} className="group">
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="text-foreground font-medium truncate">{ref.name || 'Direct'}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground tabular-nums">{ref.clicks.toLocaleString()}</span>
                          <span className="text-muted-foreground/60 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-500"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No traffic sources data available
              </div>
            )}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
