import type { Metadata } from 'next';
import DashboardClient from '@/components/dashboard/DashboardClient';

export const metadata: Metadata = {
  title: 'Workspace · LeadGenPilot',
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <DashboardClient />;
}
