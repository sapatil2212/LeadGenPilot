/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import WhatsAppLogo from "./WhatsAppLogo";
import { 
  Terminal as TerminalIcon, 
  Settings, 
  Play, 
  RefreshCw, 
  FileSpreadsheet, 
  AlertCircle, 
  CheckCircle2, 
  Copy, 
  ExternalLink, 
  Database,
  Search,
  BookOpen,
  Info,
  Trash2,
  Mail,
  Send,
  Smartphone,
  X,
  LayoutDashboard,
  MapPin,
  Map,
  Sliders,
  Check,
  AlertTriangle,
  LogOut,
  Shield,
  Loader2,
  Sparkles,
  Sun,
  Moon,
  ChevronUp,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  PencilLine,
  SlidersHorizontal,
  Tag,
  Calendar,
  ArrowUpDown,
  ListFilter,
  User,
  CreditCard,
  Phone,
  MessageSquare,
  Layout,
  Eye,
  Code2,
  ArrowRight,
  ArrowLeft,
  ListChecks,
  FileText,
  BarChart3,
  Save,
  ChevronLeft,
  ChevronRight,
  Building2,
  Bot,
  Target,
  ShieldOff,
  Flame,
  TrendingUp,
  Activity,
  ArrowUpRight,
  Compass,
  Zap,
  type LucideIcon
} from "lucide-react";
import { Lead, LeadList } from "./types";
import { ModalPortal } from "./ui/primitives";
import {
  DASHBOARD_GROUPS,
  DASHBOARD_ROUTES,
  dashboardUrl,
  initialDashboardRoute,
  routeForTab,
  routeFromPath,
  type DashboardTab,
} from "./dashboardRoutes";
import { generateOutreachCopy } from "./outreachCopy";
import {
  OutreachTemplate,
  loadOutreachTemplates,
  compileTemplateText,
  compileTemplateSubject,
} from "./outreachTemplates";
import TemplateDropdown from "./TemplateDropdown";
import SearchableDropdown from "./SearchableDropdown";
import AlertModal, { AlertModalType } from "./AlertModal";

/**
 * One tab is visible at a time, so the code for the other twelve does not need to
 * be in the first download. Each panel is fetched when its tab is first opened.
 *
 * This matters most for the panels that carry libraries of their own: the report
 * panel pulls in the charting library and the document exporters, which together
 * were a large share of a single 2.7 MB bundle that every user paid for on first
 * load, including users who never opened Reports.
 */
const IntegrationSettings = lazy(() => import("./IntegrationSettings"));
const EmailTemplates = lazy(() => import("./EmailTemplates"));
const CampaignReport = lazy(() => import("./CampaignReport"));
const Conversations = lazy(() => import("./Conversations"));
const BusinessPanel = lazy(() => import("./features/BusinessPanel"));
const AssistantPanel = lazy(() => import("./features/AssistantPanel"));
const TargetingPanel = lazy(() => import("./features/TargetingPanel"));
const CampaignPanel = lazy(() => import("./features/CampaignPanel"));
const SuppressionPanel = lazy(() => import("./features/SuppressionPanel"));
const LeadsWorkspace = lazy(() => import("./features/LeadsWorkspace"));

const DASHBOARD_ROUTE_ICONS: Record<DashboardTab, LucideIcon> = {
  dashboard: LayoutDashboard,
  business: Building2,
  assistant: Bot,
  targeting: Target,
  finder: MapPin,
  leads: Database,
  campaigns: Send,
  conversations: MessageSquare,
  templates: Layout,
  reports: BarChart3,
  suppressions: ShieldOff,
  settings: Settings,
  outreach: Send,
};
// The spreadsheet, PDF and Word writers are only reachable from the export
// buttons, so they are fetched at the moment a user clicks one rather than
// shipped to every user who never exports anything.

interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan?: string;
  emailVerified: boolean;
}

interface Entitlements {
  planName: string;
  monthlyLeadLimit: number | null;
  whatsappOutreach: boolean;
  aiInsights: boolean;
  prioritySupport: boolean;
  customIntegrations: boolean;
}

interface UsageInfo {
  used: number;
  limit: number | null;
  remaining: number | null;
  period: string;
  unlimited: boolean;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface AppProps {
  currentUser?: AuthedUser | null;
  currentWorkspace?: WorkspaceSummary | null;
  entitlements?: Entitlements | null;
  usage?: UsageInfo | null;
  onLogout?: () => void;
  onRefreshAccount?: () => void;
}

export default function App({ currentUser, currentWorkspace, entitlements, usage, onLogout, onRefreshAccount }: AppProps = {}) {
  // When entitlements are absent (auth disabled / admin), everything is unlocked.
  const canWhatsapp = entitlements ? entitlements.whatsappOutreach : true;
  const canAiInsights = entitlements ? entitlements.aiInsights : true;
  const planName = entitlements?.planName || (currentUser?.plan ? currentUser.plan : "");
  const isFreePlan = !!entitlements && !entitlements.whatsappOutreach;
  const initialBusinessTab = useRef<"learn" | "knowledge">(
    typeof window !== "undefined" &&
      (window.location.pathname.replace(/\/+$/, "") === "/app/knowledge" ||
        (window.location.pathname.replace(/\/+$/, "") === "/app" &&
          (localStorage.getItem("leadgenpilot_activeTab") || localStorage.getItem("nexaleadai_activeTab")) === "knowledge"))
      ? "knowledge"
      : "learn"
  );
  // URL-based navigation. Pathname wins on deep links; the previous localStorage
  // preference is used only when someone enters through bare /app.
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("leadgenpilot_activeTab") || localStorage.getItem("nexaleadai_activeTab")) : null;
    // Keep the migration explicit here as well as in routeForTab because this
    // guards bare-/app entry before any navigation event can run.
    const migratedSaved =
      saved === "outreach" ? "campaigns" : saved === "knowledge" ? "business" : saved;
    const pathname = typeof window !== "undefined" ? window.location.pathname : "/app";
    return initialDashboardRoute(pathname, migratedSaved).id;
  });

  const navigateToTab = useCallback(
    (tab: DashboardTab, options: { replace?: boolean } = {}) => {
      const route = routeForTab(tab);
      if (typeof window !== "undefined") {
        const nextUrl = dashboardUrl(route, window.location.href);
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextUrl !== currentUrl) {
          const method = options.replace ? "replaceState" : "pushState";
          window.history[method]({ dashboardTab: route.id }, "", nextUrl);
        }
      }
      setActiveTab(route.id);
    },
    []
  );

  // Canonicalize bare, legacy and unknown paths and remove the auth-only mode
  // parameter after the dashboard has loaded.
  useEffect(() => {
    const route = routeForTab(activeTab);
    const nextUrl = dashboardUrl(route, window.location.href);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({ dashboardTab: route.id }, "", nextUrl);
    }
    document.title = `${route.title} · LeadGenPilot`;
  }, [activeTab]);

  // Browser Back/Forward is a first-class navigation path, not just sidebar
  // clicks. Invalid history entries safely resolve to Overview.
  useEffect(() => {
    const onPopState = () => {
      const route = routeFromPath(window.location.pathname) || routeForTab("dashboard");
      const canonicalUrl = dashboardUrl(route, window.location.href);
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (canonicalUrl !== currentUrl) {
        window.history.replaceState({ dashboardTab: route.id }, "", canonicalUrl);
      }
      setActiveTab(route.id);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    localStorage.setItem("leadgenpilot_activeTab", activeTab);
  }, [activeTab]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("leadgenpilot_sidebar_collapsed") || localStorage.getItem("nexaleadai_sidebar_collapsed")) : null;
    return saved === "true";
  });
  useEffect(() => {
    localStorage.setItem("leadgenpilot_sidebar_collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("leadgenpilot_theme") || localStorage.getItem("nexaleadai_theme")) : null;
    return (saved as "light" | "dark") || "light";
  });

  useEffect(() => {
    localStorage.setItem("leadgenpilot_theme", theme);
    // Expose the active theme on <html> so global CSS (e.g. scrollbar colors)
    // can adapt without threading theme props through every component.
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Config state
  const [businessType, setBusinessType] = useState("Dental Clinic");
  const [location, setLocation] = useState("Baner Pune");
  const [maxResults, setMaxResults] = useState(10);
  const [enableSimulation, setEnableSimulation] = useState(false);
  const [headless, setHeadless] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSuccess, setConfigSuccess] = useState(false);

  // Geocoding Coordinates and radius
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [radius, setRadius] = useState<number>(5); // Default 5km
  const [mapSearchText, setMapSearchText] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Scraper status
  const [isRunning, setIsRunning] = useState(false);
  const [isStartingScraper, setIsStartingScraper] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  // Data logs & results
  const [terminalLogs, setTerminalLogs] = useState("Initializing LeadGenPilot Terminal...\nReady.");
  const activeScrapeJobIdRef = useRef<string | null>(null);
  const reportedTerminalJobIdRef = useRef<string | null>(null);
  // Last log sequence number consumed from the job's own feed, so each poll
  // fetches only new lines instead of re-appending the whole run.
  const scrapeLogSeqRef = useRef(0);
  const isFetchingScrapeLogsRef = useRef(false);
  const [processedLeads, setProcessedLeads] = useState<Lead[]>([]);
  const [failedLeads, setFailedLeads] = useState<Lead[]>([]);
  
  // UI preferences (Persisted)
  const [activeDataView, setActiveDataView] = useState<"logs" | "processed" | "failed" | "webhook">(() => {
    const saved = localStorage.getItem("leadgenpilot_activeDataView") || localStorage.getItem("nexaleadai_activeDataView");
    return (saved as any) || "logs";
  });
  const [isRetryingFailed, setIsRetryingFailed] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [showCampaignActivity, setShowCampaignActivity] = useState(false);
  const [showTargetLeads, setShowTargetLeads] = useState(false);

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [selectedLeadDetails, setSelectedLeadDetails] = useState<Lead | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, fieldKey: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // WhatsApp & SMTP Configurations
  const [whatsappStatus, setWhatsappStatus] = useState({ status: "DISCONNECTED", qr: "" });
  const [userIntegrations, setUserIntegrations] = useState<any[]>([]);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);
  const [smtpSuccess, setSmtpSuccess] = useState(false);
  const [isDisconnectingWa, setIsDisconnectingWa] = useState(false);
  const [isSendingTestMsg, setIsSendingTestMsg] = useState(false);

  // Outreach Campaign parameters
  const [campaignDelay, setCampaignDelay] = useState(30);
  const [campaignEnableEmail, setCampaignEnableEmail] = useState(true);
  const [campaignEnableWhatsapp, setCampaignEnableWhatsapp] = useState(true);
  const [campaignDryRun, setCampaignDryRun] = useState(false);
  const [campaignSheets, setCampaignSheets] = useState<string[]>([]);
  const [selectedCampaignSheet, setSelectedCampaignSheet] = useState<string>("");
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);
  const [previewCopy, setPreviewCopy] = useState<{ emailSubject: string; emailBody: string; whatsappMessage: string } | null>(null);
  const [isLoadingPreviewCopy, setIsLoadingPreviewCopy] = useState(false);

  // Campaign Wizard — step-by-step flow: Source -> Channels -> Template -> Options -> Review
  const [campaignStep, setCampaignStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [campaignSourceType, setCampaignSourceType] = useState<"list" | "sheet">("list");
  const [selectedCampaignListId, setSelectedCampaignListId] = useState<string>("");
  const [campaignPriorities, setCampaignPriorities] = useState<string[]>([]); // empty = all priorities
  const [campaignSkipSent, setCampaignSkipSent] = useState(true);
  const [campaignEmailTemplates, setCampaignEmailTemplates] = useState<OutreachTemplate[]>([]);
  const [campaignWhatsappTemplates, setCampaignWhatsappTemplates] = useState<OutreachTemplate[]>([]);
  const [campaignEmailTemplateId, setCampaignEmailTemplateId] = useState<string>("");
  const [campaignWhatsappTemplateId, setCampaignWhatsappTemplateId] = useState<string>("");
  const [campaignPreview, setCampaignPreview] = useState<{ total: number; withEmail: number; withPhone: number; sample: { businessName: string; leadPriority: string; hasEmail: boolean; hasPhone: boolean }[] } | null>(null);
  // WhatsApp is only actually enabled when both the toggle AND the plan allow it.
  // Used everywhere the wizard needs to know the true effective channel state
  // (e.g. hiding the WhatsApp template step when the plan blocks the channel).
  const campaignWhatsappEffective = canWhatsapp && campaignEnableWhatsapp;
  const [isLoadingCampaignPreview, setIsLoadingCampaignPreview] = useState(false);
  const [campaignPreviewError, setCampaignPreviewError] = useState<string>("");

  // Outreach Modal
  const [selectedLeadForOutreach, setSelectedLeadForOutreach] = useState<Lead | null>(null);
  const [outreachEmailSubject, setOutreachEmailSubject] = useState("");
  const [outreachEmailBody, setOutreachEmailBody] = useState("");
  // Editable recipient email — pre-filled from the lead, changeable by the user.
  const [outreachEmailTo, setOutreachEmailTo] = useState("");
  const [outreachWhatsappMsg, setOutreachWhatsappMsg] = useState("");
  // Outreach templates + AI copy cache (used to apply templates per lead).
  const [outreachEmailTemplates, setOutreachEmailTemplates] = useState<OutreachTemplate[]>([]);
  const [outreachWhatsappTemplates, setOutreachWhatsappTemplates] = useState<OutreachTemplate[]>([]);
  const [selectedEmailTemplateId, setSelectedEmailTemplateId] = useState("");
  const [selectedWhatsappTemplateId, setSelectedWhatsappTemplateId] = useState("");
  const [aiOutreachCopy, setAiOutreachCopy] = useState<{ emailSubject: string; emailBody: string; whatsappMessage: string } | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSendingWhatsapp, setIsSendingWhatsapp] = useState(false);
  const [outreachEmailViewMode, setOutreachEmailViewMode] = useState<"preview" | "code">("preview");

  // Campaign State
  const [campaignRunning, setCampaignRunning] = useState(false);
  const [campaignProgress, setCampaignProgress] = useState({
    current: 0,
    total: 0,
    status: "Idle",
    secondsRemaining: 0,
    emailsSent: 0,
    whatsappSent: 0,
    emailsFailed: 0,
    whatsappFailed: 0,
    skipped: 0,
  });
  const [isStartingCampaign, setIsStartingCampaign] = useState(false);

  // Reusable interactive alert/success modal (replaces window.alert for outreach).
  const [appModal, setAppModal] = useState<{ isOpen: boolean; type: AlertModalType; title: string; message: string }>({
    isOpen: false,
    type: "success",
    title: "",
    message: "",
  });
  const showAppModal = (type: AlertModalType, title: string, message: string) =>
    setAppModal({ isOpen: true, type, title, message });
  const closeAppModal = () => setAppModal((prev) => ({ ...prev, isOpen: false }));
  const [isStoppingCampaign, setIsStoppingCampaign] = useState(false);

  // Unread conversation count (for the sidebar Inbox badge) — polled globally.
  const [conversationsUnread, setConversationsUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/conversations");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setConversationsUnread(data.totalUnread || 0);
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const [autoScrollLogs, setAutoScrollLogs] = useState<boolean>(() => {
    const saved = localStorage.getItem("leadgenpilot_autoScrollLogs") ?? localStorage.getItem("nexaleadai_autoScrollLogs");
    return saved === null ? true : saved === "true";
  });

  // Account settings modal
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [acctName, setAcctName] = useState("");
  const [acctCurrentPassword, setAcctCurrentPassword] = useState("");
  const [acctNewPassword, setAcctNewPassword] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctMessage, setAcctMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showContactOptions, setShowContactOptions] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  
  // Custom Lead Lists dropdown state
  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState("");
  const listDropdownRef = useRef<HTMLDivElement>(null);

  // Custom Export dropdown state
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
      if (listDropdownRef.current && !listDropdownRef.current.contains(event.target as Node)) {
        setListDropdownOpen(false);
        setListSearchQuery("");
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setExportDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── CRM State ──
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>("ALL");
  const [crmLeads, setCrmLeads] = useState<Lead[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(false);
  const [isLoadingCrmLeads, setIsLoadingCrmLeads] = useState(false);
  const [crmSearchTerm, setCrmSearchTerm] = useState("");
  const [crmPriorityFilter, setCrmPriorityFilter] = useState("ALL");
  const [crmWebsiteFilter, setCrmWebsiteFilter] = useState("ALL");
  const [crmEmailFilter, setCrmEmailFilter] = useState("ALL");
  const [crmWhatsappFilter, setCrmWhatsappFilter] = useState("ALL");
  const [crmDateFrom, setCrmDateFrom] = useState("");
  const [crmDateTo, setCrmDateTo] = useState("");
  const [crmSortBy, setCrmSortBy] = useState("leadScore");
  const [crmSortDir, setCrmSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCrmLeadIds, setSelectedCrmLeadIds] = useState<Set<string>>(new Set());
  const [selectedCrmLeadDetail, setSelectedCrmLeadDetail] = useState<Lead | null>(null);
  // Leads table CRUD: view/edit mode for the detail panel + delete confirmation.
  const [crmDetailMode, setCrmDetailMode] = useState<"view" | "edit">("view");
  const [crmEditDraft, setCrmEditDraft] = useState<{ businessName: string; phone: string; address: string; category: string; website: string; rating: string; reviews: string; leadPriority: "HOT" | "WARM" | "COLD" }>({
    businessName: "", phone: "", address: "", category: "", website: "", rating: "", reviews: "", leadPriority: "COLD",
  });
  const [isSavingCrmEdit, setIsSavingCrmEdit] = useState(false);
  const [crmConfirmModal, setCrmConfirmModal] = useState<{ isOpen: boolean; isLoading: boolean; message: string; onConfirm: () => void }>({
    isOpen: false, isLoading: false, message: "", onConfirm: () => {},
  });
  const [crmNotes, setCrmNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameListValue, setRenameListValue] = useState("");
  const [isDeletingListId, setIsDeletingListId] = useState<string | null>(null);
  const [showCrmFilters, setShowCrmFilters] = useState(false);
  const [overviewMapFilter, setOverviewMapFilter] = useState<"ALL" | "HOT" | "WARM" | "COLD">("ALL");

  // Map refs
  const finderMapInstance = useRef<any>(null);
  const finderMarker = useRef<any>(null);
  const finderCircle = useRef<any>(null);
  const overviewMapInstance = useRef<any>(null);
  const overviewMarkers = useRef<any[]>([]);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const filteredLeads = processedLeads.filter(lead => {
    const matchesSearch = 
      lead.businessName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.category && lead.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (lead.aiInsight && lead.aiInsight.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (lead.emails && lead.emails.some(e => e.toLowerCase().includes(searchTerm.toLowerCase())));
      
    const matchesPriority = priorityFilter === "ALL" || lead.leadPriority === priorityFilter;
    
    return matchesSearch && matchesPriority;
  });

  const downloadCSV = () => {
    if (filteredLeads.length === 0) return;
    
    const headers = [
      "Business Name", "Phone Number", "Address", "Rating", "Reviews", "Website", "Website Status",
      "Instagram URL", "Instagram Status", "Instagram Last Post", "Facebook URL", "Facebook Status",
      "Facebook Last Post", "LinkedIn URL", "LinkedIn Status", "Emails", "Google Analytics Present",
      "Meta Pixel Present", "WhatsApp Present", "Appointment System", "Google Maps URL", "Lead Score",
      "Lead Priority", "Date Added", "AI Insight"
    ];

    const rows = filteredLeads.map(lead => [
      lead.businessName, lead.phone, lead.address, lead.rating, lead.reviews, lead.website, lead.websiteStatus,
      lead.instagramUrl, lead.instagramStatus, lead.instagramLastPost, lead.facebookUrl, lead.facebookStatus,
      lead.facebookLastPost, lead.linkedinUrl, lead.linkedinStatus, lead.emails ? lead.emails.join("; ") : "",
      lead.googleAnalyticsPresent ? "Yes" : "No", lead.metaPixelPresent ? "Yes" : "No", lead.whatsappPresent ? "Yes" : "No",
      lead.appointmentSystem ? "Yes" : "No", lead.mapsUrl, lead.leadScore, lead.leadPriority, lead.dateAdded, lead.aiInsight
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => {
        const str = String(val === null || val === undefined ? "" : val);
        if (str.includes(",") || str.includes("\"") || str.includes("\n") || str.includes(";")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `leadgenpilot_leads_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchWorkspaceLeads = async () => {
    const response = await fetch("/api/processed", { credentials: "include" });
    if (!response.ok) {
      setProcessedLeads([]);
      return;
    }
    const data = await response.json();
    setProcessedLeads(Array.isArray(data) ? data : []);
  };

  // Fetch all states from the server
  const fetchData = async () => {
    try {
      // 1. Fetch config
      const configRes = await fetch("/api/config");
      if (configRes.ok) {
        const config = await configRes.json();
        setBusinessType(config.businessType || "Dental Clinic");
        setLocation(config.location || "Baner Pune");
        setMaxResults(config.maxResults || 10);
        setEnableSimulation(config.enableSimulation || false);
        setHeadless(config.headless || false);
        setLat(config.lat || 19.9975); // Fallback to Nashik Center
        setLng(config.lng || 73.7898);
        setRadius(config.radius || 5);
      }

      // 2. Fetch Status
      const statusRes = await fetch("/api/status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        setIsRunning(status.isRunning);
        // Adopt a run already in flight (a reload mid-scrape) so its console
        // feed resumes instead of staying empty until the next run.
        if (status.isRunning && status.jobId && activeScrapeJobIdRef.current !== status.jobId) {
          activeScrapeJobIdRef.current = status.jobId;
          reportedTerminalJobIdRef.current = null;
          scrapeLogSeqRef.current = 0;
        }
        setWebhookConfigured(status.webhookUrlConfigured);
        setLastResult(status.lastResult);
      }

      // Operator-wide process logs and failed-delivery files are deliberately
      // not loaded in a tenant dashboard. Per-workspace status comes from the
      // tenant-scoped status/jobs endpoints.

      // 3. Fetch this workspace's full CRM leads once. Status polling below
      // refreshes them only when a discovery run finishes.
      await fetchWorkspaceLeads();
      setFailedLeads([]);

      // 4. Fetch SMTP settings
      const smtpRes = await fetch("/api/config/smtp");
      if (smtpRes.ok) {
        const smtp = await smtpRes.json();
        setSmtpHost(smtp.host || "");
        setSmtpPort(smtp.port || "587");
        setSmtpUser(smtp.user || "");
        setSmtpFrom(smtp.from || "");
        if (smtp.hasPassword) {
          setSmtpPass("��������");
        }
      }

      // 7. Fetch WhatsApp status
      const waRes = await fetch("/api/whatsapp/status");
      if (waRes.ok) {
        const wa = await waRes.json();
        setWhatsappStatus(wa);
      }

      // 8. Fetch Campaign status
      const campaignRes = await fetch("/api/campaign/status");
      if (campaignRes.ok) {
        const campaign = await campaignRes.json();
        setCampaignRunning(campaign.isRunning);
        setCampaignProgress(campaign.progress);
      }

      // 9. Fetch user-specific integrations
      try {
        const userIntRes = await fetch("/api/integrations", { credentials: "include" });
        if (userIntRes.ok) {
          const userIntData = await userIntRes.json();
          if (userIntData.ok) {
            setUserIntegrations(userIntData.integrations);
          }
        }
      } catch (err) {
        console.error("Failed to fetch user integrations:", err);
      }
    } catch (e) {
      console.error("Failed to connect to the Express background server.", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchStatusAndLogs();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "outreach") {
      fetchCampaignSheets();
    }
  }, [activeTab]);

  /**
   * Pulls new lines from the active run's own tenant-scoped feed.
   *
   * This is the workspace's own job output, not the operator-wide process log,
   * which is why the console can show it at all.
   */
  const fetchScrapeJobLogs = async () => {
    const jobId = activeScrapeJobIdRef.current;
    if (!jobId || isFetchingScrapeLogsRef.current) return;
    isFetchingScrapeLogsRef.current = true;
    try {
      const res = await fetch(`/api/jobs/${jobId}/logs?after=${scrapeLogSeqRef.current}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (activeScrapeJobIdRef.current !== jobId) return;
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        const appended = data.lines.join("\n");
        setTerminalLogs((prev) => `${prev}${prev.endsWith("\n") ? "" : "\n"}${appended}\n`);
      }
      if (typeof data.nextSeq === "number") scrapeLogSeqRef.current = data.nextSeq;
    } catch {
      /* the console is best-effort; status polling still reports the outcome */
    } finally {
      isFetchingScrapeLogsRef.current = false;
    }
  };

  // While a run is in flight the console follows it closely; 2s keeps the feed
  // readable without making the poll itself the load.
  useEffect(() => {
    if (!isRunning) return;
    void fetchScrapeJobLogs();
    const interval = setInterval(() => void fetchScrapeJobLogs(), 2000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const fetchStatusAndLogs = async () => {
    try {
      const statusRes = await fetch("/api/status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        setIsRunning((prev) => {
          // When a scrape finishes, refresh the account so the lead-usage
          // meter reflects the leads just consumed.
          if (prev && !status.isRunning) {
            onRefreshAccount?.();
            void fetchWorkspaceLeads();
          }
          return status.isRunning;
        });
        setWebhookConfigured(status.webhookUrlConfigured);
        setLastResult(status.lastResult);

        // The launch endpoint returns as soon as the durable job is accepted.
        // Any later browser/network failure is persisted on that job, so report
        // its terminal state here instead of leaving the console frozen on an
        // optimistic "launching" message.
        const belongsToCurrentRun =
          !!status.jobId && status.jobId === activeScrapeJobIdRef.current;
        if (
          belongsToCurrentRun &&
          !status.isRunning &&
          status.jobStatus &&
          reportedTerminalJobIdRef.current !== status.jobId
        ) {
          reportedTerminalJobIdRef.current = status.jobId;
          // Drain whatever the run logged after the last poll before printing
          // the verdict, so the console ends with the real final lines.
          await fetchScrapeJobLogs();
          if (status.jobStatus === "failed") {
            setTerminalLogs((prev) =>
              prev + `\n[ERROR] Lead discovery failed: ${status.error || "Unknown scraper error."}\n`
            );
          } else if (status.jobStatus === "cancelled") {
            setTerminalLogs((prev) => prev + "\n[SYSTEM] Lead discovery was cancelled.\n");
          } else if (status.jobStatus === "completed") {
            const result = status.lastResult || {};
            const found = Number(result.leadsPersisted ?? result.leadsFound ?? 0);
            setTerminalLogs((prev) =>
              prev + `\n[SUCCESS] Lead discovery completed. ${found} lead${found === 1 ? "" : "s"} saved.\n`
            );
          }
        }
      }

      const waRes = await fetch("/api/whatsapp/status");
      if (waRes.ok) {
        const wa = await waRes.json();
        setWhatsappStatus(wa);
      }

      const campaignRes = await fetch("/api/campaign/status");
      if (campaignRes.ok) {
        const campaign = await campaignRes.json();
        setCampaignRunning(campaign.isRunning);
        setCampaignProgress(campaign.progress);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (autoScrollLogs && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [terminalLogs, autoScrollLogs]);

  useEffect(() => {
    localStorage.setItem("leadgenpilot_activeDataView", activeDataView);
  }, [activeDataView]);

  useEffect(() => {
    localStorage.setItem("leadgenpilot_autoScrollLogs", String(autoScrollLogs));
  }, [autoScrollLogs]);

  // Leaflet map setup for Geo Lead Finder tab
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !document.getElementById("finder-map") || activeTab !== "finder") {
      if (finderMapInstance.current) {
        finderMapInstance.current.remove();
        finderMapInstance.current = null;
        finderMarker.current = null;
        finderCircle.current = null;
      }
      return;
    }

    if (finderMapInstance.current) return;

    const initialLat = lat || 19.9975;
    const initialLng = lng || 73.7898;

    const map = L.map("finder-map").setView([initialLat, initialLng], 12);
    finderMapInstance.current = map;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    const marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);
    finderMarker.current = marker;

    const circle = L.circle([initialLat, initialLng], {
      color: '#4f46e5',
      fillColor: '#6366f1',
      fillOpacity: 0.12,
      weight: 2,
      dashArray: '6 4',
      radius: radius * 1000
    }).addTo(map);
    finderCircle.current = circle;

    marker.on("dragend", async () => {
      const pos = marker.getLatLng();
      setLat(pos.lat);
      setLng(pos.lng);
      circle.setLatLng(pos);
      await reverseGeocode(pos.lat, pos.lng);
    });

    map.on("click", async (e: any) => {
      const pos = e.latlng;
      marker.setLatLng(pos);
      circle.setLatLng(pos);
      setLat(pos.lat);
      setLng(pos.lng);
      await reverseGeocode(pos.lat, pos.lng);
    });
  }, [activeTab]);

  // Update circle radius on slider change
  useEffect(() => {
    if (finderCircle.current) {
      finderCircle.current.setRadius(radius * 1000);
    }
  }, [radius]);

  // Sync map center, marker, and circle when coordinates change
  useEffect(() => {
    if (finderMapInstance.current && lat && lng) {
      const currentCenter = finderMapInstance.current.getCenter();
      if (Math.abs(currentCenter.lat - lat) > 0.0001 || Math.abs(currentCenter.lng - lng) > 0.0001) {
        finderMapInstance.current.setView([lat, lng]);
      }
      if (finderMarker.current) {
        finderMarker.current.setLatLng([lat, lng]);
      }
      if (finderCircle.current) {
        finderCircle.current.setLatLng([lat, lng]);
      }
    }
  }, [lat, lng]);

  // Leaflet map setup for Dashboard Overview tab
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !document.getElementById("overview-map") || activeTab !== "dashboard" || processedLeads.length === 0) {
      if (overviewMapInstance.current) {
        overviewMapInstance.current.remove();
        overviewMapInstance.current = null;
        overviewMarkers.current = [];
      }
      return;
    }

    if (overviewMapInstance.current) {
      overviewMarkers.current.forEach(m => m.remove());
      overviewMarkers.current = [];
    } else {
      const firstValid = processedLeads.find(l => l.lat && l.lng);
      const centerLat = firstValid?.lat || lat || 19.9975;
      const centerLng = firstValid?.lng || lng || 73.7898;

      const map = L.map("overview-map").setView([centerLat, centerLng], 12);
      overviewMapInstance.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(map);
    }

    const leadsToShow = overviewMapFilter === "ALL"
      ? processedLeads
      : processedLeads.filter(l => l.leadPriority === overviewMapFilter);

    const bounds: any[] = [];
    leadsToShow.forEach(lead => {
      if (lead.lat && lead.lng) {
        const color = lead.leadPriority === "HOT" ? "#ef4444" : lead.leadPriority === "WARM" ? "#f59e0b" : "#64748b";
        const marker = L.circleMarker([lead.lat, lead.lng], {
          radius: 8,
          fillColor: color,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(overviewMapInstance.current);

        bounds.push([lead.lat, lead.lng]);

        marker.bindPopup(`
          <div style="font-family: system-ui, -apple-system, sans-serif; padding: 4px; min-width: 170px;">
            <div style="font-weight: 700; font-size: 13px; color: #0f172a; margin-bottom: 2px;">${lead.businessName}</div>
            <div style="display: flex; align-items: center; gap: 6px; margin: 4px 0;">
              <span style="font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 9999px; background: ${color}20; color: ${color};">${lead.leadPriority}</span>
              <span style="font-size: 11px; color: #64748b;">★ ${lead.rating || "N/A"} (${lead.reviews || 0})</span>
            </div>
            <div style="font-size: 11px; color: #334155; margin-bottom: 4px;">Score: <b style="color: #4f46e5;">${lead.leadScore || 0}</b></div>
            <div style="font-size: 10px; color: #64748b; line-height: 1.3;">${lead.address || "No address specified"}</div>
          </div>
        `);
        overviewMarkers.current.push(marker);
      }
    });

    if (bounds.length > 0 && overviewMapInstance.current) {
      try {
        overviewMapInstance.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      } catch (e) {}
    }
  }, [activeTab, processedLeads, overviewMapFilter]);

  const reverseGeocode = async (latitude: number, longitude: number) => {
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${latitude}&lon=${longitude}`);
      if (res.ok) {
        const data = await res.json();
        const addr = data.address;
        const sub = addr.suburb || addr.neighbourhood || addr.village || addr.quarter || addr.residential || addr.road || "";
        const city = addr.city || addr.town || addr.municipality || "";
        const formatted = sub && city ? `${sub}, ${city}` : data.display_name ? data.display_name.split(",").slice(0, 3).join(",").trim() : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        setLocation(formatted);
      }
    } catch (e) {
      console.error("Reverse geocoding error:", e);
    }
  };

  const handleSearchAreaGeocode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapSearchText.trim()) return;
    setIsGeocoding(true);
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(mapSearchText)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const item = data[0];
          const newLat = parseFloat(item.lat);
          const newLng = parseFloat(item.lon);
          setLat(newLat);
          setLng(newLng);
          setLocation(mapSearchText);
          
          if (finderMapInstance.current) {
            finderMapInstance.current.setView([newLat, newLng], 12);
          }
          if (finderMarker.current) {
            finderMarker.current.setLatLng([newLat, newLng]);
          }
          if (finderCircle.current) {
            finderCircle.current.setLatLng([newLat, newLng]);
          }
        } else {
          alert("Location not found. Try adding a city name (e.g. Gangapur Road, Nashik).");
        }
      }
    } catch (err) {
      alert("Error finding location.");
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigSuccess(false);

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessType, location, maxResults, enableSimulation, headless, lat, lng, radius }),
      });

      if (res.ok) {
        setConfigSuccess(true);
        setTimeout(() => setConfigSuccess(false), 3000);
        fetchData();
      }
    } catch (e) {
      alert("Error saving configuration.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleStartScraper = async () => {
    if (isRunning || isStartingScraper) return;
    setIsStartingScraper(true);
    try {
      setTerminalLogs(prev => prev + "\n[SYSTEM] Synchronizing search area parameters... saving config...\n");
      const runCriteria = { businessType, location, maxResults, enableSimulation, headless, lat, lng, radius };
      
      const saveRes = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runCriteria),
      });

      if (!saveRes.ok) {
        setTerminalLogs(prev => prev + "[WARN] Parameter autosave failed. The current form values will still be used for this run.\n");
      } else {
        setTerminalLogs(prev => prev + "[SYSTEM] Search parameters synchronized successfully.\n");
      }

      setTerminalLogs(prev => prev + "[SYSTEM] Checking Playwright Chromium and starting the lead discovery job...\n");
      const res = await fetch("/api/run-scraper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runCriteria),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        activeScrapeJobIdRef.current = data.jobId || null;
        reportedTerminalJobIdRef.current = null;
        scrapeLogSeqRef.current = 0;
        setTerminalLogs(prev => prev + `[SYSTEM] Lead search accepted${data.jobId ? ` (job ${data.jobId})` : ""}. Waiting for browser startup...\n`);
        setIsRunning(true);
        setActiveDataView("logs");
      } else {
        setTerminalLogs(prev => prev + `[ERROR] Failed to start scraper: ${data.error || "Unknown error"}\n`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not reach the discovery service.";
      setTerminalLogs(prev => prev + `[ERROR] ${message}\n`);
    } finally {
      setIsStartingScraper(false);
    }
  };

  const handleStopScraper = async () => {
    if (!isRunning) return;
    setIsStopping(true);
    try {
      setTerminalLogs(prev => prev + "\n[SYSTEM] Stop request initiated by user. Aborting scraping loop...\n");
      const res = await fetch("/api/stop-scraper", { method: "POST" });
      if (res.ok) {
        setTerminalLogs(prev => prev + "[SYSTEM] Stopping scraping operations...\n");
      } else {
        const errorData = await res.json();
        setTerminalLogs(prev => prev + `[ERROR] Failed to stop scraper: ${errorData.error || "Unknown error"}\n`);
      }
    } catch (e) {
      alert("Error requesting stop scraper.");
    } finally {
      setIsStopping(false);
    }
  };

  const handleRetryFailed = async () => {
    if (isRetryingFailed) return;
    setIsRetryingFailed(true);
    try {
      const res = await fetch("/api/retry-failed", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Finished Retrying! Succeeded: ${data.succeeded}, Failed: ${data.failed}`);
        fetchData();
      }
    } catch (e) {
      alert("Error executing retry script.");
    } finally {
      setIsRetryingFailed(false);
    }
  };

  const handleResetData = async () => {
    if (!window.confirm("CAUTION: This will permanently wipe all harvested leads, reset scraper logs, and stop active campaigns. Proceed?")) {
      return;
    }
    setIsClearing(true);
    try {
      const res = await fetch("/api/reset-data", { method: "POST" });
      if (res.ok) {
        alert("Lead database and logs completely wiped!");
        setSelectedLeadDetails(null);
        fetchData();
      } else {
        alert("Server failed to wipe database.");
      }
    } catch (e) {
      alert("Error calling reset API.");
    } finally {
      setIsClearing(false);
    }
  };

  const handleTestWebhook = async () => {
    if (isTestingWebhook) return;
    setIsTestingWebhook(true);
    try {
      const res = await fetch("/api/test-webhook", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("?? Connection Success!\n\nYour Google Sheets Webhook is verified and active! A mock lead has been successfully dispatched and appended to your spreadsheet.");
      } else {
        alert(`? Connection Failed:\n\n${data.error || "Google Apps Script rejected the request."}\n\nREMEDY CHECKLIST:\n1. Open your Google Sheets document.\n2. Click "Extensions" > "Apps Script".\n3. Click the blue "Deploy" button at the top-right > "Manage deployments".\n4. Locate your active Web App deployment and click the Edit (pencil) icon.\n5. Under "Configuration", ensure:\n   - "Execute as": "Me" (your email)\n   - "Who has access": "Anyone" (Anonymous/public access is mandatory)\n6. IMPORTANT: Select "New version" from the version dropdown. (Google will NOT update permissions on your old link without a new version release!)\n7. Click "Deploy", copy the new Web App URL, paste it in your .env, and try again!`);
      }
      fetchData();
    } catch (e) {
      alert("Error trying to trigger the webhook test API.");
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSmtp(true);
    setSmtpSuccess(false);
    try {
      const res = await fetch("/api/config/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass === "��������" ? "" : smtpPass,
          from: smtpFrom
        })
      });
      if (res.ok) {
        setSmtpSuccess(true);
        setTimeout(() => setSmtpSuccess(false), 3000);
        fetchData();
      } else {
        alert("Failed to save SMTP configuration.");
      }
    } catch (err) {
      alert("Error saving SMTP configuration.");
    } finally {
      setIsSavingSmtp(false);
    }
  };

  const handleInitializeWhatsApp = async () => {
    try {
      const res = await fetch("/api/whatsapp/initialize", { method: "POST" });
      if (res.ok) {
        setWhatsappStatus(prev => ({ ...prev, status: "CONNECTING" }));
      }
    } catch (err) {
      alert("Error initializing WhatsApp.");
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (!window.confirm("Disconnect WhatsApp session? This will log out the client and terminate active scans.")) return;
    setIsDisconnectingWa(true);
    // Optimistically transition the UI to connecting/generating new QR
    setWhatsappStatus({ status: "CONNECTING", qr: "" });
    try {
      const res = await fetch("/api/whatsapp/disconnect", { method: "POST" });
      if (res.ok) {
        fetchData();
      } else {
        alert("Failed to disconnect WhatsApp.");
        fetchData();
      }
    } catch (err) {
      alert("Error disconnecting WhatsApp session.");
      fetchData();
    } finally {
      setIsDisconnectingWa(false);
    }
  };

  const handleSendTestMessage = async () => {
    const phone = window.prompt("Enter phone number with country code (e.g. 919876543210) to send a test message, or leave blank to send to yourself:");
    if (phone === null) return; // user cancelled
    
    setIsSendingTestMsg(true);
    try {
      const res = await fetch("/api/whatsapp/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() })
      });
      if (res.ok) {
        alert("Test message sent successfully!");
      } else {
        const data = await res.json();
        alert("Failed to send test message: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      alert("Error sending test message.");
    } finally {
      setIsSendingTestMsg(false);
    }
  };

  const handleOpenOutreach = async (lead: Lead) => {
    setSelectedLeadForOutreach(lead);
    // Pre-fill the recipient with the lead's detected email (if any); the user
    // can edit it manually in the outreach console.
    setOutreachEmailTo(lead.emails && lead.emails.length > 0 ? lead.emails[0] : "");
    setOutreachEmailSubject("Generating AI pitch...");
    setOutreachEmailBody("Drafting customized outreach campaign pitch based on AI insights...\n\nPlease wait a moment.");
    setOutreachWhatsappMsg("Drafting customized message...");

    // Load this workspace's server-owned templates and reset prior selection.
    try {
      const templateResponse = await fetch("/api/templates", { credentials: "include" });
      if (templateResponse.ok) {
        const allTemplates = (await templateResponse.json()) as OutreachTemplate[];
        setOutreachEmailTemplates(allTemplates.filter((template) => template.templateType === "email"));
        setOutreachWhatsappTemplates(allTemplates.filter((template) => template.templateType === "whatsapp"));
      }
    } catch {
      setOutreachEmailTemplates([]);
      setOutreachWhatsappTemplates([]);
    }
    setSelectedEmailTemplateId("");
    setSelectedWhatsappTemplateId("");
    setAiOutreachCopy(null);

    try {
      const res = await fetch("/api/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead })
      });
      if (res.ok) {
        const copy = await res.json();
        setOutreachEmailSubject(copy.emailSubject);
        setOutreachEmailBody(copy.emailBody);
        setOutreachWhatsappMsg(copy.whatsappMessage);
        setAiOutreachCopy(copy);
      } else {
        const copy = generateOutreachCopy(lead);
        setOutreachEmailSubject(copy.emailSubject);
        setOutreachEmailBody(copy.emailBody);
        setOutreachWhatsappMsg(copy.whatsappMessage);
        setAiOutreachCopy(copy);
      }
    } catch (e) {
      const copy = generateOutreachCopy(lead);
      setOutreachEmailSubject(copy.emailSubject);
      setOutreachEmailBody(copy.emailBody);
      setOutreachWhatsappMsg(copy.whatsappMessage);
      setAiOutreachCopy(copy);
    }
  };

  // Apply a saved template to the current lead. When the template relies on an
  // AI-generated body (or has none), the AI copy for this lead is injected.
  const applyEmailTemplate = (id: string) => {
    setSelectedEmailTemplateId(id);
    if (!id || !selectedLeadForOutreach) return;
    const tpl = outreachEmailTemplates.find(t => t.id === id);
    if (!tpl) return;
    const aiBody = aiOutreachCopy?.emailBody || outreachEmailBody;
    setOutreachEmailSubject(compileTemplateSubject(tpl, selectedLeadForOutreach, outreachEmailSubject));
    setOutreachEmailBody(compileTemplateText(tpl, selectedLeadForOutreach, aiBody));
  };

  const applyWhatsappTemplate = (id: string) => {
    setSelectedWhatsappTemplateId(id);
    if (!id || !selectedLeadForOutreach) return;
    const tpl = outreachWhatsappTemplates.find(t => t.id === id);
    if (!tpl) return;
    const aiBody = aiOutreachCopy?.whatsappMessage || outreachWhatsappMsg;
    setOutreachWhatsappMsg(compileTemplateText(tpl, selectedLeadForOutreach, aiBody));
  };

  const handleSendEmail = async () => {
    if (!selectedLeadForOutreach) return;
    setIsSendingEmail(true);
    try {
      const recipient = outreachEmailTo.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!recipient) {
        alert("Please enter a recipient email address.");
        setIsSendingEmail(false);
        return;
      }
      if (!emailRegex.test(recipient)) {
        alert("Please enter a valid email address.");
        setIsSendingEmail(false);
        return;
      }

      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: selectedLeadForOutreach.businessName,
          leadId: selectedLeadForOutreach.id,
          to: recipient,
          subject: outreachEmailSubject,
          body: outreachEmailBody
        })
      });
      if (res.ok) {
        showAppModal("success", "Email Sent", `Your outreach email to ${selectedLeadForOutreach.businessName} was delivered successfully.`);
        const sentDate = new Date().toISOString().split("T")[0];
        setProcessedLeads(prev => prev.map(lead => {
          if (lead.businessName === selectedLeadForOutreach.businessName) {
            return { ...lead, emailStatus: "SENT", emailSentDate: sentDate };
          }
          return lead;
        }));
        // Reflect the SENT status in the CRM leads table immediately too.
        setCrmLeads(prev => prev.map(lead =>
          (selectedLeadForOutreach.id && lead.id === selectedLeadForOutreach.id) || lead.businessName === selectedLeadForOutreach.businessName
            ? { ...lead, emailStatus: "SENT", emailSentDate: sentDate }
            : lead
        ));
        setSelectedLeadForOutreach(prev => prev ? { ...prev, emailStatus: "SENT", emailSentDate: sentDate } : null);
      } else {
        const errorData = await res.json();
        showAppModal("danger", "Email Failed", errorData.error || "The email could not be sent. Please try again.");
      }
    } catch (err) {
      showAppModal("danger", "Email Error", "Something went wrong while sending the email. Please try again.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSendWhatsapp = async () => {
    if (!selectedLeadForOutreach) return;
    setIsSendingWhatsapp(true);
    try {
      const phone = selectedLeadForOutreach.phone;
      if (!phone) {
        alert("This lead does not have a phone number.");
        setIsSendingWhatsapp(false);
        return;
      }

      const res = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: selectedLeadForOutreach.businessName,
          leadId: selectedLeadForOutreach.id,
          phone: phone,
          message: outreachWhatsappMsg
        })
      });
      if (res.ok) {
        showAppModal("success", "WhatsApp Sent", `Your WhatsApp message to ${selectedLeadForOutreach.businessName} was delivered successfully.`);
        const sentDate = new Date().toISOString().split("T")[0];
        setProcessedLeads(prev => prev.map(lead => {
          if (lead.businessName === selectedLeadForOutreach.businessName) {
            return { ...lead, whatsappStatus: "SENT", whatsappSentDate: sentDate };
          }
          return lead;
        }));
        // Reflect the SENT status in the CRM leads table immediately too.
        setCrmLeads(prev => prev.map(lead =>
          (selectedLeadForOutreach.id && lead.id === selectedLeadForOutreach.id) || lead.businessName === selectedLeadForOutreach.businessName
            ? { ...lead, whatsappStatus: "SENT", whatsappSentDate: sentDate }
            : lead
        ));
        setSelectedLeadForOutreach(prev => prev ? { ...prev, whatsappStatus: "SENT", whatsappSentDate: sentDate } : null);
      } else {
        const errorData = await res.json();
        showAppModal("danger", "WhatsApp Failed", errorData.error || "The WhatsApp message could not be sent. Please try again.");
      }
    } catch (err) {
      showAppModal("danger", "WhatsApp Error", "Something went wrong while sending the WhatsApp message. Please try again.");
    } finally {
      setIsSendingWhatsapp(false);
    }
  };

  const fetchCampaignSheets = async () => {
    setIsLoadingSheets(true);
    try {
      const res = await fetch("/api/campaign/sheets");
      if (res.ok) {
        const data = await res.json();
        setCampaignSheets(data);
      }
    } catch (e) {
      console.error("Error loading sheets", e);
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // Build the request body shared by the preview and start endpoints, so the
  // wizard's "Review" step reflects exactly what will be launched.
  const buildCampaignRequestBody = () => {
    const emailTpl = campaignEmailTemplateId ? campaignEmailTemplates.find(t => t.id === campaignEmailTemplateId) : null;
    const whatsappTpl = campaignWhatsappEffective && campaignWhatsappTemplateId ? campaignWhatsappTemplates.find(t => t.id === campaignWhatsappTemplateId) : null;
    return {
      delaySeconds: campaignDelay,
      enableEmail: campaignEnableEmail,
      enableWhatsapp: campaignWhatsappEffective,
      dryRun: campaignDryRun,
      sheetName: campaignSourceType === "sheet" ? selectedCampaignSheet : undefined,
      listId: campaignSourceType === "list" ? selectedCampaignListId : undefined,
      priorities: campaignPriorities.length > 0 ? campaignPriorities : undefined,
      skipAlreadySent: campaignSkipSent,
      emailTemplate: emailTpl || undefined,
      whatsappTemplate: whatsappTpl || undefined,
    };
  };

  const fetchCampaignPreview = async () => {
    setIsLoadingCampaignPreview(true);
    setCampaignPreviewError("");
    setCampaignPreview(null);
    try {
      const res = await fetch("/api/campaign/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCampaignRequestBody())
      });
      const data = await res.json();
      if (res.ok) {
        setCampaignPreview(data);
      } else {
        setCampaignPreviewError(data.error || "Failed to preview campaign target leads.");
      }
    } catch (e) {
      setCampaignPreviewError("Error loading campaign preview.");
    } finally {
      setIsLoadingCampaignPreview(false);
    }
  };

  const togglePriorityFilter = (p: string) => {
    setCampaignPriorities(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  // Step navigation: validate the current step before advancing.
  const canAdvanceCampaignStep = (step: number): boolean => {
    if (step === 1) return campaignSourceType === "list" ? !!selectedCampaignListId : true;
    if (step === 2) return campaignEnableEmail || campaignWhatsappEffective;
    return true;
  };

  const goToCampaignStep = (step: 1 | 2 | 3 | 4 | 5) => {
    if (step === 5) fetchCampaignPreview();
    setCampaignStep(step);
  };

  const resetCampaignWizard = () => {
    setCampaignStep(1);
    setCampaignPreview(null);
    setCampaignPreviewError("");
  };

  const handleStartCampaign = () => {
    // Retained only while the legacy panel is removed incrementally. It must
    // never invoke the retired immediate-send endpoint.
    navigateToTab("campaigns");
    showAppModal(
      "success",
      "Use reviewed campaigns",
      "Campaign delivery now requires generation, review, and approval in the Campaigns tab."
    );
  };

  const handleSelectPreviewLead = async (lead: Lead) => {
    setPreviewLead(lead);
    setPreviewCopy(null);
    setIsLoadingPreviewCopy(true);
    try {
      const res = await fetch("/api/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead })
      });
      if (res.ok) {
        const copy = await res.json();
        setPreviewCopy(copy);
      } else {
        setPreviewCopy(generateOutreachCopy(lead));
      }
    } catch (e) {
      setPreviewCopy(generateOutreachCopy(lead));
    } finally {
      setIsLoadingPreviewCopy(false);
    }
  };

  const handleStopCampaign = async () => {
    setIsStoppingCampaign(true);
    try {
      const res = await fetch("/api/campaign/stop", { method: "POST" });
      if (res.ok) {
        alert("Campaign abort request successfully received.");
      } else {
        const err = await res.json();
        alert(`Failed to stop campaign: ${err.error || "Unknown error"}`);
      }
    } catch (e) {
      alert("Error stopping campaign.");
    } finally {
      setIsStoppingCampaign(false);
    }
  };

  const openAccountModal = () => {
    setAcctName(currentUser?.name || "");
    setAcctCurrentPassword("");
    setAcctNewPassword("");
    setAcctMessage(null);
    setShowAccountModal(true);
  };

  const handleSaveProfile = async () => {
    setAcctBusy(true);
    setAcctMessage(null);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: acctName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAcctMessage({ type: "ok", text: "Profile updated." });
        onRefreshAccount?.();
      } else {
        setAcctMessage({ type: "err", text: data.error || "Failed to update profile." });
      }
    } catch {
      setAcctMessage({ type: "err", text: "Network error." });
    } finally {
      setAcctBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (!acctCurrentPassword || !acctNewPassword) {
      setAcctMessage({ type: "err", text: "Enter your current and new password." });
      return;
    }
    setAcctBusy(true);
    setAcctMessage(null);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: acctCurrentPassword, newPassword: acctNewPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAcctMessage({ type: "ok", text: "Password changed successfully." });
        setAcctCurrentPassword("");
        setAcctNewPassword("");
      } else {
        setAcctMessage({ type: "err", text: data.error || "Failed to change password." });
      }
    } catch {
      setAcctMessage({ type: "err", text: "Network error." });
    } finally {
      setAcctBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    const password = window.prompt("This permanently deletes your account. Enter your password to confirm:");
    if (!password) return;
    setAcctBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert("Your account has been deleted.");
        onLogout?.();
      } else {
        setAcctMessage({ type: "err", text: data.error || "Failed to delete account." });
      }
    } catch {
      setAcctMessage({ type: "err", text: "Network error." });
    } finally {
      setAcctBusy(false);
    }
  };

  // ────────────────────────────────────────────────
  // CRM Handlers
  // ────────────────────────────────────────────────

  const fetchLeadLists = async () => {
    setIsLoadingLists(true);
    try {
      const res = await fetch("/api/crm/lists");
      if (res.ok) {
        const data = await res.json();
        setLeadLists(data);
        // Default to the aggregated "All Leads" view when nothing is selected.
        if (!activeListId) {
          setActiveListId("ALL");
        }
      }
    } catch (e) { console.error("CRM: failed to fetch lists", e); }
    finally { setIsLoadingLists(false); }
  };

  const fetchCrmLeads = async (listId: string) => {
    if (!listId) return;
    setIsLoadingCrmLeads(true);
    try {
      const params = new URLSearchParams({
        search: crmSearchTerm,
        priority: crmPriorityFilter,
        websiteStatus: crmWebsiteFilter,
        emailStatus: crmEmailFilter,
        whatsappStatus: crmWhatsappFilter,
        sortBy: crmSortBy,
        sortDir: crmSortDir,
        ...(crmDateFrom ? { dateFrom: crmDateFrom } : {}),
        ...(crmDateTo ? { dateTo: crmDateTo } : {}),
      });
      const url = listId === "ALL"
        ? `/api/crm/leads?${params}`
        : `/api/crm/lists/${listId}/leads?${params}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCrmLeads(data);
      }
    } catch (e) { console.error("CRM: failed to fetch leads", e); }
    finally { setIsLoadingCrmLeads(false); }
  };

  const handleSelectList = (id: string) => {
    setActiveListId(id);
    setSelectedCrmLeadDetail(null);
    setSelectedCrmLeadIds(new Set());
    setCrmSearchTerm("");
    setCrmPriorityFilter("ALL");
    setCrmWebsiteFilter("ALL");
    setCrmEmailFilter("ALL");
    setCrmWhatsappFilter("ALL");
    setCrmDateFrom("");
    setCrmDateTo("");
    setCrmSortBy("leadScore");
    setCrmSortDir("desc");
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    setIsCreatingList(true);
    try {
      const res = await fetch("/api/crm/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim(), businessType: "", location: "" }),
      });
      if (res.ok) {
        const list = await res.json();
        await fetchLeadLists();
        setActiveListId(list.id);
        setShowNewListModal(false);
        setNewListName("");
      }
    } catch (e) { alert("Failed to create list."); }
    finally { setIsCreatingList(false); }
  };

  const handleRenameList = async (id: string) => {
    if (!renameListValue.trim()) { setRenamingListId(null); return; }
    try {
      const res = await fetch(`/api/crm/lists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameListValue.trim() }),
      });
      if (res.ok) {
        setLeadLists(prev => prev.map(l => l.id === id ? { ...l, name: renameListValue.trim() } : l));
      }
    } catch (e) { alert("Failed to rename list."); }
    finally { setRenamingListId(null); }
  };

  const handleDeleteList = async (id: string) => {
    if (!window.confirm("Delete this list and ALL its leads permanently?")) return;
    setIsDeletingListId(id);
    try {
      const res = await fetch(`/api/crm/lists/${id}`, { method: "DELETE" });
      if (res.ok) {
        setLeadLists(prev => prev.filter(l => l.id !== id));
        if (activeListId === "ALL") {
          fetchCrmLeads("ALL");
        } else if (activeListId === id) {
          const remaining = leadLists.filter(l => l.id !== id);
          setActiveListId(remaining.length > 0 ? remaining[0].id : null);
          setCrmLeads([]);
        }
      }
    } catch (e) { alert("Failed to delete list."); }
    finally { setIsDeletingListId(null); }
  };

  const handleCrmSort = (col: string) => {
    if (crmSortBy === col) {
      setCrmSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setCrmSortBy(col);
      setCrmSortDir("desc");
    }
  };

  const handleSaveNotes = async (lead: Lead) => {
    if (!lead.id) return;
    setIsSavingNotes(true);
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: crmNotes }),
      });
      if (res.ok) {
        setCrmLeads(prev => prev.map(l => l.id === lead.id ? { ...l, notes: crmNotes } : l));
        setSelectedCrmLeadDetail(prev => prev ? { ...prev, notes: crmNotes } : null);
      } else {
        showAppModal("danger", "Save Failed", "Could not save notes for this lead.");
      }
    } catch (e) { showAppModal("danger", "Save Failed", "Something went wrong while saving notes."); }
    finally { setIsSavingNotes(false); }
  };

  const handleDeleteCrmLead = (lead: Lead) => {
    if (!lead.id) return;
    setCrmConfirmModal({
      isOpen: true,
      isLoading: false,
      message: `Delete "${lead.businessName}" from this list? This cannot be undone.`,
      onConfirm: async () => {
        setCrmConfirmModal(prev => ({ ...prev, isLoading: true }));
        try {
          const res = await fetch(`/api/crm/leads/${lead.id}`, { method: "DELETE" });
          if (res.ok) {
            setCrmLeads(prev => prev.filter(l => l.id !== lead.id));
            setSelectedCrmLeadIds(prev => { const next = new Set(prev); next.delete(lead.id!); return next; });
            if (selectedCrmLeadDetail?.id === lead.id) setSelectedCrmLeadDetail(null);
            setCrmConfirmModal(prev => ({ ...prev, isOpen: false, isLoading: false }));
            showAppModal("success", "Lead Deleted", `"${lead.businessName}" was removed from this list.`);
          } else {
            setCrmConfirmModal(prev => ({ ...prev, isOpen: false, isLoading: false }));
            showAppModal("danger", "Delete Failed", "Could not delete this lead. Please try again.");
          }
        } catch (e) {
          setCrmConfirmModal(prev => ({ ...prev, isOpen: false, isLoading: false }));
          showAppModal("danger", "Delete Failed", "Something went wrong while deleting this lead.");
        }
      },
    });
  };

  const handleCrmBulkDelete = () => {
    if (selectedCrmLeadIds.size === 0) return;
    const ids = Array.from(selectedCrmLeadIds);
    setCrmConfirmModal({
      isOpen: true,
      isLoading: false,
      message: `Delete ${ids.length} selected lead${ids.length > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setCrmConfirmModal(prev => ({ ...prev, isLoading: true }));
        try {
          await Promise.all(ids.map(id => fetch(`/api/crm/leads/${id}`, { method: "DELETE" })));
          setCrmLeads(prev => prev.filter(l => !selectedCrmLeadIds.has(l.id!)));
          setSelectedCrmLeadIds(new Set());
          setSelectedCrmLeadDetail(null);
          setCrmConfirmModal(prev => ({ ...prev, isOpen: false, isLoading: false }));
          showAppModal("success", "Leads Deleted", `${ids.length} lead${ids.length > 1 ? "s" : ""} deleted.`);
        } catch (e) {
          setCrmConfirmModal(prev => ({ ...prev, isOpen: false, isLoading: false }));
          showAppModal("danger", "Delete Failed", "Something went wrong while deleting the selected leads.");
        }
      },
    });
  };

  // Open the detail panel in read-only "view" mode.
  const handleViewCrmLead = (lead: Lead) => {
    setSelectedCrmLeadDetail(lead);
    setCrmNotes(lead.notes || "");
    setCrmDetailMode("view");
  };

  // Open the detail panel pre-loaded with an editable draft of the lead's core fields.
  const handleEditCrmLead = (lead: Lead) => {
    setSelectedCrmLeadDetail(lead);
    setCrmNotes(lead.notes || "");
    setCrmEditDraft({
      businessName: lead.businessName || "",
      phone: lead.phone || "",
      address: lead.address || "",
      category: lead.category || "",
      website: lead.website || "",
      rating: String(lead.rating ?? ""),
      reviews: String(lead.reviews ?? ""),
      leadPriority: lead.leadPriority || "COLD",
    });
    setCrmDetailMode("edit");
  };

  const handleSaveCrmEdit = async () => {
    if (!selectedCrmLeadDetail?.id) return;
    setIsSavingCrmEdit(true);
    try {
      const res = await fetch(`/api/crm/leads/${selectedCrmLeadDetail!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: crmEditDraft.businessName,
          phone: crmEditDraft.phone,
          address: crmEditDraft.address,
          category: crmEditDraft.category,
          website: crmEditDraft.website,
          rating: parseFloat(crmEditDraft.rating) || 0,
          reviews: parseInt(crmEditDraft.reviews, 10) || 0,
          leadPriority: crmEditDraft.leadPriority,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCrmLeads(prev => prev.map(l => l.id === selectedCrmLeadDetail!.id ? { ...l, ...updated } : l));
        setSelectedCrmLeadDetail(prev => prev ? { ...prev, ...updated } : null);
        setCrmDetailMode("view");
        showAppModal("success", "Lead Updated", `"${crmEditDraft.businessName}" was updated successfully.`);
      } else {
        const err = await res.json().catch(() => ({}));
        showAppModal("danger", "Update Failed", err.error || "Could not update this lead.");
      }
    } catch (e) {
      showAppModal("danger", "Update Failed", "Something went wrong while saving changes.");
    } finally {
      setIsSavingCrmEdit(false);
    }
  };

  // The writers live in ./exports/leadExports and are fetched when used.
  const handleExportCSV = async () => {
    if (crmLeads.length === 0) { alert("No leads available to export."); return; }
    const { exportLeadsToCsv } = await import("./exports/leadExports");
    exportLeadsToCsv(crmLeads);
  };

  const handleExportExcel = async () => {
    if (crmLeads.length === 0) { alert("No leads available to export."); return; }
    const { exportLeadsToExcel } = await import("./exports/leadExports");
    await exportLeadsToExcel(crmLeads);
  };

  const handleExportPDF = async () => {
    if (crmLeads.length === 0) { alert("No leads available to export."); return; }
    const { exportLeadsToPdf } = await import("./exports/leadExports");
    await exportLeadsToPdf(crmLeads);
  };

  const handleExportWord = async () => {
    if (crmLeads.length === 0) { alert("No leads available to export."); return; }
    const { exportLeadsToWord } = await import("./exports/leadExports");
    await exportLeadsToWord(crmLeads);
  };

  // Re-fetch leads whenever active list or filters/sort changes
  useEffect(() => {
    if (false && activeListId && activeTab === "leads") {
      fetchCrmLeads(activeListId!);
    }
  }, [activeListId, crmSortBy, crmSortDir, activeTab]);

  // Fetch CRM lists whenever the leads tab becomes active
  useEffect(() => {
    if (false && activeTab === "leads") {
      fetchLeadLists();
    }
  }, [activeTab]);

  // Load lead lists + outreach templates for the Campaign wizard when the
  // outreach tab becomes active (reused source: same CRM lists, same
  // localStorage templates as the single-lead Outreach Console).
  useEffect(() => {
    if (activeTab === "outreach") {
      fetchLeadLists();
      const all = loadOutreachTemplates(currentWorkspace?.id);
      setCampaignEmailTemplates(all.filter(t => t.templateType === "email"));
      setCampaignWhatsappTemplates(all.filter(t => t.templateType === "whatsapp"));
    }
  }, [activeTab]);

  // Debounced search + filter re-fetch
  useEffect(() => {
    if (false || !activeListId || activeTab !== "leads") return;
    const t = setTimeout(() => fetchCrmLeads(activeListId), 350);
    return () => clearTimeout(t);
  }, [crmSearchTerm, crmPriorityFilter, crmWebsiteFilter, crmEmailFilter, crmWhatsappFilter, crmDateFrom, crmDateTo]);

  // Helper stats for dashboard
  const hotLeads = processedLeads.filter(l => l.leadPriority === "HOT").length;
  const warmLeads = processedLeads.filter(l => l.leadPriority === "WARM").length;
  const coldLeads = processedLeads.filter(l => l.leadPriority === "COLD").length;
  const totalProcessed = processedLeads.length;


  const scorePoor = processedLeads.filter(l => l.leadScore <= 50).length;
  const scoreNeedsWork = processedLeads.filter(l => l.leadScore > 50 && l.leadScore <= 100).length;
  const scoreGood = processedLeads.filter(l => l.leadScore > 100 && l.leadScore <= 150).length;
  const scoreExcellent = processedLeads.filter(l => l.leadScore > 150).length;

  const maxScoreCount = Math.max(scorePoor, scoreNeedsWork, scoreGood, scoreExcellent, 1);

  const currentRoute = routeForTab(activeTab);
  const CurrentRouteIcon = DASHBOARD_ROUTE_ICONS[currentRoute.id];
  const isLight = theme === "light";
  const bgMain = isLight ? "bg-slate-50 text-slate-800" : "bg-[#020617] text-[#e2e8f0]";
  const bgCard = isLight ? "bg-white border border-slate-200" : "bg-gradient-to-br from-slate-900 to-[#111827] border border-[#1e293b]";
  const bgAside = isLight ? "bg-white border-r border-slate-200" : "bg-[#090d16] border-r border-[#1e293b]";
  const bgHeader = isLight ? "bg-white/80 border-b border-slate-200" : "bg-[#090d16]/70 border-b border-[#1e293b]/60";
  const borderSubtle = isLight ? "border-slate-200" : "border-[#1e293b]";
  const textPrimary = isLight ? "text-slate-900" : "text-white";
  const textSecondary = isLight ? "text-slate-500" : "text-slate-400";
  
  return (
    <div className={`relative h-dvh ${bgMain} font-sans overflow-hidden`}>
      
      {/* Sidebar Navigation — fixed, collapsible to an icon rail */}
      <aside className={`${sidebarCollapsed ? "w-[72px]" : "w-64"} ${bgAside} fixed inset-y-0 left-0 z-30 flex h-dvh flex-col justify-between overflow-hidden transition-[width] duration-200 shadow-xl`}>
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Logo Brand */}
          <div className={`h-14 flex items-center ${sidebarCollapsed ? "justify-center px-0" : "px-5"} border-b ${isLight ? "border-slate-200/80" : "border-[#1e293b]/80"}`}>
            <div className="relative flex items-center gap-2.5">
              {/*
                Two artworks rather than one: the light logo is dark navy text
                that disappears against the dark sidebar, and the dark logo is
                pale glowing text that disappears against the light one.
              */}
              <img
                src={isLight ? "/assets/logo/logo.png" : "/assets/logo/logo-dark.png"}
                alt="LeadGenPilot"
                className="h-5.5 w-auto object-contain"
              />
              {!sidebarCollapsed && (
                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-xs">
                  AGENT V2
                </span>
              )}
              <span className="absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 -top-0.5 -right-1 ring-2 ring-emerald-400/20 animate-pulse"></span>
            </div>
          </div>

          {/* Route-aware navigation — grouped for fast scanning. */}
          <nav className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3" aria-label="Dashboard navigation">
            {DASHBOARD_GROUPS.map((group) => {
              const routes = DASHBOARD_ROUTES.filter((route) => route.group === group.id);
              return (
                <div key={group.id}>
                  {sidebarCollapsed ? (
                    group.id !== "overview" && (
                      <div className={`h-px mx-2 my-2 ${isLight ? "bg-slate-200" : "bg-slate-800/80"}`} />
                    )
                  ) : (
                    <div className={`px-3 pb-1.5 pt-1 text-[9.5px] font-bold uppercase tracking-[0.16em] ${
                      isLight ? "text-slate-400" : "text-slate-500"
                    }`}>
                      {group.label}
                    </div>
                  )}
                  <div className="space-y-1">
                    {routes.map((route) => {
                      const Icon = DASHBOARD_ROUTE_ICONS[route.id];
                      const pulse =
                        (route.id === "finder" && isRunning) ||
                        ((route.id === "campaigns" || route.id === "reports") && campaignRunning) ||
                        (route.id === "conversations" && conversationsUnread > 0);
                      const badge =
                        route.id === "leads"
                          ? totalProcessed
                          : route.id === "conversations" && conversationsUnread > 0
                            ? conversationsUnread
                            : undefined;
                      const active = activeTab === route.id;

                      return (
                        <a
                          key={route.id}
                          href={route.path}
                          aria-current={active ? "page" : undefined}
                          data-dashboard-route={route.id}
                          onClick={(event) => {
                            if (
                              event.button !== 0 ||
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey
                            ) return;
                            event.preventDefault();
                            navigateToTab(route.id);
                          }}
                          title={sidebarCollapsed ? `${route.label} — ${route.description}` : route.description}
                          className={`btn-interactive group relative w-full flex items-center rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer ${
                            sidebarCollapsed ? "justify-center px-0 py-2.5" : "justify-between px-3 py-2.5"
                          } ${
                            active
                              ? isLight
                                ? "bg-indigo-50 text-indigo-700 font-semibold shadow-xs border border-indigo-200/80"
                                : "bg-gradient-to-r from-indigo-600/20 via-indigo-600/10 to-transparent text-indigo-400 font-semibold border border-indigo-500/25 shadow-xs shadow-indigo-500/10"
                              : isLight
                                ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900 hover:translate-x-0.5"
                                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-100 hover:translate-x-0.5"
                          }`}
                        >
                          {/* Active Left Indicator Bar */}
                          {active && !sidebarCollapsed && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                          )}
                          <span className={`flex items-center ${sidebarCollapsed ? "" : "gap-2.5"}`}>
                            <Icon className={`h-4.5 w-4.5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${active ? "text-indigo-500" : isLight ? "text-slate-400" : "text-slate-500"}`} />
                            {!sidebarCollapsed && <span className="truncate">{route.label}</span>}
                          </span>
                          {!sidebarCollapsed && badge !== undefined && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold tabular-nums ${
                              route.id === "conversations"
                                ? "bg-indigo-500 text-white shadow-xs shadow-indigo-500/30"
                                : isLight
                                  ? "bg-slate-100 text-slate-600 border border-slate-200"
                                  : "bg-[#1e293b] text-slate-300 border border-slate-700/50"
                            }`}>
                              {badge}
                            </span>
                          )}
                          {!sidebarCollapsed && pulse && (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          )}
                          {sidebarCollapsed && pulse && (
                            <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer — current plan + monthly usage + collapse toggle */}
        <div className={`border-t ${isLight ? "border-slate-200" : "border-[#1e293b]/60"} ${sidebarCollapsed ? "p-2" : "p-3.5"} space-y-2.5`}>
          {!sidebarCollapsed && (
            <div className={`p-3 rounded-xl border ${isLight ? "bg-slate-50/70 border-slate-200/80" : "bg-[#040711] border-[#1e293b]/80"} space-y-2`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9.5px] font-bold uppercase tracking-wider ${isLight ? "text-slate-400" : "text-slate-500"}`}>Current Plan</span>
                {entitlements ? (
                  isFreePlan ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isLight ? "bg-white text-slate-600 border-slate-200" : "bg-slate-800/80 text-slate-300 border-slate-700"}`}>
                      {entitlements.planName}
                    </span>
                  ) : (
                    <span className="text-[10px] inline-flex items-center gap-1 text-white bg-gradient-to-r from-indigo-600 to-violet-600 px-2.5 py-0.5 rounded-full font-semibold shadow-xs">
                      <Sparkles className="h-2.5 w-2.5" /> {entitlements.planName}
                    </span>
                  )
                ) : (
                  <span className="text-[10px] text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full font-semibold border border-indigo-500/20">Live</span>
                )}
              </div>
              {usage && !usage.unlimited && usage.limit !== null && (
                <div title={`${usage.used} of ${usage.limit} leads used this month`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-semibold tabular-nums ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                      {usage.used} / {usage.limit} leads
                    </span>
                    <span className="text-[10px] text-slate-500 font-bold tabular-nums">
                      {Math.round((usage.used / usage.limit) * 100)}%
                    </span>
                  </div>
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-slate-800"}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${usage.used >= usage.limit ? "bg-rose-500" : "bg-gradient-to-r from-indigo-500 to-violet-500"}`}
                      style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`w-full btn-interactive flex items-center gap-2 rounded-xl text-[11px] font-semibold cursor-pointer transition-all ${
              sidebarCollapsed ? "justify-center py-2" : "justify-center py-2"
            } border ${isLight ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-100" : "border-[#1e293b] bg-slate-900/40 text-slate-400 hover:bg-slate-800/60 hover:text-white"}`}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /> Collapse rail</>}
          </button>
        </div>
      </aside>

      {/* Fixed main shell shared by every route */}
      <div className="min-w-0">
        {/* Fixed dashboard header */}
        <header className={`${sidebarCollapsed ? "left-[72px]" : "left-64"} fixed top-0 right-0 h-14 ${bgHeader} px-3 sm:px-5 lg:px-6 flex items-center justify-between z-40 backdrop-blur-md transition-[left] duration-200 border-b ${borderSubtle}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
              currentRoute.id === "suppressions"
                ? isLight
                  ? "border-rose-200 bg-rose-50 text-rose-500 shadow-xs"
                  : "border-rose-500/20 bg-rose-500/10 text-rose-400 shadow-xs"
                : isLight
                  ? "border-indigo-100 bg-indigo-50 text-indigo-600 shadow-xs"
                  : "border-indigo-500/25 bg-indigo-500/10 text-indigo-400 shadow-xs shadow-indigo-500/10"
            }`}>
              <CurrentRouteIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${textSecondary}`}>
                Workspace / {currentRoute.label}
              </div>
              <div className={`mt-0.5 truncate text-sm font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                {currentRoute.title}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Live Sync Status Pill */}
            <div className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold ${
              isLight ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
            }`}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span>Live Engine Ready</span>
            </div>

            {/* Quick Action Button */}
            <button
              onClick={() => navigateToTab("finder")}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-xs shadow-indigo-500/25 btn-interactive cursor-pointer"
            >
              <MapPin className="h-3 w-3" />
              <span>New Scan</span>
            </button>

            {currentWorkspace && (
              <div className={`hidden md:flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-slate-700/80 bg-slate-900/60 text-slate-200"}`} title={currentWorkspace.slug}>
                <Building2 className="h-3 w-3 text-indigo-400" />
                <span className="max-w-36 truncate text-xs font-semibold">{currentWorkspace.name}</span>
                <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400 px-1 py-0.2 rounded bg-slate-800">{currentWorkspace.role}</span>
              </div>
            )}
            <button 
              onClick={() => setTheme(isLight ? "dark" : "light")}
              className={`p-1.5 rounded-lg border btn-interactive ${borderSubtle} ${isLight ? "hover:bg-slate-100 text-slate-600 hover:text-slate-900 bg-white" : "hover:bg-slate-800 text-slate-400 hover:text-white bg-slate-900/40"} cursor-pointer`}
              title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </button>
            <button 
              onClick={fetchData}
              className={`p-1.5 rounded-lg border btn-interactive ${borderSubtle} ${isLight ? "hover:bg-slate-100 text-slate-600 hover:text-slate-900 bg-white" : "hover:bg-slate-800 text-slate-400 hover:text-white bg-slate-900/40"} cursor-pointer`}
              title="Reload Statuses"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

            {currentUser && (
              <div ref={profileDropdownRef} className="relative flex items-center pl-2.5 ml-0.5 border-l border-slate-200 dark:border-[#1e293b]/60">
                <button
                  onClick={() => setShowProfileDropdown(prev => !prev)}
                  className="flex items-center gap-1.5 cursor-pointer group focus:outline-none"
                  aria-expanded={showProfileDropdown}
                >
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold shadow-xs ring-2 ring-indigo-500/10 group-hover:ring-indigo-500/35 transition-all">
                    {(currentUser.name || currentUser.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden md:block leading-tight text-left">
                    <div className={`text-xs font-semibold group-hover:text-indigo-500 transition-colors ${isLight ? "text-slate-800" : "text-white"}`}>
                      {currentUser.name || currentUser.email.split("@")[0]}
                    </div>
                  </div>
                  <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${showProfileDropdown ? "rotate-180 text-indigo-400" : ""}`} />
                </button>

                {showProfileDropdown && (
                  <div className={`absolute right-0 top-10 w-52 rounded-xl shadow-xl border overflow-hidden z-[100] py-1 transition-all duration-200 ${
                    isLight 
                      ? "bg-white border-slate-200/80 text-slate-800" 
                      : "bg-[#090d16] border-[#1e293b] text-[#e2e8f0]"
                  }`}>
                    {/* Header info */}
                    <div className={`px-3.5 py-2 border-b text-xs ${isLight ? "border-slate-100 bg-slate-50/50" : "border-[#1e293b]/60 bg-[#020617]/40"}`}>
                      <div className="font-semibold truncate">{currentUser.name || "User Account"}</div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">{currentUser.email}</div>
                      {entitlements && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[8.5px] font-black text-white bg-gradient-to-r from-indigo-600 to-violet-600 px-1.5 py-0.2 rounded-full shadow-xs">
                            {entitlements.planName}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Menu items */}
                    <div className="p-1 space-y-0.5">
                      <button
                        onClick={() => {
                          setShowProfileDropdown(false);
                          openAccountModal();
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all text-left cursor-pointer ${
                          isLight ? "hover:bg-slate-50 text-slate-700 hover:text-slate-900" : "hover:bg-slate-800/40 text-slate-300 hover:text-white"
                        }`}
                      >
                        <User className="h-3.5 w-3.5 text-indigo-400" />
                        Profile Settings
                      </button>

                      <button
                        onClick={() => {
                          setShowProfileDropdown(false);
                          setShowPricingModal(true);
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all text-left cursor-pointer ${
                          isLight ? "hover:bg-slate-50 text-slate-700 hover:text-slate-900" : "hover:bg-slate-800/40 text-slate-300 hover:text-white"
                        }`}
                      >
                        <CreditCard className="h-3.5 w-3.5 text-indigo-400" />
                        Pricing Plans
                      </button>

                      <div className={`h-px my-1 ${isLight ? "bg-slate-100" : "bg-[#1e293b]/60"}`}></div>

                      {onLogout && (
                        <button
                          onClick={() => {
                            setShowProfileDropdown(false);
                            onLogout();
                          }}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all text-left cursor-pointer ${
                            isLight ? "hover:bg-rose-50 text-rose-600" : "hover:bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          <LogOut className="h-3.5 w-3.5 text-rose-400" />
                          Log out
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* The only scrolling region; sidebar and header stay identical and fixed. */}
        <main
          className={`${sidebarCollapsed ? "left-[72px]" : "left-64"} fixed top-14 right-0 bottom-0 min-w-0 overflow-y-auto overscroll-contain p-3 sm:p-4 lg:p-5 transition-[left] duration-200`}
          data-active-route={currentRoute.path}
        >
          {/*
            One boundary for every lazily loaded panel. The fallback is shown only
            on the first visit to a tab, while its chunk downloads.
          */}
          <Suspense
            fallback={
              <div
                className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"
                role="status"
                aria-live="polite"
                data-testid="panel-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            }
          >

          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === "dashboard" && (() => {
            const currentHour = new Date().getHours();
            const timeGreeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
            const userName = currentUser?.name || currentUser?.email?.split("@")[0] || "Growth Leader";
            const hotPercentage = totalProcessed > 0 ? Math.round((hotLeads / totalProcessed) * 100) : 0;
            const warmPercentage = totalProcessed > 0 ? Math.round((warmLeads / totalProcessed) * 100) : 0;
            const coldPercentage = totalProcessed > 0 ? Math.round((coldLeads / totalProcessed) * 100) : 0;

            return (
              <div className="space-y-6 animate-fadeIn pb-8">
                
                {/* ── Executive Greeting & Diagnostic Command Bar ── */}
                <div className={`p-4 sm:p-5 border rounded-2xl relative overflow-hidden flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all ${
                  isLight 
                    ? "bg-gradient-to-r from-white via-indigo-50/30 to-white border-slate-200/80 shadow-xs" 
                    : "bg-gradient-to-r from-indigo-950/30 via-[#0a0f1d] to-slate-900 border-[#1e293b] shadow-lg"
                }`}>
                  <div className="absolute -left-20 -top-20 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
                  <div className="absolute right-0 top-0 w-40 h-40 bg-rose-500/5 rounded-full blur-xl pointer-events-none"></div>
                  
                  <div className="space-y-1.5 relative z-10 max-w-2xl">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${
                        isLight ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                      }`}>
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                        Real-time Lead Engine Active
                      </span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                        isLight ? "bg-slate-100 text-slate-600 border-slate-200" : "bg-slate-800/80 text-slate-400 border-slate-700/60"
                      }`}>
                        Workspace: <b className={isLight ? "text-slate-800" : "text-slate-200"}>{currentWorkspace?.name || "Production"}</b>
                      </span>
                    </div>

                    <h1 className={`text-lg sm:text-xl font-extrabold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                      {timeGreeting}, <span className="bg-gradient-to-r from-indigo-500 via-indigo-400 to-violet-500 bg-clip-text text-transparent">{userName}</span>
                    </h1>
                    
                    <p className={`text-xs leading-relaxed ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                      Your intelligent lead acquisition hub. Monitor geo-prospects, qualification scores, and outreach readiness in real time.
                    </p>
                  </div>

                  {/* Quick Command Action Triggers */}
                  <div className="flex items-center gap-2 shrink-0 relative z-10 flex-wrap">
                    <button
                      onClick={() => navigateToTab("finder")}
                      className="btn-interactive flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold rounded-lg cursor-pointer shadow-xs shadow-indigo-500/20"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      <span>Start New Search</span>
                      <ArrowRight className="h-3 w-3 opacity-70" />
                    </button>

                    <button
                      onClick={fetchData}
                      title="Fetch latest leads and system metrics"
                      className={`btn-interactive flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                        isLight 
                          ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-xs" 
                          : "border-[#1e293b] bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <RefreshCw className="h-3 w-3 text-indigo-400" />
                      <span>Sync</span>
                    </button>

                    <button
                      onClick={downloadCSV}
                      disabled={processedLeads.length === 0}
                      title="Download full CRM dataset as CSV"
                      className={`btn-interactive flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer transition-all disabled:opacity-40 ${
                        isLight 
                          ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-xs" 
                          : "border-[#1e293b] bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <FileSpreadsheet className="h-3 w-3 text-emerald-400" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                </div>

                {/* ── High-Impact Interactive KPI Stat Cards (4 Cards) ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  
                  {/* Card 1: Total Leads in Database */}
                  <div 
                    onClick={() => {
                      setCrmPriorityFilter("ALL");
                      navigateToTab("leads");
                    }}
                    role="button"
                    tabIndex={0}
                    title="Click to view all leads in CRM"
                    className={`group cursor-pointer rounded-xl p-3.5 border transition-all duration-200 relative overflow-hidden hover:-translate-y-0.5 ${
                      isLight 
                        ? "bg-white border-slate-200/80 shadow-xs hover:border-indigo-300 hover:shadow-indigo-500/10 hover:shadow-md" 
                        : "bg-gradient-to-br from-slate-900/90 to-[#0b101d] border-[#1e293b] hover:border-indigo-500/40 hover:shadow-[0_4px_20px_rgba(99,102,241,0.12)]"
                    }`}
                  >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 w-20 h-20 bg-indigo-500/10 rounded-full blur-lg group-hover:bg-indigo-500/20 transition-all duration-300"></div>
                    <div className="flex justify-between items-start relative z-10">
                      <div>
                        <span className={`text-[10px] font-bold tracking-wider uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                          Total Leads
                        </span>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className={`text-2xl font-black tracking-tight tabular-nums ${isLight ? "text-slate-900" : "text-white"}`}>
                            {totalProcessed.toLocaleString()}
                          </span>
                          <span className={`text-[10px] font-semibold ${isLight ? "text-slate-500" : "text-slate-400"}`}>records</span>
                        </div>
                      </div>
                      <div className={`p-2 rounded-lg transition-transform duration-200 group-hover:scale-110 ${
                        isLight ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner"
                      }`}>
                        <Database className="h-4 w-4" />
                      </div>
                    </div>
                    
                    <div className="mt-3 pt-2 border-t border-dashed border-slate-700/20 flex items-center justify-between text-[10px] relative z-10">
                      <span className={`font-medium ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                        CRM Repository
                      </span>
                      <span className="inline-flex items-center gap-1 font-bold text-indigo-500 group-hover:translate-x-0.5 transition-transform">
                        Explore <ArrowRight className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>

                  {/* Card 2: Hot Leads (🔥 HOT) */}
                  <div 
                    onClick={() => {
                      setCrmPriorityFilter("HOT");
                      navigateToTab("leads");
                    }}
                    role="button"
                    tabIndex={0}
                    title="Click to filter HOT leads in CRM"
                    className={`group cursor-pointer rounded-xl p-3.5 border transition-all duration-200 relative overflow-hidden hover:-translate-y-0.5 ${
                      isLight 
                        ? "bg-white border-slate-200/80 shadow-xs hover:border-rose-300 hover:shadow-rose-500/10 hover:shadow-md" 
                        : "bg-gradient-to-br from-slate-900/90 to-[#0b101d] border-rose-950/40 hover:border-rose-500/40 hover:shadow-[0_4px_20px_rgba(244,63,94,0.15)]"
                    }`}
                  >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 w-20 h-20 bg-rose-500/10 rounded-full blur-lg group-hover:bg-rose-500/20 transition-all duration-300"></div>
                    <div className="flex justify-between items-start relative z-10">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold tracking-wider uppercase text-rose-500">
                            Hot Leads
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            {hotPercentage}%
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className="text-2xl font-black tracking-tight tabular-nums text-rose-500">
                            {hotLeads.toLocaleString()}
                          </span>
                          <span className="text-[10px] font-semibold text-rose-400/80">HOT</span>
                        </div>
                      </div>
                      <div className={`p-2 rounded-lg transition-transform duration-200 group-hover:scale-110 ${
                        isLight ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-inner"
                      }`}>
                        <Flame className="h-4 w-4" />
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-dashed border-slate-700/20 flex items-center justify-between text-[10px] relative z-10">
                      <span className={`font-medium ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                        Critical digital gaps
                      </span>
                      <span className="inline-flex items-center gap-1 font-bold text-rose-500 group-hover:translate-x-0.5 transition-transform">
                        Filter HOT <ArrowRight className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>

                  {/* Card 3: Warm Leads (⚡ WARM) */}
                  <div 
                    onClick={() => {
                      setCrmPriorityFilter("WARM");
                      navigateToTab("leads");
                    }}
                    role="button"
                    tabIndex={0}
                    title="Click to filter WARM leads in CRM"
                    className={`group cursor-pointer rounded-xl p-3.5 border transition-all duration-200 relative overflow-hidden hover:-translate-y-0.5 ${
                      isLight 
                        ? "bg-white border-slate-200/80 shadow-xs hover:border-amber-300 hover:shadow-amber-500/10 hover:shadow-md" 
                        : "bg-gradient-to-br from-slate-900/90 to-[#0b101d] border-amber-950/40 hover:border-amber-500/40 hover:shadow-[0_4px_20px_rgba(245,158,11,0.15)]"
                    }`}
                  >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 w-20 h-20 bg-amber-500/10 rounded-full blur-lg group-hover:bg-amber-500/20 transition-all duration-300"></div>
                    <div className="flex justify-between items-start relative z-10">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold tracking-wider uppercase text-amber-500">
                            Warm Leads
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            {warmPercentage}%
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className="text-2xl font-black tracking-tight tabular-nums text-amber-500">
                            {warmLeads.toLocaleString()}
                          </span>
                          <span className="text-[10px] font-semibold text-amber-400/80">WARM</span>
                        </div>
                      </div>
                      <div className={`p-2 rounded-lg transition-transform duration-200 group-hover:scale-110 ${
                        isLight ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-inner"
                      }`}>
                        <Zap className="h-4 w-4" />
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-dashed border-slate-700/20 flex items-center justify-between text-[10px] relative z-10">
                      <span className={`font-medium ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                        Moderate upside
                      </span>
                      <span className="inline-flex items-center gap-1 font-bold text-amber-500 group-hover:translate-x-0.5 transition-transform">
                        Filter WARM <ArrowRight className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>

                  {/* Card 4: Webhook & Outbox Sync */}
                  <div 
                    className={`rounded-xl p-3.5 border transition-all duration-200 relative overflow-hidden ${
                      isLight 
                        ? "bg-white border-slate-200/80 shadow-xs" 
                        : "bg-gradient-to-br from-slate-900/90 to-[#0b101d] border-[#1e293b]"
                    }`}
                  >
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 w-20 h-20 bg-emerald-500/10 rounded-full blur-lg"></div>
                    <div className="flex justify-between items-start relative z-10">
                      <div>
                        <span className={`text-[10px] font-bold tracking-wider uppercase ${failedLeads.length > 0 ? "text-amber-400" : "text-emerald-500"}`}>
                          Outbox Delivery
                        </span>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className={`text-2xl font-black tracking-tight tabular-nums ${failedLeads.length > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                            {failedLeads.length === 0 ? "100%" : failedLeads.length}
                          </span>
                          <span className={`text-[10px] font-semibold ${failedLeads.length > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                            {failedLeads.length === 0 ? "synced" : "pending"}
                          </span>
                        </div>
                      </div>
                      <div className={`p-2 rounded-lg ${
                        failedLeads.length > 0
                          ? isLight ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : isLight ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      }`}>
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-dashed border-slate-700/20 flex items-center justify-between text-[10px] relative z-10">
                      {failedLeads.length > 0 ? (
                        <button 
                          onClick={handleRetryFailed}
                          disabled={isRetryingFailed}
                          className="font-bold text-amber-400 hover:text-amber-300 underline cursor-pointer border-0 bg-transparent p-0 flex items-center gap-1"
                        >
                          {isRetryingFailed ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          <span>Retry Dispatch</span>
                        </button>
                      ) : (
                        <>
                          <span className={`font-medium ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                            Google Sheet
                          </span>
                          <span className="font-bold text-emerald-500">Connected</span>
                        </>
                      )}
                    </div>
                  </div>

                </div>

                {/* ── Interactive Map & Analytics Grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  
                  {/* Left Column: Interactive Geographic Distribution Map */}
                  <div className={`lg:col-span-8 ${
                    isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                  } border rounded-xl p-4 flex flex-col justify-between`}>
                    
                    <div>
                      {/* Map Header with Filter Segmented Controls */}
                      <div className={`flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b gap-2.5 ${
                        isLight ? "border-slate-100" : "border-[#1e293b]/70"
                      }`}>
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/10 text-indigo-400"}`}>
                            <Map className="h-4 w-4" />
                          </div>
                          <div>
                            <h2 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                              Lead Locations Map
                            </h2>
                            <p className="text-[10px] text-slate-400">
                              {processedLeads.length} localized prospect markers
                            </p>
                          </div>
                        </div>

                        {/* Interactive Priority Filter Pills */}
                        <div className={`inline-flex items-center rounded-lg p-0.5 border self-start sm:self-auto ${
                          isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/80 border-slate-800"
                        }`}>
                          <button
                            onClick={() => setOverviewMapFilter("ALL")}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
                              overviewMapFilter === "ALL"
                                ? isLight ? "bg-white text-indigo-600 shadow-xs font-bold" : "bg-indigo-600 text-white shadow-xs font-bold"
                                : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                            }`}
                          >
                            All ({processedLeads.length})
                          </button>
                          <button
                            onClick={() => setOverviewMapFilter("HOT")}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
                              overviewMapFilter === "HOT"
                                ? "bg-rose-500 text-white shadow-xs font-bold"
                                : isLight ? "text-rose-600 hover:text-rose-700" : "text-rose-400 hover:text-rose-300"
                            }`}
                          >
                            🔥 Hot ({hotLeads})
                          </button>
                          <button
                            onClick={() => setOverviewMapFilter("WARM")}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
                              overviewMapFilter === "WARM"
                                ? "bg-amber-500 text-white shadow-xs font-bold"
                                : isLight ? "text-amber-600 hover:text-amber-700" : "text-amber-400 hover:text-amber-300"
                            }`}
                          >
                            ⚡ Warm ({warmLeads})
                          </button>
                          <button
                            onClick={() => setOverviewMapFilter("COLD")}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer ${
                              overviewMapFilter === "COLD"
                                ? isLight ? "bg-slate-700 text-white shadow-xs font-bold" : "bg-slate-600 text-white shadow-xs font-bold"
                                : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            ❄️ Cold ({coldLeads})
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Leaflet Map Box */}
                    {processedLeads.length === 0 ? (
                      <div className={`flex-grow flex flex-col items-center justify-center border border-dashed ${
                        isLight ? "border-slate-200 bg-slate-50/50" : "border-[#1e293b] bg-slate-950/20"
                      } rounded-xl py-10 text-center`}>
                        <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400 mb-2 animate-pulse">
                          <Compass className="h-6 w-6" />
                        </div>
                        <h4 className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-white"}`}>No geo-targeted leads found</h4>
                        <p className="text-[11px] text-slate-400 max-w-sm mt-0.5">
                          Drop a search pin in the Lead Finder tab to automatically extract businesses from Google Maps.
                        </p>
                        <button
                          onClick={() => navigateToTab("finder")}
                          className="mt-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer shadow-xs btn-interactive"
                        >
                          Open Lead Finder
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <div id="overview-map" className={`w-full h-[280px] rounded-xl overflow-hidden border ${
                          isLight ? "border-slate-200 shadow-inner" : "border-[#1e293b] shadow-xl"
                        } z-0`}></div>
                      </div>
                    )}

                    {/* Map Legend Footer */}
                    <div className={`mt-3 pt-2.5 border-t flex flex-wrap items-center justify-between gap-2.5 text-[10px] ${
                      isLight ? "border-slate-100 text-slate-500" : "border-[#1e293b]/60 text-slate-400"
                    }`}>
                      <div className="flex items-center gap-3.5 flex-wrap">
                        <span className="flex items-center gap-1 font-medium">
                          <span className="h-2 w-2 rounded-full bg-rose-500 shadow-xs"></span>
                          <span>Hot: Urgent Need / No Site</span>
                        </span>
                        <span className="flex items-center gap-1 font-medium">
                          <span className="h-2 w-2 rounded-full bg-amber-500 shadow-xs"></span>
                          <span>Warm: Moderate Gaps</span>
                        </span>
                        <span className="flex items-center gap-1 font-medium">
                          <span className="h-2 w-2 rounded-full bg-slate-500 shadow-xs"></span>
                          <span>Cold: Fully Established</span>
                        </span>
                      </div>
                      <span className="text-[9.5px] text-indigo-400 font-medium italic">
                        💡 Click any marker to view company profile & score
                      </span>
                    </div>

                  </div>

                  {/* Right Column: Visual Quality & Health Matrices */}
                  <div className="lg:col-span-4 space-y-4">
                    
                    {/* Card 1: Priority Breakdown */}
                    <div className={`${
                      isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                    } border rounded-xl p-4`}>
                      <div className={`flex items-center justify-between pb-2.5 border-b mb-3.5 ${
                        isLight ? "border-slate-100" : "border-[#1e293b]/70"
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <BarChart3 className="h-3.5 w-3.5 text-indigo-400" />
                          <h3 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                            Priority Breakdown
                          </h3>
                        </div>
                        <span className="text-[9.5px] font-bold text-indigo-400 px-1.5 py-0.2 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                          Total: {totalProcessed}
                        </span>
                      </div>

                      {/* Visual Stacked Multi-Segment Bar */}
                      <div className="space-y-3">
                        <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-800/40 p-0.5 border border-slate-700/40">
                          <div 
                            className="h-full bg-rose-500 rounded-l-full transition-all duration-700" 
                            style={{ width: `${hotPercentage}%` }}
                            title={`Hot: ${hotLeads} (${hotPercentage}%)`}
                          />
                          <div 
                            className="h-full bg-amber-500 transition-all duration-700" 
                            style={{ width: `${warmPercentage}%` }}
                            title={`Warm: ${warmLeads} (${warmPercentage}%)`}
                          />
                          <div 
                            className="h-full bg-slate-500 rounded-r-full transition-all duration-700" 
                            style={{ width: `${coldPercentage}%` }}
                            title={`Cold: ${coldLeads} (${coldPercentage}%)`}
                          />
                        </div>

                        {/* Detailed Rows */}
                        <div className="space-y-2 pt-1">
                          {/* Hot Row */}
                          <div 
                            onClick={() => { setCrmPriorityFilter("HOT"); navigateToTab("leads"); }}
                            className="p-2 rounded-lg border border-rose-500/15 bg-rose-500/5 hover:bg-rose-500/10 cursor-pointer transition-all flex items-center justify-between"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                              <span className="text-[11px] font-bold text-rose-400">HOT Priority</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black tabular-nums text-white">{hotLeads}</span>
                              <span className="text-[9.5px] text-slate-400">({hotPercentage}%)</span>
                            </div>
                          </div>

                          {/* Warm Row */}
                          <div 
                            onClick={() => { setCrmPriorityFilter("WARM"); navigateToTab("leads"); }}
                            className="p-2 rounded-lg border border-amber-500/15 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer transition-all flex items-center justify-between"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              <span className="text-[11px] font-bold text-amber-400">WARM Priority</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black tabular-nums text-white">{warmLeads}</span>
                              <span className="text-[9.5px] text-slate-400">({warmPercentage}%)</span>
                            </div>
                          </div>

                          {/* Cold Row */}
                          <div 
                            onClick={() => { setCrmPriorityFilter("COLD"); navigateToTab("leads"); }}
                            className="p-2 rounded-lg border border-slate-500/15 bg-slate-500/5 hover:bg-slate-500/10 cursor-pointer transition-all flex items-center justify-between"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              <span className="text-[11px] font-bold text-slate-400">COLD Priority</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black tabular-nums text-white">{coldLeads}</span>
                              <span className="text-[9.5px] text-slate-400">({coldPercentage}%)</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Digital Presence Health Matrix */}
                    <div className={`${
                      isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                    } border rounded-xl p-4`}>
                      <div className={`flex items-center justify-between pb-2.5 border-b mb-3 ${
                        isLight ? "border-slate-100" : "border-[#1e293b]/70"
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <Activity className="h-3.5 w-3.5 text-indigo-400" />
                          <h3 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                            Digital Gap Matrix
                          </h3>
                        </div>
                        <span className="text-[9.5px] text-slate-400 font-mono">0–200 Index</span>
                      </div>

                      <div className="space-y-2.5">
                        {/* 0-50: Critical Gaps */}
                        <div>
                          <div className="flex justify-between text-[10.5px] mb-1">
                            <span className="font-semibold text-rose-400 flex items-center gap-1.5">
                              <span>0–50</span>
                              <span className="text-[8.5px] px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-400">Prime Targets</span>
                            </span>
                            <span className="font-bold tabular-nums text-white">{scorePoor} leads</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div 
                              className="h-full bg-rose-500 transition-all duration-700 rounded-full" 
                              style={{ width: `${maxScoreCount > 0 ? (scorePoor / maxScoreCount) * 100 : 0}%` }}
                            />
                          </div>
                        </div>

                        {/* 51-100: Needs Work */}
                        <div>
                          <div className="flex justify-between text-[10.5px] mb-1">
                            <span className="font-semibold text-amber-400 flex items-center gap-1.5">
                              <span>51–100</span>
                              <span className="text-[8.5px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400">Needs Work</span>
                            </span>
                            <span className="font-bold tabular-nums text-white">{scoreNeedsWork} leads</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div 
                              className="h-full bg-amber-500 transition-all duration-700 rounded-full" 
                              style={{ width: `${maxScoreCount > 0 ? (scoreNeedsWork / maxScoreCount) * 100 : 0}%` }}
                            />
                          </div>
                        </div>

                        {/* 101-150: Moderate */}
                        <div>
                          <div className="flex justify-between text-[10.5px] mb-1">
                            <span className="font-semibold text-indigo-400 flex items-center gap-1.5">
                              <span>101–150</span>
                              <span className="text-[8.5px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400">Moderate</span>
                            </span>
                            <span className="font-bold tabular-nums text-white">{scoreGood} leads</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div 
                              className="h-full bg-indigo-500 transition-all duration-700 rounded-full" 
                              style={{ width: `${maxScoreCount > 0 ? (scoreGood / maxScoreCount) * 100 : 0}%` }}
                            />
                          </div>
                        </div>

                        {/* 151-200: Established */}
                        <div>
                          <div className="flex justify-between text-[10.5px] mb-1">
                            <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                              <span>151–200</span>
                              <span className="text-[8.5px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400">Established</span>
                            </span>
                            <span className="font-bold tabular-nums text-white">{scoreExcellent} leads</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div 
                              className="h-full bg-emerald-500 transition-all duration-700 rounded-full" 
                              style={{ width: `${maxScoreCount > 0 ? (scoreExcellent / maxScoreCount) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                </div>

                {/* ── 3-Step Interactive Growth Flow / Pipeline Banner ── */}
                <div className={`p-4 border rounded-xl ${
                  isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                }`}>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-700/20 mb-3.5">
                    <div>
                      <h3 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        Your 3-Step Client Acquisition Engine
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Follow the automated workflow to generate verified paying clients.
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                      Ready to Scale <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    
                    {/* Step 1 */}
                    <div 
                      onClick={() => navigateToTab("finder")}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer hover:-translate-y-0.5 ${
                        isLight ? "bg-slate-50 border-slate-200 hover:border-indigo-300" : "bg-slate-900/60 border-slate-800 hover:border-indigo-500/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="h-6 w-6 rounded-lg bg-indigo-600/10 text-indigo-400 font-bold text-xs flex items-center justify-center border border-indigo-500/20">
                          1
                        </span>
                        <MapPin className="h-3.5 w-3.5 text-indigo-400" />
                      </div>
                      <h4 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        Locate & Extract
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Search any target locality for high-intent business niches on Google Maps.
                      </p>
                      <div className="mt-2 text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                        Open Lead Finder <ArrowRight className="h-2.5 w-2.5" />
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div 
                      onClick={() => navigateToTab("leads")}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer hover:-translate-y-0.5 ${
                        isLight ? "bg-slate-50 border-slate-200 hover:border-indigo-300" : "bg-slate-900/60 border-slate-800 hover:border-indigo-500/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="h-6 w-6 rounded-lg bg-violet-600/10 text-violet-400 font-bold text-xs flex items-center justify-center border border-violet-500/20">
                          2
                        </span>
                        <Database className="h-3.5 w-3.5 text-violet-400" />
                      </div>
                      <h4 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        Score & Segment
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Filter by AI score, website existence, and missing pixels to find responsive leads.
                      </p>
                      <div className="mt-2 text-[10px] font-bold text-violet-400 flex items-center gap-1">
                        Review CRM Leads <ArrowRight className="h-2.5 w-2.5" />
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div 
                      onClick={() => navigateToTab("campaigns")}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer hover:-translate-y-0.5 ${
                        isLight ? "bg-slate-50 border-slate-200 hover:border-indigo-300" : "bg-slate-900/60 border-slate-800 hover:border-indigo-500/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="h-6 w-6 rounded-lg bg-emerald-600/10 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/20">
                          3
                        </span>
                        <Send className="h-3.5 w-3.5 text-emerald-400" />
                      </div>
                      <h4 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                        Multichannel Outreach
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Deploy personalized Email & WhatsApp sequences directly to verified decision makers.
                      </p>
                      <div className="mt-2 text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                        Launch Outreach <ArrowRight className="h-2.5 w-2.5" />
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            );
          })()}

          {/* TAB 2: GEO LEAD FINDER */}
          {activeTab === "finder" && (() => {
            const NICHE_PRESETS = [
              { label: "Dental Clinics", icon: "🦷" },
              { label: "Ayurvedic & Wellness", icon: "🌿" },
              { label: "Digital Agencies", icon: "💻" },
              { label: "Legal & Law Firms", icon: "⚖️" },
              { label: "Real Estate & Builders", icon: "🏡" },
              { label: "Fine Dining & Cafes", icon: "🍽️" },
            ];
            const RADIUS_PRESETS = [3, 5, 10, 15, 25, 50];

            return (
              <div className="space-y-6 animate-fadeIn pb-8">
                
                {/* ── Top Discovery Header Banner ── */}
                <div className={`p-3.5 sm:p-4 border rounded-xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                }`}>
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
                      <Compass className="h-4 w-4" />
                    </div>
                    <div>
                      <h1 className={`text-sm sm:text-base font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                        Geospatial Maps Lead Finder
                      </h1>
                      <p className="text-[11px] text-slate-400">
                        Scan Google Maps for local businesses, extract verified contact info, and evaluate digital gaps.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    {isRunning ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
                        </span>
                        Discovery In Progress
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        Engine Ready
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  
                  {/* Left Column: Interactive Area Selector Map */}
                  <div className={`lg:col-span-7 ${
                    isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                  } border rounded-xl p-4 flex flex-col justify-between`}>
                    
                    <div>
                      <div className={`flex items-center justify-between pb-2.5 mb-3 border-b ${
                        isLight ? "border-slate-100" : "border-[#1e293b]/70"
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-4 w-4 text-indigo-400" />
                          <h2 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                            Target Locality & Radius
                          </h2>
                        </div>
                        <span className="text-[10px] text-slate-400 hidden sm:inline">
                          Click map or search below to drop center
                        </span>
                      </div>

                      {/* Geocoding Search Form */}
                      <form onSubmit={handleSearchAreaGeocode} className="flex gap-2 mb-3">
                        <div className="relative flex-grow">
                          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                          <input 
                            type="text" 
                            placeholder="Type locality (e.g. Gangapur Road, Nashik or Koregaon Park, Pune)"
                            value={mapSearchText}
                            onChange={(e) => setMapSearchText(e.target.value)}
                            className={`w-full text-xs border rounded-lg pl-8 pr-3 py-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${
                              isLight 
                                ? "bg-slate-50 text-slate-900 border-slate-200 focus:bg-white" 
                                : "bg-slate-950/60 text-white border-[#1e293b] focus:border-indigo-500"
                            }`}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={isGeocoding || isRunning}
                          className="btn-interactive px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50"
                        >
                          {isGeocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                          <span>Locate</span>
                        </button>
                      </form>
                    </div>

                    {/* Leaflet Map Box */}
                    <div className="relative">
                      <div id="finder-map" className={`w-full h-[240px] rounded-xl overflow-hidden border ${
                        isLight ? "border-slate-200" : "border-[#1e293b]"
                      } z-0 shadow-inner`}></div>
                    </div>

                    {/* Interactive Coordinates Bar */}
                    <div className={`mt-2.5 text-[10px] flex items-center justify-between p-2 rounded-lg border ${
                      isLight ? "bg-slate-50 border-slate-200 text-slate-600" : "bg-slate-950/50 border-slate-900 text-slate-400"
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-indigo-400" />
                        <span className="font-medium">Target Coordinates:</span>
                        <span className="font-mono font-bold text-indigo-400">
                          {lat ? lat.toFixed(5) : "19.99750"}, {lng ? lng.toFixed(5) : "73.78980"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const coordText = `${lat?.toFixed(6) || 0}, ${lng?.toFixed(6) || 0}`;
                          copyToClipboard(coordText, "coords");
                        }}
                        className="btn-interactive flex items-center gap-1 text-[9.5px] font-semibold text-slate-400 hover:text-white cursor-pointer"
                      >
                        {copiedField === "coords" ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <Check className="h-2.5 w-2.5" /> Copied
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Copy className="h-2.5 w-2.5" /> Copy
                          </span>
                        )}
                      </button>
                    </div>

                  </div>

                  {/* Right Column: Scan Parameters & Niche Selector */}
                  <div className={`lg:col-span-5 ${
                    isLight ? "bg-white border-slate-200/80 shadow-xs" : "bg-[#090d16] border-[#1e293b] shadow-lg"
                  } border rounded-xl p-4 flex flex-col justify-between`}>
                    
                    <div>
                      <div className={`flex items-center gap-1.5 pb-2.5 mb-3 border-b ${
                        isLight ? "border-slate-100" : "border-[#1e293b]/70"
                      }`}>
                        <Sliders className="h-4 w-4 text-indigo-400" />
                        <h2 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                          Discovery Parameters
                        </h2>
                      </div>

                      <form onSubmit={handleSaveConfig} className="space-y-3">
                        
                        {/* Business Niche Selector */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[9.5px] font-bold text-slate-400 tracking-wider uppercase">
                              Target Business Niche
                            </label>
                            <span className="text-[9.5px] text-indigo-400 font-semibold">1-Click Presets</span>
                          </div>

                          {/* Quick Niche Chips */}
                          <div className="flex flex-wrap gap-1 mb-2">
                            {NICHE_PRESETS.map((preset) => {
                              const isSelected = businessType.toLowerCase() === preset.label.toLowerCase();
                              return (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => setBusinessType(preset.label)}
                                  disabled={isRunning || isSavingConfig}
                                  className={`btn-interactive text-[9.5px] px-2 py-0.5 rounded-md border transition-all cursor-pointer flex items-center gap-1 ${
                                    isSelected
                                      ? "bg-indigo-600 text-white border-indigo-500 font-bold shadow-xs"
                                      : isLight
                                        ? "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200/70"
                                        : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                                  }`}
                                >
                                  <span>{preset.icon}</span>
                                  <span>{preset.label}</span>
                                </button>
                              );
                            })}
                          </div>

                          <input 
                            type="text" 
                            value={businessType}
                            onChange={(e) => setBusinessType(e.target.value)}
                            placeholder="e.g. Dental Clinic, Marketing Agency"
                            disabled={isRunning || isSavingConfig}
                            className={`w-full text-xs border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50 transition-all ${
                              isLight ? "bg-slate-50 text-slate-900 border-slate-200" : "bg-slate-950/60 text-white border-[#1e293b]"
                            }`}
                            required
                          />
                        </div>

                        {/* Location Name */}
                        <div>
                          <label className="block text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                            Area / Locality Label
                          </label>
                          <input 
                            type="text" 
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            onBlur={async () => {
                              if (!location.trim()) return;
                              try {
                                const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(location)}`);
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data && data.length > 0) {
                                    const item = data[0];
                                    const newLat = parseFloat(item.lat);
                                    const newLng = parseFloat(item.lon);
                                    setLat(newLat);
                                    setLng(newLng);
                                    if (finderMapInstance.current) {
                                      finderMapInstance.current.setView([newLat, newLng], 12);
                                    }
                                    if (finderMarker.current) {
                                      finderMarker.current.setLatLng([newLat, newLng]);
                                    }
                                    if (finderCircle.current) {
                                      finderCircle.current.setLatLng([newLat, newLng]);
                                    }
                                  }
                                }
                              } catch (e) {
                                console.error("Auto-geocoding error:", e);
                              }
                            }}
                            placeholder="e.g. Gangapur Road, Nashik"
                            disabled={isRunning || isSavingConfig}
                            className={`w-full text-xs border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50 transition-all ${
                              isLight ? "bg-slate-50 text-slate-900 border-slate-200" : "bg-slate-950/60 text-white border-[#1e293b]"
                            }`}
                            required
                          />
                        </div>

                        {/* Search Radius with Quick Pills */}
                        <div>
                          <div className="flex justify-between text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                            <span>Search Radius Limit</span>
                            <span className="text-indigo-400 font-bold tabular-nums">{radius} km radius</span>
                          </div>

                          {/* Quick Radius Pills */}
                          <div className="flex gap-1 mb-1.5">
                            {RADIUS_PRESETS.map((km) => (
                              <button
                                key={km}
                                type="button"
                                onClick={() => setRadius(km)}
                                disabled={isRunning || isSavingConfig}
                                className={`btn-interactive flex-1 text-[9px] py-0.5 rounded-md border transition-all cursor-pointer font-bold ${
                                  radius === km
                                    ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                                    : isLight
                                      ? "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                                      : "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white"
                                }`}
                              >
                                {km}km
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2.5">
                            <input 
                              type="range" 
                              min="1"
                              max="100"
                              value={radius > 100 ? 100 : radius}
                              onChange={(e) => setRadius(parseInt(e.target.value) || 5)}
                              disabled={isRunning || isSavingConfig}
                              className="flex-grow h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                            <input 
                              type="number"
                              min="1"
                              max="500"
                              value={radius}
                              onChange={(e) => setRadius(parseInt(e.target.value) || 5)}
                              disabled={isRunning || isSavingConfig}
                              className={`w-14 text-center text-xs font-bold border rounded-md px-1.5 py-1 focus:outline-none focus:border-indigo-500 disabled:opacity-50 ${
                                isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"
                              }`}
                              title="Type custom radius in km"
                            />
                          </div>
                        </div>

                        {/* Limit Leads & Options */}
                        <div className="grid grid-cols-2 gap-2.5 pt-0.5">
                          <div>
                            <label className="block text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mb-1">
                              Max Leads
                            </label>
                            <input 
                              type="number" 
                              min="1"
                              max="5000"
                              value={maxResults}
                              onChange={(e) => setMaxResults(parseInt(e.target.value, 10) || 10)}
                              disabled={isRunning || isSavingConfig}
                              className={`w-full text-xs font-bold border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50 ${
                                isLight ? "bg-slate-50 text-slate-900 border-slate-200" : "bg-slate-950/60 text-white border-[#1e293b]"
                              }`}
                              required
                            />
                          </div>

                          <div className="flex flex-col justify-center gap-1 pt-3">
                            <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300 cursor-pointer select-none">
                              <input 
                                type="checkbox"
                                checked={headless}
                                onChange={(e) => setHeadless(e.target.checked)}
                                disabled={isRunning || isSavingConfig}
                                className="rounded text-indigo-600 focus:ring-indigo-500/20 h-3 w-3"
                              />
                              <span>Headless Mode</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-[10.5px] text-slate-300 cursor-pointer select-none">
                              <input 
                                type="checkbox"
                                checked={enableSimulation}
                                onChange={(e) => setEnableSimulation(e.target.checked)}
                                disabled={isRunning || isSavingConfig}
                                className="rounded text-indigo-600 focus:ring-indigo-500/20 h-3 w-3"
                              />
                              <span>Simulation Mode</span>
                            </label>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={isRunning || isSavingConfig}
                          className="w-full text-xs font-bold py-1.5 rounded-lg border border-indigo-500/30 text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 focus:outline-none transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer btn-interactive"
                        >
                          {isSavingConfig ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          <span>{isSavingConfig ? "Saving..." : configSuccess ? "Parameters Saved ✓" : "Save Configuration"}</span>
                        </button>
                      </form>
                    </div>

                    {/* Primary Run / Stop Execution Trigger */}
                    <div className="pt-3 border-t border-slate-700/20 mt-3">
                      {isRunning ? (
                        <button
                          onClick={handleStopScraper}
                          disabled={isStopping}
                          className="w-full py-2.5 px-3 rounded-lg font-bold text-xs bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white flex items-center justify-center gap-1.5 shadow-md shadow-rose-500/20 focus:outline-none transition-all disabled:opacity-50 cursor-pointer btn-interactive"
                        >
                          {isStopping ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>Halting Scraper...</span>
                            </>
                          ) : (
                            <>
                              <X className="h-3.5 w-3.5" />
                              <span>Halt Active Scraper</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={handleStartScraper}
                          disabled={isRunning || isStartingScraper}
                          className="w-full py-2.5 px-3 rounded-lg font-bold text-xs bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white flex items-center justify-center gap-1.5 shadow-md shadow-indigo-500/25 focus:outline-none transition-all disabled:opacity-50 cursor-pointer btn-interactive"
                        >
                          {isStartingScraper ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                          <span>{isStartingScraper ? "Starting Lead Discovery…" : "Launch Lead Discovery Agent"}</span>
                        </button>
                      )}
                    </div>

                  </div>

                </div>

                {/* ── macOS-Style Execution Console ── */}
                <div className="bg-[#070b14] border border-[#1e293b] rounded-xl p-3.5 shadow-xl flex flex-col justify-between">
                  
                  {/* Console Header with Mac Dots and Terminal Tools */}
                  <div className="flex flex-wrap items-center justify-between pb-2.5 border-b border-[#1e293b] mb-3 gap-2.5">
                    <div className="flex items-center gap-2.5">
                      {/* Window Controls */}
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80 inline-block"></span>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 inline-block"></span>
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
                      </div>
                      
                      <div className="h-3.5 w-px bg-slate-800 mx-0.5"></div>

                      <div className="flex items-center gap-1.5">
                        <TerminalIcon className="h-3.5 w-3.5 text-indigo-400" />
                        <h3 className="text-[11px] font-bold font-mono text-slate-200 tracking-wide">
                          Scraper Engine Stream — Lead Discovery Job
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer select-none font-mono">
                        <input 
                          type="checkbox"
                          checked={autoScrollLogs}
                          onChange={(e) => setAutoScrollLogs(e.target.checked)}
                          className="rounded text-indigo-500 bg-slate-900 border-slate-700 h-3 w-3"
                        />
                        <span>Auto-scroll</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          copyToClipboard(terminalLogs, "logs");
                        }}
                        className="btn-interactive flex items-center gap-1 text-[10px] font-mono font-medium text-slate-400 hover:text-white px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 cursor-pointer"
                      >
                        {copiedField === "logs" ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <Check className="h-2.5 w-2.5" /> Copied
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Copy className="h-2.5 w-2.5" /> Copy Logs
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setTerminalLogs("")}
                        className="btn-interactive text-[10px] font-mono font-medium text-slate-400 hover:text-rose-400 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Terminal Log Screen */}
                  <div 
                    ref={terminalContainerRef}
                    className="w-full h-44 bg-black/90 border border-slate-900/80 rounded-lg p-3 font-mono text-[11px] overflow-y-auto leading-relaxed text-emerald-400 whitespace-pre-wrap select-text scrollbar-thin shadow-inner"
                  >
                    {terminalLogs || (
                      <span className="text-slate-600 italic">
                        [System ready] Click "Launch Lead Discovery Agent" above to start live stream output...
                      </span>
                    )}
                  </div>
                </div>

              </div>
            );
          })()}

          {/* TAB 3: CRM — LEAD LISTS */}
          {/* TAB 3: CRM — LEAD LISTS */}
          {/* Universal Leads workspace — extracted from the legacy agency-specific table. */}
          {activeTab === "leads" && (
            <LeadsWorkspace
              isLight={isLight}
              onOpenOutreach={handleOpenOutreach}
              onFindLeads={() => navigateToTab("finder")}
              onAddToCampaign={(leadIds) => {
                sessionStorage.setItem("leadgenpilot_campaign_lead_ids", JSON.stringify(leadIds));
                navigateToTab("campaigns");
              }}
            />
          )}

          {/* Legacy CRM retained temporarily as a compatibility reference, but no longer rendered. */}
          {false && activeTab === "leads" && (
            <div className="flex flex-col gap-4 h-full animate-fadeIn" style={{ minHeight: "calc(100vh - 180px)" }}>

              {/* ── MAIN AREA: Leads Table + Detail Panel ── */}
              <div className="flex-1 flex flex-col gap-4 min-w-0">

                {/* Filter & Action Bar */}
                <div className={`border rounded-2xl p-4 ${isLight ? "bg-white border-slate-200 shadow-sm" : "bg-[#090d16] border-[#1e293b]"}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Search */}
                    <div className="relative flex-grow min-w-[180px] max-w-xs">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search leads..."
                        value={crmSearchTerm}
                        onChange={e => setCrmSearchTerm(e.target.value)}
                        className={`w-full text-xs border rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                      />
                    </div>

                    {/* Interactive Custom Lead Lists Dropdown */}
                    <div ref={listDropdownRef} className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setListDropdownOpen(!listDropdownOpen)}
                        className={`flex items-center justify-between gap-2.5 text-xs border rounded-lg px-3 py-2 cursor-pointer transition-all focus:outline-none focus:border-indigo-500 ${
                          isLight
                            ? "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                            : "bg-[#030712] text-white border-[#1e293b] hover:border-[#334155]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-indigo-400 shrink-0" />
                          <span className="font-semibold truncate max-w-[120px]">
                            {activeListId === "ALL" ? "All Leads" : (leadLists.find(l => l.id === activeListId)?.name || "Select List")}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            activeListId === "ALL" 
                              ? isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/20 text-indigo-400"
                              : "bg-slate-500/10 text-slate-500"
                          }`}>
                            {activeListId === "ALL" 
                              ? leadLists.reduce((a, l) => a + l.leadCount, 0)
                              : (leadLists.find(l => l.id === activeListId)?.leadCount || 0)
                            }
                          </span>
                        </div>
                        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${listDropdownOpen ? "rotate-180" : ""}`} />
                      </button>

                      {listDropdownOpen && (
                        <div
                          className={`absolute z-30 mt-1 w-72 rounded-lg border shadow-lg overflow-hidden ${
                            isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"
                          }`}
                        >
                          {/* Search List input */}
                          <div className={`flex items-center gap-2 px-2.5 py-2 border-b ${isLight ? "border-slate-100" : "border-[#1e293b]/60"}`}>
                            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <input
                              type="text"
                              value={listSearchQuery}
                              onChange={(e) => setListSearchQuery(e.target.value)}
                              placeholder="Search lists..."
                              className={`w-full text-xs bg-transparent focus:outline-none ${isLight ? "text-slate-800 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
                              onClick={e => e.stopPropagation()}
                            />
                          </div>

                          {/* Options */}
                          <div className="max-h-60 overflow-y-auto p-1 space-y-0.5">
                            {/* All Leads view option */}
                            {("all leads".includes(listSearchQuery.trim().toLowerCase())) && (
                              <div
                                onClick={() => {
                                  handleSelectList("ALL");
                                  setListDropdownOpen(false);
                                  setListSearchQuery("");
                                }}
                                className={`group flex items-center justify-between gap-2 px-2.5 py-2 text-xs rounded-lg cursor-pointer select-none transition-colors ${
                                  activeListId === "ALL"
                                    ? isLight ? "bg-indigo-50 text-indigo-600 font-medium" : "bg-indigo-600/10 text-indigo-400 font-medium"
                                    : isLight ? "text-slate-600 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Database className={`h-4 w-4 shrink-0 ${activeListId === "ALL" ? "text-indigo-400" : "text-slate-500"}`} />
                                  <span className="truncate">All Leads</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    activeListId === "ALL" 
                                      ? isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-500/20 text-indigo-300"
                                      : "bg-slate-500/10 text-slate-500"
                                  }`}>
                                    {leadLists.reduce((a, l) => a + l.leadCount, 0)}
                                  </span>
                                  {activeListId === "ALL" && <Check className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
                                </div>
                              </div>
                            )}

                            {/* Separator / Title */}
                            {leadLists.length > 0 && (
                              <div className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500 border-t my-1 ${
                                isLight ? "border-slate-100" : "border-[#1e293b]/40"
                              }`}>
                                Saved Lists
                              </div>
                            )}

                            {isLoadingLists ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" />
                              </div>
                            ) : leadLists.filter(l => l.name.toLowerCase().includes(listSearchQuery.trim().toLowerCase())).length === 0 ? (
                              <div className="px-3 py-6 text-center text-[10px] text-slate-500">No matching lists found.</div>
                            ) : (
                              leadLists
                                .filter(l => l.name.toLowerCase().includes(listSearchQuery.trim().toLowerCase()))
                                .map(list => {
                                  const isActive = activeListId === list.id;
                                  const isRenaming = renamingListId === list.id;
                                  return (
                                    <div
                                      key={list.id}
                                      onClick={() => {
                                        if (!isRenaming) {
                                          handleSelectList(list.id);
                                          setListDropdownOpen(false);
                                          setListSearchQuery("");
                                        }
                                      }}
                                      className={`group relative flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-pointer select-none transition-colors ${
                                        isActive
                                          ? isLight ? "bg-indigo-50 text-indigo-600 font-medium" : "bg-indigo-600/10 text-indigo-400 font-medium"
                                          : isLight ? "text-slate-600 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"
                                      }`}
                                    >
                                      {isRenaming ? (
                                        <div className="flex items-center gap-1.5 w-full" onClick={e => e.stopPropagation()}>
                                          <input
                                            autoFocus
                                            value={renameListValue}
                                            onChange={e => setRenameListValue(e.target.value)}
                                            onKeyDown={e => { 
                                              if (e.key === "Enter") handleRenameList(list.id); 
                                              if (e.key === "Escape") setRenamingListId(null); 
                                            }}
                                            className={`w-full text-[11px] border rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500 ${
                                              isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#030712] border-[#1e293b] text-white"
                                            }`}
                                          />
                                          <button onClick={() => handleRenameList(list.id)} className="text-emerald-400 hover:text-emerald-300 p-0.5 shrink-0">
                                            <Check className="h-3.5 w-3.5" />
                                          </button>
                                          <button onClick={() => setRenamingListId(null)} className={`p-0.5 shrink-0 transition-colors ${isLight ? "text-slate-400 hover:text-slate-700" : "text-slate-400 hover:text-slate-300"}`}>
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex-1 min-w-0">
                                            <span className="block truncate">{list.name}</span>
                                            <span className={`block text-[9px] ${isActive ? "text-indigo-400/80" : "text-slate-500"}`}>
                                              {list.leadCount} leads · {new Date(list.scrapedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                            </span>
                                          </div>
                                          
                                          <div className="flex items-center gap-1 shrink-0">
                                            {/* Hidden action buttons showing on item hover */}
                                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                              <button
                                                onClick={() => { setRenamingListId(list.id); setRenameListValue(list.name); }}
                                                className="p-1 text-slate-400 hover:text-indigo-400 transition-colors"
                                                title="Rename List"
                                              >
                                                <PencilLine className="h-3.5 w-3.5" />
                                              </button>
                                              <button
                                                onClick={() => handleDeleteList(list.id)}
                                                disabled={isDeletingListId === list.id}
                                                className="p-1 text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-50"
                                                title="Delete List"
                                              >
                                                {isDeletingListId === list.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                              </button>
                                            </div>
                                            {isActive && <Check className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })
                            )}
                          </div>

                          {/* Dropdown Footer with New List Action */}
                          <div className={`px-2 py-1.5 border-t text-center ${isLight ? "bg-slate-50 border-slate-100" : "bg-slate-950/20 border-[#1e293b]/60"}`}>
                            <button
                              type="button"
                              onClick={() => {
                                setShowNewListModal(true);
                                setListDropdownOpen(false);
                              }}
                              className="w-full flex items-center justify-center gap-1 py-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                            >
                              <FolderPlus className="h-3 w-3" />
                              <span>Create New List</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Quick Priority Filter Pills */}
                    <div className={`hidden md:inline-flex items-center rounded-xl p-1 border shrink-0 ${
                      isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/90 border-slate-800"
                    }`}>
                      <button
                        type="button"
                        onClick={() => setCrmPriorityFilter("ALL")}
                        className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                          crmPriorityFilter === "ALL"
                            ? isLight ? "bg-white text-indigo-600 shadow-xs font-bold" : "bg-indigo-600 text-white shadow-xs font-bold"
                            : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        All Leads
                      </button>
                      <button
                        type="button"
                        onClick={() => setCrmPriorityFilter("HOT")}
                        className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                          crmPriorityFilter === "HOT"
                            ? "bg-rose-500 text-white shadow-xs font-bold"
                            : isLight ? "text-rose-600 hover:text-rose-700" : "text-rose-400 hover:text-rose-300"
                        }`}
                      >
                        🔥 Hot
                      </button>
                      <button
                        type="button"
                        onClick={() => setCrmPriorityFilter("WARM")}
                        className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                          crmPriorityFilter === "WARM"
                            ? "bg-amber-500 text-white shadow-xs font-bold"
                            : isLight ? "text-amber-600 hover:text-amber-700" : "text-amber-400 hover:text-amber-300"
                        }`}
                      >
                        ⚡ Warm
                      </button>
                      <button
                        type="button"
                        onClick={() => setCrmPriorityFilter("COLD")}
                        className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                          crmPriorityFilter === "COLD"
                            ? isLight ? "bg-slate-700 text-white shadow-xs font-bold" : "bg-slate-600 text-white shadow-xs font-bold"
                            : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        ❄️ Cold
                      </button>
                    </div>

                    {/* Website status */}
                    <SearchableDropdown
                      isLight={isLight}
                      value={crmWebsiteFilter}
                      onChange={setCrmWebsiteFilter}
                      placeholder="Select Website"
                      searchPlaceholder="Search website..."
                      options={[
                        { id: "ALL", label: "All Websites" },
                        { id: "MISSING", label: "Missing" },
                        { id: "BROKEN", label: "Broken" },
                        { id: "OUTDATED", label: "Outdated" },
                        { id: "WORKING", label: "Working" }
                      ]}
                      className="shrink-0 w-36"
                    />

                    {/* Toggle expanded filters */}
                    <button
                      onClick={() => setShowCrmFilters(p => !p)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-2 border rounded-lg transition-all cursor-pointer ${
                        showCrmFilters
                          ? "bg-indigo-600/10 text-indigo-400 border-indigo-500/30"
                          : isLight ? "bg-white text-slate-600 border-slate-200 hover:border-indigo-300" : "bg-transparent text-slate-400 border-[#1e293b] hover:border-indigo-500/40"
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      More Filters
                    </button>

                    {/* Actions right side */}
                    <div className="ml-auto flex items-center gap-2">
                      {selectedCrmLeadIds.size > 0 && (
                        <button
                          onClick={handleCrmBulkDelete}
                          className="flex items-center gap-1.5 text-xs px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg cursor-pointer transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete {selectedCrmLeadIds.size}
                        </button>
                      )}
                      {/* Interactive Export Dropdown */}
                      <div ref={exportDropdownRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                          disabled={crmLeads.length === 0}
                          className={`flex items-center gap-1.5 text-xs px-3 py-2 border rounded-lg cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            isLight 
                              ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50" 
                              : "bg-transparent text-slate-300 border-[#1e293b] hover:bg-slate-800/40"
                          }`}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Export Leads</span>
                          <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${exportDropdownOpen ? "rotate-180" : ""}`} />
                        </button>

                        {exportDropdownOpen && (
                          <div
                            className={`absolute right-0 z-30 mt-1 w-44 rounded-lg border shadow-lg overflow-hidden ${
                              isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"
                            }`}
                          >
                            <div className="py-1">
                              <button
                                onClick={() => {
                                  handleExportCSV();
                                  setExportDropdownOpen(false);
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${
                                  isLight ? "text-slate-650 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"
                                }`}
                              >
                                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span>Export as CSV</span>
                              </button>

                              <button
                                onClick={() => {
                                  handleExportExcel();
                                  setExportDropdownOpen(false);
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${
                                  isLight ? "text-slate-650 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"
                                }`}
                              >
                                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>Export as Excel (.xlsx)</span>
                              </button>
                              
                              <button
                                onClick={() => {
                                  handleExportPDF();
                                  setExportDropdownOpen(false);
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${
                                  isLight ? "text-slate-650 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"
                                }`}
                              >
                                <FileText className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                                <span>Export as PDF</span>
                              </button>

                              <button
                                onClick={() => {
                                  handleExportWord();
                                  setExportDropdownOpen(false);
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${
                                  isLight ? "text-slate-650 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"
                                }`}
                              >
                                <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                <span>Export as Word (.docx)</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => activeListId && fetchCrmLeads(activeListId)}
                        disabled={isLoadingCrmLeads}
                        className={`p-2 border rounded-lg cursor-pointer transition-all ${isLight ? "bg-white text-slate-600 border-slate-200 hover:bg-slate-50" : "bg-transparent text-slate-400 border-[#1e293b] hover:bg-slate-800"}`}
                        title="Refresh"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoadingCrmLeads ? "animate-spin text-indigo-400" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded filter row */}
                  {showCrmFilters && (
                    <div className={`mt-3 pt-3 border-t flex flex-wrap gap-3 ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-indigo-400" />
                        <SearchableDropdown
                          isLight={isLight}
                          value={crmEmailFilter}
                          onChange={setCrmEmailFilter}
                          placeholder="Select Email Status"
                          searchPlaceholder="Search status..."
                          options={[
                            { id: "ALL", label: "All Email Status" },
                            { id: "SENT", label: "Email Sent" },
                            { id: "PENDING", label: "Email Pending" }
                          ]}
                          className="shrink-0 w-40"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Smartphone className="h-3.5 w-3.5 text-indigo-400" />
                        <SearchableDropdown
                          isLight={isLight}
                          value={crmWhatsappFilter}
                          onChange={setCrmWhatsappFilter}
                          placeholder="Select WA Status"
                          searchPlaceholder="Search status..."
                          options={[
                            { id: "ALL", label: "All WhatsApp Status" },
                            { id: "SENT", label: "WA Sent" },
                            { id: "PENDING", label: "WA Pending" }
                          ]}
                          className="shrink-0 w-44"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                        <input
                          type="date"
                          value={crmDateFrom}
                          onChange={e => setCrmDateFrom(e.target.value)}
                          className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                          title="Date from"
                        />
                        <span className="text-slate-400 text-xs">to</span>
                        <input
                          type="date"
                          value={crmDateTo}
                          onChange={e => setCrmDateTo(e.target.value)}
                          className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                          title="Date to"
                        />
                      </div>

                      <button
                        onClick={() => {
                          setCrmSearchTerm(""); setCrmPriorityFilter("ALL"); setCrmWebsiteFilter("ALL");
                          setCrmEmailFilter("ALL"); setCrmWhatsappFilter("ALL");
                          setCrmDateFrom(""); setCrmDateTo("");
                        }}
                        className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1.5 border border-rose-500/20 rounded-lg cursor-pointer transition-all"
                      >
                        Clear Filters
                      </button>
                    </div>
                  )}
                </div>

                {/* Floating Multi-Selection Action Bar */}
                {selectedCrmLeadIds.size > 0 && (
                  <div className={`p-3.5 border rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xl animate-fadeIn ${
                    isLight 
                      ? "bg-indigo-50/90 border-indigo-200 text-indigo-950" 
                      : "bg-gradient-to-r from-indigo-950/90 via-slate-900 to-indigo-950/90 border-indigo-500/30 text-white"
                  }`}>
                    <div className="flex items-center gap-3">
                      <span className="h-7 w-7 rounded-xl bg-indigo-600 text-white font-black text-xs flex items-center justify-center shadow-xs">
                        {selectedCrmLeadIds.size}
                      </span>
                      <div>
                        <span className="text-xs font-bold">
                          {selectedCrmLeadIds.size} {selectedCrmLeadIds.size === 1 ? "lead" : "leads"} selected
                        </span>
                        <span className="text-[11px] opacity-70 ml-2 hidden sm:inline">
                          Apply bulk operations across selected records
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCrmLeadIds(new Set())}
                        className={`btn-interactive px-3 py-1.5 text-xs font-semibold rounded-xl border cursor-pointer ${
                          isLight 
                            ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" 
                            : "border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white"
                        }`}
                      >
                        Clear Selection
                      </button>
                      <button
                        type="button"
                        onClick={handleCrmBulkDelete}
                        className="btn-interactive px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Selected ({selectedCrmLeadIds.size})</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Table + Detail split */}
                <div className={`flex gap-4 flex-1 min-h-0 ${selectedCrmLeadDetail ? "" : ""}`}>

                  {/* Leads Table */}
                  <div className={`border rounded-2xl overflow-hidden flex flex-col ${selectedCrmLeadDetail ? "flex-1" : "flex-1"} ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
                    {!activeListId ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
                        <FolderOpen className="h-10 w-10 text-slate-600 opacity-40" />
                        <p className="text-sm text-slate-500">Select a list from the dropdown filter above to view leads.</p>
                        <p className="text-xs text-slate-600">Lists are created automatically after each scrape session.</p>
                      </div>
                    ) : (
                      <div className="overflow-auto flex-1">
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 z-10">
                            <tr className={`border-b text-[9px] uppercase tracking-wider ${isLight ? "bg-slate-50 border-slate-200 text-slate-400" : "bg-[#090d16] border-[#1e293b]/60 text-slate-400"}`}>
                              <th className="p-3 w-8">
                                <input
                                  type="checkbox"
                                  checked={crmLeads.length > 0 && crmLeads.every(l => l.id && selectedCrmLeadIds.has(l.id))}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setSelectedCrmLeadIds(new Set(crmLeads.map(l => l.id!).filter(Boolean)));
                                    } else {
                                      setSelectedCrmLeadIds(new Set());
                                    }
                                  }}
                                  className="rounded text-indigo-500 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                                />
                              </th>
                              {[
                                { key: "businessName", label: "Business" },
                                { key: "leadScore", label: "Score" },
                                { key: "leadPriority", label: "Priority" },
                                { key: "rating", label: "Rating" },
                                { key: "reviews", label: "Reviews" },
                              ].map(col => (
                                <th
                                  key={col.key}
                                  onClick={() => handleCrmSort(col.key)}
                                  className="p-3 font-normal cursor-pointer hover:text-indigo-400 transition-colors select-none"
                                >
                                  <div className="flex items-center gap-1">
                                    {col.label}
                                    {crmSortBy === col.key
                                      ? (crmSortDir === "asc" ? <ChevronUp className="h-3 w-3 text-indigo-400" /> : <ChevronDown className="h-3 w-3 text-indigo-400" />)
                                      : <ArrowUpDown className="h-3 w-3 opacity-30" />}
                                  </div>
                                </th>
                              ))}
                              <th className="p-3 font-normal">Website</th>
                              <th className="p-3 font-normal text-center">Socials</th>
                              <th className="p-3 font-normal">Outreach</th>
                              <th
                                onClick={() => handleCrmSort("dateAdded")}
                                className="p-3 font-normal cursor-pointer hover:text-indigo-400 transition-colors select-none"
                              >
                                <div className="flex items-center gap-1">
                                  Date
                                  {crmSortBy === "dateAdded"
                                    ? (crmSortDir === "asc" ? <ChevronUp className="h-3 w-3 text-indigo-400" /> : <ChevronDown className="h-3 w-3 text-indigo-400" />)
                                    : <ArrowUpDown className="h-3 w-3 opacity-30" />}
                                </div>
                              </th>
                              <th className="p-3 font-normal text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className={`divide-y text-xs ${isLight ? "divide-slate-100" : "divide-[#1e293b]/40"}`}>
                            {isLoadingCrmLeads ? (
                              <tr>
                                <td colSpan={11} className="py-16 text-center">
                                  <Loader2 className="h-6 w-6 text-indigo-400 animate-spin mx-auto" />
                                  <div className="text-slate-500 mt-2 text-xs">Loading leads...</div>
                                </td>
                              </tr>
                            ) : crmLeads.length === 0 ? (
                              <tr>
                                <td colSpan={11} className="py-16 text-center text-slate-500">
                                  No leads match your filters.
                                </td>
                              </tr>
                            ) : (
                              crmLeads.map((lead, idx) => {
                                const isSelected = lead.id ? selectedCrmLeadIds.has(lead.id) : false;
                                const isDetailOpen = selectedCrmLeadDetail?.id === lead.id;
                                const scoreColor = lead.leadScore <= 50 ? "text-slate-500" : lead.leadScore <= 100 ? "text-amber-500" : lead.leadScore <= 150 ? "text-indigo-400" : "text-emerald-400";
                                const priorityBg = lead.leadPriority === "HOT" ? "bg-rose-500/10 border-rose-500/20 text-rose-400" : lead.leadPriority === "WARM" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-slate-500/10 border-slate-500/20 text-slate-400";
                                const hasInsta = lead.instagramStatus !== "NOT_FOUND";
                                const hasFb = lead.facebookStatus !== "NOT_FOUND";
                                const hasLi = lead.linkedinStatus !== "NOT_FOUND";

                                return (
                                  <tr
                                    key={lead.id || idx}
                                    onClick={() => {
                                      if (isDetailOpen) {
                                        setSelectedCrmLeadDetail(null);
                                      } else {
                                        handleViewCrmLead(lead);
                                      }
                                    }}
                                    className={`transition-all cursor-pointer ${isLight ? "hover:bg-slate-50" : "hover:bg-slate-800/20"} ${isDetailOpen ? "bg-indigo-600/5 border-l-2 border-l-indigo-500" : ""} ${isSelected ? (isLight ? "bg-indigo-50" : "bg-indigo-900/10") : ""}`}
                                  >
                                    <td className="p-3" onClick={e => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={e => {
                                          const next = new Set(selectedCrmLeadIds);
                                          if (e.target.checked) next.add(lead.id!);
                                          else next.delete(lead.id!);
                                          setSelectedCrmLeadIds(next);
                                        }}
                                        className="rounded text-indigo-500 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                                      />
                                    </td>
                                    <td className="p-3">
                                      <div className={`font-semibold leading-snug max-w-[200px] truncate ${isLight ? "text-slate-900" : "text-white"}`}>{lead.businessName}</div>
                                      <div className="text-[10px] text-slate-500 mt-0.5 max-w-[200px] truncate">{lead.address}</div>
                                      {activeListId === "ALL" && (lead as any).listName && (
                                        <div className="mt-1 flex items-center gap-1 max-w-[200px]">
                                          <FolderOpen className="h-2.5 w-2.5 text-indigo-400/70 shrink-0" />
                                          <span className="text-[9px] text-indigo-400/80 truncate">{(lead as any).listName}</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className={`p-3 font-black text-center ${scoreColor}`}>{lead.leadScore}</td>
                                    <td className="p-3 text-center">
                                      <span className={`text-[9px] font-bold px-2 py-0.5 border rounded-full ${priorityBg}`}>{lead.leadPriority}</span>
                                    </td>
                                    <td className={`p-3 text-center text-xs font-semibold ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                                      {lead.rating > 0 ? `⭐ ${lead.rating}` : "—"}
                                    </td>
                                    <td className={`p-3 text-center text-xs ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                                      {lead.reviews > 0 ? lead.reviews.toLocaleString() : "—"}
                                    </td>
                                    <td className="p-3">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                        lead.websiteStatus === "WORKING" ? "bg-emerald-500/10 text-emerald-400" :
                                        lead.websiteStatus === "BROKEN" ? "bg-rose-500/10 text-rose-400" :
                                        lead.websiteStatus === "OUTDATED" ? "bg-amber-500/10 text-amber-400" :
                                        "bg-slate-500/10 text-slate-400"
                                      }`}>{lead.websiteStatus}</span>
                                    </td>
                                    <td className="p-3 text-center">
                                      <div className="flex justify-center gap-0.5">
                                        <span className={`text-[9px] font-bold px-1 rounded ${hasInsta ? "text-pink-400 bg-pink-500/10" : "text-slate-700 opacity-40"}`}>IG</span>
                                        <span className={`text-[9px] font-bold px-1 rounded ${hasFb ? "text-blue-400 bg-blue-500/10" : "text-slate-700 opacity-40"}`}>FB</span>
                                        <span className={`text-[9px] font-bold px-1 rounded ${hasLi ? "text-sky-400 bg-sky-500/10" : "text-slate-700 opacity-40"}`}>LI</span>
                                      </div>
                                    </td>
                                    <td className="p-3">
                                      <div className="flex flex-col gap-0.5">
                                        {lead.emailStatus && (
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${lead.emailStatus === "SENT" ? "bg-emerald-500/10 text-emerald-400" : lead.emailStatus === "FAILED" ? "bg-rose-500/10 text-rose-400" : "bg-slate-500/10 text-slate-400"}`}>
                                            ✉ {lead.emailStatus}
                                          </span>
                                        )}
                                        {lead.whatsappStatus && (
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${lead.whatsappStatus === "SENT" ? "bg-emerald-500/10 text-emerald-400" : lead.whatsappStatus === "FAILED" ? "bg-rose-500/10 text-rose-400" : "bg-slate-500/10 text-slate-400"}`}>
                                            📱 {lead.whatsappStatus}
                                          </span>
                                        )}
                                        {lead.conversationStatus === "REPLIED" && (
                                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 flex items-center gap-0.5 w-fit">
                                            <MessageSquare className="h-2.5 w-2.5" /> REPLIED
                                          </span>
                                        )}
                                        {!lead.emailStatus && !lead.whatsappStatus && !lead.conversationStatus && (
                                          <span className="text-[9px] text-slate-600">—</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className={`p-3 text-[10px] whitespace-nowrap ${isLight ? "text-slate-500" : "text-slate-500"}`}>
                                      {lead.dateAdded ? new Date(lead.dateAdded).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                                    </td>
                                    <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => handleOpenOutreach(lead)}
                                          className="px-2 py-1 text-[9px] font-bold text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/25 rounded-md cursor-pointer transition-all mr-0.5"
                                        >
                                          Outreach
                                        </button>
                                        <button
                                          onClick={() => handleViewCrmLead(lead)}
                                          className="p-1 text-slate-500 hover:text-indigo-400 transition-colors cursor-pointer"
                                          title="View lead"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleEditCrmLead(lead)}
                                          className="p-1 text-slate-500 hover:text-indigo-400 transition-colors cursor-pointer"
                                          title="Edit lead"
                                        >
                                          <PencilLine className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteCrmLead(lead)}
                                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                                          title="Delete lead"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {/* Table footer count */}
                    {activeListId && !isLoadingCrmLeads && crmLeads.length > 0 && (
                      <div className={`px-4 py-2 border-t text-[10px] text-slate-500 flex items-center justify-between ${isLight ? "border-slate-200 bg-slate-50" : "border-[#1e293b]/60"}`}>
                        <span>{crmLeads.length} leads shown{selectedCrmLeadIds.size > 0 ? ` · ${selectedCrmLeadIds.size} selected` : ""}</span>
                        <span className="text-slate-600">Sorted by <strong>{crmSortBy}</strong> {crmSortDir === "asc" ? "↑" : "↓"}</span>
                      </div>
                    )}
                  </div>

                  {/* Lead Detail Panel — view or edit mode */}
                  {selectedCrmLeadDetail && (
                    <div className={`w-80 shrink-0 border rounded-2xl p-5 space-y-4 overflow-y-auto relative ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`} style={{ maxHeight: "calc(100vh - 210px)" }}>
                      <button
                        onClick={() => setSelectedCrmLeadDetail(null)}
                        className={`absolute top-4 right-4 p-1 rounded ${isLight ? "hover:bg-slate-100 text-slate-400" : "hover:bg-slate-800 text-slate-500"}`}
                      >
                        <X className="h-4 w-4" />
                      </button>

                      {crmDetailMode === "edit" ? (
                        <>
                          <div className={`border-b pb-3 flex items-center gap-2 ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                            <PencilLine className="h-4 w-4 text-indigo-400" />
                            <h3 className={`font-bold text-sm ${isLight ? "text-slate-900" : "text-white"}`}>Edit Lead</h3>
                          </div>

                          <div className="space-y-3 text-xs">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1">Business Name</label>
                              <input
                                type="text"
                                value={crmEditDraft.businessName}
                                onChange={e => setCrmEditDraft(d => ({ ...d, businessName: e.target.value }))}
                                className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1">Phone</label>
                              <input
                                type="text"
                                value={crmEditDraft.phone}
                                onChange={e => setCrmEditDraft(d => ({ ...d, phone: e.target.value }))}
                                className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1">Address</label>
                              <textarea
                                value={crmEditDraft.address}
                                onChange={e => setCrmEditDraft(d => ({ ...d, address: e.target.value }))}
                                rows={2}
                                className={`w-full border rounded-lg px-3 py-2 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 resize-none ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1">Category</label>
                              <input
                                type="text"
                                value={crmEditDraft.category}
                                onChange={e => setCrmEditDraft(d => ({ ...d, category: e.target.value }))}
                                className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1">Website</label>
                              <input
                                type="text"
                                value={crmEditDraft.website}
                                onChange={e => setCrmEditDraft(d => ({ ...d, website: e.target.value }))}
                                className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] font-bold text-slate-500 mb-1">Rating</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={crmEditDraft.rating}
                                  onChange={e => setCrmEditDraft(d => ({ ...d, rating: e.target.value }))}
                                  className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] font-bold text-slate-500 mb-1">Reviews</label>
                                <input
                                  type="number"
                                  value={crmEditDraft.reviews}
                                  onChange={e => setCrmEditDraft(d => ({ ...d, reviews: e.target.value }))}
                                  className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1">Priority</label>
                              <select
                                value={crmEditDraft.leadPriority}
                                onChange={e => setCrmEditDraft(d => ({ ...d, leadPriority: e.target.value as "HOT" | "WARM" | "COLD" }))}
                                className={`w-full border rounded-lg px-3 py-2 text-xs cursor-pointer focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                              >
                                <option value="HOT">HOT</option>
                                <option value="WARM">WARM</option>
                                <option value="COLD">COLD</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              onClick={() => setCrmDetailMode("view")}
                              disabled={isSavingCrmEdit}
                              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all border disabled:opacity-50 ${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-300 hover:bg-slate-800"}`}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSaveCrmEdit}
                              disabled={isSavingCrmEdit}
                              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5"
                            >
                              {isSavingCrmEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              {isSavingCrmEdit ? "Saving..." : "Save Changes"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                      <div className={`border-b pb-3 ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className={`font-bold text-sm pr-6 leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                            {selectedCrmLeadDetail!.businessName}
                          </h3>
                          <button
                            onClick={() => handleEditCrmLead(selectedCrmLeadDetail!)}
                            className={`shrink-0 p-1 rounded-lg transition-colors cursor-pointer ${isLight ? "hover:bg-slate-100 text-slate-400 hover:text-indigo-500" : "hover:bg-slate-800 text-slate-500 hover:text-indigo-400"}`}
                            title="Edit lead"
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-[9px] font-bold px-2 py-0.5 border rounded-full ${
                            selectedCrmLeadDetail!.leadPriority === "HOT" ? "bg-rose-500/10 border-rose-500/20 text-rose-400" :
                            selectedCrmLeadDetail!.leadPriority === "WARM" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                            "bg-slate-500/10 border-slate-500/20 text-slate-400"
                          }`}>{selectedCrmLeadDetail!.leadPriority}</span>
                          <span className={`text-[10px] font-bold ${selectedCrmLeadDetail!.leadScore > 150 ? "text-emerald-400" : selectedCrmLeadDetail!.leadScore > 100 ? "text-indigo-400" : "text-slate-400"}`}>
                            Score: {selectedCrmLeadDetail!.leadScore}
                          </span>
                        </div>
                      </div>

                      {/* AI Insight */}
                      <div className="bg-indigo-500/5 border border-indigo-500/20 p-3 rounded-xl">
                        <div className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-1.5">AI Sales Hook</div>
                        <p className={`text-[11px] leading-relaxed ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                          "{selectedCrmLeadDetail!.aiInsight || "No insight recorded."}"
                        </p>
                      </div>

                      {/* Contact */}
                      <div className={`space-y-2 text-xs pb-3 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Contact</div>
                        <div className="flex justify-between"><span className={isLight ? "text-slate-500" : "text-slate-400"}>Phone:</span><span className={`font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{selectedCrmLeadDetail!.phone || "—"}</span></div>
                        <div className="flex justify-between items-start gap-2"><span className={`shrink-0 ${isLight ? "text-slate-500" : "text-slate-400"}`}>Email:</span><span className={`text-right truncate max-w-[160px] font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{selectedCrmLeadDetail!.emails?.length > 0 ? selectedCrmLeadDetail!.emails[0] : "—"}</span></div>
                        <div className="flex justify-between"><span className={isLight ? "text-slate-500" : "text-slate-400"}>Category:</span><span className={isLight ? "text-slate-700" : "text-slate-300"}>{selectedCrmLeadDetail!.category || "—"}</span></div>
                        <div className="flex justify-between"><span className={isLight ? "text-slate-500" : "text-slate-400"}>Rating:</span><span className={isLight ? "text-slate-700" : "text-slate-300"}>⭐ {selectedCrmLeadDetail!.rating} ({selectedCrmLeadDetail!.reviews} reviews)</span></div>
                      </div>

                      {/* Technical */}
                      <div className={`space-y-2 text-xs pb-3 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2">Technical Audit</div>
                        {[
                          { label: "Website", value: selectedCrmLeadDetail!.websiteStatus },
                          { label: "Analytics", value: selectedCrmLeadDetail!.googleAnalyticsPresent ? "✓ Active" : "✗ Missing" },
                          { label: "Meta Pixel", value: selectedCrmLeadDetail!.metaPixelPresent ? "✓ Active" : "✗ Missing" },
                          { label: "WhatsApp Widget", value: selectedCrmLeadDetail!.whatsappPresent ? "✓ Present" : "✗ Missing" },
                          { label: "Booking System", value: selectedCrmLeadDetail!.appointmentSystem ? "✓ Detected" : "✗ Missing" },
                        ].map(item => (
                          <div key={item.label} className="flex justify-between">
                            <span className={isLight ? "text-slate-500" : "text-slate-400"}>{item.label}:</span>
                            <span className={item.value.startsWith("✓") ? "text-emerald-400" : item.value.startsWith("✗") ? "text-slate-500" : isLight ? "text-slate-700" : "text-slate-300"}>{item.value}</span>
                          </div>
                        ))}
                      </div>

                      {/* Notes */}
                      <div className="space-y-2">
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          <PencilLine className="h-3 w-3" /> Notes
                        </div>
                        <textarea
                          value={crmNotes}
                          onChange={e => setCrmNotes(e.target.value)}
                          placeholder="Add private notes about this lead..."
                          rows={3}
                          className={`w-full text-xs border rounded-xl p-3 focus:outline-none focus:border-indigo-500 resize-none ${isLight ? "bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400" : "bg-[#030712] border-[#1e293b] text-white placeholder:text-slate-600"}`}
                        />
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleSaveNotes(selectedCrmLeadDetail!)}
                            disabled={isSavingNotes}
                            className="px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                          >
                            {isSavingNotes ? "Saving…" : "Save Notes"}
                          </button>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2 pt-1">
                        <button
                          onClick={() => handleOpenOutreach(selectedCrmLeadDetail!)}
                          className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1.5"
                        >
                          <Send className="h-3.5 w-3.5" /> Open Outreach Console
                        </button>
                        <a
                          href={selectedCrmLeadDetail!.mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`w-full py-2 px-3 border rounded-lg text-center flex items-center justify-center gap-1.5 text-xs ${isLight ? "border-slate-200 hover:bg-slate-50 text-slate-600" : "border-[#1e293b] hover:bg-slate-800/40 text-slate-300"}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> View on Maps
                        </a>
                        <button
                          onClick={() => handleDeleteCrmLead(selectedCrmLeadDetail!)}
                          className="w-full py-2 px-3 border border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 rounded-lg text-center flex items-center justify-center gap-1.5 text-xs cursor-pointer transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete Lead
                        </button>
                      </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* New List Modal */}
          {showNewListModal && (
            <ModalPortal>
              <div
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn"
                onMouseDown={() => { setShowNewListModal(false); setNewListName(""); }}
              >
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`border rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-scaleUp ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}
                >
                  <h3 className={`text-base font-bold mb-4 flex items-center gap-2 ${isLight ? "text-slate-900" : "text-white"}`}>
                    <FolderPlus className="h-5 w-5 text-indigo-400" /> Create New List
                  </h3>
                  <input
                    autoFocus
                    type="text"
                    placeholder="e.g. Dental Clinic – Nashik July 2026"
                    value={newListName}
                    onChange={e => setNewListName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleCreateList(); if (e.key === "Escape") setShowNewListModal(false); }}
                    className={`w-full text-sm border rounded-lg px-3 py-2.5 focus:outline-none focus:border-indigo-500 mb-4 ${isLight ? "bg-white border-slate-200 text-slate-800" : "bg-[#030712] border-[#1e293b] text-white"}`}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setShowNewListModal(false); setNewListName(""); }}
                      className={`px-4 py-2 border rounded-lg text-sm cursor-pointer transition-all ${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-400 hover:bg-slate-800"}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateList}
                      disabled={isCreatingList || !newListName.trim()}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                    >
                      {isCreatingList ? "Creating…" : "Create List"}
                    </button>
                  </div>
                </div>
              </div>
            </ModalPortal>
          )}

          {/* TAB 4: INTEGRATIONS & OUTREACH SETTINGS */}
          {activeTab === "settings" && (
            <div className="space-y-6">
              <IntegrationSettings 
                isLight={isLight} 
                canWhatsapp={canWhatsapp}
                whatsappStatus={whatsappStatus}
                onInitializeWhatsApp={handleInitializeWhatsApp}
                onDisconnectWhatsApp={handleDisconnectWhatsApp}
                onSendWhatsAppTest={handleSendTestMessage}
                isSendingTestMsg={isSendingTestMsg}
                isDisconnectingWa={isDisconnectingWa}
                webhookConfigured={webhookConfigured}
                onWebhookConfiguredChange={setWebhookConfigured}
                onIntegrationsChange={fetchData}
                onRequestPricingModal={() => setShowPricingModal(true)}
              />
            </div>
          )}

          {/* TAB 5: OUTREACH CAMPAIGN PANEL */}
          {activeTab === "outreach" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 animate-fadeIn pb-6">
              
              {/* Left Column - Setup & Progress / Logs & List (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                
                {/* Campaign Action & Settings Card */}
                <div className={`border rounded-xl p-4 space-y-3 shadow-sm ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
                  <div className={`flex items-center justify-between pb-2.5 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                    <div className="flex items-center gap-2">
                      <Send className="h-4 w-4 text-indigo-400" />
                      <h3 className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-white"}`}>
                        Campaign Settings
                      </h3>
                    </div>
                    {campaignRunning && (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[8.5px] font-bold bg-indigo-500/10 text-indigo-400 animate-pulse border border-indigo-500/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
                        {campaignProgress.status.includes("Simulation") ? "SIMULATION ACTIVE" : "LIVE CAMPAIGN"}
                      </span>
                    )}
                  </div>

                  {campaignRunning ? (
                    /* Running View */
                    <div className="space-y-4 text-xs">
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Dispatching Progress:</span>
                          <span className={`font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                            {campaignProgress.current} / {campaignProgress.total} Leads
                          </span>
                        </div>
                        <div className={`w-full rounded-full h-2 overflow-hidden border ${isLight ? "bg-slate-100 border-slate-200" : "bg-slate-900 border-slate-800"}`}>
                          <div 
                            className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${campaignProgress.total > 0 ? (campaignProgress.current / campaignProgress.total) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 py-2 text-center text-[10px]">
                        <div className={`p-2 rounded-lg border ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/50 border-slate-900"}`}>
                          <div className="text-emerald-400 font-bold text-xs">
                            {(campaignProgress.emailsSent || 0) + (campaignProgress.whatsappSent || 0)}
                          </div>
                          <div className="text-slate-500 mt-0.5">Dispatched</div>
                        </div>
                        <div className={`p-2 rounded-lg border ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/50 border-slate-900"}`}>
                          <div className="text-rose-400 font-bold text-xs">
                            {(campaignProgress.emailsFailed || 0) + (campaignProgress.whatsappFailed || 0)}
                          </div>
                          <div className="text-slate-500 mt-0.5">Delivery Errors</div>
                        </div>
                        <div className={`p-2 rounded-lg border ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/50 border-slate-900"}`}>
                          <div className="text-amber-500 font-bold text-xs">
                            {campaignProgress.skipped || 0}
                          </div>
                          <div className="text-slate-500 mt-0.5">Skipped (No Info)</div>
                        </div>
                      </div>

                      <div className="bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-xl flex items-center justify-between text-indigo-400">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span className="text-[10px] truncate max-w-[280px]">
                            {campaignProgress.status}
                          </span>
                        </div>
                        {campaignProgress.secondsRemaining > 0 && (
                          <span className="font-bold text-[10px] whitespace-nowrap bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                            Gap: {campaignProgress.secondsRemaining}s
                          </span>
                        )}
                      </div>

                      <div className="flex justify-end pt-2">
                        <button
                          onClick={handleStopCampaign}
                          disabled={isStoppingCampaign}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-rose-600/10 flex items-center gap-1.5"
                        >
                          <X className="h-3.5 w-3.5" /> Stop Outreach Campaign
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Step-by-step Campaign Wizard: Source -> Channels -> Template -> Options -> Review */
                    <div className="space-y-5 text-xs">
                      {/* Step indicator */}
                      <div className="flex items-center">
                        {([
                          { n: 1, label: "Source" },
                          { n: 2, label: "Channels" },
                          { n: 3, label: "Template" },
                          { n: 4, label: "Options" },
                          { n: 5, label: "Review" },
                        ] as const).map((s, idx) => (
                          <React.Fragment key={s.n}>
                            <button
                              type="button"
                              onClick={() => (s.n < campaignStep || canAdvanceCampaignStep(campaignStep)) && goToCampaignStep(s.n)}
                              className={`flex items-center gap-1.5 cursor-pointer transition-all ${
                                s.n === campaignStep ? "opacity-100" : s.n < campaignStep ? "opacity-80" : "opacity-40"
                              }`}
                            >
                              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 shrink-0 ${
                                s.n === campaignStep
                                  ? "bg-indigo-600 text-white border-indigo-600"
                                  : s.n < campaignStep
                                    ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/40"
                                    : isLight ? "bg-white text-slate-400 border-slate-300" : "bg-slate-900 text-slate-500 border-slate-700"
                              }`}>
                                {s.n < campaignStep ? <Check className="h-3 w-3" /> : s.n}
                              </span>
                              <span className={`text-[10px] font-bold hidden sm:inline ${s.n === campaignStep ? (isLight ? "text-slate-900" : "text-white") : "text-slate-500"}`}>
                                {s.label}
                              </span>
                            </button>
                            {idx < 4 && (
                              <div className={`flex-1 h-px mx-2 ${s.n < campaignStep ? "bg-indigo-500/50" : isLight ? "bg-slate-200" : "bg-slate-800"}`} />
                            )}
                          </React.Fragment>
                        ))}
                      </div>

                      {/* ── STEP 1: Source ── */}
                      {campaignStep === 1 && (
                        <div className="space-y-4 animate-fadeIn">
                          <p className={`leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                            Choose where this campaign pulls its leads from — a saved CRM lead list (recommended) or a Google Sheet tab.
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => setCampaignSourceType("list")}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                campaignSourceType === "list"
                                  ? "border-indigo-500 bg-indigo-500/10"
                                  : isLight ? "border-slate-200 hover:border-slate-300 bg-white" : "border-slate-800 hover:border-slate-700 bg-slate-950/40"
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Database className="h-4 w-4 text-indigo-400" />
                                <span className={`font-bold text-xs ${isLight ? "text-slate-800" : "text-white"}`}>Saved Lead List</span>
                              </div>
                              <p className="text-[10px] text-slate-500">Use leads from a CRM list you've already scraped. Supports priority filtering.</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => setCampaignSourceType("sheet")}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                campaignSourceType === "sheet"
                                  ? "border-indigo-500 bg-indigo-500/10"
                                  : isLight ? "border-slate-200 hover:border-slate-300 bg-white" : "border-slate-800 hover:border-slate-700 bg-slate-950/40"
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                                <span className={`font-bold text-xs ${isLight ? "text-slate-800" : "text-white"}`}>Google Sheet Tab</span>
                              </div>
                              <p className="text-[10px] text-slate-500">Use leads synced to your connected Google Sheet.</p>
                            </button>
                          </div>

                          {campaignSourceType === "list" ? (
                            <div className="space-y-1.5">
                              <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase">Select Lead List:</label>
                              <div className="flex gap-2">
                                <div className="flex-grow">
                                  <SearchableDropdown
                                    isLight={isLight}
                                    value={selectedCampaignListId}
                                    onChange={setSelectedCampaignListId}
                                    placeholder="Select a list..."
                                    searchPlaceholder="Search lead lists..."
                                    emptyMessage="No matching lead lists."
                                    options={leadLists.map((l) => ({
                                      id: l.id,
                                      label: l.name,
                                      subtitle: `${l.leadCount} leads · ${l.businessType || "—"}`,
                                    }))}
                                  />
                                </div>
                                <button
                                  onClick={fetchLeadLists}
                                  disabled={isLoadingLists}
                                  className={`p-2 border rounded-lg transition-all cursor-pointer flex items-center justify-center ${isLight ? "bg-white text-slate-600 border-slate-200 hover:bg-slate-50" : "bg-[#030712] text-slate-400 border-[#1e293b] hover:bg-slate-800"}`}
                                  title="Refresh Lead Lists"
                                  type="button"
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingLists ? "animate-spin" : ""}`} />
                                </button>
                              </div>
                              {leadLists.length === 0 && !isLoadingLists && (
                                <p className="text-[9px] text-amber-500">No saved lead lists yet — run a scrape or switch to Google Sheet.</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <label className="block text-[10px] font-bold text-slate-400 tracking-wider uppercase">Target Google Sheet Tab:</label>
                              <div className="flex gap-2">
                                <div className="flex-grow">
                                  <SearchableDropdown
                                    isLight={isLight}
                                    value={selectedCampaignSheet}
                                    onChange={setSelectedCampaignSheet}
                                    placeholder="All Sheets (Combined)"
                                    searchPlaceholder="Search sheet tabs..."
                                    emptyMessage="No matching sheet tabs."
                                    options={campaignSheets.map((s) => ({ id: s, label: s }))}
                                  />
                                </div>
                                <button
                                  onClick={fetchCampaignSheets}
                                  disabled={isLoadingSheets}
                                  className={`p-2 border rounded-lg transition-all cursor-pointer flex items-center justify-center ${isLight ? "bg-white text-slate-600 border-slate-200 hover:bg-slate-50" : "bg-[#030712] text-slate-400 border-[#1e293b] hover:bg-slate-800"}`}
                                  title="Refresh Sheet List"
                                  type="button"
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSheets ? "animate-spin" : ""}`} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── STEP 2: Channels ── */}
                      {campaignStep === 2 && (
                        <div className="space-y-3 animate-fadeIn">
                          <p className={`leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                            Pick which channels this campaign should dispatch through.
                          </p>
                          <div className={`space-y-3 p-4 rounded-xl border ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/40 border-slate-900"}`}>
                            <div className="flex flex-col gap-2">
                              <label className={`flex items-center gap-2 cursor-pointer select-none ${isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-300 hover:text-white"}`}>
                                <input
                                  type="checkbox"
                                  checked={campaignEnableEmail}
                                  onChange={(e) => setCampaignEnableEmail(e.target.checked)}
                                  className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                                />
                                <Mail className="h-3.5 w-3.5 text-indigo-400" />
                                <span>Email Outreach (SMTP)</span>
                              </label>
                              <label className={`flex items-center gap-2 select-none ${!canWhatsapp ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-300 hover:text-white"}`}>
                                <input
                                  type="checkbox"
                                  checked={canWhatsapp && campaignEnableWhatsapp}
                                  disabled={!canWhatsapp}
                                  onChange={(e) => setCampaignEnableWhatsapp(e.target.checked)}
                                  className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 disabled:opacity-50"
                                />
                                <span className="flex items-center gap-1.5">
                                  <WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500 shrink-0" />
                                  <span>WhatsApp Gateway Outreach</span>
                                </span>
                                {!canWhatsapp && (
                                  <span className="text-[9px] font-bold text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded uppercase tracking-wide">Pro</span>
                                )}
                              </label>
                            </div>
                          </div>
                          {!campaignEnableEmail && !campaignWhatsappEffective && (
                            <p className="text-[10px] text-rose-400">Select at least one channel to continue.</p>
                          )}
                          {campaignEnableWhatsapp && !canWhatsapp && (
                            <p className="text-[10px] text-indigo-400">WhatsApp is included in the Pro plan. This campaign will run on Email only.</p>
                          )}
                        </div>
                      )}

                      {/* ── STEP 3: Template ── */}
                      {campaignStep === 3 && (
                        <div className="space-y-4 animate-fadeIn">
                          <p className={`leading-relaxed ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                            Choose a saved template per channel, or leave on AI-generated pitch to auto-write a message per lead.
                          </p>
                          {campaignEnableEmail && (
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                                <Mail className="h-3 w-3 text-indigo-400" /> Email Template
                              </label>
                              <TemplateDropdown
                                isLight={isLight}
                                value={campaignEmailTemplateId}
                                onChange={setCampaignEmailTemplateId}
                                placeholder="Search email templates..."
                                emptyMessage="No matching templates."
                                options={campaignEmailTemplates.map((t) => ({
                                  id: t.id, label: t.name, subtitle: t.subject, badge: t.useAiBody ? "AI body" : undefined,
                                }))}
                              />
                            </div>
                          )}
                          {/* WhatsApp template picker only shown when the channel is actually
                              enabled (toggle ON *and* plan allows it). If the plan blocks
                              WhatsApp, there's no point picking a template that can't be used. */}
                          {campaignWhatsappEffective && (
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                                <WhatsAppLogo className="h-3 w-3 fill-emerald-500 text-emerald-500" /> WhatsApp Template
                              </label>
                              <TemplateDropdown
                                isLight={isLight}
                                value={campaignWhatsappTemplateId}
                                onChange={setCampaignWhatsappTemplateId}
                                placeholder="Search WhatsApp templates..."
                                emptyMessage="No matching templates."
                                options={campaignWhatsappTemplates.map((t) => ({
                                  id: t.id, label: t.name, subtitle: t.introText || t.customBodyText, badge: t.useAiBody ? "AI body" : undefined,
                                }))}
                              />
                            </div>
                          )}
                          {!campaignEnableEmail && !campaignWhatsappEffective && (
                            <p className="text-[10px] text-amber-500">Go back and enable a channel first.</p>
                          )}
                        </div>
                      )}

                      {/* ── STEP 4: Options ── */}
                      {campaignStep === 4 && (
                        <div className="space-y-4 animate-fadeIn">
                          <div>
                            <span className="text-slate-400 text-[10px] tracking-wider uppercase font-bold block mb-2">
                              Priority Filter (leave empty for all):
                            </span>
                            <div className="flex gap-2">
                              {["HOT", "WARM", "COLD"].map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => togglePriorityFilter(p)}
                                  className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold cursor-pointer transition-all ${
                                    campaignPriorities.includes(p)
                                      ? p === "HOT" ? "bg-rose-500/15 border-rose-500/40 text-rose-400" : p === "WARM" ? "bg-amber-500/15 border-amber-500/40 text-amber-400" : "bg-slate-500/15 border-slate-500/40 text-slate-300"
                                      : isLight ? "border-slate-200 text-slate-500 hover:border-slate-300" : "border-slate-800 text-slate-500 hover:border-slate-700"
                                  }`}
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>

                          <label className={`flex items-center gap-2 cursor-pointer select-none ${isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-300 hover:text-white"}`}>
                            <input
                              type="checkbox"
                              checked={campaignSkipSent}
                              onChange={(e) => setCampaignSkipSent(e.target.checked)}
                              className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                            />
                            <ListChecks className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Skip leads that already received this channel (recommended)</span>
                          </label>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400 text-[10px] tracking-wider uppercase font-bold">Safety Dispatch Spacing:</span>
                              <span className="text-indigo-400 font-bold">{campaignDelay} seconds</span>
                            </div>
                            <input
                              type="range"
                              min="10"
                              max="120"
                              step="5"
                              value={campaignDelay}
                              onChange={(e) => setCampaignDelay(parseInt(e.target.value, 10))}
                              className={`w-full accent-indigo-500 h-1.5 rounded-lg appearance-none cursor-pointer border ${isLight ? "bg-slate-100 border-slate-200" : "bg-slate-900 border-slate-800"}`}
                            />
                            <span className="text-[9px] text-slate-500 block font-sans">
                              Recommended spacing: 30s+ to mimic human messaging patterns.
                            </span>
                          </div>

                          <label className={`flex items-center gap-2 text-amber-500 hover:text-amber-400 cursor-pointer select-none pt-1.5 border-t ${isLight ? "border-slate-200" : "border-slate-800/60"}`}>
                            <input
                              type="checkbox"
                              checked={campaignDryRun}
                              onChange={(e) => setCampaignDryRun(e.target.checked)}
                              className="rounded text-amber-500 focus:ring-amber-500 h-3.5 w-3.5"
                            />
                            <span className="font-bold">Simulation (Dry-run) Mode</span>
                          </label>
                        </div>
                      )}

                      {/* ── STEP 5: Review & Launch ── */}
                      {campaignStep === 5 && (
                        <div className="space-y-4 animate-fadeIn">
                          <div className={`p-4 rounded-xl border space-y-2 ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/40 border-slate-900"}`}>
                            <div className="flex justify-between"><span className="text-slate-500">Source:</span><span className={`font-bold ${isLight ? "text-slate-800" : "text-white"}`}>
                              {campaignSourceType === "list" ? (leadLists.find(l => l.id === selectedCampaignListId)?.name || "—") : (selectedCampaignSheet || "All Sheets (Combined)")}
                            </span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Channels:</span><span className={`font-bold ${isLight ? "text-slate-800" : "text-white"}`}>
                              {[campaignEnableEmail && "Email", campaignWhatsappEffective && "WhatsApp"].filter(Boolean).join(" + ") || "None"}
                            </span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Templates:</span><span className={`font-bold text-right ${isLight ? "text-slate-800" : "text-white"}`}>
                              {campaignEnableEmail ? (campaignEmailTemplateId ? (campaignEmailTemplates.find(t => t.id === campaignEmailTemplateId)?.name) : "AI (email)") : "—"}
                              {campaignWhatsappEffective ? ` · ${campaignWhatsappTemplateId ? campaignWhatsappTemplates.find(t => t.id === campaignWhatsappTemplateId)?.name : "AI (WhatsApp)"}` : ""}
                            </span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Priority filter:</span><span className={`font-bold ${isLight ? "text-slate-800" : "text-white"}`}>{campaignPriorities.length > 0 ? campaignPriorities.join(", ") : "All"}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Delay:</span><span className={`font-bold ${isLight ? "text-slate-800" : "text-white"}`}>{campaignDelay}s between leads</span></div>
                            {campaignDryRun && <div className="text-amber-500 font-bold text-[10px]">SIMULATION MODE — no real messages will be sent.</div>}
                          </div>

                          <div className={`p-4 rounded-xl border ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
                            {isLoadingCampaignPreview ? (
                              <div className="flex items-center gap-2 text-indigo-400 py-4 justify-center">
                                <Loader2 className="h-4 w-4 animate-spin" /> Calculating target leads...
                              </div>
                            ) : campaignPreviewError ? (
                              <div className="text-rose-400 text-center py-2">{campaignPreviewError}</div>
                            ) : campaignPreview ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-2 text-center">
                                  <div><div className="text-xl font-black text-indigo-400">{campaignPreview.total}</div><div className="text-[9px] text-slate-500 uppercase">Target Leads</div></div>
                                  <div><div className="text-xl font-black text-emerald-400">{campaignPreview.withEmail}</div><div className="text-[9px] text-slate-500 uppercase">With Email</div></div>
                                  <div><div className="text-xl font-black text-sky-400">{campaignPreview.withPhone}</div><div className="text-[9px] text-slate-500 uppercase">With Phone</div></div>
                                </div>
                                {campaignPreview.total === 0 && (
                                  <p className="text-amber-500 text-center text-[10px]">No leads match these settings. Adjust the filters or source in earlier steps.</p>
                                )}
                                {campaignPreview.sample.length > 0 && (
                                  <div className={`border-t pt-2 space-y-1 ${isLight ? "border-slate-100" : "border-slate-800/60"}`}>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold">Sample:</div>
                                    {campaignPreview.sample.map((s, i) => (
                                      <div key={i} className="flex justify-between text-[10px]">
                                        <span className="truncate max-w-[180px]">{s.businessName}</span>
                                        <span className="text-slate-500">{s.leadPriority}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button onClick={fetchCampaignPreview} type="button" className="w-full text-center text-indigo-400 hover:text-indigo-300 py-2 cursor-pointer">
                                Load preview
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Step navigation footer */}
                      <div className={`flex justify-between items-center pt-3 border-t ${isLight ? "border-slate-200" : "border-slate-800/60"}`}>
                        <button
                          type="button"
                          onClick={() => goToCampaignStep((campaignStep - 1) as any)}
                          disabled={campaignStep === 1}
                          className={`px-3 py-2 rounded-lg text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed ${isLight ? "text-slate-600 hover:bg-slate-100" : "text-slate-300 hover:bg-slate-800"}`}
                        >
                          <ArrowLeft className="h-3.5 w-3.5" /> Back
                        </button>

                        {campaignStep < 5 ? (
                          <button
                            type="button"
                            onClick={() => goToCampaignStep((campaignStep + 1) as any)}
                            disabled={!canAdvanceCampaignStep(campaignStep)}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-indigo-600/10 flex items-center gap-1.5"
                          >
                            Next <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={handleStartCampaign}
                            disabled={isStartingCampaign || !campaignPreview || campaignPreview.total === 0}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-indigo-600/10 flex items-center gap-1.5"
                          >
                            <Play className="h-3.5 w-3.5" /> {isStartingCampaign ? "Launching..." : "Launch Campaign"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Campaign Progress Logs console */}
                <div className={`border rounded-xl p-4 shadow-sm transition-all duration-300 ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"} ${showCampaignActivity ? "space-y-2.5" : ""}`}>
                  <div 
                    onClick={() => setShowCampaignActivity(!showCampaignActivity)}
                    className="flex items-center justify-between pb-1 cursor-pointer select-none group"
                  >
                    <div className="flex items-center gap-2">
                      <TerminalIcon className="h-4 w-4 text-indigo-400" />
                      <h3 className={`text-xs font-bold transition-colors ${isLight ? "text-slate-800 group-hover:text-indigo-600" : "text-white group-hover:text-indigo-400"}`}>
                        Campaign Activity
                      </h3>
                    </div>
                    <button className={`btn-interactive p-1 rounded-md border transition-all cursor-pointer ${
                      isLight 
                        ? "bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100" 
                        : "bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    }`}>
                      {showCampaignActivity ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>

                  {showCampaignActivity && (
                    <div className={`h-[150px] border rounded-lg p-3 overflow-y-auto font-mono text-[10px] space-y-1 leading-relaxed animate-fadeIn ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}>
                      {terminalLogs.split("\n").filter(line => 
                        line.includes("Campaign") || 
                        line.includes("outreach") || 
                        line.includes("WhatsApp outreach") || 
                        line.includes("Email outreach") || 
                        line.includes("SUCCESS:") ||
                        line.includes("Wiping") ||
                        line.includes("disconnect")
                      ).length > 0 ? (
                        terminalLogs.split("\n").filter(line => 
                          line.includes("Campaign") || 
                          line.includes("outreach") || 
                          line.includes("WhatsApp outreach") || 
                          line.includes("Email outreach") || 
                          line.includes("SUCCESS:") ||
                          line.includes("Wiping") ||
                          line.includes("disconnect")
                        ).map((log, i) => (
                          <div key={i} className={
                            log.includes("SUCCESS") ? "text-emerald-400" :
                            log.includes("ERROR") || log.includes("Aborted") ? "text-rose-400" :
                            log.includes("WARNING") || log.includes("Skipping") ? "text-amber-400" :
                            log.includes("SIMULATION") ? "text-indigo-400" : "text-slate-300"
                          }>
                            {log}
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-500 italic text-center pt-12">No active outreach campaign logs generated. Start campaign to view console output.</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Real-time Dispatch History Report + animated charts + export */}
                <CampaignReport isLight={isLight} liveRefresh={campaignRunning} />

                {/* Campaign Checklist Table (Robust Feature 2) */}
                <div className={`border rounded-xl p-4 shadow-sm transition-all duration-300 ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"} ${showTargetLeads ? "space-y-3" : ""}`}>
                  <div 
                    onClick={() => setShowTargetLeads(!showTargetLeads)}
                    className="flex items-center justify-between pb-1 cursor-pointer select-none group"
                  >
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-indigo-400" />
                      <h3 className={`text-xs font-bold transition-colors ${isLight ? "text-slate-800 group-hover:text-indigo-600" : "text-white group-hover:text-indigo-400"}`}>
                        Target Leads
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9.5px] text-slate-400 font-medium">
                        {processedLeads.filter(l => (!selectedCampaignSheet || l.sheetName === selectedCampaignSheet) && ((l.emails && l.emails.length > 0 && l.emailStatus !== "SENT") || (l.phone && l.whatsappStatus !== "SENT"))).length} Pending
                      </span>
                      <button className={`btn-interactive p-1 rounded-md border transition-all cursor-pointer ${
                        isLight 
                          ? "bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100" 
                          : "bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                      }`}>
                        {showTargetLeads ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>

                  {showTargetLeads && (
                    <div className="overflow-x-auto max-h-[260px] overflow-y-auto animate-fadeIn scrollbar-thin">
                      <table className="w-full text-left border-collapse font-sans text-xs">
                        <thead>
                          <tr className={`border-b text-[9px] font-bold uppercase tracking-wider ${isLight ? "border-slate-200 text-slate-400" : "border-[#1e293b]/40 text-slate-400"}`}>
                            <th className="py-2 font-normal">Business Details</th>
                            <th className="py-2 font-normal">Email status</th>
                            <th className="py-2 font-normal">WhatsApp status</th>
                            <th className="py-2 text-right font-normal">Preview</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isLight ? "divide-slate-100" : "divide-[#1e293b]/20"}`}>
                          {processedLeads.filter(l => !selectedCampaignSheet || l.sheetName === selectedCampaignSheet).map((lead, idx) => {
                            const hasEmail = lead.emails && lead.emails.length > 0;
                            const hasPhone = !!lead.phone;
                            return (
                              <tr key={idx} className={`transition-all ${isLight ? "hover:bg-slate-50" : "hover:bg-slate-900/20"}`}>
                                <td className="py-2 pr-2">
                                  <div className={`font-bold text-xs ${isLight ? "text-slate-900" : "text-white"}`}>{lead.businessName}</div>
                                  <div className="text-[9.5px] text-slate-500 truncate max-w-[200px]">{lead.address || "No address"}</div>
                                </td>
                                <td className="py-2">
                                  {hasEmail ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                      lead.emailStatus === "SENT" ? "bg-emerald-500/10 text-emerald-400" :
                                      lead.emailStatus === "FAILED" ? "bg-rose-500/10 text-rose-400" :
                                      "bg-slate-500/10 text-slate-400"
                                    }`}>
                                      {lead.emailStatus || "PENDING"}
                                    </span>
                                  ) : (
                                    <span className="text-slate-600 text-[9px] italic">No Email</span>
                                  )}
                                </td>
                                <td className="py-2">
                                  {hasPhone ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                      lead.whatsappStatus === "SENT" ? "bg-emerald-500/10 text-emerald-400" :
                                      lead.whatsappStatus === "FAILED" ? "bg-rose-500/10 text-rose-400" :
                                      "bg-slate-500/10 text-slate-400"
                                    }`}>
                                      {lead.whatsappStatus || "PENDING"}
                                    </span>
                                  ) : (
                                    <span className="text-slate-600 text-[9px] italic">No Phone</span>
                                  )}
                                </td>
                                <td className="py-2 text-right">
                                  <button
                                    onClick={() => handleSelectPreviewLead(lead)}
                                    className="btn-interactive px-2 py-0.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 text-[9.5px] font-bold rounded cursor-pointer transition-all"
                                  >
                                    View Pitch
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {processedLeads.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-6 text-center text-slate-500 italic text-xs">
                                No processed leads in the database. Scan coordinates first.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>

              {/* Right Column - Pitch Previewer (5 cols) */}
              <div className="lg:col-span-5">
                <div className={`border rounded-xl p-4 space-y-3 shadow-sm sticky top-4 ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}>
                  <div className={`pb-2.5 border-b flex items-center justify-between ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-indigo-400" />
                      <h3 className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-white"}`}>
                        AI Message Preview
                      </h3>
                    </div>
                  </div>

                  {isLoadingPreviewCopy ? (
                    <div className="py-16 text-center space-y-2 text-xs text-indigo-400">
                      <Loader2 className="h-6 w-6 text-indigo-500 animate-spin mx-auto" />
                      <span>Generating AI pitch tailored to lead profile...</span>
                    </div>
                  ) : previewLead ? (
                    <div className="space-y-3 text-xs">
                      <div>
                        <div className="text-[9.5px] text-slate-400 font-bold uppercase tracking-wider">Active Target:</div>
                        <div className={`text-xs font-bold mt-0.5 leading-snug ${isLight ? "text-slate-900" : "text-white"}`}>{previewLead.businessName}</div>
                        <div className="text-[9.5px] text-slate-500 truncate mt-0.5">{previewLead.address}</div>
                      </div>

                      <div className={`p-2.5 rounded-lg border space-y-0.5 text-[9.5px] text-slate-400 ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/50 border-slate-900"}`}>
                        <div><strong className="text-indigo-400">Priority:</strong> {previewLead.leadPriority}</div>
                        <div><strong className="text-indigo-400">Digital Score:</strong> {previewLead.leadScore} pts</div>
                        <div className="truncate"><strong className="text-indigo-400">AI Insight:</strong> {previewLead.aiInsight}</div>
                      </div>

                      <div className={`space-y-2 border-t pt-2.5 ${isLight ? "border-slate-200" : "border-slate-800/50"}`}>
                        <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 select-none">
                          <WhatsAppLogo className="h-3 w-3 fill-emerald-500 text-emerald-500 shrink-0" /> WhatsApp Message Copy
                        </span>
                        <textarea
                          readOnly
                          value={previewCopy?.whatsappMessage || ""}
                          className={`w-full min-h-[90px] border rounded-lg p-2.5 text-[10.5px] leading-relaxed focus:outline-none focus:border-indigo-500 resize-none font-sans ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                        />
                        <div className="flex justify-end">
                          <button
                            onClick={() => {
                              if (previewCopy) {
                                navigator.clipboard.writeText(previewCopy.whatsappMessage);
                                alert("WhatsApp pitch copied to clipboard!");
                              }
                            }}
                            className={`btn-interactive px-2 py-0.5 border text-[9.5px] font-bold rounded cursor-pointer transition-all flex items-center gap-1 ${isLight ? "bg-white hover:bg-slate-50 text-slate-600 border-slate-200" : "bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800"}`}
                          >
                            <Copy className="h-2.5 w-2.5" /> Copy WhatsApp Pitch
                          </button>
                        </div>
                      </div>

                      <div className={`space-y-2 border-t pt-2.5 ${isLight ? "border-slate-200" : "border-slate-800/50"}`}>
                        <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          <Mail className="h-3 w-3 text-indigo-400" /> Email Pitch Copy
                        </span>
                        <div className="space-y-1.5">
                          <div className={`text-[9.5px] text-slate-400 p-1.5 rounded border truncate ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/30 border-slate-900"}`}>
                            <strong>Subject:</strong> {previewCopy?.emailSubject || ""}
                          </div>
                          <textarea
                            readOnly
                            value={previewCopy?.emailBody || ""}
                            className={`w-full min-h-[120px] border rounded-lg p-2.5 text-[10.5px] leading-relaxed focus:outline-none focus:border-indigo-500 resize-none font-sans ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={() => {
                              if (previewCopy) {
                                navigator.clipboard.writeText(previewCopy.emailBody);
                                alert("Email pitch body copied to clipboard!");
                              }
                            }}
                            className={`btn-interactive px-2 py-0.5 border text-[9.5px] font-bold rounded cursor-pointer transition-all flex items-center gap-1 ${isLight ? "bg-white hover:bg-slate-50 text-slate-600 border-slate-200" : "bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800"}`}
                          >
                            <Copy className="h-2.5 w-2.5" /> Copy Email Pitch
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-16 text-center space-y-2 text-xs text-slate-500">
                      <BookOpen className="h-6 w-6 text-slate-600 mx-auto opacity-50" />
                      <span className="text-[11px]">Select a lead from the checklist on the left to preview customized AI copy.</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 6: EMAIL TEMPLATES BUILDER */}
          {activeTab === "templates" && (
            <div className="space-y-6 animate-fadeIn">
              <EmailTemplates isLight={isLight} workspaceId={currentWorkspace?.id} />
            </div>
          )}

          {/* TAB 7: OUTREACH REPORTS */}
          {activeTab === "reports" && (
            <div className="space-y-6 animate-fadeIn">
              <CampaignReport isLight={isLight} liveRefresh={campaignRunning} alwaysExpanded />
            </div>
          )}

          {/* TAB 8: CONVERSATIONS (INBOX) */}
          {activeTab === "conversations" && (
            <div className="animate-fadeIn">
              <Conversations isLight={isLight} onUnreadChange={setConversationsUnread} />
            </div>
          )}

          {/*
            TAB 9-12: the Phase 3 and Phase 4 surfaces.

            Each is a self-contained panel rather than more markup in this file.
            App.tsx is already 5,000 lines; weaving four feature areas into it
            would make every one of them harder to change than it needs to be.
            They share src/ui/primitives.tsx for theming so they still look like
            the rest of the dashboard.
          */}
          {activeTab === "business" && (
            <div className="animate-fadeIn">
              <BusinessPanel isLight={isLight} initialTab={initialBusinessTab.current} />
            </div>
          )}

          {activeTab === "assistant" && (
            <div className="animate-fadeIn">
              <AssistantPanel isLight={isLight} />
            </div>
          )}

          {activeTab === "targeting" && (
            <div className="animate-fadeIn">
              <TargetingPanel isLight={isLight} />
            </div>
          )}

          {/* TAB 13: CAMPAIGNS (Phase 5: generation with approval) */}
          {activeTab === "campaigns" && (
            <div className="animate-fadeIn">
              <CampaignPanel isLight={isLight} />
            </div>
          )}

          {/* TAB 14: DO NOT CONTACT (opt-out compliance) */}
          {activeTab === "suppressions" && (
            <div className="animate-fadeIn" data-testid="suppressions-panel">
              <SuppressionPanel isLight={isLight} />
            </div>
          )}

          </Suspense>
        </main>
      </div>

      {/* Reusable interactive alert / success modal */}
      <AlertModal
        isOpen={appModal.isOpen}
        type={appModal.type}
        title={appModal.title}
        message={appModal.message}
        confirmLabel="Done"
        onConfirm={closeAppModal}
        onCancel={closeAppModal}
        isLight={isLight}
      />

      {/* Leads table delete confirmation modal */}
      <AlertModal
        isOpen={crmConfirmModal.isOpen}
        type="danger"
        title="Delete Lead"
        message={crmConfirmModal.message}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={crmConfirmModal.isLoading}
        onConfirm={crmConfirmModal.onConfirm}
        onCancel={() => setCrmConfirmModal(prev => ({ ...prev, isOpen: false }))}
        isLight={isLight}
      />

      {/* OUTREACH CONSOLE MODAL */}
      {selectedLeadForOutreach && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto animate-fadeIn"
            onMouseDown={() => setSelectedLeadForOutreach(null)}
          >
            <div
              className={`border rounded-2xl w-full max-w-4xl shadow-2xl relative flex flex-col max-h-[90vh] animate-scaleUp ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
            
            {/* Modal Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
              <div>
                <h2 className={`text-base font-bold flex items-center gap-2 ${isLight ? "text-slate-900" : "text-white"}`}>
                  <Send className="h-5 w-5 text-indigo-400" /> Lead Outreach Console
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Drafting outreach pitches for <strong className={isLight ? "text-slate-800" : "text-white"}>{selectedLeadForOutreach.businessName}</strong>
                </p>
              </div>
              <button 
                onClick={() => setSelectedLeadForOutreach(null)}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* WhatsApp message editor */}
              <div className="space-y-4 flex flex-col h-full">
                <div className={`flex items-center justify-between pb-2 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/40"}`}>
                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 select-none">
                    <WhatsAppLogo className="h-4 w-4 fill-emerald-500 text-emerald-500 shrink-0" /> WhatsApp Message Pitch
                  </span>
                  
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                    selectedLeadForOutreach.whatsappStatus === "SENT" ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-500/10 text-slate-400"
                  }`}>
                    {selectedLeadForOutreach.whatsappStatus || "PENDING"}
                  </span>
                </div>

                {/* WhatsApp template selector */}
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3 text-emerald-400" /> Template
                  </label>
                  <TemplateDropdown
                    isLight={isLight}
                    value={selectedWhatsappTemplateId}
                    onChange={applyWhatsappTemplate}
                    placeholder="Search WhatsApp templates..."
                    emptyMessage="No matching templates."
                    options={outreachWhatsappTemplates.map((t) => ({
                      id: t.id,
                      label: t.name,
                      subtitle: t.introText || t.customBodyText,
                      badge: t.useAiBody ? "AI body" : undefined,
                    }))}
                  />
                  {outreachWhatsappTemplates.length === 0 && (
                    <p className="text-[9px] text-slate-500 mt-1">No WhatsApp templates yet — create them in the Templates screen.</p>
                  )}
                </div>

                <textarea
                  value={outreachWhatsappMsg}
                  onChange={(e) => setOutreachWhatsappMsg(e.target.value)}
                  className={`flex-grow w-full min-h-[280px] border rounded-xl p-4 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 resize-y ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                  placeholder="Customized WhatsApp outreach text..."
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-500">
                    Recipient: <strong className={isLight ? "text-slate-800" : "text-white"}>{selectedLeadForOutreach.phone || "No phone number"}</strong>
                  </span>
                  
                  <button
                    onClick={handleSendWhatsapp}
                    disabled={isSendingWhatsapp || !selectedLeadForOutreach.phone || whatsappStatus.status !== "CONNECTED" || !canWhatsapp}
                    title={!canWhatsapp ? "WhatsApp outreach is a Pro feature" : undefined}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-indigo-600/10"
                  >
                    {isSendingWhatsapp ? "Delivering message..." : !canWhatsapp ? "WhatsApp (Pro)" : "Send WhatsApp message"}
                  </button>
                </div>
              </div>

              {/* Email message editor */}
              <div className="space-y-4 flex flex-col h-full">
                <div className={`flex items-center justify-between pb-2 border-b ${isLight ? "border-slate-200" : "border-[#1e293b]/40"}`}>
                  <span className="text-xs font-bold text-indigo-400 flex items-center gap-1">
                    <Mail className="h-4 w-4" /> Email Pitch Details
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                    selectedLeadForOutreach.emailStatus === "SENT" ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-500/10 text-slate-400"
                  }`}>
                    {selectedLeadForOutreach.emailStatus || "PENDING"}
                  </span>
                </div>

                <div className="space-y-3 flex-grow flex flex-col">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                      <FileSpreadsheet className="h-3 w-3 text-indigo-400" /> Template
                    </label>
                    <TemplateDropdown
                      isLight={isLight}
                      value={selectedEmailTemplateId}
                      onChange={applyEmailTemplate}
                      placeholder="Search email templates..."
                      emptyMessage="No matching templates."
                      options={outreachEmailTemplates.map((t) => ({
                        id: t.id,
                        label: t.name,
                        subtitle: t.subject,
                        badge: t.useAiBody ? "AI body" : undefined,
                      }))}
                    />
                    {outreachEmailTemplates.length === 0 && (
                      <p className="text-[9px] text-slate-500 mt-1">No email templates yet — create them in the Templates screen.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1 flex items-center justify-between">
                      <span>Recipient Email</span>
                      {selectedLeadForOutreach.emails && selectedLeadForOutreach.emails.length > 0 ? (
                        <span className="text-[9px] font-normal text-emerald-400 normal-case">Auto-detected · editable</span>
                      ) : (
                        <span className="text-[9px] font-normal text-amber-400 normal-case">No email detected · enter manually</span>
                      )}
                    </label>
                    <input
                      type="email"
                      value={outreachEmailTo}
                      onChange={(e) => setOutreachEmailTo(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                      placeholder="recipient@example.com"
                    />
                    {selectedLeadForOutreach.emails && selectedLeadForOutreach.emails.length > 1 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {selectedLeadForOutreach.emails.map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => setOutreachEmailTo(em)}
                            className={`text-[9px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${outreachEmailTo === em ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" : isLight ? "bg-white text-slate-500 border-slate-200 hover:border-indigo-300" : "bg-transparent text-slate-400 border-[#1e293b] hover:border-indigo-500/40"}`}
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Subject Header</label>
                    <input
                      type="text"
                      value={outreachEmailSubject}
                      onChange={(e) => setOutreachEmailSubject(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                      placeholder="Email subject..."
                    />
                  </div>

                  <div className="flex-grow flex flex-col">
                    <label className="flex items-center justify-between text-[9px] font-bold text-slate-500 mb-1">
                      <span>Message Body</span>
                      {/<[a-z][\s\S]*>/i.test(outreachEmailBody) && (
                        <button
                          type="button"
                          onClick={() => setOutreachEmailViewMode(prev => prev === "preview" ? "code" : "preview")}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold transition-colors cursor-pointer ${
                            outreachEmailViewMode === "preview"
                              ? "bg-indigo-500/15 text-indigo-400"
                              : isLight ? "bg-slate-100 text-slate-500 hover:bg-slate-200" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          {outreachEmailViewMode === "preview" ? <><Code2 className="h-3 w-3" /> View Code</> : <><Eye className="h-3 w-3" /> Preview</>}
                        </button>
                      )}
                    </label>
                    {/<[a-z][\s\S]*>/i.test(outreachEmailBody) && outreachEmailViewMode === "preview" ? (
                      <iframe
                        srcDoc={outreachEmailBody}
                        title="Email preview"
                        sandbox="allow-same-origin"
                        className={`flex-grow w-full min-h-[240px] border rounded-xl overflow-hidden ${isLight ? "bg-white border-slate-200" : "bg-white border-[#1e293b]"}`}
                        style={{ colorScheme: "light" }}
                      />
                    ) : (
                      <textarea
                        value={outreachEmailBody}
                        onChange={(e) => setOutreachEmailBody(e.target.value)}
                        className={`flex-grow w-full min-h-[240px] border rounded-xl p-4 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 resize-y ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                        placeholder="Customized B2B pitch email body..."
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                    To: <strong className={isLight ? "text-slate-800" : "text-white"}>{outreachEmailTo.trim() || "Enter a recipient email"}</strong>
                  </span>
                  
                  <button
                    onClick={handleSendEmail}
                    disabled={isSendingEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outreachEmailTo.trim())}
                    title={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outreachEmailTo.trim()) ? "Enter a valid recipient email" : "Send this email now"}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-md shadow-indigo-600/10"
                  >
                    {isSendingEmail ? "Transmitting..." : "Send Outreach Email"}
                  </button>
                </div>
              </div>

            </div>

            {/* Modal Footer warning */}
            <div className={`px-6 py-3 border-t flex items-center justify-between text-[9px] text-slate-500 ${isLight ? "border-slate-200 bg-slate-50" : "border-[#1e293b]/60 bg-slate-950/40"}`}>
              <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5 text-indigo-400" /> Production Safeguard Active</span>
              <span>Delay: 30s spacing loop in campaign. Single messages deliver instantly.</span>
            </div>

          </div>
        </div>
      </ModalPortal>
    )}

      {/* ACCOUNT SETTINGS MODAL */}
      {showAccountModal && currentUser && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto animate-fadeIn"
            onMouseDown={() => setShowAccountModal(false)}
          >
            <div
              className={`border rounded-3xl w-full max-w-3xl shadow-2xl relative flex flex-col animate-scaleUp ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
            <div className={`px-6 py-4 border-b flex items-center justify-between ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
              <h2 className={`text-base font-bold flex items-center gap-2 ${isLight ? "text-slate-900" : "text-white"}`}>
                <Settings className="h-5 w-5 text-indigo-400" /> Account Settings
              </h2>
              <button
                onClick={() => setShowAccountModal(false)}
                className={`p-1.5 rounded-lg cursor-pointer transition-colors ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Split layout: Profile & Security on the left, Plan info & Danger Zone on the right */}
            <div className="p-6 space-y-6">
              {acctMessage && (
                <div className={`text-xs rounded-lg px-3 py-2 border ${acctMessage.type === "ok" ? "text-emerald-600 bg-emerald-50 border-emerald-100" : "text-rose-600 bg-rose-50 border-rose-100"}`}>
                  {acctMessage.text}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                
                {/* COLUMN 1: Profile & Security settings */}
                <div className="space-y-6">
                  {/* Profile Section */}
                  <div className="space-y-3">
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Profile Details</h3>
                    <div className="space-y-3.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Email Address</label>
                        <input
                          type="email"
                          value={currentUser.email}
                          disabled
                          className={`w-full border rounded-lg px-3 py-2 text-xs opacity-60 cursor-not-allowed ${isLight ? "bg-slate-50 text-slate-600 border-slate-200" : "bg-[#030712] text-slate-400 border-[#1e293b]"}`}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Display Name</label>
                        <input
                          type="text"
                          value={acctName}
                          onChange={(e) => setAcctName(e.target.value)}
                          placeholder="Your display name"
                          className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                        />
                      </div>
                      <button
                        onClick={handleSaveProfile}
                        disabled={acctBusy}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                      >
                        {acctBusy ? "Saving..." : "Save Profile Details"}
                      </button>
                    </div>
                  </div>

                  <div className={`h-px ${isLight ? "bg-slate-100" : "bg-[#1e293b]/60"}`}></div>

                  {/* Security Section */}
                  <div className="space-y-3">
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Change Password</h3>
                    <div className="space-y-3.5">
                      <input
                        type="password"
                        value={acctCurrentPassword}
                        onChange={(e) => setAcctCurrentPassword(e.target.value)}
                        placeholder="Current password"
                        autoComplete="current-password"
                        className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                      />
                      <input
                        type="password"
                        value={acctNewPassword}
                        onChange={(e) => setAcctNewPassword(e.target.value)}
                        placeholder="New password (min. 8 chars)"
                        autoComplete="new-password"
                        className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                      />
                      <button
                        onClick={handleChangePassword}
                        disabled={acctBusy}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                      >
                        {acctBusy ? "Updating..." : "Update Security Password"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* COLUMN 2: Plan Info & Danger Zone */}
                <div className="space-y-6">
                  {/* Plan Information Card */}
                  <div className={`border rounded-2xl p-5 relative overflow-hidden ${
                    isLight ? "bg-slate-50/50 border-slate-200" : "bg-gradient-to-br from-slate-900 to-[#111827] border-[#1e293b]"
                  }`}>
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl"></div>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Subscription Tier</span>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className={`text-xl font-extrabold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                        {planName || "Free Starter"} Plan
                      </span>
                      <button
                        onClick={() => {
                          setShowAccountModal(false);
                          setShowPricingModal(true);
                        }}
                        className="text-[10px] font-bold text-indigo-400 hover:underline cursor-pointer border-0 bg-transparent p-0"
                      >
                        Change plan
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Access code-free outreach campaigns, scraper features, and persistent CRM directories.
                    </p>

                    {usage && !usage.unlimited && usage.limit !== null && (
                      <div className="mt-4 pt-4 border-t border-slate-800/40 space-y-2">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Monthly Leads Quota:</span>
                          <span className="font-semibold">{usage.used} / {usage.limit} used</span>
                        </div>
                        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-slate-800"}`}>
                          <div
                            className={`h-full rounded-full transition-all ${usage.used >= usage.limit ? "bg-rose-500" : "bg-indigo-500"}`}
                            style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Danger Zone Card */}
                  <div className="border border-rose-500/20 bg-rose-500/5 rounded-2xl p-5 space-y-3.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-rose-500">Danger Zone</h3>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Permanently delete your account and all associated scraper configurations, leads, and custom integrations. This action is irreversible.
                    </p>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={acctBusy}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                    >
                      Permanently Delete Account
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* PRICING PLANS MODAL */}
      {showPricingModal && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto animate-fadeIn"
            onMouseDown={() => setShowPricingModal(false)}
          >
            <div
              className={`border rounded-2xl w-full max-w-3xl shadow-2xl relative flex flex-col animate-scaleUp ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
            {/* Modal Header */}
            <div className="px-5 pt-5 pb-1 relative">
              <div className="text-center max-w-xl mx-auto space-y-0.5">
                <h3 className={`text-base font-bold ${isLight ? "text-slate-900" : "text-white"}`}>Find the perfect plan for your agency</h3>
                <p className="text-[11px] text-slate-400">Scale your cold B2B sales outreach and discover verified prospects automatically.</p>
              </div>
              <button
                onClick={() => setShowPricingModal(false)}
                className={`absolute top-5 right-5 p-1.5 rounded-lg cursor-pointer transition-colors ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 md:p-6 overflow-y-auto max-h-[calc(100vh-140px)] space-y-5">

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4.5">
                {/* Plan 1: Free Forever */}
                <div className={`border rounded-xl p-4.5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 hover:scale-[1.01] ${
                  isLight ? "bg-slate-50/50 border-slate-200" : "bg-gradient-to-b from-[#111827] to-black/30 border-[#1e293b]"
                } ${planName.toLowerCase() === "free" || planName.toLowerCase() === "free forever" ? "ring ring-emerald-500/40" : ""}`}>
                  {planName.toLowerCase() === "free" || planName.toLowerCase() === "free forever" ? (
                    <div className="absolute top-2.5 right-2.5 text-[8px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                      Current Plan
                    </div>
                  ) : null}
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Free Forever</span>
                    <div className="mt-1 flex items-baseline">
                      <span className={`text-2xl font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>Free</span>
                      <span className="text-[10px] text-slate-500 ml-1">forever</span>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-450 leading-snug">Perfect for solo freelancers and small teams getting started.</p>
                    
                    <div className={`h-px my-3.5 ${isLight ? "bg-slate-200" : "bg-[#1e293b]/60"}`}></div>
                    
                    <ul className="space-y-1.5 text-[10.5px] text-slate-400">
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>100 leads/month</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Email Outreach</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>AI Lead Scoring</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Google Sheets Sync</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Basic Deduplication</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Basic Lead Analysis</span>
                      </li>
                      <li className="flex items-center gap-1.5 opacity-30">
                        <X className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                        <span>WhatsApp Outreach</span>
                      </li>
                      <li className="flex items-center gap-1.5 opacity-30">
                        <X className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                        <span>Advanced AI Insights</span>
                      </li>
                      <li className="flex items-center gap-1.5 opacity-30">
                        <X className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                        <span>Priority Support</span>
                      </li>
                    </ul>
                  </div>
                  
                  <button 
                    disabled 
                    className={`mt-6 w-full py-1.5 text-[10px] font-bold rounded-lg text-center cursor-not-allowed border ${
                      planName.toLowerCase() === "free" || planName.toLowerCase() === "free forever"
                        ? "bg-emerald-600 text-white border-transparent"
                        : "bg-slate-800/40 text-slate-500 border border-slate-700/20"
                    }`}
                  >
                    {planName.toLowerCase() === "free" || planName.toLowerCase() === "free forever" ? "Active Plan" : "Included"}
                  </button>
                </div>

                {/* Plan 2: Pro */}
                <div className={`border-0 rounded-xl p-4.5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 hover:scale-[1.01] ${
                  isLight ? "bg-blue-50/60" : "bg-gradient-to-b from-blue-950/40 to-black/35"
                } ${planName.toLowerCase() === "pro" ? "ring ring-emerald-500/40" : ""}`}>
                  <div className="absolute top-2.5 right-2.5 text-[8px] font-black text-white bg-blue-600 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    {planName.toLowerCase() === "pro" ? "Current Plan" : "Popular"}
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-blue-450 uppercase tracking-widest">Pro</span>
                    <div className="mt-1 flex items-baseline">
                      <span className={`text-2xl font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>₹999</span>
                      <span className="text-[10px] text-slate-500 ml-1">/mo</span>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-450 leading-snug">For growing agencies ready to scale cold outreach dispatches.</p>
                    
                    <div className={`h-px my-3.5 ${isLight ? "bg-slate-200" : "bg-[#1e293b]/60"}`}></div>
                    
                    <ul className="space-y-1.5 text-[10.5px] text-slate-400">
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className={`${isLight ? "text-slate-900" : "text-slate-100"} font-semibold`}>Unlimited leads/month</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>AI Lead Scoring</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Google Sheets Sync</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Smart Deduplication</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Email Outreach (SMTP)</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className={`${isLight ? "text-slate-900" : "text-slate-100"} font-semibold`}>WhatsApp Outreach</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className={`${isLight ? "text-slate-900" : "text-slate-100"} font-semibold`}>Advanced AI Insights</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className={`${isLight ? "text-slate-900" : "text-slate-100"} font-semibold`}>Priority Support</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className={`${isLight ? "text-slate-900" : "text-slate-100"} font-semibold`}>Custom Integrations</span>
                      </li>
                    </ul>
                  </div>
                  
                  {planName.toLowerCase() === "pro" ? (
                    <button disabled className="mt-6 w-full py-1.5 bg-emerald-600 text-white border-transparent text-[10px] font-bold rounded-lg cursor-not-allowed text-center">
                      Active Plan
                    </button>
                  ) : (
                    <a 
                      href="/#pricing" 
                      target="_blank" 
                      rel="noreferrer"
                      className="mt-6 w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg text-center shadow-md shadow-indigo-600/10 block cursor-pointer transition-all"
                    >
                      Upgrade to Pro
                    </a>
                  )}
                </div>

                {/* Plan 3: Custom */}
                <div className={`border rounded-xl p-4.5 flex flex-col justify-between relative overflow-hidden transition-all duration-300 hover:scale-[1.01] ${
                  isLight ? "bg-white border-slate-200" : "bg-gradient-to-b from-[#111827] to-black/30 border-[#1e293b]"
                } ${planName.toLowerCase() === "custom" ? "ring ring-emerald-500/20" : ""}`}>
                  {planName.toLowerCase() === "custom" ? (
                    <div className="absolute top-2.5 right-2.5 text-[8px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                      Current Plan
                    </div>
                  ) : null}
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Custom</span>
                    <div className="mt-1 flex items-baseline">
                      <span className={`text-2xl font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>Custom</span>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-450 leading-snug">For large teams with custom volume, SLA, and integration needs.</p>
                    
                    <div className={`h-px my-3.5 ${isLight ? "bg-slate-200" : "bg-[#1e293b]/60"}`}></div>
                    
                    <ul className="space-y-1.5 text-[10.5px] text-slate-400">
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-slate-200 font-semibold">Everything in Pro</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Custom lead volume</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Multi-city campaigns</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Dedicated account manager</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Custom integrations & API</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>White-label option</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>SLA guarantee</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Onboarding & training</span>
                      </li>
                    </ul>
                  </div>
                  
                  {planName.toLowerCase() === "custom" ? (
                    <button disabled className="mt-6 w-full py-1.5 bg-emerald-600 text-white border-transparent text-[10px] font-bold rounded-lg cursor-not-allowed text-center">
                      Active Plan
                    </button>
                  ) : (
                    <button 
                      onClick={() => setShowContactOptions(true)}
                      className="mt-6 w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg text-center shadow-md shadow-indigo-600/10 block cursor-pointer transition-all"
                    >
                      Contact Sales
                    </button>
                  )}
                </div>
              </div>
            </div>


          </div>
        </div>
      </ModalPortal>
    )}

      {showContactOptions && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
            onMouseDown={() => setShowContactOptions(false)}
          >
            <div
              className={`border rounded-xl w-full max-w-xs shadow-xl p-5 relative animate-scaleUp ${isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"}`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowContactOptions(false)}
                className={`absolute top-3 right-3 p-1 rounded-lg cursor-pointer transition-colors ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
              >
                <X className="h-4 w-4" />
              </button>
              <h4 className={`text-xs font-bold uppercase tracking-wider mb-3.5 ${isLight ? "text-slate-900" : "text-white"}`}>Contact Sales</h4>
              <div className="space-y-2">
                <a
                  href="tel:8830553868"
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                    isLight ? "border-slate-200 hover:bg-slate-50 text-slate-700 hover:border-slate-300" : "border-[#1e293b] hover:bg-slate-800/60 text-slate-200 hover:border-[#334155]"
                  }`}
                >
                  <Phone className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Call +91 8830553868</span>
                </a>
                <a
                  href="https://wa.me/918830553868"
                  target="_blank"
                  rel="noreferrer"
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                    isLight ? "border-slate-200 hover:bg-slate-50 text-slate-700 hover:border-slate-300" : "border-[#1e293b] hover:bg-slate-800/60 text-slate-200 hover:border-[#334155]"
                  }`}
                >
                  <MessageSquare className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>WhatsApp chat</span>
                </a>
                <a
                  href="mailto:chatnexgen@gmail.com?subject=Outreach Campaign custom pricing request"
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                    isLight ? "border-slate-200 hover:bg-slate-50 text-slate-700 hover:border-slate-300" : "border-[#1e293b] hover:bg-slate-800/60 text-slate-200 hover:border-[#334155]"
                  }`}
                >
                  <Mail className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span className="truncate">Email chatnexgen@gmail.com</span>
                </a>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

    </div>
  );
}
