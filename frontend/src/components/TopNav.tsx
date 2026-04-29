import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { Button } from "./ui";
import { UrlCreateForm } from "./UrlCreateForm";

export function TopNav() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center justify-between bg-background px-4 py-2 border-b border-border shadow-sm">
      <div className="flex items-center gap-4">
        {/* Placeholder Hamburger */}
        <Button variant="ghost" size="icon" className="rounded-full">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 stroke-foreground">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </Button>
        <Link to="/dashboard" className="flex items-center gap-1 font-bold text-xl tracking-tight">
          <div className="bg-primary text-primary-foreground p-1 rounded-md flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
            </svg>
          </div>
          <span>Shortly</span>
        </Link>
      </div>

      <div className="hidden md:flex flex-1 max-w-2xl px-6">
        <UrlCreateForm />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={logout} className="rounded-full">
          Logout
        </Button>
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
          {/* User Initial */}
          U
        </div>
      </div>
    </nav>
  );
}
