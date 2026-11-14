import React, { useState, useEffect, useRef } from "react";
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
  Loader2,
  Upload,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Image as ImageIcon,
  X,
  File,
  Download,
  AlertCircle,
  Building,
  Globe,
  Briefcase,
  Zap,
  CheckCircle2,
  ChevronRight,
  Wand2
} from "lucide-react";
import { api, messageOf } from "./ui/api";
import { TemplateAttachment, OutreachTemplate } from "./outreachTemplates";

export interface EmailTemplate {
  id: string;
  name: string;
  templateType: "email" | "whatsapp";
  subject: string;
  designMode: "builder" | "code";
  htmlCode: string;
  
  // Header / Branding
  useLogo: boolean;
  logoType: "text" | "image";
  logoValue: string;
  headerImage?: string;
  textAlign?: "left" | "center" | "right";
  
  // Message Body
  introText: string;
  useAiBody: boolean;
  customBodyText: string;
  
  // Call to Action
  useCta: boolean;
  ctaText: string;
  ctaUrl: string;
  ctaBgColor: string;
  
  // Signature / Contact
  useContact: boolean;
  contactText: string;
  
  // Footer / Compliance
  useFooter: boolean;
  footerText: string;
  
  // Attachments (PDFs, Docs, etc.)
  attachments?: TemplateAttachment[];
  
  createdAt: string;
}

interface BusinessProfileView {
  businessName?: string;
  website?: string;
  industry?: string;
  description?: string;
  targetAudience?: string;
  brandTone?: string;
  services?: string[];
  contactEmail?: string;
  senderName?: string;
  phone?: string;
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

const DYNAMIC_VARIABLES = [
  { tag: "{{company}}", label: "Company Name", sample: "Apex Solutions" },
  { tag: "{{name}}", label: "Contact / Owner Name", sample: "Sarah" },
  { tag: "{{city}}", label: "City", sample: "New York" },
  { tag: "{{category}}", label: "Industry Category", sample: "Digital Marketing" },
  { tag: "{{phone}}", label: "Lead Phone", sample: "+1 555-0199" },
  { tag: "{{website}}", label: "Lead Website", sample: "apexsolutions.com" },
];

const SUBJECT_SUGGESTIONS = [
  "Quick question regarding {{company}}",
  "Growth opportunity for {{company}} in {{city}}",
  "Complimentary performance audit for {{company}}",
  "{{category}} partnership inquiry: {{company}}",
  "Idea for {{company}}'s customer acquisition in {{city}}"
];

const STARTER_BODY_HOOKS = [
  {
    title: "Problem & Solution",
    badge: "High Converting",
    subject: "Quick question for {{company}} regarding customer growth in {{city}}",
    intro: "Hi {{name}},",
    body: "I came across {{company}} while reviewing leading {{category}} businesses in {{city}}.\n\nMany businesses in your space struggle with inconsistent high-intent leads and rising ad costs. We help teams like {{company}} automate local outreach and capture qualified clients directly.\n\nWe noticed a few quick opportunities where you could capture more market share this quarter."
  },
  {
    title: "Free Audit Offer",
    badge: "Low Resistance",
    subject: "Complimentary Performance & Visibility Audit for {{company}}",
    intro: "Hello {{name}},",
    body: "We recently analyzed search rankings and local visibility for {{category}} providers across {{city}}.\n\nWe compiled a 3-point performance breakdown specifically for {{company}}, highlighting 2 high-traffic search terms your competitors are winning right now.\n\nWould you like me to send over the 1-page summary?"
  },
  {
    title: "Direct Partnership",
    badge: "B2B Focus",
    subject: "{{company}} + partnership inquiry in {{city}}",
    intro: "Hi {{company}} team,",
    body: "I've been following {{company}}'s presence in {{city}} and wanted to reach out directly.\n\nWe recently partnered with several {{category}} teams to increase their qualified pipeline by over 40% in under 60 days.\n\nWould you be open to a 5-minute chat this week to explore if a collaboration makes sense?"
  }
];

const STARTER_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{company}} Outreach</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .email-container { max-width: 580px; margin: 24px auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
    .header { padding: 24px 32px 16px; border-bottom: 1px solid #f1f5f9; }
    .content { padding: 28px 32px; color: #334155; font-size: 14px; line-height: 1.65; }
    .cta-btn { display: inline-block; padding: 12px 24px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h2 style="margin: 0; color: #0f172a; font-size: 18px;">Special Invitation for {{company}}</h2>
    </div>
    <div class="content">
      <p>Hi {{name}},</p>
      <p>We noticed your listing in <strong>{{city}}</strong> and wanted to reach out regarding your current customer acquisition in {{category}}.</p>
      <p>We recently prepared a customized growth strategy specifically for {{company}} that shows where you can capture more local leads without increasing ad spend.</p>
      <a href="https://example.com" class="cta-btn">View Strategy & Book 10-Min Demo</a>
      <p style="margin-top: 24px; color: #64748b; font-size: 13px;">Best regards,<br>The Outreach Team</p>
    </div>
    <div class="footer">
      <p style="margin: 0;">You received this because {{company}} is listed publicly in {{city}}. Reply STOP to unsubscribe.</p>
    </div>
  </div>
</body>
</html>`;

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function EmailTemplates({ isLight, workspaceId }: EmailTemplatesProps) {
  const storageKey = `leadfinder_email_templates_v3:${workspaceId || "default"}`;
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [activeMode, setActiveMode] = useState<"builder" | "code">("builder");
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  // This panel is the Email channel only. WhatsApp templates live in the
  // component-based builder (MessageTemplatePanel), which the /app/templates
  // channel switcher renders instead of this one. The old in-panel
  // Email/WhatsApp tab pair duplicated that switcher, so it is gone.
  const [templateError, setTemplateError] = useState("");
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  
  // Business Profile integration
  const [businessProfile, setBusinessProfile] = useState<BusinessProfileView | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isAutoCreatingPack, setIsAutoCreatingPack] = useState(false);

  // File Upload Refs
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Alert Modal
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

  // Load Templates & Business Profile
  useEffect(() => {
    let alive = true;
    setIsLoadingTemplates(true);
    setTemplateError("");

    Promise.all([
      api.get<EmailTemplate[]>("/api/templates").catch((err) => {
        if (alive) setTemplateError(messageOf(err));
        return [] as EmailTemplate[];
      }),
      api.get<BusinessProfileView>("/api/business/profile").catch(() => null)
    ]).then(([templateRows, profileData]) => {
      if (alive) {
        setTemplates(templateRows || []);
        if (profileData) setBusinessProfile(profileData);
        setIsLoadingTemplates(false);
      }
    });

    return () => {
      alive = false;
    };
  }, [storageKey]);

  const upsertTemplate = (saved: EmailTemplate) => {
    setTemplates((current) => {
      const exists = current.some((t) => t.id === saved.id);
      return exists
        ? current.map((t) => (t.id === saved.id ? saved : t))
        : [saved, ...current];
    });
  };

  const handleCreateNew = () => {
    const defaultSender = businessProfile?.senderName || "Founder";
    const defaultBiz = businessProfile?.businessName || "";
    const defaultEmail = businessProfile?.contactEmail || "";
    const defaultPhone = businessProfile?.phone || "";
    const defaultWebsite = businessProfile?.website || "";

    const newTpl: EmailTemplate = {
      id: `tpl-${Date.now()}`,
      name: "New Email Outreach Template",
      templateType: "email",
      subject: "Quick question for {{company}}",
      designMode: "builder",
      htmlCode: STARTER_HTML_TEMPLATE,
      useLogo: Boolean(defaultBiz),
      logoType: "text",
      logoValue: defaultBiz || "/logo.png",
      textAlign: "left",
      introText: "Hi {{name}},",
      useAiBody: false,
      customBodyText: defaultBiz
        ? `I noticed {{company}} while researching leading {{category}} businesses in {{city}}.\n\nAt ${defaultBiz}, we specialize in helping companies like yours generate consistent high-intent inquiries and scale local market visibility.\n\nWe identified 2 key areas where {{company}} could quickly capture more inbound customers.`
        : "We noticed your listing in {{city}} and wanted to offer...",
      useCta: true,
      ctaText: "Schedule a 10-Min Strategy Call",
      ctaUrl: defaultWebsite || "https://example.com",
      ctaBgColor: "#4f46e5",
      useContact: Boolean(defaultEmail || defaultPhone),
      contactText: `Best regards,\n${defaultSender}\n${defaultEmail}${defaultPhone ? ` | ${defaultPhone}` : ""}`,
      useFooter: true,
      footerText: "You are receiving this because {{company}} is publicly listed in {{city}}. Reply STOP to unsubscribe.",
      attachments: [],
      createdAt: new Date().toISOString()
    };
    setSelectedTemplate(newTpl);
    setActiveMode("builder");
    setIsEditing(true);
  };

  // 1-Click Auto-Create High-Converting Templates from Business Profile
  const handleAutoCreateFromProfile = async () => {
    setIsAutoCreatingPack(true);
    setTemplateError("");
    try {
      const bizName = businessProfile?.businessName || "Our Company";
      const bizDesc = businessProfile?.description || "drive consistent qualified inquiries and outperform local competitors";
      const bizSender = businessProfile?.senderName || "Outreach Director";
      const bizEmail = businessProfile?.contactEmail || "";
      const bizPhone = businessProfile?.phone || "";
      const bizWebsite = businessProfile?.website || "https://example.com";

      const pack: Omit<EmailTemplate, "id" | "createdAt">[] = [
        {
          name: `${bizName} - Problem & Solution Pitch`,
          templateType: "email",
          subject: "Quick question for {{company}} regarding customer growth in {{city}}",
          designMode: "builder",
          htmlCode: "",
          useLogo: true,
          logoType: "text",
          logoValue: bizName,
          textAlign: "left",
          introText: "Hi {{name}},",
          useAiBody: false,
          customBodyText: `I came across {{company}} while reviewing leading {{category}} businesses in {{city}}.\n\nAt ${bizName}, we help businesses like yours ${bizDesc}.\n\nWe identified 2 key areas where {{company}} could quickly capture more inbound customers this month.`,
          useCta: true,
          ctaText: "Schedule a 10-Min Strategy Call",
          ctaUrl: bizWebsite,
          ctaBgColor: "#4f46e5",
          useContact: true,
          contactText: `Best regards,\n${bizSender}\n${bizEmail}${bizPhone ? ` | ${bizPhone}` : ""}`,
          useFooter: true,
          footerText: "You received this because {{company}} is publicly listed in {{city}}. Reply STOP to unsubscribe.",
          attachments: []
        },
        {
          name: `${bizName} - Complimentary Growth Audit`,
          templateType: "email",
          subject: "Complimentary Performance & Visibility Audit for {{company}}",
          designMode: "builder",
          htmlCode: "",
          useLogo: true,
          logoType: "text",
          logoValue: bizName,
          textAlign: "left",
          introText: "Hello {{name}},",
          useAiBody: false,
          customBodyText: `We recently analyzed local search rankings for {{category}} in {{city}} and compiled a 3-point performance audit specifically for {{company}}.\n\nThere are 2 high-traffic search terms your top competitors are capturing right now that could easily be directed to your website.\n\nWould you like me to send over the free 1-page breakdown?`,
          useCta: true,
          ctaText: "Claim Your Free Audit",
          ctaUrl: bizWebsite,
          ctaBgColor: "#059669",
          useContact: true,
          contactText: `Best regards,\n${bizSender}\n${bizEmail}`,
          useFooter: true,
          footerText: "Reply STOP to opt out.",
          attachments: []
        },
        // The WhatsApp starter that used to be in this pack is gone: this panel
        // is email-only now, so it would have created a template the list then
        // filtered out. WhatsApp starters come from the component-based builder.
      ];

      const createdList: EmailTemplate[] = [];
      for (const item of pack) {
        const res = await api.post<EmailTemplate>("/api/templates", { template: item });
        createdList.push(res);
      }

      setTemplates((prev) => [...createdList, ...prev]);
      setModalConfig({
        isOpen: true,
        type: "success",
        title: "Templates Auto-Created Successfully",
        message: `Created ${createdList.length} high-converting email templates customized for ${bizName}. You can now use them or customize them anytime.`,
        confirmLabel: "Awesome",
        onConfirm: () => setModalConfig((p) => ({ ...p, isOpen: false }))
      });
    } catch (err) {
      setTemplateError(messageOf(err));
    } finally {
      setIsAutoCreatingPack(false);
    }
  };

  // Populate active template with business profile details
  const handlePopulateFromProfile = () => {
    if (!selectedTemplate || !businessProfile) return;
    const bizName = businessProfile.businessName || "";
    const bizSender = businessProfile.senderName || "Founder";
    const bizEmail = businessProfile.contactEmail || "";
    const bizPhone = businessProfile.phone || "";
    const bizWebsite = businessProfile.website || "";
    const bizDesc = businessProfile.description || "scale qualified inquiries and dominate local presence";

    setSelectedTemplate({
      ...selectedTemplate,
      useLogo: Boolean(bizName),
      logoValue: bizName || selectedTemplate.logoValue,
      customBodyText: selectedTemplate.customBodyText || `At ${bizName || "our firm"}, we help {{category}} companies like {{company}} in {{city}} ${bizDesc}.`,
      ctaUrl: bizWebsite || selectedTemplate.ctaUrl,
      useContact: true,
      contactText: `Best regards,\n${bizSender}\n${bizEmail}${bizPhone ? ` | ${bizPhone}` : ""}`,
    });
  };

  // Insert Variable Tag into Active or Focused Field
  const handleInsertTag = (tag: string) => {
    if (!selectedTemplate) return;
    if (activeMode === "code") {
      setSelectedTemplate({
        ...selectedTemplate,
        htmlCode: selectedTemplate.htmlCode ? `${selectedTemplate.htmlCode} ${tag}` : tag
      });
      return;
    }

    // Default to appending to body or subject
    if (activeInputRef.current) {
      const el = activeInputRef.current;
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const val = el.value;
      const next = val.substring(0, start) + tag + val.substring(end);
      el.value = next;
      if (el.name === "subject") {
        setSelectedTemplate({ ...selectedTemplate, subject: next });
      } else if (el.name === "customBodyText") {
        setSelectedTemplate({ ...selectedTemplate, customBodyText: next });
      } else if (el.name === "introText") {
        setSelectedTemplate({ ...selectedTemplate, introText: next });
      }
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    } else {
      setSelectedTemplate({
        ...selectedTemplate,
        customBodyText: selectedTemplate.customBodyText ? `${selectedTemplate.customBodyText} ${tag}` : tag
      });
    }
  };

  // Image Upload Handler
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setTemplateError("Please select a valid image file (PNG, JPG, SVG, WebP).");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setTemplateError("Logo image size must be under 3MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl && selectedTemplate) {
        setSelectedTemplate({
          ...selectedTemplate,
          useLogo: true,
          logoType: "image",
          logoValue: dataUrl,
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Document Attachment Upload Handler (PDF, Word, Excel, etc.)
  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedTemplate) return;

    const currentAttachments = selectedTemplate.attachments || [];
    if (currentAttachments.length >= 8) {
      setTemplateError("Maximum 8 attachments allowed per template.");
      return;
    }

    const fileList = Array.from(files) as File[];
    let processed = 0;
    const newAttachments: TemplateAttachment[] = [];

    fileList.forEach((file: File) => {
      if (file.size > 10 * 1024 * 1024) {
        setTemplateError(`File "${file.name}" exceeds the 10MB limit.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        newAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          dataUrl
        });
        processed++;
        if (processed === fileList.length) {
          setSelectedTemplate({
            ...selectedTemplate,
            attachments: [...currentAttachments, ...newAttachments]
          });
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const handleRemoveAttachment = (id: string) => {
    if (!selectedTemplate) return;
    setSelectedTemplate({
      ...selectedTemplate,
      attachments: (selectedTemplate.attachments || []).filter((a) => a.id !== id)
    });
  };

  // Save Template
  const handleSave = async () => {
    if (!selectedTemplate) return;
    setSaveStatus("saving");
    setTemplateError("");

    const payload = {
      ...selectedTemplate,
      designMode: activeMode,
      htmlCode: activeMode === "code" ? selectedTemplate.htmlCode : (selectedTemplate.htmlCode || ""),
      attachments: selectedTemplate.attachments || []
    };

    const exists = templates.some((t) => t.id === selectedTemplate.id);
    try {
      const saved = exists
        ? await api.put<EmailTemplate>(`/api/templates/${selectedTemplate.id}`, { template: payload })
        : await api.post<EmailTemplate>("/api/templates", { template: payload });

      upsertTemplate(saved);
      setSelectedTemplate(saved);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      setModalConfig({
        isOpen: true,
        type: "success",
        title: "Template Saved Successfully",
        message: `"${saved.name}" has been saved and is ready for use in campaigns and outreach.`,
        confirmLabel: "Done",
        onConfirm: () => setModalConfig((p) => ({ ...p, isOpen: false }))
      });
    } catch (err) {
      setSaveStatus("idle");
      setTemplateError(messageOf(err));
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalConfig({
      isOpen: true,
      type: "danger",
      title: "Delete Outreach Template",
      message: "Are you sure you want to delete this template? This action cannot be undone.",
      confirmLabel: "Delete Template",
      onConfirm: async () => {
        setModalConfig((p) => ({ ...p, isLoading: true }));
        try {
          await api.del(`/api/templates/${id}`);
          setTemplates((cur) => cur.filter((t) => t.id !== id));
          if (selectedTemplate?.id === id) {
            setSelectedTemplate(null);
            setIsEditing(false);
          }
          setModalConfig((p) => ({ ...p, isOpen: false, isLoading: false }));
        } catch (err) {
          setTemplateError(messageOf(err));
          setModalConfig((p) => ({ ...p, isOpen: false, isLoading: false }));
        }
      }
    });
  };

  const handleDuplicate = async (tpl: EmailTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const cloned = await api.post<EmailTemplate>("/api/templates", {
        template: { ...tpl, name: `${tpl.name} (Copy)` }
      });
      upsertTemplate(cloned);
    } catch (err) {
      setTemplateError(messageOf(err));
    }
  };

  // WhatsApp Compiler
  const generateWhatsappText = (tpl: EmailTemplate): string => {
    const parts: string[] = [];
    if (tpl.introText.trim()) parts.push(tpl.introText.trim());
    if (tpl.useAiBody) {
      parts.push("[🤖 AI Personalization: A tailored pitch based on lead's reviews and category will be injected during campaign dispatch.]");
    } else if (tpl.customBodyText.trim()) {
      parts.push(tpl.customBodyText.trim());
    }
    if (tpl.useCta && tpl.ctaText.trim()) {
      parts.push(`${tpl.ctaText.trim()}${tpl.ctaUrl ? " " + tpl.ctaUrl : ""}`);
    }
    if (tpl.useContact && tpl.contactText.trim()) {
      parts.push(tpl.contactText.trim());
    }
    if (tpl.useFooter && tpl.footerText.trim()) {
      parts.push(tpl.footerText.trim());
    }
    return parts.join("\n\n").trim();
  };

  // Modern HTML Email Compiler
  const generateHtml = (tpl: EmailTemplate): string => {
    const align = tpl.textAlign || "left";
    const textAlignCss = `text-align: ${align};`;
    const marginCss = align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";

    let logoHtml = "";
    if (tpl.useLogo) {
      const logoSrc = tpl.logoValue && tpl.logoValue.trim() ? tpl.logoValue.trim() : "/logo.png";
      if (tpl.logoType === "image" || logoSrc.startsWith("data:") || logoSrc.startsWith("http") || logoSrc.startsWith("/")) {
        logoHtml = `
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 20px;">
            <tr>
              <td align="${align}">
                <img src="${logoSrc}" alt="Logo" style="max-height: 48px; height: auto; max-width: 220px; object-fit: contain; margin: ${marginCss}; display: inline-block; border: 0;" />
              </td>
            </tr>
          </table>`;
      } else {
        logoHtml = `
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 20px;">
            <tr>
              <td align="${align}">
                <span style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; font-family: 'Inter', sans-serif;">${logoSrc}</span>
              </td>
            </tr>
          </table>`;
      }
    }

    let greetingHtml = "";
    if (tpl.introText.trim()) {
      greetingHtml = `
        <div style="font-size: 15px; color: #1e293b; font-weight: 600; margin-bottom: 16px; ${textAlignCss}">
          ${tpl.introText.replace(/\n/g, "<br/>")}
        </div>`;
    }

    let bodyHtml = "";
    if (tpl.useAiBody) {
      bodyHtml = `
        <div style="padding: 16px 20px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px; ${textAlignCss}">
          <div style="font-weight: 600; color: #4f46e5; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">✨ AI Dynamic Body (Tailored per lead during send)</div>
          ${tpl.customBodyText.trim() ? tpl.customBodyText.replace(/\n/g, "<br/>") : "Our AI engine will analyze {{company}}'s digital presence, category, and city to write a completely tailored pitch."}
        </div>`;
    } else if (tpl.customBodyText.trim()) {
      bodyHtml = `
        <div style="font-size: 14px; color: #334155; line-height: 1.68; margin-bottom: 20px; white-space: pre-line; ${textAlignCss}">
          ${tpl.customBodyText}
        </div>`;
    }

    let ctaHtml = "";
    if (tpl.useCta && tpl.ctaText.trim()) {
      ctaHtml = `
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 26px 0;">
          <tr>
            <td align="${align}">
              <table border="0" cellpadding="0" cellspacing="0" style="margin: ${marginCss};">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: ${tpl.ctaBgColor || "#4f46e5"};">
                    <a href="${tpl.ctaUrl || "#"}" target="_blank" style="display: inline-block; padding: 12px 26px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px; font-family: 'Inter', sans-serif;">
                      ${tpl.ctaText}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`;
    }

    let attachmentsHtml = "";
    if (tpl.attachments && tpl.attachments.length > 0) {
      const attPills = tpl.attachments.map((a) => `
        <span style="display: inline-block; padding: 6px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11.5px; color: #334155; margin: 4px 6px 4px 0;">
          📎 <strong>${a.name}</strong> <span style="color: #64748b;">(${formatFileSize(a.size)})</span>
        </span>
      `).join("");
      attachmentsHtml = `
        <div style="margin: 24px 0 16px; padding: 14px 18px; background-color: #fafbfc; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">Attached Documents (${tpl.attachments.length})</div>
          <div>${attPills}</div>
        </div>`;
    }

    let contactHtml = "";
    if (tpl.useContact && tpl.contactText.trim()) {
      contactHtml = `
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12.5px; color: #64748b; line-height: 1.6; white-space: pre-line; ${textAlignCss}">
          ${tpl.contactText}
        </div>`;
    }

    let footerHtml = "";
    if (tpl.useFooter && tpl.footerText.trim()) {
      footerHtml = `
        <div style="margin-top: 16px; font-size: 11px; color: #94a3b8; line-height: 1.5; white-space: pre-line; ${textAlignCss}">
          ${tpl.footerText}
        </div>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tpl.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 28px 16px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding: 28px 32px;">
              ${logoHtml}
              ${greetingHtml}
              ${bodyHtml}
              ${ctaHtml}
              ${attachmentsHtml}
              ${contactHtml}
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  };

  const handleCopyCode = () => {
    if (!selectedTemplate) return;
    const text = selectedTemplate.templateType === "email"
      ? (activeMode === "code" ? selectedTemplate.htmlCode : generateHtml(selectedTemplate))
      : (activeMode === "code" ? selectedTemplate.htmlCode : generateWhatsappText(selectedTemplate));

    navigator.clipboard.writeText(text);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  const previewHtml = selectedTemplate && selectedTemplate.templateType === "email"
    ? (activeMode === "code" ? selectedTemplate.htmlCode : generateHtml(selectedTemplate))
    : "";

  const previewWhatsappText = selectedTemplate && selectedTemplate.templateType === "whatsapp"
    ? (activeMode === "code" ? selectedTemplate.htmlCode : generateWhatsappText(selectedTemplate))
    : "";

  const highlightVariables = (text: string) => {
    if (!text) return "";
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, idx) => {
      if (part.startsWith("{{") && part.endsWith("}}")) {
        return (
          <strong key={idx} className="bg-indigo-150/90 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded font-mono font-bold text-[10px] border border-indigo-250/20 inline-block mx-0.5">
            {part}
          </strong>
        );
      }
      return part;
    });
  };

  const filteredTemplates = templates.filter((t) => t.templateType === "email");

  return (
    <div className="space-y-6">
      {/* ── VIEW 1: TEMPLATE CARDS DASHBOARD GRID ── */}
      {!isEditing ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Business Profile Status Banner */}
          <div className={`p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
            isLight ? "bg-gradient-to-r from-indigo-50/70 via-white to-indigo-50/40 border-indigo-100" : "bg-gradient-to-r from-indigo-950/20 via-[#090d16] to-indigo-950/10 border-indigo-900/30"
          }`}>
            <div className="flex items-start md:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Building className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    {businessProfile?.businessName ? businessProfile.businessName : "Business Profile"}
                  </span>
                  <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full ${
                    businessProfile?.businessName 
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" 
                      : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  }`}>
                    {businessProfile?.businessName ? "Profile Linked" : "Setup Recommended"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {businessProfile?.businessName
                    ? `${businessProfile.industry || "General Business"} • ${businessProfile.services?.length || 0} services configured. 1-click tailored templates ready.`
                    : "Add your business info in Business Settings to auto-generate personalized outreach templates."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleAutoCreateFromProfile}
                disabled={isAutoCreatingPack}
                className="btn-interactive px-3.5 py-2 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 cursor-pointer transition-all"
                title="Automatically creates high-converting email templates based on your business profile"
              >
                {isAutoCreatingPack ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                <span>{isAutoCreatingPack ? "Synthesizing..." : "Auto-Generate Templates"}</span>
              </button>
            </div>
          </div>

          {templateError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 flex items-center justify-between">
              <span>{templateError}</span>
              <button onClick={() => setTemplateError("")} className="text-rose-500 hover:text-rose-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Tab Selector & New Template Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 dark:border-slate-800/60 pb-3">
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                isLight
                  ? "bg-slate-100/80 border-slate-200/80 text-slate-700"
                  : "bg-black/30 border-[#1e293b] text-slate-300"
              }`}
            >
              <Mail className="h-3.5 w-3.5 text-indigo-500" />
              <span>Email Templates</span>
              <span
                className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold tabular-nums ${
                  isLight ? "bg-slate-200 text-slate-700" : "bg-slate-800 text-slate-300"
                }`}
              >
                {filteredTemplates.length}
              </span>
            </div>

            <button
              onClick={handleCreateNew}
              className="btn-interactive px-3.5 py-1.5 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition-all bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Create New Email Template</span>
            </button>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoadingTemplates && (
              <div className={`col-span-full rounded-2xl border p-12 text-center text-xs ${
                isLight ? "border-slate-200 bg-white text-slate-500" : "border-[#1e293b] bg-[#090d16] text-slate-400"
              }`}>
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-indigo-500" />
                Loading templates…
              </div>
            )}

            {!isLoadingTemplates && filteredTemplates.length === 0 && (
              <div className={`col-span-full rounded-2xl border border-dashed p-10 text-center ${
                isLight ? "border-indigo-200/90 bg-indigo-50/20" : "border-indigo-500/20 bg-indigo-500/5"
              }`}>
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-3 text-indigo-500">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  No email templates yet
                </div>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                  Click <strong>Auto-Generate Templates</strong> to create a ready-to-use template pack from your business details, or create one manually with custom hooks and attachments.
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    onClick={handleAutoCreateFromProfile}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                  >
                    ✨ Auto-Generate Templates Pack
                  </button>
                  <button
                    onClick={handleCreateNew}
                    className={`px-4 py-2 border rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isLight ? "border-slate-300 hover:bg-slate-100 text-slate-700" : "border-slate-700 hover:bg-slate-800 text-slate-300"
                    }`}
                  >
                    + Create Blank
                  </button>
                </div>
              </div>
            )}

            {filteredTemplates.map((tpl) => {
              const attCount = tpl.attachments?.length || 0;
              return (
                <div
                  key={tpl.id}
                  className={`border rounded-2xl p-4 flex flex-col justify-between h-48 transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-pointer group ${
                    isLight 
                      ? "bg-white border-slate-200 hover:border-indigo-300" 
                      : "bg-[#090d16] border-[#1e293b] hover:border-indigo-500/40"
                  }`}
                  onClick={() => {
                    setSelectedTemplate(tpl);
                    setActiveMode(tpl.designMode || "builder");
                    setIsEditing(true);
                  }}
                >
                  <div className="space-y-2.5 flex-grow min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`p-2 rounded-xl shrink-0 ${
                          tpl.templateType === "email"
                            ? (isLight ? "bg-indigo-50 text-indigo-600" : "bg-indigo-950/40 text-indigo-400")
                            : (isLight ? "bg-emerald-50 text-emerald-600" : "bg-emerald-950/40 text-emerald-400")
                        }`}>
                          {tpl.templateType === "email" ? <Mail className="h-4 w-4" /> : <WhatsAppLogo className="h-4 w-4 fill-emerald-500" />}
                        </div>
                        <h4 className={`text-xs font-bold leading-tight truncate ${isLight ? "text-slate-900" : "text-white"}`}>
                          {tpl.name}
                        </h4>
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase shrink-0 ${
                        tpl.designMode === "code"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                          : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                      }`}>
                        {tpl.designMode === "code" ? "Custom HTML" : "Visual"}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {tpl.templateType === "email" ? (
                        <div className="text-[11px] text-slate-500 truncate">
                          <span className="font-semibold text-slate-400">Subject:</span> {tpl.subject || "(No Subject)"}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 line-clamp-2 italic leading-relaxed">
                          {tpl.introText || tpl.customBodyText || "No text preview defined..."}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {tpl.useLogo && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${isLight ? "bg-slate-100 text-slate-600" : "bg-slate-900 text-slate-400"}`}>
                            Logo
                          </span>
                        )}
                        {tpl.useCta && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${isLight ? "bg-slate-100 text-slate-600" : "bg-slate-900 text-slate-400"}`}>
                            CTA Button
                          </span>
                        )}
                        {attCount > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                            <Paperclip className="h-2.5 w-2.5" />
                            {attCount} {attCount === 1 ? "file" : "files"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`pt-2.5 border-t flex items-center justify-between text-[11px] ${
                    isLight ? "border-slate-100" : "border-[#1e293b]/60"
                  }`}>
                    <span className="text-slate-400 flex items-center gap-1 text-[10px]">
                      <Clock className="h-3 w-3" />
                      {new Date(tpl.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleDuplicate(tpl, e)}
                        className={`p-1.5 rounded-lg border hover:scale-105 transition-all cursor-pointer ${
                          isLight 
                            ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-500" 
                            : "border-slate-800 bg-[#0c111d] hover:bg-slate-800 text-slate-400"
                        }`}
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(tpl.id, e)}
                        className={`p-1.5 rounded-lg border hover:scale-105 hover:text-rose-500 hover:border-rose-500/30 transition-all cursor-pointer ${
                          isLight 
                            ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-500" 
                            : "border-slate-800 bg-[#0c111d] hover:bg-slate-800 text-slate-400"
                        }`}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedTemplate(tpl);
                          setActiveMode(tpl.designMode || "builder");
                          setIsEditing(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all cursor-pointer shadow-xs"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Create Blank Card */}
            <div
              onClick={handleCreateNew}
              className={`border border-dashed rounded-2xl flex flex-col items-center justify-center h-48 transition-all hover:border-indigo-500/60 cursor-pointer group ${
                isLight ? "bg-slate-50/40 border-slate-300" : "bg-slate-900/10 border-slate-800"
              }`}
            >
              <div className={`p-3 rounded-2xl mb-2 transition-all group-hover:scale-110 ${
                isLight ? "bg-slate-100 text-slate-600" : "bg-slate-800/50 text-slate-300"
              }`}>
                <PlusCircle className="h-5 w-5" />
              </div>
              <span className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-slate-200"}`}>
                Create Blank Template
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5">
                Design custom email or paste HTML code
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ── VIEW 2: SIMPLIFIED TEMPLATE EDITOR WORKSPACE ── */
        <div className="space-y-5 animate-fadeIn">
          {/* Top Bar: Back, Name, Channel, Mode Toggle, Save */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setIsEditing(false)}
                className={`px-3 py-1.5 border rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                  isLight 
                    ? "border-slate-200 hover:bg-slate-50 text-slate-600" 
                    : "border-[#1e293b] hover:bg-slate-800 text-slate-300"
                }`}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>

              <div className="min-w-0 flex items-center gap-2">
                <input
                  type="text"
                  value={selectedTemplate?.name || ""}
                  onChange={(e) => selectedTemplate && setSelectedTemplate({ ...selectedTemplate, name: e.target.value })}
                  placeholder="Template Name..."
                  className={`text-sm font-bold bg-transparent outline-none border-b border-transparent focus:border-indigo-500 px-1 py-0.5 transition-colors max-w-[280px] md:max-w-[360px] truncate ${
                    isLight ? "text-slate-900" : "text-white"
                  }`}
                />
                <span className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                  selectedTemplate?.templateType === "email"
                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }`}>
                  {selectedTemplate?.templateType === "email" ? "Email" : "WhatsApp"}
                </span>
              </div>
            </div>

            {/* Actions: Visual Builder / Custom HTML Toggle, Copy, Save */}
            <div className="flex items-center gap-2 shrink-0">
              {selectedTemplate?.templateType === "email" && (
                <div className={`p-0.5 rounded-xl border flex items-center ${
                  isLight ? "bg-slate-100 border-slate-200" : "bg-black/30 border-slate-800"
                }`}>
                  <button
                    onClick={() => setActiveMode("builder")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeMode === "builder"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <LayoutIcon className="h-3 w-3" />
                    <span>Visual Builder</span>
                  </button>
                  <button
                    onClick={() => setActiveMode("code")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeMode === "code"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : isLight ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Code className="h-3 w-3" />
                    <span>Custom HTML Code</span>
                  </button>
                </div>
              )}

              <button
                onClick={handleCopyCode}
                className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isLight 
                    ? "border-slate-200 hover:bg-slate-50 text-slate-600" 
                    : "border-[#1e293b] hover:bg-slate-800 text-slate-300"
                }`}
                title="Copy code or outreach text"
              >
                {copiedNotification ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{copiedNotification ? "Copied!" : "Copy"}</span>
              </button>

              <button
                onClick={handleSave}
                disabled={saveStatus === "saving"}
                className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm cursor-pointer transition-all disabled:opacity-50"
              >
                {saveStatus === "saving" ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : saveStatus === "saved" ? (
                  <Check className="h-3.5 w-3.5 text-white" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>{saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save Template"}</span>
              </button>
            </div>
          </div>

          {templateError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700 flex items-center justify-between">
              <span>{templateError}</span>
              <button onClick={() => setTemplateError("")} className="text-rose-500 hover:text-rose-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Quick Dynamic Variable Tag Bar */}
          <div className={`p-3 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-2.5 ${
            isLight ? "bg-white border-slate-200/90" : "bg-[#090d16] border-[#1e293b]"
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                Insert Lead Variables:
              </span>
              <span className="text-[10px] text-slate-500 hidden lg:inline">
                (Click any variable to insert)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {DYNAMIC_VARIABLES.map((v) => (
                <button
                  key={v.tag}
                  type="button"
                  onClick={() => handleInsertTag(v.tag)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer border hover:scale-105 active:scale-95 ${
                    isLight 
                      ? "bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 border-slate-200" 
                      : "bg-slate-900/60 hover:bg-indigo-950/60 hover:border-indigo-500/40 text-slate-300 border-slate-800"
                  }`}
                  title={`${v.label} (e.g. ${v.sample})`}
                >
                  + {v.tag}
                </button>
              ))}

              {businessProfile?.businessName && (
                <button
                  type="button"
                  onClick={handlePopulateFromProfile}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-indigo-500 hover:text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/10 transition-all cursor-pointer flex items-center gap-1 ml-1"
                  title="Auto-fill with company name, sender, services and website from business profile"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Use Business Info</span>
                </button>
              )}
            </div>
          </div>

          {/* Split Work Area: Left Form/Code Editor - Right Live Preview */}
          {selectedTemplate && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Left Column: Form or Code */}
              <div className={`border rounded-2xl p-5 space-y-5 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                {activeMode === "builder" ? (
                  /* ── VISUAL BUILDER MODE ── */
                  <div className="space-y-5">
                    {/* 1. Subject Line (Email Only) with Quick Suggestions */}
                    {selectedTemplate.templateType === "email" && (
                      <div className="space-y-2">
                        <label className="text-xs font-bold flex items-center justify-between text-slate-700 dark:text-slate-200">
                          <span className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-indigo-500" />
                            Email Campaign Subject Line
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal">Supports dynamic tags</span>
                        </label>
                        <input
                          ref={(el) => { if (el) el.name = "subject"; }}
                          onFocus={(e) => { activeInputRef.current = e.target; }}
                          type="text"
                          value={selectedTemplate.subject}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, subject: e.target.value })}
                          placeholder="e.g. Quick question regarding {{company}} in {{city}}"
                          className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium transition-all focus:border-indigo-500 ${
                            isLight ? "bg-slate-50/50 border-slate-200 text-slate-900" : "bg-slate-950/60 border-slate-800 text-slate-100"
                          }`}
                        />

                        {/* Subject Suggestions */}
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <span className="text-[9.5px] font-bold text-slate-400 mr-1">Suggestions:</span>
                          {SUBJECT_SUGGESTIONS.map((subj, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setSelectedTemplate({ ...selectedTemplate, subject: subj })}
                              className={`text-[9.5px] px-2 py-0.5 rounded-md border transition-all cursor-pointer truncate max-w-[220px] ${
                                isLight 
                                  ? "bg-slate-100 hover:bg-indigo-50 hover:border-indigo-200 text-slate-600" 
                                  : "bg-slate-900/60 hover:bg-slate-850 hover:border-slate-700 text-slate-400"
                              }`}
                              title={subj}
                            >
                              {subj}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 2. Brand Header / Logo Section (Email only) */}
                    {selectedTemplate.templateType === "email" && (
                      <div className={`p-4 rounded-xl border space-y-3 ${
                        isLight ? "bg-slate-50/60 border-slate-200/80" : "bg-slate-950/40 border-slate-800/80"
                      }`}>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedTemplate.useLogo}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useLogo: e.target.checked })}
                              className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                            />
                            <span>Include Brand Header / Logo</span>
                          </label>

                          {selectedTemplate.useLogo && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedTemplate({ ...selectedTemplate, textAlign: "left" })}
                                className={`p-1 rounded-md border ${
                                  (selectedTemplate.textAlign || "left") === "left"
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : isLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400"
                                }`}
                                title="Align Left"
                              >
                                <AlignLeft className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedTemplate({ ...selectedTemplate, textAlign: "center" })}
                                className={`p-1 rounded-md border ${
                                  selectedTemplate.textAlign === "center"
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : isLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400"
                                }`}
                                title="Align Center"
                              >
                                <AlignCenter className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedTemplate({ ...selectedTemplate, textAlign: "right" })}
                                className={`p-1 rounded-md border ${
                                  selectedTemplate.textAlign === "right"
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : isLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400"
                                }`}
                                title="Align Right"
                              >
                                <AlignRight className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {selectedTemplate.useLogo && (
                          <div className="space-y-3 pt-1">
                            <input
                              type="file"
                              ref={logoFileInputRef}
                              accept="image/png,image/jpeg,image/svg+xml,image/webp"
                              onChange={handleLogoUpload}
                              className="hidden"
                            />

                            {selectedTemplate.logoValue && (selectedTemplate.logoValue.startsWith("data:") || selectedTemplate.logoValue.startsWith("http") || selectedTemplate.logoValue.startsWith("/")) ? (
                              <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                                isLight ? "bg-white border-slate-200" : "bg-slate-900 border-slate-800"
                              }`}>
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`h-12 w-20 rounded-lg border flex items-center justify-center p-1 shrink-0 overflow-hidden ${
                                    isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950 border-slate-800"
                                  }`}>
                                    <img
                                      src={selectedTemplate.logoValue}
                                      alt="Logo preview"
                                      className="max-h-full max-w-full object-contain"
                                      onError={(e) => {
                                        (e.target as HTMLElement).style.display = "none";
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                      {selectedTemplate.logoValue.startsWith("data:") ? "Uploaded Image Ready" : selectedTemplate.logoValue}
                                    </div>
                                    <div className="text-[10px] text-slate-400">Brand Header Image</div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => logoFileInputRef.current?.click()}
                                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 cursor-pointer flex items-center gap-1"
                                  >
                                    <Upload className="h-3 w-3" />
                                    <span>Replace</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTemplate({ ...selectedTemplate, logoValue: "" })}
                                    className="p-1 text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer"
                                    title="Remove"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div
                                  onClick={() => logoFileInputRef.current?.click()}
                                  className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all hover:border-indigo-500 ${
                                    isLight ? "border-slate-300 bg-white hover:bg-indigo-50/20" : "border-slate-800 bg-slate-900/40 hover:bg-indigo-950/20"
                                  }`}
                                >
                                  <Upload className="h-4 w-4 text-indigo-500 mx-auto mb-1" />
                                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Upload Image</div>
                                  <div className="text-[9.5px] text-slate-400">PNG, JPG, SVG up to 3MB</div>
                                </div>

                                <div className="space-y-1">
                                  <input
                                    type="text"
                                    value={selectedTemplate.logoValue}
                                    onChange={(e) => setSelectedTemplate({ ...selectedTemplate, logoValue: e.target.value })}
                                    placeholder="Or Image URL / Business Name"
                                    className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium h-full ${
                                      isLight ? "bg-white border-slate-200 text-slate-800" : "bg-slate-900 border-slate-800 text-slate-200"
                                    }`}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 3. Greeting / Opening Hook */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          Opening Greeting Hook
                        </label>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedTemplate({ ...selectedTemplate, introText: "Hi {{name}}," })}
                            className="text-[9.5px] text-indigo-500 hover:underline cursor-pointer"
                          >
                            "Hi &#123;&#123;name&#125;&#125;,"
                          </button>
                          <span className="text-slate-400 text-[10px]">•</span>
                          <button
                            type="button"
                            onClick={() => setSelectedTemplate({ ...selectedTemplate, introText: "Hi {{company}} team," })}
                            className="text-[9.5px] text-indigo-500 hover:underline cursor-pointer"
                          >
                            "Hi &#123;&#123;company&#125;&#125; team,"
                          </button>
                        </div>
                      </div>
                      <input
                        ref={(el) => { if (el) el.name = "introText"; }}
                        onFocus={(e) => { activeInputRef.current = e.target; }}
                        type="text"
                        value={selectedTemplate.introText}
                        onChange={(e) => setSelectedTemplate({ ...selectedTemplate, introText: e.target.value })}
                        placeholder="Hi {{name}},"
                        className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium ${
                          isLight ? "bg-slate-50/50 border-slate-200 text-slate-900" : "bg-slate-950/60 border-slate-800 text-slate-100"
                        }`}
                      />
                    </div>

                    {/* 4. Message Body with Starter Hooks */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                          <FileText className="h-3.5 w-3.5 text-indigo-500" />
                          Message Outreach Body
                        </label>

                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer text-slate-500">
                            <input
                              type="checkbox"
                              checked={selectedTemplate.useAiBody}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useAiBody: e.target.checked })}
                              className="rounded text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                            />
                            <span>AI Dynamic Pitch per lead</span>
                          </label>
                        </div>
                      </div>

                      {/* Quick Content Starters */}
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        <span className="text-[9.5px] font-bold text-slate-400 shrink-0">Starters:</span>
                        {STARTER_BODY_HOOKS.map((hook, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSelectedTemplate({
                                ...selectedTemplate,
                                subject: hook.subject,
                                introText: hook.intro,
                                customBodyText: hook.body
                              });
                            }}
                            className={`text-[9.5px] px-2.5 py-1 rounded-lg border font-medium shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
                              isLight 
                                ? "bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 border-slate-200" 
                                : "bg-slate-900/60 hover:bg-indigo-950/50 hover:border-indigo-500/30 text-slate-300 border-slate-800"
                            }`}
                          >
                            <Sparkles className="h-2.5 w-2.5 text-indigo-500" />
                            <span>{hook.title}</span>
                          </button>
                        ))}
                      </div>

                      <textarea
                        ref={(el) => { if (el) el.name = "customBodyText"; }}
                        onFocus={(e) => { activeInputRef.current = e.target; }}
                        value={selectedTemplate.customBodyText}
                        onChange={(e) => setSelectedTemplate({ ...selectedTemplate, customBodyText: e.target.value })}
                        placeholder="Write your value pitch here... e.g. We noticed your listing in {{city}} and wanted to share 2 key insights..."
                        rows={5}
                        className={`w-full p-3 text-xs rounded-xl border outline-none resize-y leading-relaxed font-sans ${
                          isLight ? "bg-slate-50/50 border-slate-200 text-slate-900" : "bg-slate-950/60 border-slate-800 text-slate-100"
                        }`}
                      />
                    </div>

                    {/* 5. Call to Action (CTA) Button */}
                    <div className={`p-4 rounded-xl border space-y-3 ${
                      isLight ? "bg-slate-50/60 border-slate-200/80" : "bg-slate-950/40 border-slate-800/80"
                    }`}>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedTemplate.useCta}
                            onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useCta: e.target.checked })}
                            className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                          />
                          <span>{selectedTemplate.templateType === "email" ? "Add Call-to-Action (CTA) Button" : "Add CTA Link"}</span>
                        </label>
                      </div>

                      {selectedTemplate.useCta && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Button Text</label>
                            <input
                              type="text"
                              value={selectedTemplate.ctaText}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, ctaText: e.target.value })}
                              placeholder="e.g. Schedule a 10-Min Demo"
                              className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium ${
                                isLight ? "bg-white border-slate-200 text-slate-800" : "bg-slate-900 border-slate-800 text-slate-200"
                              }`}
                            />
                          </div>

                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">Destination URL</label>
                            <input
                              type="text"
                              value={selectedTemplate.ctaUrl}
                              onChange={(e) => setSelectedTemplate({ ...selectedTemplate, ctaUrl: e.target.value })}
                              placeholder="https://cal.com/your-team"
                              className={`w-full p-2.5 text-xs rounded-xl border outline-none font-medium ${
                                isLight ? "bg-white border-slate-200 text-slate-800" : "bg-slate-900 border-slate-800 text-slate-200"
                              }`}
                            />
                          </div>

                          {selectedTemplate.templateType === "email" && (
                            <div className="md:col-span-2 flex items-center gap-3 pt-1">
                              <span className="text-[10px] font-bold text-slate-400">Button Color:</span>
                              <div className="flex items-center gap-2">
                                {["#4f46e5", "#0f172a", "#059669", "#7c3aed", "#2563eb", "#d97706"].map((color) => (
                                  <button
                                    key={color}
                                    type="button"
                                    onClick={() => setSelectedTemplate({ ...selectedTemplate, ctaBgColor: color })}
                                    style={{ backgroundColor: color }}
                                    className={`w-5 h-5 rounded-full transition-all cursor-pointer ${
                                      selectedTemplate.ctaBgColor === color ? "ring-2 ring-offset-2 ring-indigo-500 scale-110" : "opacity-80 hover:opacity-100"
                                    }`}
                                  />
                                ))}
                                <input
                                  type="color"
                                  value={selectedTemplate.ctaBgColor || "#4f46e5"}
                                  onChange={(e) => setSelectedTemplate({ ...selectedTemplate, ctaBgColor: e.target.value })}
                                  className="w-6 h-6 rounded-lg cursor-pointer border-0 bg-transparent"
                                  title="Custom color picker"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 6. Document & PDF Attachments (NEW) */}
                    <div className={`p-4 rounded-xl border space-y-3 ${
                      isLight ? "bg-slate-50/60 border-slate-200/80" : "bg-slate-950/40 border-slate-800/80"
                    }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                            <Paperclip className="h-3.5 w-3.5 text-indigo-500" />
                            Email Attachments (PDFs & Documents)
                          </label>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Attach pitch decks, PDF brochures, case studies, or audit reports (max 10MB each)
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => docFileInputRef.current?.click()}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Attach File</span>
                        </button>
                      </div>

                      <input
                        type="file"
                        ref={docFileInputRef}
                        multiple
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                        onChange={handleDocUpload}
                        className="hidden"
                      />

                      {selectedTemplate.attachments && selectedTemplate.attachments.length > 0 ? (
                        <div className="space-y-1.5 pt-1">
                          {selectedTemplate.attachments.map((att) => (
                            <div
                              key={att.id}
                              className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                                isLight ? "bg-white border-slate-200" : "bg-slate-900 border-slate-800"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                                  <FileText className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                    {att.name}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {formatFileSize(att.size)}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveAttachment(att.id)}
                                className="p-1 text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer transition-colors"
                                title="Remove attachment"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          onClick={() => docFileInputRef.current?.click()}
                          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all hover:border-indigo-500 ${
                            isLight ? "border-slate-300 bg-white hover:bg-indigo-50/20" : "border-slate-800 bg-slate-900/40 hover:bg-indigo-950/20"
                          }`}
                        >
                          <Paperclip className="h-4 w-4 text-slate-400 mx-auto mb-1" />
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Click to attach PDF, Word, Excel, or presentation documents
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Files are included automatically when campaigns or outreach emails are sent
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 7. Signature & Contact Line */}
                    <div className={`p-4 rounded-xl border space-y-3 ${
                      isLight ? "bg-slate-50/60 border-slate-200/80" : "bg-slate-950/40 border-slate-800/80"
                    }`}>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTemplate.useContact}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useContact: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span>Sender Signature & Contact Information</span>
                      </label>

                      {selectedTemplate.useContact && (
                        <textarea
                          value={selectedTemplate.contactText}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, contactText: e.target.value })}
                          placeholder="Best regards,&#10;Founder / Outreach Director&#10;team@example.com | +1 555-0199"
                          rows={2}
                          className={`w-full p-2.5 text-xs rounded-xl border outline-none resize-none ${
                            isLight ? "bg-white border-slate-200 text-slate-800" : "bg-slate-900 border-slate-800 text-slate-200"
                          }`}
                        />
                      )}
                    </div>

                    {/* 8. Footer / Unsubscribe */}
                    <div className={`p-4 rounded-xl border space-y-3 ${
                      isLight ? "bg-slate-50/60 border-slate-200/80" : "bg-slate-950/40 border-slate-800/80"
                    }`}>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTemplate.useFooter}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, useFooter: e.target.checked })}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span>Footer Opt-Out / Compliance Line</span>
                      </label>

                      {selectedTemplate.useFooter && (
                        <textarea
                          value={selectedTemplate.footerText}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, footerText: e.target.value })}
                          placeholder="You received this because {{company}} is listed publicly in {{city}}. Reply STOP to unsubscribe."
                          rows={2}
                          className={`w-full p-2.5 text-xs rounded-xl border outline-none resize-none ${
                            isLight ? "bg-white border-slate-200 text-slate-800" : "bg-slate-900 border-slate-800 text-slate-200"
                          }`}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── CUSTOM HTML CODE MODE ── */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-1">
                      <div>
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Code className="h-4 w-4 text-indigo-500" />
                          <span>Paste Raw HTML Template Code</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Paste responsive HTML code from BeeFree, Stripo, Figma, Mailchimp, or your custom email coder.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedTemplate({ ...selectedTemplate, htmlCode: STARTER_HTML_TEMPLATE })}
                        className="text-[10px] font-bold text-indigo-500 hover:text-indigo-400 border border-indigo-500/30 px-2 py-1 rounded-lg cursor-pointer"
                      >
                        Insert Starter HTML
                      </button>
                    </div>

                    {/* Email Subject for Code Mode */}
                    {selectedTemplate.templateType === "email" && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">Subject Line:</label>
                        <input
                          type="text"
                          value={selectedTemplate.subject}
                          onChange={(e) => setSelectedTemplate({ ...selectedTemplate, subject: e.target.value })}
                          placeholder="e.g. Special invitation for {{company}}"
                          className={`w-full p-2 text-xs rounded-xl border outline-none ${
                            isLight ? "bg-slate-50 border-slate-200 text-slate-900" : "bg-slate-950 border-slate-800 text-slate-100"
                          }`}
                        />
                      </div>
                    )}

                    <div className="relative">
                      <textarea
                        value={selectedTemplate.htmlCode}
                        onChange={(e) => setSelectedTemplate({ ...selectedTemplate, htmlCode: e.target.value })}
                        placeholder="<!-- Paste your full HTML email code here -->&#10;<!DOCTYPE html>&#10;<html>&#10;..."
                        rows={22}
                        className="w-full p-3 font-mono text-[11px] leading-relaxed rounded-xl border outline-none min-h-[460px] focus:border-indigo-500 bg-slate-950 text-slate-200 border-slate-800 resize-y"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Interactive Live Compiled Preview */}
              <div className={`border rounded-2xl p-5 space-y-4 sticky top-6 ${
                isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"
              }`}>
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Eye className="h-4 w-4 text-emerald-500" />
                    <span>Live Interactive Preview</span>
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Real-Time Render
                  </span>
                </div>

                {selectedTemplate.templateType === "email" ? (
                  /* DESKTOP EMAIL CLIENT MOCKUP */
                  <div className={`rounded-xl border overflow-hidden flex flex-col shadow-sm ${
                    isLight ? "bg-slate-100 border-slate-200" : "bg-slate-950 border-slate-800"
                  }`}>
                    {/* Fake Email Client Chrome */}
                    <div className={`px-4 py-3 border-b flex items-center justify-between text-[11px] ${
                      isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/60 border-slate-800"
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block opacity-80"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block opacity-80"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block opacity-80"></span>
                        <span className="ml-2 font-bold text-slate-600 dark:text-slate-300 truncate max-w-[240px]">
                          {selectedTemplate.subject || "(No Subject)"}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">Mail Preview</span>
                    </div>

                    {/* Email Headers (From, To) */}
                    <div className={`px-4 py-2.5 border-b text-[10.5px] space-y-1 ${
                      isLight ? "bg-white border-slate-200 text-slate-600" : "bg-[#090d16] border-slate-850 text-slate-300"
                    }`}>
                      <div>
                        <strong className="text-slate-400">From:</strong>{" "}
                        <span>{businessProfile?.senderName || "Outreach Team"} &lt;{businessProfile?.contactEmail || "outreach@company.com"}&gt;</span>
                      </div>
                      <div>
                        <strong className="text-slate-400">To:</strong>{" "}
                        <span>Sarah &lt;contact@apexsolutions.com&gt;</span>
                      </div>
                    </div>

                    {/* Email Body Iframe */}
                    <div className="min-h-[440px] bg-white">
                      {previewHtml ? (
                        <iframe
                          srcDoc={previewHtml}
                          title="Email Preview"
                          className="w-full min-h-[440px] border-0 bg-white"
                          sandbox="allow-popups allow-popups-to-escape-sandbox"
                        />
                      ) : (
                        <div className="p-12 text-center text-slate-400 text-xs">
                          Waiting for template elements to compile...
                        </div>
                      )}
                    </div>

                    {/* Attachments Footer Tray (if any attachments exist) */}
                    {selectedTemplate.attachments && selectedTemplate.attachments.length > 0 && (
                      <div className={`p-3 border-t flex flex-wrap items-center gap-2 ${
                        isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900 border-slate-800"
                      }`}>
                        <div className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Paperclip className="h-3 w-3" />
                          <span>Attachments ({selectedTemplate.attachments.length} files)</span>
                        </div>
                        {selectedTemplate.attachments.map((att) => (
                          <div
                            key={att.id}
                            className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-2 text-[11px] ${
                              isLight ? "bg-white border-slate-200 text-slate-700" : "bg-slate-950 border-slate-800 text-slate-300"
                            }`}
                          >
                            <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                            <span className="font-semibold truncate max-w-[160px]">{att.name}</span>
                            <span className="text-[9.5px] text-slate-400 shrink-0">({formatFileSize(att.size)})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* WHATSAPP SMARTPHONE PREVIEW */
                  <div className="flex items-center justify-center p-2 min-h-[490px]">
                    <div className="w-[305px] h-[490px] border-[8px] border-slate-850 rounded-[36px] overflow-hidden shadow-2xl bg-[#efeae2] flex flex-col font-sans relative ring-4 ring-slate-800/25">
                      {/* Notch */}
                      <div className="w-24 h-4.5 bg-black rounded-full absolute top-1.5 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-900 absolute left-4 border border-slate-800/30"></div>
                      </div>

                      {/* Top Bar */}
                      <div className="h-6.5 bg-[#075e54] text-white px-5 pt-1.5 flex items-center justify-between text-[8px] font-bold tracking-wider shrink-0 z-40 select-none">
                        <span>9:41</span>
                        <div className="flex items-center gap-1.5">
                          <span>5G</span>
                          <span className="h-2 w-3.5 border border-white/60 rounded-xs relative flex items-center p-[1px]"><span className="h-full w-2 bg-white rounded-3xs"></span></span>
                        </div>
                      </div>

                      {/* Header */}
                      <div className="bg-[#075e54] text-white px-3.5 py-3 flex items-center gap-2 shrink-0 z-40 relative shadow-md">
                        <ChevronLeft className="h-4 w-4 text-white -ml-1.5 shrink-0" />
                        <div className="h-8 w-8 rounded-full bg-teal-700 text-white flex items-center justify-center text-[10px] font-bold shrink-0 relative border border-teal-500/20">
                          OA
                          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#075e54]"></span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold leading-tight truncate">Outreach Agent</div>
                          <div className="text-[7.5px] text-teal-200">Online</div>
                        </div>
                        <div className="flex items-center gap-3.5 text-white/90 ml-auto shrink-0">
                          <Video className="h-3.5 w-3.5" />
                          <Phone className="h-3.5 w-3.5" />
                          <MoreVertical className="h-3.5 w-3.5" />
                        </div>
                      </div>

                      {/* Chat Messages */}
                      <div 
                        className="flex-1 p-3 overflow-y-auto space-y-2 relative flex flex-col justify-start z-30"
                        style={{ 
                          backgroundColor: "#efeae2",
                          backgroundImage: "radial-gradient(#dfdcd6 1px, transparent 1px)",
                          backgroundSize: "16px 16px"
                        }}
                      >
                        <div className="mx-auto text-[8px] bg-slate-250/60 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-md shadow-sm mb-3.5 text-center max-w-[85%] uppercase font-bold tracking-wider select-none">
                          🔒 Messages are end-to-end encrypted
                        </div>

                        {previewWhatsappText ? (
                          <div className="bg-[#dcf8c6] text-slate-800 text-[10.5px] p-2.5 rounded-2xl rounded-tr-none shadow-sm max-w-[85%] self-end relative leading-relaxed whitespace-pre-wrap border border-[#c1e8a4] animate-scaleUp">
                            <div 
                              className="whatsapp-bubble-tail absolute top-0 -right-2 w-3.5 h-3.5 bg-[#dcf8c6]" 
                              style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}
                            ></div>
                            {highlightVariables(previewWhatsappText)}
                            <div className="text-[7.5px] text-slate-500 text-right mt-1.5 flex items-center justify-end gap-0.5">
                              <span>{new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                              <span className="text-[#34b7f1] font-bold text-[8.5px] leading-none shrink-0">✓✓</span>
                            </div>
                          </div>
                        ) : (
                          <div className="m-auto text-center space-y-1 text-slate-450 p-4">
                            <MessageCircle className="h-6 w-6 text-slate-400 mx-auto opacity-60" />
                            <div className="text-[9px] text-slate-500">Enter template details to see WhatsApp preview...</div>
                          </div>
                        )}
                      </div>

                      {/* Keyboard Input Footer */}
                      <div className="bg-[#f0f0f0] p-2 flex items-center gap-1.5 shrink-0 z-40 select-none border-t border-slate-200">
                        <div className="flex-1 bg-white rounded-full px-3 py-1.5 text-[9px] text-slate-400 border border-slate-200 flex items-center justify-between shadow-sm">
                          <span className="flex items-center gap-1.5">
                            <Smile className="h-4 w-4 text-slate-400 shrink-0" />
                            <span>Type a message</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <Camera className="h-4 w-4 text-slate-400 shrink-0" />
                          </span>
                        </div>
                        <div className="h-7 w-7 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xs shadow-md shrink-0">
                          <Mic className="h-4 w-4" />
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

      {/* Alert Modal */}
      <AlertModal
        isOpen={modalConfig.isOpen}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmLabel={modalConfig.confirmLabel}
        onConfirm={modalConfig.onConfirm}
        onCancel={() => setModalConfig((p) => ({ ...p, isOpen: false }))}
        isLight={isLight}
        isLoading={modalConfig.isLoading}
      />
    </div>
  );
}
