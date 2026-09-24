'use client';

import Image from 'next/image';
import { FormEvent, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

export default function SuperAdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/superadmin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password, secret }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setError(data.error || 'Login failed. Check your credentials and superadmin secret.');
        return;
      }
      sessionStorage.setItem('superadmin_user', JSON.stringify(data.user));
      window.location.href = '/superadmin/dashboard';
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'h-11 w-full rounded-xl border border-slate-700/80 bg-slate-900/70 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050816] p-5 text-white">
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_15%_15%,rgba(99,102,241,.28),transparent_30%),radial-gradient(circle_at_85%_80%,rgba(139,92,246,.18),transparent_32%)]" />
      <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:40px_40px]" />

      <section className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/75 p-7 shadow-2xl shadow-indigo-950/50 backdrop-blur-2xl sm:p-9">
        <a href="/" className="mb-7 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-white"><ArrowLeft className="h-3.5 w-3.5" />Back to website</a>
        <div className="flex items-center justify-between gap-4">
          <Image src="/assets/logo/logo-dark.png" alt="LeadGenPilot" width={158} height={40} priority className="h-8 w-auto" />
          <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-300">Restricted</span>
        </div>

        <div className="mt-8">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-300"><ShieldCheck className="h-5 w-5" /></div>
          <h1 className="text-2xl font-bold tracking-tight">Admin command center</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Authenticate with your administrator credentials and private access secret. Every attempt is audited.</p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={submit} autoComplete="off">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-300">Admin email</span>
            <span className="relative block"><Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" autoComplete="username" required /></span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-300">Password</span>
            <span className="relative block"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your administrator password" autoComplete="current-password" required /></span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-300">Superadmin secret</span>
            <span className="relative block"><ShieldCheck className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input className={`${inputClass} pr-11`} type={showSecret ? 'text' : 'password'} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Private environment secret" autoComplete="off" required /><button className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 transition hover:text-white" type="button" onClick={() => setShowSecret((value) => !value)} aria-label={showSecret ? 'Hide secret' : 'Show secret'}>{showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
          </label>

          {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-3 text-xs leading-5 text-rose-200" role="alert">{error}</div>}

          <button className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" disabled={busy} type="submit">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Verifying access…</> : 'Open admin console'}
          </button>
        </form>
        <p className="mt-6 text-center text-[11px] text-slate-500">Protected by signed sessions, rate limits, and audit logging.</p>
      </section>
    </main>
  );
}
