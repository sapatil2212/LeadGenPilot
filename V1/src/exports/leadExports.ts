/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CRM lead export writers: CSV, Excel, PDF and Word.
 *
 * Extracted from App.tsx so the column definitions, page layout and document
 * assembly — around 560 lines that only run when somebody clicks Export — are
 * fetched on demand instead of sitting in the chunk every user downloads before
 * the dashboard paints. The document contents are unchanged: these are the same
 * functions, moved.
 */

import type { Lead } from "../types";
export function exportLeadsToCsv(crmLeads: Lead[]): void {
    if (crmLeads.length === 0) {
      alert("No leads available to export.");
      return;
    }

    // All 28 columns — exact same order as DB schema
    const headers = [
      "Business Name", "Phone", "Address", "Rating", "Reviews",
      "Website", "Website Status", "Website Missing",
      "Instagram URL", "Instagram Status", "Instagram Last Post",
      "Facebook URL", "Facebook Status", "Facebook Last Post",
      "LinkedIn URL", "LinkedIn Status",
      "WhatsApp Present", "Appointment System",
      "Google Analytics", "Meta Pixel",
      "Emails", "Google Maps URL",
      "Lead Score", "Lead Priority", "Date Added", "Category",
      "Email Status", "WhatsApp Status",
      "Email Sent Date", "WhatsApp Sent Date",
      "AI Insight", "Notes"
    ];

    // RFC 4180-compliant quoting — wrap any field containing comma, quote or newline
    const q = (v: any): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = crmLeads.map((l: Lead) => [
      q(l.businessName), q(l.phone), q(l.address),
      q(l.rating), q(l.reviews),
      q(l.website), q(l.websiteStatus), q(l.websiteMissing ? "Yes" : "No"),
      q(l.instagramUrl), q(l.instagramStatus), q(l.instagramLastPost),
      q(l.facebookUrl), q(l.facebookStatus), q(l.facebookLastPost),
      q(l.linkedinUrl), q(l.linkedinStatus),
      q(l.whatsappPresent ? "Yes" : "No"), q(l.appointmentSystem ? "Yes" : "No"),
      q(l.googleAnalyticsPresent ? "Yes" : "No"), q(l.metaPixelPresent ? "Yes" : "No"),
      q(Array.isArray(l.emails) ? l.emails.join("; ") : ""),
      q(l.mapsUrl),
      q(l.leadScore), q(l.leadPriority), q(l.dateAdded), q(l.category),
      q(l.emailStatus || ""), q(l.whatsappStatus || ""),
      q(l.emailSentDate || ""), q(l.whatsappSentDate || ""),
      q(l.aiInsight), q(l.notes || "")
    ].join(","));

    const csvContent = "\ufeff" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `leads_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export async function exportLeadsToExcel(crmLeads: Lead[]): Promise<void> {
    if (crmLeads.length === 0) {
      alert("No leads available to export.");
      return;
    }
    const XLSX = await import("xlsx");

    // Column definitions: header label + character-width hint (wch)
    // wch = max expected content width in characters — Google Sheets & Excel
    // honour this to auto-size columns correctly.
    const colDefs = [
      { h: "#",                    wch: 4  },
      { h: "Business Name",        wch: 32 },
      { h: "Phone",                wch: 18 },
      { h: "Address",              wch: 45 },
      { h: "Category",             wch: 22 },
      { h: "Rating",               wch: 8  },
      { h: "Reviews",              wch: 10 },
      { h: "Lead Score",           wch: 10 },
      { h: "Priority",             wch: 10 },
      { h: "Date Added",           wch: 18 },
      { h: "Website",              wch: 38 },
      { h: "Website Status",       wch: 16 },
      { h: "Website Missing",      wch: 16 },
      { h: "Instagram URL",        wch: 36 },
      { h: "Instagram Status",     wch: 18 },
      { h: "Instagram Last Post",  wch: 20 },
      { h: "Facebook URL",         wch: 36 },
      { h: "Facebook Status",      wch: 18 },
      { h: "Facebook Last Post",   wch: 20 },
      { h: "LinkedIn URL",         wch: 36 },
      { h: "LinkedIn Status",      wch: 16 },
      { h: "WhatsApp Present",     wch: 16 },
      { h: "Appointment System",   wch: 20 },
      { h: "Google Analytics",     wch: 18 },
      { h: "Meta Pixel",           wch: 14 },
      { h: "Emails",               wch: 36 },
      { h: "Google Maps URL",      wch: 36 },
      { h: "Email Status",         wch: 14 },
      { h: "WhatsApp Status",      wch: 16 },
      { h: "Email Sent Date",      wch: 20 },
      { h: "WhatsApp Sent Date",   wch: 20 },
      { h: "AI Insight",           wch: 60 },
      { h: "Notes",                wch: 36 },
    ];

    const headerRow = colDefs.map(c => c.h);
    const dataRows = crmLeads.map((l: Lead, i: number) => [
      i + 1,
      l.businessName || "",
      l.phone || "",
      l.address || "",
      l.category || "",
      l.rating ?? "",
      l.reviews ?? "",
      l.leadScore ?? "",
      l.leadPriority || "",
      l.dateAdded ? l.dateAdded.substring(0, 10) : "",
      l.website || "",
      l.websiteStatus || "",
      l.websiteMissing ? "Yes" : "No",
      l.instagramUrl || "",
      l.instagramStatus || "",
      l.instagramLastPost || "",
      l.facebookUrl || "",
      l.facebookStatus || "",
      l.facebookLastPost || "",
      l.linkedinUrl || "",
      l.linkedinStatus || "",
      l.whatsappPresent ? "Yes" : "No",
      l.appointmentSystem ? "Yes" : "No",
      l.googleAnalyticsPresent ? "Yes" : "No",
      l.metaPixelPresent ? "Yes" : "No",
      Array.isArray(l.emails) ? l.emails.join(", ") : "",
      l.mapsUrl || "",
      l.emailStatus || "",
      l.whatsappStatus || "",
      l.emailSentDate || "",
      l.whatsappSentDate || "",
      l.aiInsight || "",
      l.notes || "",
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

    // Calculate dynamic column widths based on cell content length to prevent clipping or overlay in Google Sheets/Excel
    const colWidths = colDefs.map((col, colIdx) => {
      let maxLength = col.h.length;
      dataRows.forEach((row) => {
        const val = row[colIdx];
        const valStr = val === null || val === undefined ? "" : String(val);
        if (valStr.length > maxLength) {
          maxLength = valStr.length;
        }
      });
      // Cap column width between the default minimum and 70 characters
      const wch = Math.min(Math.max(maxLength + 3, col.wch), 70);
      return { wch };
    });

    ws["!cols"] = colWidths;

    // Style header row cells (bold + background) using SheetJS cell format
    headerRow.forEach((_, ci) => {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (!ws[cellAddr]) return;
      ws[cellAddr].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4F46E5" } },
        alignment: { horizontal: "center", wrapText: false },
        border: {
          bottom: { style: "thin", color: { rgb: "C7C7E8" } },
          right:  { style: "thin", color: { rgb: "C7C7E8" } },
        },
      };
    });

    // Freeze top header row
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CRM Leads");

    // Write using xlsx — triggers browser download
    XLSX.writeFile(wb, `leads_export_${Date.now()}.xlsx`);
}

export async function exportLeadsToPdf(crmLeads: Lead[]): Promise<void> {
    if (crmLeads.length === 0) {
      alert("No leads available to export.");
      return;
    }

    // ── Load the navbar logo as a base64 data-URL & calculate aspect ratio ──
    let logoDataUrl: string | null = null;
    let logoWidth = 44;
    let logoHeight = 13;
    try {
      const resp = await fetch("/logo.png");
      const blob = await resp.blob();
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Get natural dimensions of the image to prevent stretching
      if (logoDataUrl) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const aspect = img.naturalWidth / img.naturalHeight;
            // Cap height at 12mm to fit clean in our 18mm header height
            logoHeight = 12;
            logoWidth = logoHeight * aspect;
            // Cap width at 50mm to prevent extremely wide logo assets
            if (logoWidth > 50) {
              logoWidth = 50;
              logoHeight = logoWidth / aspect;
            }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = logoDataUrl!;
        });
      }
    } catch {
      // Logo load failed — fall back to text only
      logoDataUrl = null;
    }

    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

    // ── Create A2-landscape document (594 × 420 mm) ────────────────────────
    // A2 landscape gives ~570 mm usable width which fits all 27 columns
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a2" });
    const pageW = doc.internal.pageSize.getWidth();   // ~594 mm
    const exportDate = new Date().toLocaleString();
    const HEADER_H = 18; // header bar height in mm

    // ── Per-page header renderer — plain white background ───────────────────
    const drawPageHeader = () => {
      // Plain white background header
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pageW, HEADER_H, "F");

      // Logo on top-left corner (dynamically scaled width/height)
      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, "PNG", 5, (HEADER_H - logoHeight) / 2, logoWidth, logoHeight);
        } catch {
          doc.setTextColor(79, 70, 229);
          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.text("LeadGenPilot", 5, 11);
        }
      } else {
        doc.setTextColor(79, 70, 229);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("LeadGenPilot", 5, 11);
      }

      // "Lead Report" next to the logo on the left side
      const textX = logoDataUrl ? (logoWidth + 10) : 54;
      doc.setTextColor(30, 41, 59); // dark slate text
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Lead Report", textX, 10.5);

      // Meta details (Export date / total counts) on the right corner
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Exported: ${exportDate}  ·  Total: ${crmLeads.length} leads`,
        pageW - 6, 10.5, { align: "right" }
      );

      // Thin light-grey separator line at the bottom of the header zone
      doc.setDrawColor(226, 232, 240); // border-slate-200
      doc.setLineWidth(0.3);
      doc.line(0, HEADER_H, pageW, HEADER_H);

      // Reset text and drawing colors
      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(0, 0, 0);
    };

    drawPageHeader();

    // ── Single table with ALL columns horizontal ────────────────────────────
    // A2 landscape usable width ≈ 582 mm (6 mm margin each side)
    // Column widths in mm — must total ≤ 582
    const cols = [
      { h: "#",            w: 7,  align: "center" as const },
      { h: "Business Name",w: 34, align: "left"   as const },
      { h: "Phone",        w: 24, align: "left"   as const },
      { h: "Address",      w: 42, align: "left"   as const },
      { h: "Category",     w: 20, align: "left"   as const },
      { h: "Rating",       w: 11, align: "center" as const },
      { h: "Reviews",      w: 12, align: "center" as const },
      { h: "Score",        w: 11, align: "center" as const },
      { h: "Priority",     w: 14, align: "center" as const },
      { h: "Date Added",   w: 19, align: "center" as const },
      { h: "Website",      w: 32, align: "left"   as const },
      { h: "Web Status",   w: 18, align: "center" as const },
      { h: "Emails",       w: 32, align: "left"   as const },
      { h: "Instagram St.",w: 18, align: "center" as const },
      { h: "Facebook St.", w: 18, align: "center" as const },
      { h: "LinkedIn St.", w: 18, align: "center" as const },
      { h: "WhatsApp",     w: 15, align: "center" as const },
      { h: "Appt. Sys.",   w: 14, align: "center" as const },
      { h: "GA",           w: 10, align: "center" as const },
      { h: "Meta Px",      w: 13, align: "center" as const },
      { h: "Email Status", w: 18, align: "center" as const },
      { h: "WA Status",    w: 16, align: "center" as const },
      { h: "Email Sent",   w: 19, align: "center" as const },
      { h: "WA Sent",      w: 19, align: "center" as const },
      { h: "AI Insight",   w: 55, align: "left"   as const },
      { h: "Notes",        w: 28, align: "left"   as const },
    ];

    const head = [cols.map(c => c.h)];
    const body = crmLeads.map((l: Lead, i: number) => [
      String(i + 1),
      l.businessName || "",
      l.phone || "",
      l.address || "",
      l.category || "",
      String(l.rating ?? ""),
      String(l.reviews ?? ""),
      String(l.leadScore ?? ""),
      l.leadPriority || "",
      l.dateAdded ? l.dateAdded.substring(0, 10) : "",
      l.website || "",
      l.websiteStatus || "",
      Array.isArray(l.emails) ? l.emails.join(", ") : "",
      l.instagramStatus || "",
      l.facebookStatus || "",
      l.linkedinStatus || "",
      l.whatsappPresent ? "Yes" : "No",
      l.appointmentSystem ? "Yes" : "No",
      l.googleAnalyticsPresent ? "Yes" : "No",
      l.metaPixelPresent ? "Yes" : "No",
      l.emailStatus || "—",
      l.whatsappStatus || "—",
      l.emailSentDate ? l.emailSentDate.substring(0, 10) : "—",
      l.whatsappSentDate ? l.whatsappSentDate.substring(0, 10) : "—",
      l.aiInsight || "",
      l.notes || "",
    ]);

    const columnStyles: Record<number, any> = {};
    cols.forEach((c, idx) => {
      columnStyles[idx] = { cellWidth: c.w, halign: c.align };
    });

    autoTable(doc, {
      startY: HEADER_H + 2,
      head,
      body,
      theme: "grid",
      margin: { left: 6, right: 6 },
      styles: {
        fontSize: 5.8,
        cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
        overflow: "linebreak",
        valign: "top",
        lineColor: [226, 232, 240], // slate-200 grid lines
        lineWidth: 0.15,
        textColor: [51, 65, 85]     // slate-700 data text
      },
      headStyles: {
        fillColor: [255, 255, 255],  // plain white header background
        textColor: [15, 23, 42],     // dark slate header text
        fontStyle: "bold",
        fontSize: 6,
        halign: "center",
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
        lineColor: [148, 163, 184],  // slate-400 table header bottom border
        lineWidth: 0.25
      },
      alternateRowStyles: { fillColor: [255, 255, 255] }, // plain white row background
      columnStyles,
      didDrawPage: () => drawPageHeader(),
    });

    // ── Page numbers ────────────────────────────────────────────────────────
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${p} of ${totalPages}`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 4,
        { align: "center" }
      );
    }

    doc.save(`leads_export_${Date.now()}.pdf`);
}

export async function exportLeadsToWord(crmLeads: Lead[]): Promise<void> {
    if (crmLeads.length === 0) {
      alert("No leads available to export.");
      return;
    }

    const [{ Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType }, { saveAs }] = await Promise.all([
      import("docx"),
      import("file-saver"),
    ]);

    // Helper: create a header cell
    const hCell = (text: string, widthPct: number) =>
      new TableCell({
        width: { size: widthPct * 100, type: WidthType.PERCENTAGE },
        shading: { fill: "4F46E5" },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [
          new Paragraph({
            children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 16 })],
            spacing: { before: 0, after: 0 },
          }),
        ],
      });

    // Helper: create a data cell
    const dCell = (text: string, widthPct: number, shade = false) =>
      new TableCell({
        width: { size: widthPct * 100, type: WidthType.PERCENTAGE },
        shading: shade ? { fill: "F0F0FF" } : { fill: "FFFFFF" },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: text || "—", size: 14 })],
            spacing: { before: 0, after: 0 },
          }),
        ],
      });

    // ── Section 1: Core Info table ────────────────────────────────────────────
    const coreHeader = new TableRow({
      tableHeader: true,
      children: [
        hCell("#", 2), hCell("Business Name", 18), hCell("Phone", 10),
        hCell("Address", 20), hCell("Category", 10), hCell("Rating", 5),
        hCell("Reviews", 6), hCell("Score", 5), hCell("Priority", 7), hCell("Date Added", 10),
      ],
    });

    const coreRows = crmLeads.map((l: Lead, i: number) => {
      const shade = i % 2 === 1;
      return new TableRow({
        children: [
          dCell(String(i + 1), 2, shade), dCell(l.businessName || "", 18, shade),
          dCell(l.phone || "", 10, shade), dCell(l.address || "", 20, shade),
          dCell(l.category || "", 10, shade), dCell(String(l.rating ?? ""), 5, shade),
          dCell(String(l.reviews ?? ""), 6, shade), dCell(String(l.leadScore ?? ""), 5, shade),
          dCell(l.leadPriority || "", 7, shade),
          dCell(l.dateAdded ? l.dateAdded.substring(0, 10) : "", 10, shade),
        ],
      });
    });

    // ── Section 2: Digital Presence table ─────────────────────────────────────
    const dpHeader = new TableRow({
      tableHeader: true,
      children: [
        hCell("#", 2), hCell("Business Name", 16), hCell("Website", 14),
        hCell("Status", 7), hCell("Emails", 14), hCell("Instagram", 8),
        hCell("Facebook", 8), hCell("LinkedIn", 8), hCell("WA?", 5),
        hCell("GA?", 5), hCell("Meta?", 5), hCell("Email St.", 7), hCell("WA St.", 7),
      ],
    });

    const dpRows = crmLeads.map((l: Lead, i: number) => {
      const shade = i % 2 === 1;
      return new TableRow({
        children: [
          dCell(String(i + 1), 2, shade), dCell(l.businessName || "", 16, shade),
          dCell(l.website || "", 14, shade), dCell(l.websiteStatus || "", 7, shade),
          dCell(Array.isArray(l.emails) ? l.emails.join(", ") : "", 14, shade),
          dCell(l.instagramStatus || "", 8, shade), dCell(l.facebookStatus || "", 8, shade),
          dCell(l.linkedinStatus || "", 8, shade),
          dCell(l.whatsappPresent ? "Yes" : "No", 5, shade),
          dCell(l.googleAnalyticsPresent ? "Yes" : "No", 5, shade),
          dCell(l.metaPixelPresent ? "Yes" : "No", 5, shade),
          dCell(l.emailStatus || "—", 7, shade), dCell(l.whatsappStatus || "—", 7, shade),
        ],
      });
    });

    // ── Section 3: AI Insights table ──────────────────────────────────────────
    const aiHeader = new TableRow({
      tableHeader: true,
      children: [
        hCell("#", 3), hCell("Business Name", 22), hCell("Priority", 8),
        hCell("Score", 7), hCell("AI Insight", 60),
      ],
    });

    const aiRows = crmLeads.map((l: Lead, i: number) => {
      const shade = i % 2 === 1;
      return new TableRow({
        children: [
          dCell(String(i + 1), 3, shade), dCell(l.businessName || "", 22, shade),
          dCell(l.leadPriority || "", 8, shade), dCell(String(l.leadScore ?? ""), 7, shade),
          dCell(l.aiInsight || "", 60, shade),
        ],
      });
    });

    const sectionTitle = (text: string) =>
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 24, color: "4F46E5" })],
        spacing: { before: 400, after: 160 },
      });

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: 18 },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { orientation: "landscape" as any },
              margin: { top: 720, bottom: 720, left: 720, right: 720 },
            },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "LeadGenPilot — CRM Leads Export", bold: true, size: 36, color: "4F46E5" })],
              spacing: { after: 120 },
            }),
            new Paragraph({
              children: [new TextRun({ text: `Generated: ${new Date().toLocaleString()}  |  Total leads: ${crmLeads.length}`, size: 18, color: "666666" })],
              spacing: { after: 400 },
            }),

            sectionTitle("Section 1 — Core Business Information"),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [coreHeader, ...coreRows] }),

            sectionTitle("Section 2 — Digital Presence & Outreach Status"),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [dpHeader, ...dpRows] }),

            sectionTitle("Section 3 — AI Growth Insights"),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [aiHeader, ...aiRows] }),
          ],
        },
      ],
    });

    Packer.toBlob(doc).then((blob) => {
      saveAs(blob, `leads_export_${Date.now()}.docx`);
    });
}
