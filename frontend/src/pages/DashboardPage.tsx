import { useUrls, useDeleteUrl } from "../hooks/useUrls";
import { GlassCard } from "../components/ui";
import { Link } from "react-router-dom";
import { useState } from "react";

function getDomainFromUrl(url: string) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

function getInitial(domain: string) {
  return domain.charAt(0).toUpperCase();
}

function getGradient(index: number) {
  const gradients = [
    "from-violet-500 to-blue-500",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-500",
    "from-orange-500 to-amber-500",
    "from-pink-500 to-rose-500",
    "from-indigo-500 to-purple-500",
  ];
  return gradients[index % gradients.length];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

export function DashboardPage() {
  const { data, isLoading, fetchNextPage, hasNextPage } = useUrls();
  const deleteUrl = useDeleteUrl();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const handleCopy = (shortUrl: string, id: number) => {
    navigator.clipboard.writeText(shortUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Your Links</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {items.length > 0 ? `${items.length} link${items.length > 1 ? 's' : ''} created` : 'Create your first short link'}
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl shimmer" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && items.length === 0 && (
        <GlassCard className="p-12 text-center" glow>
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-violet-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.02a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" transform="translate(2,2) scale(0.85)" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No links yet</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Paste a URL in the search bar above to create your first shortened link.
          </p>
        </GlassCard>
      )}

      {/* Link List */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((url, index) => {
            const domain = getDomainFromUrl(url.longUrl);
            return (
              <GlassCard
                key={url.id}
                hover
                className="group p-4 md:p-5"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-center gap-4">
                  {/* Favicon circle */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${getGradient(index)} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
                    {getInitial(domain)}
                  </div>

                  {/* Link info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold gradient-text truncate">
                        {url.shortUrl?.replace('http://', '') || `localhost:8080/${url.shortCode}`}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs mt-0.5 truncate">
                      {url.longUrl}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-6 text-right">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{url.clickCount.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">clicks</div>
                    </div>
                    <div className="hidden md:block">
                      <div className="text-sm text-muted-foreground">{formatDate(url.createdAt)}</div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {/* Copy */}
                    <button
                      onClick={() => handleCopy(url.shortUrl || `http://localhost:8080/${url.shortCode}`, url.id!)}
                      className="p-2 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all"
                      title="Copy short URL"
                    >
                      {copiedId === url.id ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-emerald-400">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      )}
                    </button>
                    {/* Stats */}
                    <Link
                      to={`/urls/${url.id}/stats`}
                      className="p-2 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all"
                      title="View analytics"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                      </svg>
                    </Link>
                    {/* Delete */}
                    <button
                      onClick={() => deleteUrl.mutate(url.id!)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all"
                      title="Delete"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="mt-6 text-center">
          <button
            onClick={() => fetchNextPage()}
            className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors"
          >
            Load more →
          </button>
        </div>
      )}
    </div>
  );
}
