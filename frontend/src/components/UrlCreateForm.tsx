import { useState } from "react";
import { useCreateUrl } from "../hooks/useUrls";

export function UrlCreateForm() {
  const [url, setUrl] = useState("");
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createUrl = useCreateUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      const result = await createUrl.mutateAsync(url);
      setShortUrl(result.shortUrl);
      setUrl("");
      setTimeout(() => setShortUrl(null), 8000);
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
    <div className="relative">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.02a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" transform="translate(2,2) scale(0.85)" />
            </svg>
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a long URL..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all duration-200 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 focus:bg-white/[0.07]"
          />
        </div>
        <button
          type="submit"
          disabled={createUrl.isPending || !url.trim()}
          className="h-10 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-medium shadow-lg shadow-violet-500/20 hover:shadow-violet-500/35 hover:brightness-110 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] whitespace-nowrap"
        >
          {createUrl.isPending ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "Shorten"
          )}
        </button>
      </form>

      {/* Success popup */}
      {shortUrl && (
        <div className="absolute top-full mt-2 right-0 z-50 animate-scale-in">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-xl shadow-xl">
            <span className="text-sm text-emerald-400 font-mono">{shortUrl}</span>
            <button
              onClick={handleCopy}
              className="text-emerald-400 hover:text-emerald-300 transition-colors p-1"
            >
              {copied ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
