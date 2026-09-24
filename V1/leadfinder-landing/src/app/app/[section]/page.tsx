import type { Metadata } from 'next';
import DashboardClient from '@/components/dashboard/DashboardClient';

const sections = [
  'overview',
  'business',
  'assistant',
  'targeting',
  'lead-finder',
  'leads',
  'campaigns',
  'inbox',
  'templates',
  'reports',
  'do-not-contact',
  'integrations',
  'dashboard',
  'knowledge',
  'finder',
  'conversations',
  'suppressions',
  'settings',
  'outreach',
] as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}

export const metadata: Metadata = {
  title: 'Workspace · LeadGenPilot',
  robots: { index: false, follow: false },
};

export default function AppSectionPage() {
  return <DashboardClient />;
}
