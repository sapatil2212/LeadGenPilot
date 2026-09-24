/**
 * Canonical routes for every product-dashboard destination.
 *
 * The dashboard deliberately uses the browser History API instead of adding a
 * routing dependency: every panel already lives in App, while Express already
 * serves the SPA shell for nested /app paths. Keeping path parsing here gives
 * sidebar links, page headers, deep links and Back/Forward one source of truth.
 */

export type DashboardTab =
  | "dashboard"
  | "business"
  | "assistant"
  | "targeting"
  | "finder"
  | "leads"
  | "campaigns"
  | "conversations"
  | "templates"
  | "reports"
  | "suppressions"
  | "settings"
  | "outreach";

export type DashboardGroup = "overview" | "foundation" | "generation" | "outreach" | "workspace";

export interface DashboardRoute {
  id: Exclude<DashboardTab, "outreach">;
  path: string;
  label: string;
  title: string;
  description: string;
  group: DashboardGroup;
}

export const DASHBOARD_GROUPS: readonly { id: DashboardGroup; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "foundation", label: "Business foundation" },
  { id: "generation", label: "Lead generation" },
  { id: "outreach", label: "Outreach" },
  { id: "workspace", label: "Workspace" },
];

export const DASHBOARD_ROUTES: readonly DashboardRoute[] = [
  {
    id: "dashboard",
    path: "/app/overview",
    label: "Overview",
    title: "Dashboard Overview",
    description: "Monitor lead quality, outreach activity and workspace health.",
    group: "overview",
  },
  {
    id: "business",
    path: "/app/business",
    label: "Business & AI",
    title: "Business Knowledge",
    description: "Upload your existing files and let AI build your company profile, products and services.",
    group: "foundation",
  },
  {
    id: "assistant",
    path: "/app/assistant",
    label: "Assistant",
    title: "AI Assistant",
    description: "Ask questions using your workspace's trusted business context.",
    group: "foundation",
  },
  {
    id: "targeting",
    path: "/app/targeting",
    label: "Targeting",
    title: "Targeting & Scoring",
    description: "Define ideal customers and prioritize the strongest opportunities.",
    group: "generation",
  },
  {
    id: "finder",
    path: "/app/lead-finder",
    label: "Lead Finder",
    title: "Geo Lead Finder",
    description: "Discover local prospects by category, location and search radius.",
    group: "generation",
  },
  {
    id: "leads",
    path: "/app/leads",
    label: "Leads",
    title: "Leads Database",
    description: "Review, filter, enrich and organize every discovered lead.",
    group: "generation",
  },
  {
    id: "campaigns",
    path: "/app/campaigns",
    label: "Campaigns",
    title: "Campaigns",
    description: "Generate, review, approve and dispatch personalized outreach.",
    group: "outreach",
  },
  {
    id: "conversations",
    path: "/app/inbox",
    label: "Inbox",
    title: "Conversations",
    description: "Manage replies and continue prospect conversations in one place.",
    group: "outreach",
  },
  {
    id: "templates",
    path: "/app/templates",
    label: "Templates",
    title: "Outreach Templates",
    description: "Create reusable email and WhatsApp messaging frameworks.",
    group: "outreach",
  },
  {
    id: "reports",
    path: "/app/reports",
    label: "Reports",
    title: "Outreach Reports",
    description: "Track campaign dispatch, delivery performance and history.",
    group: "outreach",
  },
  {
    id: "suppressions",
    path: "/app/do-not-contact",
    label: "Do Not Contact",
    title: "Do Not Contact",
    description: "Protect opted-out recipients across every outreach channel.",
    group: "workspace",
  },
  {
    id: "settings",
    path: "/app/integrations",
    label: "Integrations",
    title: "Outreach & Integrations",
    description: "Connect email, WhatsApp, Google Sheets and external services.",
    group: "workspace",
  },
];

const routeById = new Map<DashboardRoute["id"], DashboardRoute>(
  DASHBOARD_ROUTES.map((route) => [route.id, route])
);

const routeByPath = new Map<string, DashboardRoute>(
  DASHBOARD_ROUTES.map((route) => [route.path, route])
);

/** Old and intuitive URLs accepted on input but never emitted as canonical links. */
const PATH_ALIASES: Readonly<Record<string, DashboardRoute["id"]>> = {
  "/app/dashboard": "dashboard",
  "/app/knowledge": "business",
  "/app/finder": "finder",
  "/app/conversations": "conversations",
  "/app/suppressions": "suppressions",
  "/app/settings": "settings",
  "/app/outreach": "campaigns",
};

function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  return path || "/";
}

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === "string" &&
    (value === "outreach" || DASHBOARD_ROUTES.some((route) => route.id === value));
}

export function routeForTab(tab: DashboardTab): DashboardRoute {
  return routeById.get(tab === "outreach" ? "campaigns" : tab) || routeById.get("dashboard")!;
}

/** Resolves canonical routes and compatibility aliases; bare /app is handled separately. */
export function routeFromPath(pathname: string): DashboardRoute | null {
  const normalized = normalizePath(pathname);
  const direct = routeByPath.get(normalized);
  if (direct) return direct;
  const alias = PATH_ALIASES[normalized];
  return alias ? routeById.get(alias)! : null;
}

export function isBareAppPath(pathname: string): boolean {
  return normalizePath(pathname) === "/app";
}

/** Pathname wins for deep links; storage is only a migration fallback for bare /app. */
export function initialDashboardRoute(pathname: string, savedTab: string | null): DashboardRoute {
  const fromPath = routeFromPath(pathname);
  if (fromPath) return fromPath;
  if (isBareAppPath(pathname) && isDashboardTab(savedTab)) return routeForTab(savedTab);
  return routeForTab("dashboard");
}

/** Preserves useful query/hash state while removing the auth-only mode parameter. */
export function dashboardUrl(route: DashboardRoute, currentHref?: string): string {
  if (!currentHref) return route.path;
  const url = new URL(currentHref);
  url.pathname = route.path;
  url.searchParams.delete("mode");
  return `${url.pathname}${url.search}${url.hash}`;
}
