import React from 'react';

export function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-800 px-3 py-3">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500 disabled:bg-slate-700',
  default: 'bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:bg-slate-900',
  danger: 'bg-red-700 text-white hover:bg-red-600 disabled:bg-slate-700',
  ghost: 'bg-transparent text-slate-300 hover:bg-slate-800 disabled:text-slate-600',
};

export function Button({
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 ' +
  'placeholder:text-slate-600 focus:border-sky-600 focus:outline-none';

export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'sky';
  children: React.ReactNode;
}) {
  const tones = {
    slate: 'bg-slate-800 text-slate-300',
    green: 'bg-emerald-900/60 text-emerald-300',
    amber: 'bg-amber-900/60 text-amber-300',
    red: 'bg-red-900/60 text-red-300',
    sky: 'bg-sky-900/60 text-sky-300',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Callout({
  tone,
  children,
}: {
  tone: 'warn' | 'error' | 'info';
  children: React.ReactNode;
}) {
  const tones = {
    warn: 'border-amber-800 bg-amber-950/50 text-amber-200',
    error: 'border-red-800 bg-red-950/50 text-red-200',
    info: 'border-slate-700 bg-slate-900 text-slate-300',
  };
  return (
    <div className={`rounded border px-2.5 py-2 text-[11px] leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}
