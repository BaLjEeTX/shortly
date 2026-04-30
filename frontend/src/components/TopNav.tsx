import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { UrlCreateForm } from "./UrlCreateForm";

export function TopNav() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className="sticky top-0 z-50 w-full bg-black/60 backdrop-blur-2xl border-b border-white/[0.06]">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between h-16 px-4 md:px-6">
        {/* Logo */}
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/40 transition-shadow duration-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.02a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" transform="translate(2,2) scale(0.85)" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight gradient-text hidden sm:block">Shortly</span>
        </Link>

        {/* Center: URL Create Form */}
        <div className="flex-1 max-w-xl mx-4 hidden md:block">
          <UrlCreateForm />
        </div>

        {/* Right: User actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={logout}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 px-3 py-1.5 rounded-lg hover:bg-white/5"
          >
            Logout
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold ring-2 ring-violet-500/20">
            U
          </div>
        </div>
      </div>

      {/* Mobile URL form */}
      <div className="md:hidden px-4 pb-3">
        <UrlCreateForm />
      </div>
    </header>
  );
}
