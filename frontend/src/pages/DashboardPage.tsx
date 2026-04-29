import { useUrls, useDeleteUrl } from "../hooks/useUrls";
import { Button } from "../components/ui";
import { Link } from "react-router-dom";
import { Copy, BarChart2, Trash2 } from "lucide-react";

export function DashboardPage() {
  const { data, isLoading } = useUrls();
  const deleteUrl = useDeleteUrl();

  const handleCopy = (shortUrl: string) => {
    navigator.clipboard.writeText(shortUrl);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
        {/* Youtube style category pills */}
        <Button variant="secondary" className="bg-white text-black hover:bg-white/90 rounded-full px-4 h-8 shrink-0">All URLs</Button>
        <Button variant="secondary" className="bg-card hover:bg-white/10 rounded-full px-4 h-8 shrink-0">Most Clicked</Button>
        <Button variant="secondary" className="bg-card hover:bg-white/10 rounded-full px-4 h-8 shrink-0">Recently Added</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse flex flex-col gap-3">
              <div className="w-full aspect-video bg-card rounded-xl"></div>
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-card shrink-0"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-card rounded w-3/4"></div>
                  <div className="h-3 bg-card rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-y-8 gap-x-4">
          {data?.pages.map((page) =>
            page.items.map((url: any) => (
              <div key={url.id} className="group flex flex-col gap-3">
                {/* Thumbnail */}
                <div className="relative w-full aspect-video bg-card rounded-xl overflow-hidden hover:rounded-none transition-all duration-300">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#2a2a2a] to-[#121212] group-hover:scale-105 transition-transform duration-500"></div>
                  <div className="absolute inset-0 flex items-center justify-center text-5xl font-black text-white/5 uppercase select-none">
                    {new URL(url.longUrl).hostname.replace('www.', '').split('.')[0]}
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 text-xs font-medium rounded text-white backdrop-blur-sm">
                    {url.clickCount > 0 ? `${url.clickCount} views` : 'New'}
                  </div>
                </div>

                {/* Info */}
                <div className="flex gap-3 px-1">
                  {/* Channel Avatar Placeholder */}
                  <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {new URL(url.longUrl).hostname.charAt(0).toUpperCase()}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <a href={url.shortUrl} target="_blank" className="font-semibold text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                      {url.shortUrl.replace(/^https?:\/\//, '')}
                    </a>
                    <p className="text-sm text-muted-foreground mt-1 truncate hover:text-white transition-colors" title={url.longUrl}>
                      {new URL(url.longUrl).hostname}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                      <span>{url.clickCount} views</span>
                      <span>•</span>
                      <span>{new Date().toLocaleDateString()}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full" onClick={() => handleCopy(url.shortUrl)} title="Copy">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Link to={`/urls/${url.id}/stats`}>
                        <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full" title="Analytics">
                          <BarChart2 className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-destructive/20 hover:text-destructive text-muted-foreground ml-auto" onClick={() => deleteUrl.mutate(url.id)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
