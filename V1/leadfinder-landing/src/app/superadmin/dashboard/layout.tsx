import SuperAdminClient from '@/components/admin/SuperAdminClient';

export default function SuperAdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="/superadmin-assets/theme.css" />
      <SuperAdminClient>{children}</SuperAdminClient>
    </>
  );
}
