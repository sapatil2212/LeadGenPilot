import {
  Activity,
  BadgeIndianRupee,
  BellRing,
  BriefcaseBusiness,
  Building2,
  CreditCard,
  Eye,
  FileClock,
  Flag,
  Gauge,
  Grid2X2,
  ReceiptText,
  Repeat2,
  Settings2,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface AdminRoute {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface AdminRouteGroup {
  label: string;
  items: AdminRoute[];
}

export const ADMIN_BASE = '/superadmin/dashboard';

export const ADMIN_ROUTE_GROUPS: readonly AdminRouteGroup[] = [
  { label: 'Overview', items: [{ key: 'overview', label: 'Command center', path: '', icon: Grid2X2 }] },
  {
    label: 'Customers',
    items: [
      { key: 'users', label: 'Users', path: 'users', icon: Users },
      { key: 'tenants', label: 'Workspaces', path: 'tenants', icon: Building2 },
      { key: 'leads', label: 'Leads', path: 'leads', icon: BriefcaseBusiness },
    ],
  },
  {
    label: 'Billing',
    items: [
      { key: 'billing', label: 'Revenue', path: 'billing', icon: BadgeIndianRupee },
      { key: 'subscriptions', label: 'Subscriptions', path: 'subscriptions', icon: Repeat2 },
      { key: 'invoices', label: 'Invoices', path: 'invoices', icon: ReceiptText },
      { key: 'payments', label: 'Payments', path: 'payments', icon: CreditCard },
      { key: 'plans', label: 'Plans', path: 'plans', icon: Tags },
    ],
  },
  { label: 'Growth', items: [{ key: 'visitors', label: 'Traffic', path: 'visitors', icon: Eye }] },
  {
    label: 'Platform',
    items: [
      { key: 'flags', label: 'Feature flags', path: 'flags', icon: Flag },
      { key: 'announcements', label: 'Announcements', path: 'announcements', icon: BellRing },
      { key: 'audit', label: 'Audit log', path: 'audit', icon: FileClock },
      { key: 'settings', label: 'Settings', path: 'settings', icon: Settings2 },
      { key: 'health', label: 'System health', path: 'health', icon: Gauge },
    ],
  },
] as const;

export const ADMIN_ROUTES = ADMIN_ROUTE_GROUPS.flatMap((group) => group.items);

export function adminPath(key: string): string {
  const route = ADMIN_ROUTES.find((item) => item.key === key) ?? ADMIN_ROUTES[0];
  return route.path ? `${ADMIN_BASE}/${route.path}` : ADMIN_BASE;
}

export function adminKeyFromPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  const suffix = normalized.startsWith(ADMIN_BASE)
    ? normalized.slice(ADMIN_BASE.length).replace(/^\//, '')
    : '';
  return ADMIN_ROUTES.find((item) => item.path === suffix)?.key ?? 'overview';
}

export const ADMIN_SECTIONS = ADMIN_ROUTES.filter((item) => item.path).map((item) => item.path);

export const AdminActivityIcon = Activity;
