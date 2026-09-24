'use client';

import dynamic from 'next/dynamic';

const AuthGate = dynamic(() => import('../../../../src/AuthGate'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
      Opening your workspace…
    </div>
  ),
});

export default function DashboardClient() {
  return (
    <div className="dashboard-scope min-h-screen" data-frontend="nextjs">
      <AuthGate />
    </div>
  );
}
