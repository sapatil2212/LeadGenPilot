import React, { useState, useEffect } from "react";
import AlertModal from "./AlertModal";
import WhatsAppLogo from "./WhatsAppLogo";
import { 
  Plus, 
  Trash2, 
  Code, 
  Layout as LayoutIcon, 
  Eye, 
  Save, 
  FileText, 
  Info, 
  Check,
  RefreshCw,
  Sparkles,
  Phone,
  Mail,
  User,
  ExternalLink,
  MessageSquare,
  ArrowLeft,
  Copy,
  PlusCircle,
  Clock,
  Layers,
  Send,
  MessageCircle,
  ChevronLeft,
  Video,
  MoreVertical,
  Smile,
  Paperclip,
  Camera,
  Mic,
  Loader2
} from "lucide-react";
import { api, messageOf } from "./ui/api";

interface EmailTemplate {
  id: string;
  name: string;
  templateType: "email" | "whatsapp";
  subject: string;
  designMode: "builder" | "code";
  htmlCode: string;
  
  // Wizard settings
  useLogo: boolean;
  logoType: "text" | "image";
  logoValue: string; // Title or image url
  
  introText: string; // Common welcome message
  
  useAiBody: boolean; // Auto-generate body using AI
  customBodyText: string; // Fallback or override body text
  
  useCta: boolean;
  ctaText: string;
  ctaUrl: string;
  ctaBgColor: string;
  
  useContact: boolean;
  contactText: string;
  
  useFooter: boolean;
  footerText: string;
  
  createdAt: string;
}

interface GeneratedTemplateResponse {
  draft: EmailTemplate;
  rationale: string | null;
  missingInformation: string[];
  confidence: number;
  sources: { documentId: string; documentTitle: string }[];
  provider: string;
  model: string;
  promptName: string;
  promptVersion: number;
}

interface EmailTemplatesProps {
  isLight: boolean;
  workspaceId?: string;
}

export default function EmailTemplates({ isLight, workspaceId }: EmailTemplatesProps) {
  const storageKey = `leadfinder_email_templates_v3:${workspaceId || "default"}`;
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [activeMode, setActiveMode] = useState<"builder" | "code">("builder");
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [currentTab, setCurrentTab] = useState<"email" | "whatsapp">("email");
  const [generationObjective, setGenerationObjective] = useState(
    "Introduce our most relevant offering and start a sales conversation."
  );
  const [generationTone, setGenerationTone] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [legacyTemplates, setLegacyTemplates] = useState<EmailTemplate[]>([]);
  const [legacyCodeTemplateCount, setLegacyCodeTemplateCount] = useState(0);
  const [legacyStorageKeys, setLegacyStorageKeys] = useState<string[]>([]);
  const [isImportingLegacy, setIsImportingLegacy] = useState(false);
  const [generationResult, setGenerationResult] = useState<GeneratedTemplateResponse | null>(null);
  
  const highlightVariables = (text: string) => {
    if (!text) return "";
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, idx) => {
      if (part.startsWith("{{") && part.endsWith("}}")) {
        return (
          <strong key={idx} className="bg-indigo-150/90 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 px-1 py-0.5 rounded font-bold text-[9px] border border-indigo-250/20 inline-block">
            {part}
          </strong>
        );
      }
      return part;
    });
  };
  
  // AlertModal states
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    type: "success" | "confirm" | "danger" | "warning" | "info";
    title: string;
    message: string;
    confirmLabel?: string;
    isLoading?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
    isLoading: false,
    onConfirm: () => {}
  });

  // Templates are workspace data: load them through the authenticated API so
  // teammates, campaigns and other devices all see the same reviewed records.
  useEffect(() => {
    let alive = true;
    setIsLoadingTemplates(true);
    setTemplateError("");
    api.get<EmailTemplate[]>("/api/templates")
      .then((rows) => {
        if (alive) setTemplates(rows);
      })
      .catch((error) => {
        if (alive) setTemplateError(messageOf(error));
      })
      .finally(() => {
        if (alive) setIsLoadingTemplates(false);
      });

    // Existing browser-only records cannot be assigned silently. Surface an
    // explicit import action for the currently selected workspace instead.
    const candidates: EmailTemplate[] = [];
    const seenIds = new Set<string>();
    const keys: string[] = [];
    let codeTemplateCount = 0;
    for (const key of ["leadfinder_email_templates_v3", storageKey]) {
      const saved = localStorage.getItem(key);
      if (!saved) continue;
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) continue;
        const reviewed = parsed.filter(
          (template: EmailTemplate) =>
            template && !String(template.id || "").startsWith("sample-")
        );
        for (const template of reviewed) {
          if (template.designMode === "code") {
            codeTemplateCount++;
            continue;
          }
          const legacyId = String(template.id || "");
          if (!legacyId || seenIds.has(legacyId)) continue;
          seenIds.add(legacyId);
          candidates.push(template);
        }
        if (reviewed.length) keys.push(key);
      } catch {
        // Leave malformed legacy data untouched; the user can clear it manually.
      }
    }
    setLegacyTemplates(candidates);
    setLegacyCodeTemplateCount(codeTemplateCount);
    setLegacyStorageKeys(keys);

    return () => {
      alive = false;
    };
  }, [storageKey]);

  const upsertTemplate = (saved: EmailTemplate) => {
    setTemplates((current) => {
      const exists = current.some((template) => template.id === saved.id);
      return exists
        ? current.map((template) => (template.id === saved.id ? saved : template))
        : [saved, ...current];
    });
  };

  const handleImportLegacy = async () => {
    if (!legacyTemplates.length) return;
    setIsImportingLegacy(true);
    setTemplateError("");
    try {
      const result = await api.post<{ templates: EmailTemplate[]; imported: number }>(
        "/api/templates/import",
        { templates: legacyTemplates }
      );
      setTemplates((current) => [...result.templates, ...current]);
      const importedIds = new Set(legacyTemplates.map((template) => String(template.id)));
      for (const key of legacyStorageKeys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) continue;
          const remaining = parsed.filter(
            (template: EmailTemplate) => !importedIds.has(String(template?.id || ""))
          );
          if (remaining.length) localStorage.setItem(key, JSON.stringify(remaining));
          else localStorage.removeItem(key);
        } catch {
          // Never delete a source key we could not safely update.
        }
      }
      setLegacyTemplates([]);
      setLegacyStorageKeys([]);
    } catch (error) {
      setTemplateError(messageOf(error));
    } finally {
      setIsImportingLegacy(false);
    }
  };

  const handleCreateNew = () => {
    setGenerationResult(null);
    const newTpl: EmailTemplate = {
      id: `tpl-${Date.now()}`,
      name: currentTab === "email" ? "Untitled Email Template" : "Untitled WhatsApp Template",
      templateType: currentTab,
      subject: "",
      designMode: "builder",
      htmlCode: "",
      useLogo: false,
      logoType: "text",
      logoValue: "",
      introText: "Hi {{company}} team,",
      useAiBody: false,
      customBodyText: "",
      useCta: false,
      ctaText: "",
      ctaUrl: "",
      ctaBgColor: "#4f46e5",
      useContact: false,
      contactText: "",
      useFooter: false,
      footerText: "",
      createdAt: new Date().toISOString()
    };
    setSelectedTemplate(newTpl);
    setActiveMode("builder");
    setIsEditing(true);
  };

  const handleGenerateWithAi = async () => {
    setIsGenerating(true);
    setGenerationError("");
    setGenerationResult(null);
    try {
      const result = await api.post<GeneratedTemplateResponse>("/api/templates/ai-draft", {
        channel: currentTab,
        objective: generationObjective,
        tone: generationTone || undefined,
      });
      setGenerationResult(result);
      setSelectedTemplate(result.draft);
      setActiveMode("builder");
      setIsEditing(true);
    } catch (error) {
      setGenerationError(messageOf(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDuplicate = async (tpl: EmailTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setTemplateError("");
    try {
      const cloned = await api.post<EmailTemplate>("/api/templates", {
        template: { ...tpl, name: `${tpl.name} (Copy)` },
      });
      upsertTemplate(cloned);
    } catch (error) {
      setTemplateError(messageOf(error));
    }
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    setSaveStatus("saving");
    setTemplateError("");

    const exists = templates.some((template) => template.id === selectedTemplate.id);
    try {
      const saved = exists
        ? await api.put<EmailTemplate>(`/api/templates/${selectedTemplate.id}`, {
            template: { ...selectedTemplate, designMode: "builder", htmlCode: "" },
          })
        : await api.post<EmailTemplate>("/api/templates", {
            template: { ...selectedTemplate, designMode: "builder", htmlCode: "" },
          });
      upsertTemplate(saved);
      setSelectedTemplate(saved);
      setActiveMode("builder");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      setModalConfig({
        isOpen: true,
        type: "success",
        title: "Template Saved Successfully",
        message: `"${saved.name}" is now available to this workspace and can be selected when generating a campaign.`,
        confirmLabel: "Done",
        onConfirm: () => setModalConfig((previous) => ({ ...previous, isOpen: false })),
      });
    } catch (error) {
      setSaveStatus("idle");
      setTemplateError(messageOf(error));
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalConfig({
      isOpen: true,
      type: "danger",
      title: "Delete Outreach Template",
      message: "Are you sure you want to permanently delete this outreach template shell? This action cannot be undone.",
      confirmLabel: "Delete Template",
      isLoading: false,
      onConfirm: async () => {
        setModalConfig(prev => ({ ...prev, isLoading: true }));
        setTemplateError("");
        try {
          await api.del(`/api/templates/${id}`);
          setTemplates((current) => current.filter((template) => template.id !== id));
          if (selectedTemplate?.id === id) {
            setSelectedTemplate(null);
            setIsEditing(false);
          }
          setModalConfig({
            isOpen: true,
            type: "success",
            title: "Template Deleted",
            message: "The outreach template has been removed from this workspace.",
            confirmLabel: "Done",
            isLoading: false,
            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
          });
        } catch (error) {
          setTemplateError(messageOf(error));
          setModalConfig((previous) => ({ ...previous, isOpen: false, isLoading: false }));
        }
      }
    });
  };

  const handleEditClick = (tpl: EmailTemplate) => {
    setGenerationResult(null);
    setSelectedTemplate(tpl);
    setActiveMode(tpl.designMode || "builder");
    setIsEditing(true);
  };

  // Compile output text for WhatsApp
  const generateWhatsappText = (tpl: EmailTemplate): string => {
    let text = "";
    if (tpl.introText.trim()) {
      text += tpl.introText.trim() + "\n\n";
    }
    if (tpl.useAiBody) {
      text += "[🤖 AI Outreach Agent: A personalized campaign pitch based on prospect's GMB scores, priority tier, and city signals will be automatically generated and injected here during dispatches.]\n\n";
    } else if (tpl.customBodyText.trim()) {
      text += tpl.customBodyText.trim() + "\n\n";
    }
    if (tpl.useCta && tpl.ctaText.trim()) {
      text += tpl.ctaText.trim() + " " + (tpl.ctaUrl || "") + "\n\n";
    }
    if (tpl.useContact && tpl.contactText.trim()) {
      text += tpl.contactText.trim() + "\n\n";
    }
    if (tpl.useFooter && tpl.footerText.trim()) {
      text += tpl.footerText.trim();
    }
    return text.trim();
  };

  // HTML compiler based on wizard schema (Email only)
  const generateHtml = (tpl: EmailTemplate): string => {
    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tpl.name}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 20px 0;">
    <tr>
      <td align="center">
        <!--[if mso]>
        <table align="center" border="0" cellspacing="0" cellpadding="0" width="550" style="width: 550px;">
        <tr>
        <td align="center" valign="top" width="550">
        <![endif]-->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 550px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 24px;">`;

    // 1. Logo Section
    if (tpl.useLogo && tpl.logoValue.trim()) {
      if (tpl.logoType === "image") {
        html += `
              <!-- LOGO BANNER IMAGE -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px;">
                <tr>
                  <td align="center">
                    <img src="${tpl.logoValue}" alt="Logo" style="max-height: 48px; max-width: 200px; object-contain: fill; display: block;" />
                  </td>
                </tr>
              </table>`;
      } else {
        html += `
              <!-- LOGO BANNER TEXT -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
                <tr>
                  <td align="left">
                    <span style="font-size: 16px; font-weight: bold; color: #4f46e5; letter-spacing: -0.5px;">${tpl.logoValue}</span>
                  </td>
                </tr>
              </table>`;
      }
    }

    // 2. Greeting/Common message
    if (tpl.introText.trim()) {
      html += `
              <!-- WELCOME / COMMON GREETING -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                <tr>
                  <td style="font-size: 14px; color: #334155; line-height: 1.5; white-space: pre-line;">${tpl.introText}</td>
                </tr>
              </table>`;
    }

    // 3. Body Section
    if (tpl.useAiBody) {
      html += `
              <!-- AI GENERATED OUTREACH BODY PLACEHOLDER -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                <tr>
                  <td style="padding: 16px; background-color: #f1f5f9; border-left: 4px solid #6366f1; border-radius: 6px; font-size: 13px; color: #475569; font-style: italic; line-height: 1.6;">
                    [🤖 AI Outreach Agent: A personalized campaign pitch based on prospect's GMB scores, priority tier, and city signals will be automatically generated and injected here during dispatches.]
                  </td>
                </tr>
              </table>`;
    } else if (tpl.customBodyText.trim()) {
      html += `
              <!-- CUSTOM OUTREACH BODY -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 16px;">
                <tr>
                  <td style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-line;">${tpl.customBodyText}</td>
                </tr>
              </table>`;
    }

    // 4. CTA Button Section
    if (tpl.useCta && tpl.ctaText.trim()) {
      html += `
              <!-- CTA OUTREACH BUTTON -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
                <tr>
                  <td align="center">
                    <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: ${tpl.ctaBgColor || "#4f46e5"};">
                          <a href="${tpl.ctaUrl || "#"}" target="_blank" style="display: inline-block; padding: 10px 22px; font-size: 13px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px; font-family: sans-serif;">
                            ${tpl.ctaText}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>`;
    }

    // 5. Contact details Section
    if (tpl.useContact && tpl.contactText.trim()) {
      html += `
              <!-- CONTACT OUTLET DETAILS -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px; margin-bottom: 8px;">
                <tr>
                  <td align="center" style="font-size: 11px; color: #64748b; line-height: 1.5; white-space: pre-line;">${tpl.contactText}</td>
                </tr>
              </table>`;
    }

    // 6. Footer Section
    if (tpl.useFooter && tpl.footerText.trim()) {
      html += `
              <!-- OUTREACH FOOTER / DISCLAIMER -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 8px;">
                <tr>
                  <td align="center" style="font-size: 10px; color: #94a3b8; line-height: 1.4; white-space: pre-line;">${tpl.footerText}</td>
                </tr>
              </table>`;
    }

    html += `
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td>
        </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
    return html;
  };

  const handleCopyHtml = () => {
    if (!selectedTemplate) return;
    const codeToCopy = selectedTemplate.templateType === "email"
      ? (activeMode === "code" ? selectedTemplate.htmlCode : generateHtml(selectedTemplate))
      : (activeMode === "code" ? selectedTemplate.htmlCode : generateWhatsappText(selectedTemplate));

    navigator.clipboard.writeText(codeToCopy);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  // Compile live preview outputs
  const previewHtml = selectedTemplate && selectedTemplate.templateType === "email"
    ? (activeMode === "code" ? selectedTemplate.htmlCode : generateHtml(selectedTemplate))
    : "";

  const previewWhatsappText = selectedTemplate && selectedTemplate.templateType === "whatsapp"
    ? (activeMode === "code" ? selectedTemplate.htmlCode : generateWhatsappText(selectedTemplate))
    : "";

  // Filter templates list based on active dashboard tab
  const filteredTemplates = templates.filter(t => t.templateType === currentTab);

  return (
    <div className="space-y-6">
      {/* ── VIEW 1: TEMPLATE CARDS DASHBOARD GRID ── */}
      {!isEditing ? (
        <div className="space-y-6 animate-fadeIn">
          {/* AI generation starts from the tenant's uploaded business knowledge. */}
          <div className={`relative overflow-hidden rounded-xl border p-3.5 sm:p-4 transition-all ${
            isLight
              ? "border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 to-white shadow-xs"
              : "border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 to-[#090d16] shadow-md"
          }`}>
            <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />
            <div className="relative grid gap-3 lg:grid-cols-[1fr_200px_auto] lg:items-end">
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <div className="p-1 rounded-md bg-indigo-500/10 text-indigo-500">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <h3 className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                    AI Campaign Copy Generator
                  </h3>
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
                  Gemini drafts hyper-relevant copy synthesized from your Company Profile, Products, and knowledge docs.
                </p>
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Campaign Objective
                </label>
                <textarea
                  value={generationObjective}
                  onChange={(event) => setGenerationObjective(event.target.value)}
                  rows={2}
                  maxLength={500}
                  className={`w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none transition-all focus:ring-2 focus:ring-indigo-500/15 ${
                    isLight
                      ? "border-slate-200 bg-white text-slate-800 focus:border-indigo-500"
                      : "border-[#1e293b] bg-[#030712] text-white focus:border-indigo-500/60"
                  }`}
                />
              </div>
              <div>
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Tone of Voice (Optional)
                </label>
                <input
                  value={generationTone}
                  onChange={(event) => setGenerationTone(event.target.value)}
                  maxLength={120}
                  placeholder="e.g. Consultative, direct"
                  className={`w-full rounded-lg border px-2.5 py-2 text-xs outline-none transition-all focus:ring-2 focus:ring-indigo-500/15 ${
                    isLight
                      ? "border-slate-200 bg-white text-slate-800 focus:border-indigo-500"
                      : "border-[#1e293b] bg-[#030712] text-white focus:border-indigo-500/60"
                  }`}
                />
              </div>
              <button
                onClick={handleGenerateWithAi}
                disabled={isGenerating || !generationObjective.trim()}
                className="btn-interactive flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-xs shadow-indigo-600/20 transition-all hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isGenerating ? "Synthesizing…" : `Generate ${currentTab === "email" ? "Email" : "WhatsApp"}`}
              </button>
            </div>
            {generationError && (
              <div className="relative mt-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                {generationError}
              </div>
            )}
          </div>

          {legacyTemplates.length > 0 && (
            <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              isLight
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-amber-500/20 bg-amber-500/10 text-amber-200"
            }`}>
              <div>
                <div className="text-xs font-bold">Existing browser templates found</div>
                <p className="mt-0.5 text-[10px] leading-relaxed opacity-80">
                  Import {legacyTemplates.length} reviewed template{legacyTemplates.length === 1 ? "" : "s"} into this workspace so your team and Campaigns can use them.
                </p>
              </div>
              <button
                onClick={handleImportLegacy}
                disabled={isImportingLegacy}
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {isImportingLegacy ? "Importing…" : "Import into this workspace"}
              </button>
            </div>
          )}

          {legacyCodeTemplateCount > 0 && (
            <div className={`rounded-xl border px-4 py-3 ${
              isLight
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : "border-slate-700 bg-slate-900 text-slate-300"
            }`}>
              <div className="text-xs font-bold">
                {legacyCodeTemplateCount} legacy code template{legacyCodeTemplateCount === 1 ? "" : "s"} kept in browser storage
              </div>
              <p className="mt-1 text-[10px] leading-relaxed opacity-75">
                Arbitrary HTML or raw-code templates cannot be imported safely. They were not deleted; recreate their content with the safe builder or Generate with AI.
              </p>
            </div>
          )}

          {templateError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              {templateError}
            </div>
          )}

          {/* Header Channel selector & Add Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 dark:border-slate-800/60 pb-3">
            {/* Tabs for Email vs WhatsApp */}
            <div className={`inline-flex p-0.5 rounded-xl border transition-all ${
              isLight ? "bg-slate-100/80 border-slate-200/80" : "bg-black/30 border-[#1e293b]"
            }`}>
              <button
                onClick={() => setCurrentTab("email")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentTab === "email"
                    ? "bg-indigo-600 text-white shadow-xs shadow-indigo-600/30"
                    : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                }`}
              >
                <Mail className="h-3.5 w-3.5" /> 
                <span>Email Templates</span>
                <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                  currentTab === "email" ? "bg-white/20 text-white" : isLight ? "bg-slate-200 text-slate-700" : "bg-slate-800 text-slate-300"
                }`}>
                  {templates.filter(t => t.templateType === "email").length}
                </span>
              </button>
              <button
                onClick={() => setCurrentTab("whatsapp")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  currentTab === "whatsapp"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xs shadow-emerald-600/30"
                    : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                }`}
              >
                <WhatsAppLogo className="h-3.5 w-3.5 fill-current" /> 
                <span>WhatsApp Templates</span>
                <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                  currentTab === "whatsapp" ? "bg-white/20 text-white" : isLight ? "bg-slate-200 text-slate-700" : "bg-slate-800 text-slate-300"
                }`}>
                  {templates.filter(t => t.templateType === "whatsapp").length}
                </span>
              </button>
            </div>

            <button
              onClick={handleCreateNew}
              className={`btn-interactive px-3 py-1.5 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition-all ${
                currentTab === "whatsapp"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/20"
                  : "bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-indigo-600/20"
              }`}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>New {currentTab === "email" ? "Email" : "WhatsApp"} Template</span>
            </button>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoadingTemplates && (
              <div className={`col-span-full rounded-xl border p-8 text-center text-xs ${
                isLight ? "border-slate-200 bg-white text-slate-500" : "border-[#1e293b] bg-[#090d16] text-slate-400"
              }`}>
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-indigo-500" />
                Loading workspace templates…
              </div>
            )}
            {!isLoadingTemplates && filteredTemplates.length === 0 && (
              <div className={`col-span-full rounded-xl border border-dashed p-8 text-center relative overflow-hidden ${
                isLight ? "border-indigo-200/90 bg-indigo-50/30" : "border-indigo-500/25 bg-indigo-500/5"
              }`}>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-2.5 text-indigo-500">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className={`text-xs font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  No {currentTab} templates yet
                </div>
                <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-slate-500">
                  Use the AI composer above to let Gemini create high-converting outreach copy based on your business signals.
                </p>
              </div>
            )}
            {filteredTemplates.map(tpl => {
              const activeFeatures = [
                tpl.useLogo && "Logo",
                tpl.useAiBody ? "AI Body" : "Custom Body",
                tpl.useCta && (tpl.templateType === "email" ? "CTA Button" : "CTA Link"),
                tpl.useContact && "Contact",
                tpl.useFooter && "Footer"
              ].filter(Boolean);

              return (
                <div
                  key={tpl.id}
                  className={`border rounded-xl p-3.5 flex flex-col justify-between h-42 transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-pointer group ${
                    isLight 
                      ? "bg-white border-slate-200 hover:border-indigo-300" 
                      : "bg-[#090d16] border-[#1e293b] hover:border-indigo-500/40"
                  }`}
                  onClick={() => handleEditClick(tpl)}
                >
                  <div className="space-y-2 flex-grow min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`p-1.5 rounded-lg shrink-0 ${
                          tpl.templateType === "email"
                            ? (isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-950/40 text-indigo-400")
                            : (isLight ? "bg-emerald-50 text-emerald-600" : "bg-emerald-950/40 text-emerald-400")
                        }`}>
                          {tpl.templateType === "email" ? <Mail className="h-3.5 w-3.5" /> : <WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" />}
                        </div>
                        <h4 className={`text-xs font-bold leading-tight truncate max-w-[150px] ${isLight ? "text-slate-900" : "text-white"}`}>
                          {tpl.name}
                        </h4>
                      </div>
                      <span className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded-full border uppercase shrink-0 ${
                        tpl.designMode === "code"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                          : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                      }`}>
                        {tpl.designMode === "code" ? (tpl.templateType === "email" ? "HTML" : "TEXT") : "Wizard"}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {tpl.templateType === "email" ? (
                        <div className="text-[10px] text-slate-400 font-medium truncate">
                          <strong>Subject:</strong> {tpl.subject || "(No Subject)"}
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 line-clamp-2 italic leading-relaxed">
                          {tpl.introText || tpl.customBodyText || "No text preview defined..."}
                        </p>
                      )}
                      
                      <div className="flex flex-wrap gap-1 mt-1">
                        {activeFeatures.map((feat, idx) => (
                          <span 
                            key={idx} 
                            className={`text-[8.5px] px-1.5 py-0.2 rounded font-medium ${
                              feat === "AI Body"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15"
                                : isLight ? "bg-slate-100 text-slate-600" : "bg-slate-900 text-slate-400"
                            }`}
                          >
                            {feat}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={`pt-2 border-t flex items-center justify-between text-[10px] ${
                    isLight ? "border-slate-100" : "border-[#1e293b]/60"
                  }`}>
                    <span className="text-slate-500 flex items-center gap-1 text-[9.5px]">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(tpl.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>

                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleDuplicate(tpl, e)}
                        className={`p-1 rounded-md border hover:scale-105 transition-all cursor-pointer ${
                          isLight 
                            ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-500" 
                            : "border-slate-800 bg-[#0c111d] hover:bg-slate-800 text-slate-400"
                        }`}
                        title="Duplicate Template"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(tpl.id, e)}
                        className={`p-1 rounded-md border hover:scale-105 hover:text-rose-500 hover:border-rose-500/30 transition-all cursor-pointer ${
                          isLight 
                            ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-500" 
                            : "border-slate-800 bg-[#0c111d] hover:bg-slate-800 text-slate-400"
                        }`}
                        title="Delete Template"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleEditClick(tpl)}
                        className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold transition-all cursor-pointer shadow-2xs"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Create Card placeholder */}
            <div
              onClick={handleCreateNew}
              className={`border border-dashed rounded-xl flex flex-col items-center justify-center h-42 transition-all hover:border-indigo-500/50 cursor-pointer group ${
                isLight ? "bg-slate-50/30 border-slate-300" : "bg-slate-900/10 border-slate-800"
              }`}
            >
              <div className={`p-2.5 rounded-xl mb-2 transition-all group-hover:scale-110 ${
                isLight ? "bg-slate-100 text-slate-500" : "bg-slate-800/40 text-slate-400"
              }`}>
                <PlusCircle className="h-4 w-4" />
              </div>
              <span className={`text-xs font-bold ${isLight ? "text-slate-700" : "text-slate-300"}`}>
                Create Blank Template
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">
                Design custom blocks from scratch
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ── VIEW 2: TEMPLATE EDITOR / WIZARD WORKSPACE ── */
        <div className="space-y-6 animate-fadeIn">
          {/* Back button row */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsEditing(false)}
              className={`px-3 py-1.5 border rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                isLight 
                  ? "border-slate-200 hover:bg-slate-50 text-slate-600" 
                  : "border-[#1e293b] hover:bg-slate-800 text-slate-350"
              }`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Templates</span>
            </button>

            <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-lg flex items-center gap-1.5 ${
              selectedTemplate?.templateType === "email"
                ? "bg-indigo-500/10 text-indigo-400"
                : "bg-emerald-500/10 text-emerald-455"
            }`}>
              {selectedTemplate?.templateType === "email" ? (
                <><Mail className="h-3.5 w-3.5" /> Email outreach channel</>
              ) : (
                <><WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" /> WhatsApp outreach channel</>
              )}
            </span>
          </div>

          {generationResult && (
            <div className={`rounded-xl border px-4 py-3 text-xs ${
              isLight
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
            }`}>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold">
                    AI draft ready — review and edit before saving
                  </div>
                  {generationResult.rationale && (
                    <p className="mt-1 leading-relaxed">{generationResult.rationale}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-75">
                    <span>Confidence {Math.round(generationResult.confidence * 100)}%</span>
                    <span>{generationResult.provider} / {generationResult.model}</span>
                    <span>
                      {generationResult.sources.length
                        ? `${generationResult.sources.length} uploaded source${generationResult.sources.length === 1 ? "" : "s"}`
                        : "Profile and catalogue context"}
                    </span>
                  </div>
                  {generationResult.missingInformation.length > 0 && (
                    <p className="mt-2 text-[10px] leading-relaxed">
                      Could be improved with: {generationResult.missingInformation.join(" • ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {templateError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              {templateError}
            </div>
          )}

          {/* Top Metadata row */}
          {selectedTemplate && (
            <div className={`border rounded-2xl p-4.5 space-y-4 ${
              isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
            }`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1 space-y-1.5">
                  <input
                    type="text"
                    value={selectedTemplate.name}
                    onChange={(e) => setSelectedTemplate({ ...selectedTemplate, name: e.target.value })}
                    placeholder="Template Name"
                    className={`w-full bg-transparent border-b text-sm font-bold pb-1 outline-none ${
                      isLight 
                        ? "border-slate-200 text-slate-900 focus:border-indigo-500" 
                        : "border-slate-800 text-white focus:border-indigo-400"
                    }`}
                  />
                  {selectedTemplate.templateType === "email" && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Email Subject:</span>
                      <input
                        type="text"
                        value={selectedTemplate.subject}
                        onChange={(e) => setSelectedTemplate({ ...selectedTemplate, subject: e.target.value })}
                        placeholder="Enter email campaign subject line"
                        className={`flex-1 bg-transparent text-xs outline-none ${
                          isLight ? "text-slate-700" : "text-slate-350"
                        }`}
                      />
                    </div>
                  )}
                </div>

                {/* Mode switch and actions */}
                <div className="flex items-center gap-2">
                  <div className={`flex items-center rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase ${
                    isLight ? "border-slate-200 bg-slate-50 text-slate-600" : "border-[#1e293b] bg-slate-950/40 text-slate-300"
                  }`}>
                    <LayoutIcon className="mr-1.5 h-3.5 w-3.5" /> Safe builder
                  </div>

                  <button
                    onClick={handleCopyHtml}
                    className={`p-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isLight 
                        ? "border-slate-200 hover:bg-slate-50 text-slate-600" 
                        : "border-[#1e293b] hover:bg-slate-800 text-slate-300"
                    }`}
                    title={selectedTemplate.templateType === "email" ? "Copy generated HTML" : "Copy outreach text"}
                  >
                    {copiedNotification ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Code className="h-3.5 w-3.5" />}
                    <span className="hidden md:inline">{copiedNotification ? "Copied" : (selectedTemplate.templateType === "email" ? "Copy HTML" : "Copy Text")}</span>
                  </button>

                  <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-md shadow-indigo-600/10 cursor-pointer transition-all hover:scale-[1.02]"
                  >
                    {saveStatus === "saving" ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : saveStatus === "saved" ? (
                      <Check className="h-3.5 w-3.5 text-white" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>{saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Form and Preview Splits */}
          {selectedTemplate && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              {/* Left Column: Form Builder wizard */}
              <div className={`border rounded-2xl flex flex-col justify-between overflow-hidden ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                {activeMode === "builder" ? (
                  /* STRUCTURED OUTREACH WIZARD FORM */
                  <div className="p-4 space-y-4 overflow-y-auto max-h-[560px] pr-1">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/10">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {selectedTemplate.templateType === "email" ? "Email Layout Shell Wizard" : "WhatsApp Outreach Wizard"}
                      </span>
                    </div>

                    {/* 1. Logo Section (Only Email) */}
                    {selectedTemplate.templateType === "email" && (
                      <div className={`border rounded-xl p-3 space-y-3 ${isLight ? "bg-slate-50/50 border-slate-100" : "bg-slate-900/30 border-slate-800/60"}`}>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-xs font-semibold select-none cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedTemplate.useLogo}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useLogo: e.target.checked })}
                              className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                            />
                            <span>1. Add Brand Logo Banner</span>
                          </label>
                        </div>

                        {selectedTemplate.useLogo && (
                          <div className="grid grid-cols-1 gap-2.5 pl-5.5 animate-fadeIn">
                            <div className="flex items-center gap-3 text-[10px]">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="logoType"
                                  checked={selectedTemplate.logoType === "text"}
                                  onChange={() => setSelectedTemplate({ ...selectedTemplate, logoType: "text" })}
                                  className="text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>Text Logo</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name="logoType"
                                  checked={selectedTemplate.logoType === "image"}
                                  onChange={() => setSelectedTemplate({ ...selectedTemplate, logoType: "image" })}
                                  className="text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>Image URL</span>
                              </label>
                            </div>
                            <input
                              type="text"
                              value={selectedTemplate.logoValue}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, logoValue: e.target.value })}
                              placeholder={selectedTemplate.logoType === "text" ? "Enter business name" : "https://example.com/logo.png"}
                              className={`w-full p-2 text-xs rounded-lg border outline-none ${
                                isLight ? "bg-white border-slate-200 text-slate-850" : "bg-slate-950 border-slate-850 text-slate-200"
                              }`}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* 2. Common Greeting message */}
                    <div className={`border rounded-xl p-3 space-y-2 ${isLight ? "bg-slate-50/50 border-slate-100" : "bg-slate-900/30 border-slate-800/60"}`}>
                      <label className="text-xs font-semibold block">
                        {selectedTemplate.templateType === "email" ? "2. Common Message / Greeting" : "1. Common Intro Greeting"}
                      </label>
                      <p className="text-[10px] text-slate-450 leading-snug">Welcome/thank-you line placed at the start of outreach message:</p>
                      <textarea
                        value={selectedTemplate.introText}
                        onChange={(e) => setSelectedTemplate({ ...selectedTemplate, introText: e.target.value })}
                        placeholder={selectedTemplate.templateType === "email" ? "Hi {{name}},&#10;&#10;Welcome / Thank you for connecting with us..." : "Hi {{name}},\n\nI noticed your listing..."}
                        rows={3}
                        className={`w-full p-2 text-xs rounded-lg border outline-none resize-none focus:border-indigo-500/60 font-sans ${
                          isLight ? "bg-white border-slate-200 text-slate-855" : "bg-slate-955 border-slate-855 text-slate-200"
                        }`}
                      />
                    </div>

                    {/* 3. AI Generated vs Custom Body */}
                    <div className={`border rounded-xl p-3 space-y-3 ${isLight ? "bg-slate-50/50 border-slate-100" : "bg-slate-900/30 border-slate-800/60"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1">
                          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                          {selectedTemplate.templateType === "email" ? "3. Email Body Outreach Creator" : "2. WhatsApp Outreach Body"}
                        </span>
                      </div>

                      <div className="space-y-2 pl-1.5">
                        <label className="flex items-center gap-2 text-xs select-none cursor-pointer">
                          <input
                            type="radio"
                            name="useAiBody"
                            checked={selectedTemplate.useAiBody}
                            onChange={() => setSelectedTemplate({ ...selectedTemplate, useAiBody: true })}
                            className="text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                          />
                          <span className="font-medium text-slate-200">Let AI auto-generate body based on Lead details (Recommended)</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs select-none cursor-pointer">
                          <input
                            type="radio"
                            name="useAiBody"
                            checked={!selectedTemplate.useAiBody}
                            onChange={() => setSelectedTemplate({ ...selectedTemplate, useAiBody: false })}
                            className="text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                          />
                          <span className="font-medium text-slate-200">Write custom outreach body message manually</span>
                        </label>
                      </div>

                      {selectedTemplate.useAiBody ? (
                        <div className={`pl-5.5 p-3 rounded-lg border text-[11px] leading-relaxed flex items-start gap-2 ${
                          isLight ? "bg-indigo-50/40 border-indigo-100 text-slate-650" : "bg-indigo-950/20 border-indigo-900/40 text-indigo-200/90"
                        }`}>
                          <Info className="h-4 w-4 shrink-0 text-indigo-400 mt-0.5" />
                          <span>
                            <strong>AI Personalized Outlets</strong>: Our AI Outreach Agent will automatically analyze prospect digital signals, GMB metrics, and prioritized categories to write a completely tailored pitch. No manual writing needed.
                          </span>
                        </div>
                      ) : (
                        <div className="pl-5.5 space-y-1.5 animate-fadeIn">
                          <p className="text-[10px] text-slate-450 leading-snug">Enter your manually-defined outreach message body:</p>
                          <textarea
                            value={selectedTemplate.customBodyText}
                            onChange={(e) => setSelectedTemplate({ ...selectedTemplate, customBodyText: e.target.value })}
                            placeholder="We noticed your listing in {{city}} and wanted to offer..."
                            rows={4}
                            className={`w-full p-2 text-xs rounded-lg border outline-none resize-none focus:border-indigo-500/60 font-sans ${
                              isLight ? "bg-white border-slate-200 text-slate-855" : "bg-slate-955 border-slate-855 text-slate-200"
                            }`}
                          />
                        </div>
                      )}
                    </div>

                    {/* 4. CTA Buttons Section */}
                    <div className={`border rounded-xl p-3 space-y-3 ${isLight ? "bg-slate-50/50 border-slate-100" : "bg-slate-900/30 border-slate-800/60"}`}>
                      <label className="flex items-center gap-2 text-xs font-semibold select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTemplate.useCta}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useCta: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span>{selectedTemplate.templateType === "email" ? "4. Add Call-to-Action (CTA) Button" : "3. Add Link Call-to-Action"}</span>
                      </label>

                      {selectedTemplate.useCta && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-5.5 animate-fadeIn">
                          <div>
                            <label className="text-[10px] text-slate-400 font-bold block mb-1">
                              {selectedTemplate.templateType === "email" ? "Button Text" : "CTA Message Prefix"}
                            </label>
                            <input
                              type="text"
                              value={selectedTemplate.ctaText}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, ctaText: e.target.value })}
                              placeholder={selectedTemplate.templateType === "email" ? "Book a Session" : "Book demo here:"}
                              className={`w-full p-2 text-xs rounded-lg border outline-none ${
                                isLight ? "bg-white border-slate-200 text-slate-850" : "bg-slate-955 border-slate-855 text-slate-200"
                              }`}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 font-bold block mb-1">Destination URL Link</label>
                            <input
                              type="text"
                              value={selectedTemplate.ctaUrl}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, ctaUrl: e.target.value })}
                              placeholder="https://cal.com/..."
                              className={`w-full p-2 text-xs rounded-lg border outline-none ${
                                isLight ? "bg-white border-slate-200 text-slate-850" : "bg-slate-955 border-slate-855 text-slate-200"
                              }`}
                            />
                          </div>
                          {selectedTemplate.templateType === "email" && (
                            <div className="md:col-span-2 flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 font-bold">Button Color:</span>
                              <input
                                type="color"
                                value={selectedTemplate.ctaBgColor}
                                onChange={(e) => setSelectedTemplate({ ...selectedTemplate, ctaBgColor: e.target.value })}
                                className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                              />
                              <span className="text-[10px] text-slate-500 font-mono">{selectedTemplate.ctaBgColor}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 5. Contact Details Section */}
                    <div className={`border rounded-xl p-3 space-y-2 ${isLight ? "bg-slate-50/50 border-slate-100" : "bg-slate-900/30 border-slate-800/60"}`}>
                      <label className="flex items-center gap-2 text-xs font-semibold select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTemplate.useContact}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useContact: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span>{selectedTemplate.templateType === "email" ? "5. Add Contact Details Section" : "4. Add Contact Text Line"}</span>
                      </label>

                      {selectedTemplate.useContact && (
                        <div className="pl-5.5 space-y-1 animate-fadeIn">
                          <textarea
                            value={selectedTemplate.contactText}
                            onChange={(e) => setSelectedTemplate({ ...selectedTemplate, contactText: e.target.value })}
                            placeholder="Phone: +91 8830553868 | Email: chatnexgen@gmail.com"
                            rows={2}
                            className={`w-full p-2 text-xs rounded-lg border outline-none resize-none focus:border-indigo-500/60 font-sans ${
                              isLight ? "bg-white border-slate-200 text-slate-855" : "bg-slate-955 border-slate-855 text-slate-200"
                            }`}
                          />
                        </div>
                      )}
                    </div>

                    {/* 6. Footer Common Messages Section */}
                    <div className={`border rounded-xl p-3 space-y-2 ${isLight ? "bg-slate-50/50 border-slate-100" : "bg-slate-900/30 border-slate-800/60"}`}>
                      <label className="flex items-center gap-2 text-xs font-semibold select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTemplate.useFooter}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useFooter: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span>{selectedTemplate.templateType === "email" ? "6. Add Footer Common Message" : "5. Add Opt-Out Sign-off text"}</span>
                      </label>

                      {selectedTemplate.useFooter && (
                        <div className="pl-5.5 space-y-1 animate-fadeIn">
                          <textarea
                            value={selectedTemplate.footerText}
                            onChange={(e) => setSelectedTemplate({ ...selectedTemplate, footerText: e.target.value })}
                            placeholder={selectedTemplate.templateType === "email" ? "You are receiving this because you listing was discovered via Maps geo-outreach." : "Reply STOP to unsubscribe."}
                            rows={2}
                            className={`w-full p-2 text-xs rounded-lg border outline-none resize-none focus:border-indigo-500/60 font-sans ${
                              isLight ? "bg-white border-slate-200 text-slate-855" : "bg-slate-955 border-slate-855 text-slate-200"
                            }`}
                          />
                        </div>
                      )}
                    </div>

                  </div>
                ) : (
                  /* RAW CODE EDITOR PANEL */
                  <div className="p-4 flex flex-col h-full justify-between gap-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/20">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {selectedTemplate.templateType === "email" ? "Paste HTML Source Code" : "Outreach Text Message Script"}
                      </span>
                      <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest flex items-center gap-1">
                        <Code className="h-3.5 w-3.5" /> Source Code Mode
                      </span>
                    </div>
                    <textarea
                      value={selectedTemplate.htmlCode}
                      onChange={(e) => setSelectedTemplate({ ...selectedTemplate, htmlCode: e.target.value })}
                      placeholder={selectedTemplate.templateType === "email" 
                        ? "<!-- Paste your HTML Email Template here -->&#10;<!DOCTYPE html>&#10;<html>&#10;..."
                        : "Write or paste the exact outreach message you want to dispatch here..."}
                      className="flex-1 w-full p-3 font-mono text-[11px] leading-relaxed rounded-xl border outline-none min-h-[490px] focus:border-indigo-500/60 bg-slate-955 text-slate-300 border-slate-850"
                    />
                  </div>
                )}
              </div>

              {/* Right Column: Live compiled preview */}
              <div className={`border rounded-2xl flex flex-col justify-between overflow-hidden ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                {selectedTemplate.templateType === "email" ? (
                  /* EMAIL LAYOUT IFRAME PREVIEW */
                  <div className="p-4 flex flex-col h-full gap-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/20">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Campaign Preview</span>
                      <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" /> Interactive
                      </span>
                    </div>

                    <div className={`flex-1 rounded-xl overflow-hidden border min-h-[490px] flex flex-col ${
                      isLight ? "border-slate-100 bg-slate-50" : "border-slate-800/60 bg-slate-955"
                    }`}>
                      {previewHtml ? (
                        <iframe
                          srcDoc={previewHtml}
                          title="Email live compile preview"
                          className="w-full h-full border-0 flex-1 bg-white"
                          sandbox="allow-popups allow-popups-to-escape-sandbox"
                        />
                      ) : (
                        <div className="m-auto text-center space-y-1.5 p-6">
                          <FileText className="h-8 w-8 text-slate-500 mx-auto" />
                          <div className="text-xs text-slate-450">Waiting for template elements to compile...</div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* WHATSAPP INTERACTIVE CHAT PREVIEW MOCKUP */
                  <div className="p-4 flex flex-col h-full gap-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/20">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WhatsApp Device Preview</span>
                      <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1">
                        <WhatsAppLogo className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" /> Live Render
                      </span>
                    </div>

                    <div className="flex-1 flex items-center justify-center p-2 min-h-[490px]">
                      {/* Simulated Smartphone */}
                      <div className="w-[305px] h-[490px] border-[8px] border-slate-850 rounded-[36px] overflow-hidden shadow-2xl bg-[#efeae2] flex flex-col font-sans relative ring-4 ring-slate-800/25">
                        {/* Hardware notch / Dynamic Island */}
                        <div className="w-24 h-4.5 bg-black rounded-full absolute top-1.5 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-900 absolute left-4 border border-slate-800/30"></div>
                        </div>

                        {/* Phone Top Status Bar */}
                        <div className="h-6.5 bg-[#075e54] text-white px-5 pt-1.5 flex items-center justify-between text-[8px] font-bold tracking-wider shrink-0 z-40 select-none">
                          <span>9:41</span>
                          <div className="flex items-center gap-1.5">
                            <span>5G</span>
                            <span className="h-2 w-3.5 border border-white/60 rounded-xs relative flex items-center p-[1px]"><span className="h-full w-2 bg-white rounded-3xs"></span></span>
                          </div>
                        </div>

                        {/* WhatsApp Top Profile Header Bar */}
                        <div className="bg-[#075e54] text-white px-3.5 py-3 flex items-center gap-2 shrink-0 z-40 relative shadow-md">
                          <ChevronLeft className="h-4 w-4 text-white -ml-1.5 shrink-0 cursor-pointer" />
                          <div className="h-8 w-8 rounded-full bg-teal-700 text-white flex items-center justify-center text-[10px] font-bold shrink-0 relative border border-teal-500/20">
                            OA
                            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#075e54]"></span>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold leading-tight truncate">Outreach Agent</div>
                            <div className="text-[7.5px] text-teal-200">Online</div>
                          </div>
                          
                          {/* Top Header Mock Action Icons */}
                          <div className="flex items-center gap-3.5 text-white/90 ml-auto shrink-0">
                            <Video className="h-3.5 w-3.5 cursor-pointer hover:text-white" />
                            <Phone className="h-3.5 w-3.5 cursor-pointer hover:text-white" />
                            <MoreVertical className="h-3.5 w-3.5 cursor-pointer hover:text-white" />
                          </div>
                        </div>

                        {/* WhatsApp Chat Body Window */}
                        <div 
                          className="flex-1 p-3 overflow-y-auto space-y-2 relative flex flex-col justify-start z-30"
                          style={{ 
                            backgroundColor: '#efeae2',
                            backgroundImage: 'radial-gradient(#dfdcd6 1px, transparent 1px)',
                            backgroundSize: '16px 16px'
                          }}
                        >
                          <div className="mx-auto text-[8px] bg-slate-250/60 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-md shadow-sm mb-3.5 text-center max-w-[85%] uppercase font-bold tracking-wider select-none">
                            🔒 Messages are end-to-end encrypted
                          </div>

                          {previewWhatsappText ? (
                            <div className="bg-[#dcf8c6] text-slate-800 text-[10.5px] p-2.5 rounded-2xl rounded-tr-none shadow-sm max-w-[85%] self-end relative leading-relaxed whitespace-pre-wrap border border-[#c1e8a4] animate-scaleUp">
                              {/* Bubble Tail */}
                              <div 
                                className="whatsapp-bubble-tail absolute top-0 -right-2 w-3.5 h-3.5 bg-[#dcf8c6]" 
                                style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
                              ></div>
                              {highlightVariables(previewWhatsappText)}
                              <div className="text-[7.5px] text-slate-500 text-right mt-1.5 flex items-center justify-end gap-0.5">
                                <span>{new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                                <span className="text-[#34b7f1] font-bold text-[8.5px] leading-none shrink-0">✓✓</span>
                              </div>
                            </div>
                          ) : (
                            <div className="m-auto text-center space-y-1 text-slate-450 p-4">
                              <MessageCircle className="h-6 w-6 text-slate-450 mx-auto opacity-60" />
                              <div className="text-[9px]">Enter wizard inputs to generate WhatsApp chat preview...</div>
                            </div>
                          )}
                        </div>

                        {/* WhatsApp Keyboard Input Footer */}
                        <div className="bg-[#f0f0f0] p-2 flex items-center gap-1.5 shrink-0 z-40 select-none border-t border-slate-200">
                          <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-[9px] text-slate-400 border border-slate-200 flex items-center justify-between shadow-sm">
                            <span className="flex items-center gap-1.5">
                              <Smile className="h-4 w-4 text-slate-400 shrink-0" />
                              <span>Type a message</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Paperclip className="h-3.5 w-3.5 text-slate-450 shrink-0" />
                              <Camera className="h-4 w-4 text-slate-450 shrink-0" />
                            </span>
                          </div>
                          <div className="h-7 w-7 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xs shadow-md shadow-[#00a884]/20 cursor-pointer hover:bg-[#008f72] shrink-0">
                            <Mic className="h-4 w-4" />
                          </div>
                        </div>

                        {/* Screen Bottom Home Indicator Bar */}
                        <div className="h-4.5 bg-[#f0f0f0] w-full shrink-0 relative z-40 select-none">
                          <div className="w-24 h-1 bg-slate-400 rounded-full absolute bottom-1.5 left-1/2 -translate-x-1/2"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}

      <AlertModal
        isOpen={modalConfig.isOpen}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmLabel={modalConfig.confirmLabel}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        isLight={isLight}
        isLoading={modalConfig.isLoading}
      />
    </div>
  );
}
