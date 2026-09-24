import type { Metadata } from 'next';
import SuperAdminLogin from '@/components/admin/SuperAdminLogin';

export const metadata: Metadata = {
  title: 'Admin Sign In · LeadGenPilot',
  description: 'Restricted LeadGenPilot administrator access.',
  robots: { index: false, follow: false },
};

export default function SuperAdminLoginPage() {
  return <SuperAdminLogin />;
}
