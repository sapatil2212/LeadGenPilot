/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign dispatch report exporter — renders a CampaignHistoryRecord[] into
 * CSV, PDF, or Word (.docx) buffers for download. Generation happens
 * server-side so the client bundle stays free of PDF/Word rendering code.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel } from "docx";
import { CampaignHistoryRecord } from "./campaignHistory";

const COLUMNS = ["Date", "Business", "Channel", "Status", "Recipient", "Subject / Message"];

function toRow(r: CampaignHistoryRecord): string[] {
  return [
    new Date(r.timestamp).toLocaleString("en-IN"),
    r.businessName,
    r.channel === "email" ? "Email" : "WhatsApp",
    r.status,
    r.recipient,
    (r.subject || r.messageSnippet || "").slice(0, 80),
  ];
}

/** CSV export — RFC4180-ish escaping, safe for Excel/Sheets. */
export function exportCampaignHistoryToCsv(records: CampaignHistoryRecord[]): string {
  const escape = (v: string) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.map(escape).join(",")];
  for (const r of records) {
    lines.push(toRow(r).map(escape).join(","));
  }
  return lines.join("\n");
}

/** PDF export — table report with a title and generation timestamp. */
export function exportCampaignHistoryToPdf(records: CampaignHistoryRecord[]): Buffer {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Campaign Dispatch Report", 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")} • ${records.length} record(s)`, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [COLUMNS],
    body: records.map(toRow),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [79, 70, 229] }, // indigo-600
    alternateRowStyles: { fillColor: [248, 250, 252] }, // slate-50
    theme: "grid",
  });

  return Buffer.from(doc.output("arraybuffer"));
}

/** Word (.docx) export — title + summary + a table, matching the PDF layout. */
export async function exportCampaignHistoryToDocx(records: CampaignHistoryRecord[]): Promise<Buffer> {
  const headerRow = new TableRow({
    children: COLUMNS.map(
      (c) =>
        new TableCell({
          width: { size: 100 / COLUMNS.length, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: c, bold: true })] })],
        })
    ),
  });

  const bodyRows = records.map(
    (r) =>
      new TableRow({
        children: toRow(r).map(
          (cell) =>
            new TableCell({
              width: { size: 100 / COLUMNS.length, type: WidthType.PERCENTAGE },
              children: [new Paragraph(cell)],
            })
        ),
      })
  );

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Campaign Dispatch Report", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Generated ${new Date().toLocaleString("en-IN")} • ${records.length} record(s)`,
                italics: true,
                color: "666666",
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
