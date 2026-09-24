'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Menu, Moon, RefreshCw, ShieldCheck, Sun, X } from 'lucide-react';
import {
  ADMIN_ROUTE_GROUPS,
  ADMIN_ROUTES,
  adminKeyFromPath,
  adminPath,
} from './admin-routes';

type AdminIdentity = { email?: string; kind?: string; environment?: string };
type PageController = { refresh?: () => void } | null;
type LegacyPage = {
  title: string;
  subtitle?: string;
  render: (container: HTMLElement, context: Record<string, unknown>) => Promise<PageController>;
};
type AdminRuntime = {
  UI: any;
  Pages: Record<string, LegacyPage>;
  me: AdminIdentity;
  currency: string;
};

declare global {
  interface Window {
    UI?: any;
    Pages?: Record<string, LegacyPage>;
    Charts?: any;
  }
}

const LEGACY_SCRIPTS = [
  '/superadmin-assets/charts.js',
  '/superadmin-assets/ui.js',
  '/superadmin-assets/pages-core.js',
  '/superadmin-assets/pages-billing.js',
  '/superadmin-assets/pages-platform.js',
] as const;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing ?? document.createElement('script');
    const done = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    if (!existing) {
      script.src = src;
      script.defer = false;
      document.body.appendChild(script);
    }
  });
}

function PageSkeleton() {
  return (
    <div className="col" style={{ gap: 12 }} role="status" aria-live="polite">
      {[0, 1].map((item) => (
        <div className="card card-pad" key={item}>
          <div className="skeleton" style={{ width: '30%', height: 16, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '100%', height: 60 }} />
        </div>
      ))}
    </div>
  );
}

export default function SuperAdminClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/superadmin/dashboard';
  const router = useRouter();
  const pageHostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<AdminRuntime | null>(null);
  const currentPageRef = useRef<PageController>(null);
  const pendingQueryRef = useRef<Record<string, unknown>>({});
  const renderPageRef = useRef<(key: string, query?: Record<string, unknown>) => Promise<void>>(async () => undefined);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState(() => adminKeyFromPath(pathname));
  const [pageMeta, setPageMeta] = useState({ title: 'Command center', subtitle: 'Platform operations at a glance.' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const navigate = useCallback((key: string, query: Record<string, unknown> = {}) => {
    const nextPath = adminPath(key);
    pendingQueryRef.current = query;
    setSidebarOpen(false);
    if (nextPath === window.location.pathname.replace(/\/$/, '')) {
      void renderPageRef.current(key, query);
      return;
    }
    router.push(nextPath);
  }, [router]);

  const renderPage = useCallback(async (key: string, query: Record<string, unknown> = {}) => {
    const runtime = runtimeRef.current;
    const host = pageHostRef.current;
    if (!runtime || !host) return;

    const safeKey = runtime.Pages[key] ? key : 'overview';
    const page = runtime.Pages[safeKey];
    setActiveKey(safeKey);
    setPageMeta({ title: page.title, subtitle: page.subtitle || '' });
    document.title = `${page.title} · LeadGenPilot Admin`;
    host.innerHTML = '<div class="col" style="gap:12px"><div class="card card-pad"><div class="skeleton" style="width:30%;height:16px;margin-bottom:14px"></div><div class="skeleton" style="width:100%;height:60px"></div></div><div class="card card-pad"><div class="skeleton" style="width:30%;height:16px;margin-bottom:14px"></div><div class="skeleton" style="width:100%;height:60px"></div></div></div>';
    currentPageRef.current = null;

    try {
      currentPageRef.current = await page.render(host, {
        currency: runtime.currency,
        me: runtime.me,
        navigate,
        query,
      });
    } catch (caught) {
      if (runtime.UI.RedirectingError && caught instanceof runtime.UI.RedirectingError) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      host.innerHTML = `<div class="notice notice-error"><div><strong>Could not open this page.</strong><br>${runtime.UI.esc(message)}</div></div>`;
      runtime.UI.Toast.fromError(caught);
    }
  }, [navigate]);

  renderPageRef.current = renderPage;

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        for (const src of LEGACY_SCRIPTS) await loadScript(src);
        if (cancelled || !window.UI || !window.Pages) return;
        const UI = window.UI;
        UI.Theme.init();
        setTheme(UI.Theme.current());

        let me: AdminIdentity;
        try {
          me = await UI.Api.get('/me');
        } catch (caught) {
          if (UI.RedirectingError && caught instanceof UI.RedirectingError) return;
          me = { email: 'Administrator', kind: 'superadmin_console', environment: '' };
        }

        let currency = 'INR';
        try {
          const settings = await UI.Api.get('/platform/settings');
          const currencyRow = settings.rows?.find((row: { key: string }) => row.key === 'billing.currency');
          if (currencyRow?.value) currency = String(currencyRow.value);
        } catch (caught) {
          if (UI.RedirectingError && caught instanceof UI.RedirectingError) return;
        }

        if (cancelled) return;
        runtimeRef.current = { UI, Pages: window.Pages, me, currency };
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'The admin console could not be loaded.');
        setStatus('error');
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    const query = pendingQueryRef.current;
    pendingQueryRef.current = {};
    void renderPage(adminKeyFromPath(pathname), query);
  }, [pathname, renderPage, status]);

  const toggleTheme = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.UI.Theme.toggle();
    setTheme(runtime.UI.Theme.current());
  };

  const logout = async () => {
    try {
      await fetch('/api/superadmin/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Navigation still clears the browser-visible admin state.
    }
    sessionStorage.removeItem('superadmin_user');
    window.location.href = '/superadmin';
  };

  const identity = runtimeRef.current?.me;
  const initial = (identity?.email || 'A').charAt(0).toUpperCase();

  if (status === 'loading') {
    return (
      <div id="authGate">
        <div className="inner">
          <span className="spinner" style={{ width: 26, height: 26 }} />
          <div>Verifying your admin session…</div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-slate-900 p-7 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-rose-400" />
          <h1 className="mt-4 text-lg font-bold">Admin console unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <button className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </main>
    );
  }

  return (
    <div className="admin-next-shell app-shell" data-theme={theme} data-frontend="nextjs">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
        <div className="sidebar-brand">
          <a href="/" aria-label="LeadGenPilot home" className="flex min-w-0 items-center">
            <Image className="brand-logo brand-logo--light" src="/assets/logo/logo.png" alt="LeadGenPilot" width={150} height={32} priority />
            <Image className="brand-logo brand-logo--dark" src="/assets/logo/logo-dark.png" alt="LeadGenPilot" width={150} height={32} priority />
          </a>
          <span className="brand-badge">Admin</span>
          <button className="btn btn-ghost btn-icon ml-auto lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Admin navigation">
          {ADMIN_ROUTE_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    className={`nav-item ${activeKey === item.key ? 'active' : ''}`}
                    href={adminPath(item.key)}
                    key={item.key}
                    aria-current={activeKey === item.key ? 'page' : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                      event.preventDefault();
                      navigate(item.key);
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="admin-card">
            <div className="avatar">{initial}</div>
            <div className="admin-meta">
              <div className="admin-email" title={identity?.email}>{identity?.email || 'Administrator'}</div>
              <div className="admin-role">{identity?.kind === 'superadmin_console' ? 'Superadmin' : 'Admin'}</div>
            </div>
          </div>
          <button className="btn btn-sm w-full" onClick={logout}><LogOut /> Sign out</button>
        </div>
      </aside>

      <button className={`scrim ${sidebarOpen ? '' : 'hidden'}`} aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="min-w-0">
            <div className="topbar-title">{pageMeta.title}</div>
            <div className="topbar-sub truncate">{pageMeta.subtitle}</div>
          </div>
          <div className="topbar-spacer" />
          <span className="live-pill"><span className="live-dot" />Live</span>
          <button className="btn btn-sm btn-icon" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
            {theme === 'dark' ? <Moon /> : <Sun />}
          </button>
          <button className="btn btn-sm btn-icon" onClick={() => currentPageRef.current?.refresh?.()} title="Refresh current page" aria-label="Refresh current page"><RefreshCw /></button>
        </header>
        <div className="page" ref={pageHostRef}><PageSkeleton /></div>
      </div>
      <div id="toasts" />
      <div hidden>{children}</div>
    </div>
  );
}
