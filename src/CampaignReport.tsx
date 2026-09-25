/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Dispatch Report — real-time history table + animated charts for
 * the outreach campaign engine, with CSV / Excel / PDF / Word export.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  History, FileText, FileSpreadsheet, RefreshCw, Loader2,
  Mail, CheckCircle2, XCircle, Search, X, ChevronDown,
  Eye, PencilLine, Trash2, Save,
} from "lucide-react";
import WhatsAppLogo from "./WhatsAppLogo";
import AlertModal, { AlertModalType } from "./AlertModal";
import { ModalPortal } from "./ui/primitives";
// Document writers are loaded on demand from the export handlers below. Opening
// the Reports tab should not download a spreadsheet engine, a PDF engine and a
// Word engine before the first row is visible.

interface HistoryRecord {
  id: string;
  campaignId: string;
  timestamp: string;
  businessName: string;
  channel: "email" | "whatsapp";
  status: "SENT" | "FAILED";
  recipient: string;
  subject?: string;
  messageSnippet?: string;
  dryRun: boolean;
  sourceType: "list" | "sheet";
  sourceLabel: string;
}

interface HistorySummary {
  totalSent: number;
  totalFailed: number;
  emailSent: number;
  emailFailed: number;
  whatsappSent: number;
  whatsappFailed: number;
  total: number;
  successRate: number;
  timeline: { date: string; sent: number; failed: number; email: number; whatsapp: number }[];
}

interface CampaignReportProps {
  isLight: boolean;
  liveRefresh?: boolean;
  alwaysExpanded?: boolean;
}

const CHANNEL_COLORS = { email: "#6366f1", whatsapp: "#10b981" };
const STATUS_COLORS = { sent: "#10b981", failed: "#f43f5e" };

const COLS = [
  { h: "Date / Time",        wch: 22 },
  { h: "Business Name",      wch: 32 },
  { h: "Channel",            wch: 12 },
  { h: "Status",             wch: 10 },
  { h: "Recipient",          wch: 30 },
  { h: "Subject / Message",  wch: 50 },
  { h: "Dry Run",            wch: 10 },
];

function toRow(r: HistoryRecord): string[] {
  return [
    new Date(r.timestamp).toLocaleString("en-IN"),
    r.businessName,
    r.channel === "email" ? "Email" : "WhatsApp",
    r.status,
    r.recipient,
    (r.subject || r.messageSnippet || "").slice(0, 100),
    r.dryRun ? "Yes" : "No",
  ];
}

export default function CampaignReport({ isLight, liveRefresh = false, alwaysExpanded = false }: CampaignReportProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState<"all" | "email" | "whatsapp">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "SENT" | "FAILED">("all");
  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // ── CRUD state: selection, view/edit detail panel, delete confirmation ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailRecord, setDetailRecord] = useState<HistoryRecord | null>(null);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [editDraft, setEditDraft] = useState<{ businessName: string; recipient: string; subject: string; messageSnippet: string; status: "SENT" | "FAILED" }>({
    businessName: "", recipient: "", subject: "", messageSnippet: "", status: "SENT",
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; isLoading: boolean; onConfirm: () => void; message: string }>({
    isOpen: false, isLoading: false, onConfirm: () => {}, message: "",
  });
  const [feedbackModal, setFeedbackModal] = useState<{ isOpen: boolean; type: AlertModalType; title: string; message: string }>({
    isOpen: false, type: "success", title: "", message: "",
  });
  const notify = (type: AlertModalType, title: string, message: string) =>
    setFeedbackModal({ isOpen: true, type, title, message });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        channel: channelFilter,
        status: statusFilter,
        ...(search.trim() ? { search: search.trim() } : {}),
        limit: "100",
      });
      const res = await fetch(`/api/campaign/history?${params}`);
      if (res.ok) {
        const data = await res.json();
        const nextRecords: HistoryRecord[] = data.records || [];
        setRecords(nextRecords);
        setSummary(data.summary || null);
        // Drop any stale selections for records no longer in the current page.
        const validIds = new Set(nextRecords.map((r) => r.id));
        setSelectedIds((prev) => {
          const next = new Set<string>();
          prev.forEach((id) => { if (validIds.has(id)) next.add(id); });
          return next;
        });
      }
    } catch (e) {
      console.error("Failed to load campaign history", e);
    } finally {
      setIsLoading(false);
    }
  }, [channelFilter, statusFilter, search]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  useEffect(() => {
    if (!liveRefresh) return;
    const interval = setInterval(fetchHistory, 4000);
    return () => clearInterval(interval);
  }, [liveRefresh, fetchHistory]);

  // ── CRUD handlers: view / edit / delete (single + bulk) ──────────────────

  const openView = (r: HistoryRecord) => {
    setDetailRecord(r);
    setDetailMode("view");
  };

  const openEdit = (r: HistoryRecord) => {
    setDetailRecord(r);
    setEditDraft({
      businessName: r.businessName,
      recipient: r.recipient,
      subject: r.subject || "",
      messageSnippet: r.messageSnippet || "",
      status: r.status,
    });
    setDetailMode("edit");
  };

  const closeDetail = () => setDetailRecord(null);

  const saveEdit = async () => {
    if (!detailRecord) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/campaign/history/${detailRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      if (res.ok) {
        const data = await res.json();
        setRecords((prev) => prev.map((r) => (r.id === detailRecord.id ? { ...r, ...data.record } : r)));
        notify("success", "Record Updated", `Dispatch record for "${editDraft.businessName}" was updated successfully.`);
        closeDetail();
      } else {
        const err = await res.json().catch(() => ({}));
        notify("danger", "Update Failed", err.error || "Could not update this dispatch record.");
      }
    } catch (e) {
      notify("danger", "Update Failed", "Something went wrong while saving changes.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteOne = (r: HistoryRecord) => {
    setConfirmModal({
      isOpen: true,
      isLoading: false,
      message: `Delete the dispatch record for "${r.businessName}" (${r.channel === "email" ? "Email" : "WhatsApp"})? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }));
        try {
          const res = await fetch(`/api/campaign/history/${r.id}`, { method: "DELETE" });
          if (res.ok) {
            setRecords((prev) => prev.filter((x) => x.id !== r.id));
            setSelectedIds((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
            if (detailRecord?.id === r.id) closeDetail();
            setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
            notify("success", "Record Deleted", "The dispatch record was deleted.");
          } else {
            setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
            notify("danger", "Delete Failed", "Could not delete this dispatch record.");
          }
        } catch (e) {
          setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
          notify("danger", "Delete Failed", "Something went wrong while deleting this record.");
        }
      },
    });
  };

  const deleteSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setConfirmModal({
      isOpen: true,
      isLoading: false,
      message: `Delete ${ids.length} selected dispatch record${ids.length > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }));
        try {
          const res = await fetch("/api/campaign/history/bulk", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
          });
          if (res.ok) {
            setRecords((prev) => prev.filter((r) => !selectedIds.has(r.id)));
            setSelectedIds(new Set());
            setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
            notify("success", "Records Deleted", `${ids.length} dispatch record${ids.length > 1 ? "s" : ""} deleted.`);
          } else {
            setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
            notify("danger", "Delete Failed", "Could not delete the selected records.");
          }
        } catch (e) {
          setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
          notify("danger", "Delete Failed", "Something went wrong while deleting records.");
        }
      },
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(records.map((r) => r.id)) : new Set());
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const donutData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Email", value: summary.emailSent + summary.emailFailed, color: CHANNEL_COLORS.email },
      { name: "WhatsApp", value: summary.whatsappSent + summary.whatsappFailed, color: CHANNEL_COLORS.whatsapp },
    ].filter((d) => d.value > 0);
  }, [summary]);

  // ── Client-side export functions ──────────────────────────────────────────

  const handleExportCSV = () => {
    if (records.length === 0) { alert("No records to export."); return; }
    const q = (v: string) => { const s = String(v ?? ""); return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [COLS.map(c => q(c.h)).join(",")];
    for (const r of records) lines.push(toRow(r).map(q).join(","));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `campaign_report_${Date.now()}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleExportExcel = async () => {
    if (records.length === 0) { alert("No records to export."); return; }
    const XLSX = await import("xlsx");
    const headerRow = COLS.map(c => c.h);
    const dataRows = records.map(toRow);
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    // Dynamic column widths based on actual content
    ws["!cols"] = COLS.map((col, ci) => {
      let max = col.h.length;
      dataRows.forEach(row => { if (row[ci] && row[ci].length > max) max = row[ci].length; });
      return { wch: Math.min(Math.max(max + 3, col.wch), 70) };
    });
    // Style header row
    headerRow.forEach((_, ci) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (!ws[addr]) return;
      ws[addr].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4F46E5" } },
        alignment: { horizontal: "center", wrapText: false },
      };
    });
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Campaign Report");
    XLSX.writeFile(wb, `campaign_report_${Date.now()}.xlsx`);
  };

  const handleExportPDF = async () => {
    if (records.length === 0) { alert("No records to export."); return; }
    setIsExporting("pdf");
    try {
      // Load logo + compute proportional dimensions to prevent stretching
      let logoDataUrl: string | null = null;
      let logoW = 44, logoH = 13;
      try {
        const resp = await fetch("/logo.png");
        const blob = await resp.blob();
        logoDataUrl = await new Promise<string>((res, rej) => {
          const rd = new FileReader();
          rd.onload = () => res(rd.result as string);
          rd.onerror = rej;
          rd.readAsDataURL(blob);
        });
        if (logoDataUrl) {
          await new Promise<void>((res) => {
            const img = new Image();
            img.onload = () => {
              const asp = img.naturalWidth / img.naturalHeight;
              logoH = 12; logoW = logoH * asp;
              if (logoW > 50) { logoW = 50; logoH = logoW / asp; }
              res();
            };
            img.onerror = () => res();
            img.src = logoDataUrl!;
          });
        }
      } catch { logoDataUrl = null; }

      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
      const pageW = doc.internal.pageSize.getWidth();
      const exportDate = new Date().toLocaleString();
      const HEADER_H = 18;

      const drawHeader = () => {
        // Plain white background
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageW, HEADER_H, "F");

        // Logo top-left, proportionally sized
        if (logoDataUrl) {
          try { doc.addImage(logoDataUrl, "PNG", 5, (HEADER_H - logoH) / 2, logoW, logoH); }
          catch {
            doc.setTextColor(79, 70, 229); doc.setFontSize(11);
            doc.setFont("helvetica", "bold"); doc.text("LeadGenPilot", 5, 11);
          }
        } else {
          doc.setTextColor(79, 70, 229); doc.setFontSize(11);
          doc.setFont("helvetica", "bold"); doc.text("LeadGenPilot", 5, 11);
        }

        // Title beside logo
        const textX = logoDataUrl ? logoW + 10 : 54;
        doc.setTextColor(30, 41, 59); doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Campaign Dispatch Report", textX, 10.5);

        // Meta right
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(`Exported: ${exportDate}  ·  ${records.length} records`, pageW - 6, 10.5, { align: "right" });

        // Separator line
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
        doc.line(0, HEADER_H, pageW, HEADER_H);
        doc.setTextColor(0, 0, 0); doc.setDrawColor(0, 0, 0);
      };

      drawHeader();

      // Summary line
      let startY = HEADER_H + 4;
      if (summary) {
        doc.setFontSize(7); doc.setTextColor(80, 80, 100);
        doc.text(
          `Total: ${summary.total}  ·  Sent: ${summary.totalSent}  ·  Failed: ${summary.totalFailed}  ·  Success Rate: ${summary.successRate}%`,
          pageW / 2, startY, { align: "center" }
        );
        startY += 5;
      }

      autoTable(doc, {
        startY,
        head: [COLS.map(c => c.h)],
        body: records.map(toRow),
        theme: "grid",
        margin: { left: 6, right: 6 },
        styles: {
          fontSize: 7,
          cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
          overflow: "linebreak",
          valign: "top",
          lineColor: [226, 232, 240],
          lineWidth: 0.15,
          textColor: [51, 65, 85],
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "center",
          lineColor: [148, 163, 184],
          lineWidth: 0.25,
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 40 },
          2: { cellWidth: 18, halign: "center" },
          3: { cellWidth: 16, halign: "center" },
          4: { cellWidth: 36 },
          5: { cellWidth: "auto" as any },
          6: { cellWidth: 14, halign: "center" },
        },
        didDrawPage: () => drawHeader(),
      });

      // Page numbers
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(6); doc.setTextColor(150, 150, 150);
        doc.text(`Page ${p} of ${totalPages}`, pageW / 2, doc.internal.pageSize.getHeight() - 4, { align: "center" });
      }

      doc.save(`campaign_report_${Date.now()}.pdf`);
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportWord = async () => {
    if (records.length === 0) { alert("No records to export."); return; }
    setIsExporting("docx");

    const [{ Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType }, { saveAs }] = await Promise.all([
      import("docx"),
      import("file-saver"),
    ]);

    const colWidths = [12, 22, 10, 8, 20, 22, 6]; // % per column (must sum to 100)

    const hCell = (text: string, w: number) => new TableCell({
      width: { size: w * 100, type: WidthType.PERCENTAGE },
      shading: { fill: "4F46E5" },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 16 })] })],
    });

    const dCell = (text: string, w: number, shade: boolean) => new TableCell({
      width: { size: w * 100, type: WidthType.PERCENTAGE },
      shading: { fill: shade ? "F8FAFC" : "FFFFFF" },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ children: [new TextRun({ text: text || "—", size: 14 })] })],
    });

    const headerRow = new TableRow({
      tableHeader: true,
      children: COLS.map((c, i) => hCell(c.h, colWidths[i])),
    });

    const bodyRows = records.map((r, idx) => {
      const row = toRow(r);
      const shade = idx % 2 === 1;
      return new TableRow({ children: row.map((cell, i) => dCell(cell, colWidths[i], shade)) });
    });

    const docx = new Document({
      styles: { default: { document: { run: { font: "Calibri", size: 18 } } } },
      sections: [{
        properties: {
          page: {
            size: { orientation: "landscape" as any },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: "LeadGenPilot — Campaign Dispatch Report", bold: true, size: 32, color: "4F46E5" })],
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [new TextRun({
              text: summary
                ? `Generated: ${new Date().toLocaleString()}  |  Total: ${summary.total}  |  Sent: ${summary.totalSent}  |  Failed: ${summary.totalFailed}  |  Success: ${summary.successRate}%`
                : `Generated: ${new Date().toLocaleString()}  |  ${records.length} records`,
              size: 18, color: "666666",
            })],
            spacing: { after: 400 },
          }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }),
        ],
      }],
    });

    Packer.toBlob(docx).then((blob) => {
      saveAs(blob, `campaign_report_${Date.now()}.docx`);
      setIsExporting(null);
    });
  };

  const cardBg = isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]";
  const subtleText = isLight ? "text-slate-500" : "text-slate-400";

  return (
    <div className={`border rounded-xl p-4 sm:p-5 space-y-4 transition-all duration-300 ${cardBg}`}>
      <div
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between cursor-pointer select-none group"
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-400" />
          <h3 className={`text-xs font-bold transition-colors ${isLight ? "text-slate-800 group-hover:text-indigo-600" : "text-white group-hover:text-indigo-400"}`}>
            Dispatch History &amp; Reports
          </h3>
          {liveRefresh && (
            <span className="flex items-center gap-1 text-[8.5px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full animate-pulse border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE
            </span>
          )}
        </div>
        <button className={`p-1 rounded-lg border transition-all cursor-pointer ${isLight ? "bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100" : "bg-slate-900/50 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"}`}>
          {expanded ? <X className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 animate-fadeIn">
          {/* Summary stat cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {[
                { label: "Total Dispatched", value: summary.total, color: "text-indigo-400" },
                { label: "Sent", value: summary.totalSent, color: "text-emerald-400" },
                { label: "Failed", value: summary.totalFailed, color: "text-rose-400" },
                { label: "Success Rate", value: `${summary.successRate}%`, color: "text-sky-400" },
              ].map((s) => (
                <div key={s.label} className={`p-2.5 rounded-xl border text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xs ${isLight ? "bg-slate-50/80 border-slate-200" : "bg-slate-950/40 border-slate-900"}`}>
                  <div className={`text-lg font-black tracking-tight ${s.color}`}>{s.value}</div>
                  <div className={`text-[8.5px] uppercase tracking-wider font-semibold mt-0.5 ${subtleText}`}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Animated charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={`lg:col-span-2 p-4 rounded-xl border ${isLight ? "bg-white border-slate-200" : "bg-slate-950/30 border-slate-900"}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${subtleText}`}>14-Day Dispatch Trend</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={summary?.timeline || []} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={STATUS_COLORS.sent} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={STATUS_COLORS.sent} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={STATUS_COLORS.failed} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={STATUS_COLORS.failed} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={isLight ? "#e2e8f0" : "#1e293b"} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: isLight ? "#64748b" : "#94a3b8" }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: isLight ? "#64748b" : "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: isLight ? "#ffffff" : "#0c111d", border: `1px solid ${isLight ? "#e2e8f0" : "#1e293b"}`, borderRadius: 8, fontSize: 11 }} />
                  <Area type="monotone" dataKey="sent" stroke={STATUS_COLORS.sent} fill="url(#sentGradient)" strokeWidth={2} isAnimationActive animationDuration={800} name="Sent" />
                  <Area type="monotone" dataKey="failed" stroke={STATUS_COLORS.failed} fill="url(#failedGradient)" strokeWidth={2} isAnimationActive animationDuration={800} name="Failed" />
                </AreaChart>
              </ResponsiveContainer>
              {(!summary || summary.timeline.length === 0) && (
                <div className="text-center text-[10px] text-slate-500 -mt-24 pt-24">No dispatch activity yet.</div>
              )}
            </div>

            <div className={`p-4 rounded-xl border ${isLight ? "bg-white border-slate-200" : "bg-slate-950/30 border-slate-900"}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${subtleText}`}>Channel Split</div>
              {donutData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3} isAnimationActive animationDuration={800}>
                      {donutData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: isLight ? "#ffffff" : "#0c111d", border: `1px solid ${isLight ? "#e2e8f0" : "#1e293b"}`, borderRadius: 8, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-[10px] text-slate-500">No data yet.</div>
              )}
            </div>
          </div>

          {/* Filters + Export dropdown */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-grow min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search business or recipient..."
                className={`w-full text-xs border rounded-lg pl-8 pr-2 py-2 focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
              />
            </div>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as any)}
              className={`text-xs border rounded-lg px-2 py-2 cursor-pointer focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
            >
              <option value="all">All Channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className={`text-xs border rounded-lg px-2 py-2 cursor-pointer focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
            >
              <option value="all">All Statuses</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
            </select>
            <button
              onClick={fetchHistory}
              disabled={isLoading}
              className={`p-2 border rounded-lg cursor-pointer transition-all ${isLight ? "bg-white text-slate-600 border-slate-200 hover:bg-slate-50" : "bg-transparent text-slate-400 border-[#1e293b] hover:bg-slate-800"}`}
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1.5 text-xs px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg cursor-pointer transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {selectedIds.size}
              </button>
            )}

            {/* ── Premium Export Dropdown (matches Lead Export) ── */}
            <div ref={exportDropdownRef} className="ml-auto relative">
              <button
                type="button"
                onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                disabled={records.length === 0 || isExporting !== null}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 border rounded-lg cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  isLight
                    ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    : "bg-transparent text-slate-300 border-[#1e293b] hover:bg-slate-800/40"
                }`}
              >
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span>{isExporting ? "Exporting…" : "Export Report"}</span>
                <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${exportDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {exportDropdownOpen && (
                <div className={`absolute right-0 z-30 mt-1 w-48 rounded-lg border shadow-lg overflow-hidden ${isLight ? "bg-white border-slate-200" : "bg-[#0c111d] border-[#1e293b]"}`}>
                  <div className="py-1">
                    {/* CSV */}
                    <button
                      onClick={() => { handleExportCSV(); setExportDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${isLight ? "text-slate-700 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"}`}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span>Export as CSV</span>
                    </button>
                    {/* Excel */}
                    <button
                      onClick={() => { handleExportExcel(); setExportDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${isLight ? "text-slate-700 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"}`}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span>Export as Excel (.xlsx)</span>
                    </button>
                    {/* PDF */}
                    <button
                      onClick={() => { handleExportPDF(); setExportDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${isLight ? "text-slate-700 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"}`}
                    >
                      <FileText className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      <span>Export as PDF</span>
                    </button>
                    {/* Word */}
                    <button
                      onClick={() => { handleExportWord(); setExportDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${isLight ? "text-slate-700 hover:bg-slate-50" : "text-slate-300 hover:bg-slate-800/40"}`}
                    >
                      <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span>Export as Word (.docx)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dispatch log table */}
          <div className={`border rounded-xl overflow-hidden ${isLight ? "border-slate-200" : "border-[#1e293b]"}`}>
            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className={`border-b text-[9px] uppercase tracking-wider ${isLight ? "bg-slate-50 border-slate-200 text-slate-400" : "bg-[#090d16] border-[#1e293b]/60 text-slate-400"}`}>
                    <th className="p-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={records.length > 0 && records.every((r) => selectedIds.has(r.id))}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        className="rounded text-indigo-500 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="p-2.5 font-normal">Time</th>
                    <th className="p-2.5 font-normal">Business</th>
                    <th className="p-2.5 font-normal">Channel</th>
                    <th className="p-2.5 font-normal">Recipient</th>
                    <th className="p-2.5 font-normal">Status</th>
                    <th className="p-2.5 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isLight ? "divide-slate-100" : "divide-[#1e293b]/40"}`}>
                  {isLoading ? (
                    <tr><td colSpan={7} className="py-10 text-center"><Loader2 className="h-5 w-5 text-indigo-400 animate-spin mx-auto" /></td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={7} className="py-10 text-center text-slate-500 italic">No dispatch history yet. Launch a campaign to populate this report.</td></tr>
                  ) : (
                    records.map((r) => {
                      const isSelected = selectedIds.has(r.id);
                      return (
                      <tr key={r.id} className={`transition-all ${isSelected ? (isLight ? "bg-indigo-50" : "bg-indigo-900/10") : isLight ? "hover:bg-slate-50" : "hover:bg-slate-900/20"}`}>
                        <td className="p-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => toggleSelectOne(r.id, e.target.checked)}
                            className="rounded text-indigo-500 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                          />
                        </td>
                        <td className="p-2.5 text-[10px] whitespace-nowrap text-slate-500">
                          {new Date(r.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="p-2.5">
                          <div className={`font-semibold truncate max-w-[160px] ${isLight ? "text-slate-900" : "text-white"}`}>{r.businessName}</div>
                          {r.dryRun && <span className="text-[8px] text-amber-500 font-bold">SIMULATION</span>}
                        </td>
                        <td className="p-2.5">
                          <span className="flex items-center gap-1 text-[10px] font-bold">
                            {r.channel === "email"
                              ? <Mail className="h-3 w-3 text-indigo-400" />
                              : <WhatsAppLogo className="h-3 w-3 fill-emerald-500 text-emerald-500" />}
                            {r.channel === "email" ? "Email" : "WhatsApp"}
                          </span>
                        </td>
                        <td className="p-2.5 text-[10px] truncate max-w-[140px] text-slate-500">{r.recipient}</td>
                        <td className="p-2.5">
                          <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${r.status === "SENT" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                            {r.status === "SENT" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                            {r.status}
                          </span>
                        </td>
                        <td className="p-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openView(r)}
                              className="p-1 text-slate-500 hover:text-indigo-400 transition-colors cursor-pointer"
                              title="View"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => openEdit(r)}
                              className="p-1 text-slate-500 hover:text-indigo-400 transition-colors cursor-pointer"
                              title="Edit"
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => deleteOne(r)}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                              title="Delete"
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
          </div>

          {records.length > 0 && (
            <div className={`px-1 text-[10px] flex items-center justify-between ${subtleText}`}>
              <span>{records.length} record{records.length !== 1 ? "s" : ""} shown{selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}</span>
            </div>
          )}
        </div>
      )}

      {/* View / Edit detail panel */}
      {detailRecord && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn" onMouseDown={closeDetail}>
            <div
              onMouseDown={(e) => e.stopPropagation()}
              className={`w-full ${detailMode === "view" ? "max-w-2xl" : "max-w-md"} rounded-2xl border p-5 space-y-4 relative shadow-2xl animate-scaleUp ${isLight ? "bg-white border-slate-200" : "bg-[#090d16] border-[#1e293b]"}`}
            >
              <button
                onClick={closeDetail}
                className={`absolute top-4 right-4 p-1 rounded-lg cursor-pointer transition-colors ${isLight ? "text-slate-400 hover:text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-2">
                {detailMode === "view" ? <Eye className="h-4 w-4 text-indigo-400" /> : <PencilLine className="h-4 w-4 text-indigo-400" />}
                <h3 className={`text-sm font-bold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {detailMode === "view" ? "Dispatch Record" : "Edit Dispatch Record"}
                </h3>
              </div>

              {detailMode === "view" ? (
                <div className="space-y-4 text-xs">
                  <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-xl border ${isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/40 border-slate-900"}`}>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Business</div>
                      <div className={`font-bold truncate ${isLight ? "text-slate-800" : "text-white"}`} title={detailRecord.businessName}>{detailRecord.businessName}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Channel</div>
                      <div className="flex items-center gap-1 font-bold">
                        {detailRecord.channel === "email" ? <Mail className="h-3 w-3 text-indigo-400" /> : <WhatsAppLogo className="h-3 w-3 fill-emerald-500 text-emerald-500" />}
                        {detailRecord.channel === "email" ? "Email" : "WhatsApp"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Status</div>
                      <span className={`inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded ${detailRecord.status === "SENT" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{detailRecord.status}</span>
                    </div>
                    <div className="min-w-0 col-span-2 sm:col-span-1">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Recipient</div>
                      <div className={`font-bold truncate ${isLight ? "text-slate-800" : "text-white"}`} title={detailRecord.recipient}>{detailRecord.recipient}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Source</div>
                    <div className={`truncate ${isLight ? "text-slate-700" : "text-slate-300"}`} title={detailRecord.sourceLabel}>{detailRecord.sourceLabel}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Time</div>
                    <div className={isLight ? "text-slate-700" : "text-slate-300"}>{new Date(detailRecord.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>

                {/* Subject + Message side by side on wider screens */}
                {(detailRecord.subject || detailRecord.messageSnippet) && (
                  <div className={`grid gap-3 ${detailRecord.subject && detailRecord.messageSnippet ? "sm:grid-cols-2" : ""}`}>
                    {detailRecord.subject && (
                      <div className={`p-3 rounded-xl border ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Subject</div>
                        <p className={isLight ? "text-slate-700" : "text-slate-300"}>{detailRecord.subject}</p>
                      </div>
                    )}
                    {detailRecord.messageSnippet && (
                      <div className={`p-3 rounded-xl border max-h-40 overflow-y-auto ${isLight ? "border-slate-200" : "border-[#1e293b]/60"}`}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Message</div>
                        <p className={`leading-relaxed whitespace-pre-wrap ${isLight ? "text-slate-700" : "text-slate-300"}`}>{detailRecord.messageSnippet}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setDetailMode("edit")}
                    className="px-3 py-1.5 text-[10px] font-bold text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/25 rounded-lg cursor-pointer transition-all flex items-center gap-1"
                  >
                    <PencilLine className="h-3 w-3" /> Edit
                  </button>
                  <button
                    onClick={() => deleteOne(detailRecord)}
                    className="px-3 py-1.5 text-[10px] font-bold text-rose-400 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/25 rounded-lg cursor-pointer transition-all flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-1">Business Name</label>
                  <input
                    type="text"
                    value={editDraft.businessName}
                    onChange={(e) => setEditDraft((d) => ({ ...d, businessName: e.target.value }))}
                    className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-1">Recipient</label>
                  <input
                    type="text"
                    value={editDraft.recipient}
                    onChange={(e) => setEditDraft((d) => ({ ...d, recipient: e.target.value }))}
                    className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                  />
                </div>
                {detailRecord.channel === "email" && (
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Subject</label>
                    <input
                      type="text"
                      value={editDraft.subject}
                      onChange={(e) => setEditDraft((d) => ({ ...d, subject: e.target.value }))}
                      className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-1">Message</label>
                  <textarea
                    value={editDraft.messageSnippet}
                    onChange={(e) => setEditDraft((d) => ({ ...d, messageSnippet: e.target.value }))}
                    rows={4}
                    className={`w-full border rounded-lg px-3 py-2 text-xs leading-relaxed focus:outline-none focus:border-indigo-500 resize-y ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 mb-1">Status</label>
                  <select
                    value={editDraft.status}
                    onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value as "SENT" | "FAILED" }))}
                    className={`w-full border rounded-lg px-3 py-2 text-xs cursor-pointer focus:outline-none focus:border-indigo-500 ${isLight ? "bg-white text-slate-800 border-slate-200" : "bg-[#030712] text-white border-[#1e293b]"}`}
                  >
                    <option value="SENT">SENT</option>
                    <option value="FAILED">FAILED</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setDetailMode("view")}
                    disabled={isSavingEdit}
                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg cursor-pointer transition-all border disabled:opacity-50 ${isLight ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-[#1e293b] text-slate-300 hover:bg-slate-800"}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={isSavingEdit}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-all flex items-center gap-1.5"
                  >
                    {isSavingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    {isSavingEdit ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Delete confirmation modal */}
      <AlertModal
        isOpen={confirmModal.isOpen}
        type="danger"
        title="Delete Dispatch Record"
        message={confirmModal.message}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={confirmModal.isLoading}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        isLight={isLight}
      />

      {/* Success / error feedback modal for CRUD actions */}
      <AlertModal
        isOpen={feedbackModal.isOpen}
        type={feedbackModal.type}
        title={feedbackModal.title}
        message={feedbackModal.message}
        confirmLabel="Done"
        onConfirm={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
        onCancel={() => setFeedbackModal((prev) => ({ ...prev, isOpen: false }))}
        isLight={isLight}
      />
    </div>
  );
}
