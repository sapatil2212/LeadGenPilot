import type { Metadata } from 'next';
import { ADMIN_SECTIONS } from '@/components/admin/admin-routes';

export const dynamicParams = false;

export function generateStaticParams() {
  return ADMIN_SECTIONS.map((section) => ({ section }));
}

export const metadata: Metadata = {
  title: 'Admin Console · LeadGenPilot',
  robots: { index: false, follow: false },
};

export default function SuperAdminSectionPage() {
  return null;
}
