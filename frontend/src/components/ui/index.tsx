import React from "react";

/* ─── Button ─── */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
}

export function Button({
  className = "",
  variant = "default",
  size = "md",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center font-medium transition-all duration-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

  const variants: Record<string, string> = {
    default:
      "bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:brightness-110 active:scale-[0.98]",
    outline:
      "bg-white/5 border border-white/10 text-foreground hover:bg-white/10 hover:border-white/20 active:scale-[0.98]",
    ghost:
      "text-muted-foreground hover:text-foreground hover:bg-white/5",
    destructive:
      "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:text-red-300",
  };

  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-xs gap-1.5",
    md: "h-10 px-5 text-sm gap-2",
    lg: "h-12 px-6 text-base gap-2.5",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

/* ─── Input ─── */
export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-foreground placeholder:text-muted-foreground/60 transition-all duration-200 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 focus:bg-white/[0.07] ${className}`}
      {...props}
    />
  );
}

/* ─── GlassCard ─── */
interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  hover?: boolean;
}

export function GlassCard({
  className = "",
  glow = false,
  hover = false,
  children,
  ...props
}: GlassCardProps) {
  const hoverClass = hover
    ? "hover:bg-white/[0.06] hover:border-white/[0.12] hover:shadow-lg hover:shadow-white/[0.02] hover:-translate-y-0.5"
    : "";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] shadow-xl transition-all duration-300 ${hoverClass} ${className}`}
      {...props}
    >
      {glow && (
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      )}
      {children}
    </div>
  );
}

/* ─── Badge ─── */
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning";
}

export function Badge({
  className = "",
  variant = "default",
  ...props
}: BadgeProps) {
  const variants: Record<string, string> = {
    default: "bg-white/10 text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-transparent ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
