import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui";
import { useCreateAnonymousUrl } from "../hooks/useUrls";

export function LandingPage() {
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState<number>(5);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createUrl = useCreateAnonymousUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      const result = await createUrl.mutateAsync({ longUrl: url, durationMinutes: duration });
      setShortUrl(result.shortUrl);
      setUrl("");
    } catch {
      /* handled by react-query */
    }
  };

  const handleCopy = () => {
    if (shortUrl) {
      navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative flex flex-col min-h-screen bg-background overflow-hidden">
      {/* Ambient glow orbs */}
      <div className="glow-orb glow-violet w-[600px] h-[600px] -top-32 -left-32 animate-pulse-glow" />
      <div className="glow-orb glow-blue w-[500px] h-[500px] -bottom-32 -right-32 animate-pulse-glow" style={{ animationDelay: '2s' }} />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.02a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" transform="translate(2,2) scale(0.85)" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight gradient-text">Shortly</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2">
            Sign In
          </Link>
          <Link to="/register">
            <Button size="sm">Create Account</Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 animate-fade-in">
        <div className="text-center mb-10 max-w-3xl">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6">
            Short links, <span className="gradient-text">big impact.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Create temporary, anonymous short links instantly. Or create an account for permanent links and powerful analytics.
          </p>
        </div>

        {/* Form Card */}
        <div className="w-full max-w-2xl">
          <div className="glass-strong rounded-2xl p-2 md:p-3 shadow-2xl">
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-2">
              <div className="relative flex-1 w-full">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.02a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" transform="translate(2,2) scale(0.85)" />
                  </svg>
                </div>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste your long link here..."
                  className="w-full h-14 pl-12 pr-4 rounded-xl bg-transparent border-none text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0 text-lg"
                />
              </div>

              {/* Duration Select */}
              <div className="w-full sm:w-auto px-2 sm:px-0 sm:border-l border-white/10 flex items-center">
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full sm:w-auto h-14 bg-transparent text-muted-foreground text-sm font-medium focus:outline-none px-4 cursor-pointer appearance-none"
                  style={{ WebkitAppearance: 'none' }}
                >
                  <option value={1} className="bg-background">1 Min TTL</option>
                  <option value={2} className="bg-background">2 Min TTL</option>
                  <option value={5} className="bg-background">5 Min TTL</option>
                </select>
                {/* Custom chevron since appearance is none */}
                <div className="pointer-events-none -ml-6 mr-4 text-muted-foreground/50">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
              </div>

              <Button
                type="submit"
                disabled={createUrl.isPending || !url.trim()}
                className="w-full sm:w-auto h-14 px-8 text-base shrink-0"
              >
                {createUrl.isPending ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  "Shorten"
                )}
              </Button>
            </form>
          </div>

          {/* Success Result */}
          {shortUrl && (
            <div className="mt-4 animate-fade-in">
              <div className="glass rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-emerald-500/20">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Your temporary short link is ready (valid for {duration} min{duration > 1 ? 's' : ''}):</p>
                  <a href={shortUrl} target="_blank" rel="noopener noreferrer" className="text-xl font-bold text-emerald-400 hover:text-emerald-300 transition-colors">
                    {shortUrl.replace(/^https?:\/\//, '')}
                  </a>
                </div>
                <Button variant="outline" onClick={handleCopy} className="shrink-0">
                  {copied ? (
                    <span className="flex items-center gap-2 text-emerald-400">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                      Copied!
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                      Copy Link
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
