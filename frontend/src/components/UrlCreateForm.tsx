// frontend/src/components/UrlCreateForm.tsx
import { useState } from 'react';
import { useCreateUrl } from '../hooks/useUrls';
import { Button, Input } from './ui';
import { Copy, CheckCircle } from 'lucide-react';

export function UrlCreateForm() {
  const [longUrl, setLongUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const createMutation = useCreateUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!longUrl) return;
    await createMutation.mutateAsync(longUrl);
    setLongUrl('');
  };

  const result = createMutation.data;

  const copyToClipboard = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full relative">
      <form onSubmit={handleSubmit} className="flex w-full">
        <div className="relative flex-1 flex items-center">
          <Input
            type="url"
            required
            placeholder="Shorten a link..."
            value={longUrl}
            onChange={(e) => setLongUrl(e.target.value)}
            disabled={createMutation.isPending}
            className="w-full rounded-l-full rounded-r-none border-r-0 bg-muted focus-visible:ring-0 focus-visible:border-primary pl-4 h-10 shadow-inner"
          />
        </div>
        <Button 
          type="submit" 
          disabled={createMutation.isPending} 
          className="rounded-r-full rounded-l-none border border-l-0 border-border bg-border hover:bg-border/80 text-foreground h-10 px-6 font-medium"
        >
          {createMutation.isPending ? '...' : 'Create'}
        </Button>
      </form>

      {createMutation.error && (
        <p className="absolute top-full mt-2 text-sm text-destructive font-medium">
          {(createMutation.error as Error).message}
        </p>
      )}

      {result && (
        <div className="absolute top-full right-0 mt-2 flex items-center gap-2 rounded-lg bg-card p-2 shadow-lg border border-border z-50">
          <code className="px-2 font-mono text-sm text-primary">{result.shortUrl}</code>
          <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-8 w-8 rounded-full">
            {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
