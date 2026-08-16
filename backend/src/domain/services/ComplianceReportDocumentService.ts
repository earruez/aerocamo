// ─────────────────────────────────────────────────────────────────────────────
//  ComplianceReportDocumentService — PDF de cumplimiento regulatorio por aeronave
//
//  El libro de cumplimientos de una aeronave, para presentar a DGAC o a un
//  auditor: qué se hizo, cuándo, con qué horas/ciclos, quién lo firmó y cuándo
//  vence de nuevo. Usa exactamente los mismos registros de Compliance que ya
//  se ven en /conformities — esto es solo la versión imprimible.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { prisma } from '../../infrastructure/database/prisma.client';
import { drawOrganizationLogo } from '../../shared/pdfLogo';
import { NotFoundError } from '../../shared/errors/AppError';

const PAGE = { width: 841.89, height: 595.28 }; // A4 apaisado
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 40;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';

const fmtDate = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';

const fmtNumber = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('es-CL', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
};

type Doc = PDFKit.PDFDocument;

interface ComplianceRow {
  performedAt: Date;
  taskCode: string;
  taskTitle: string;
  reference: string;
  hours: number;
  cycles: number;
  nextDue: string;
  otSt: string;
  performedBy: string;
}

export class ComplianceReportDocumentService {
  static async generateAircraftReport(organizationId: string, aircraftId: string): Promise<Buffer> {
    const [org, aircraft] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, legalName: true, logoDataUri: true } }),
      prisma.aircraft.findFirst({ where: { id: aircraftId, organizationId }, select: { registration: true, model: true, serialNumber: true } }),
    ]);
    if (!org) throw new Error('Organization not found');
    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);

    const records = await prisma.compliance.findMany({
      where: { organizationId, aircraftId },
      include: {
        task: { select: { code: true, ata: true, title: true, referenceType: true, referenceNumber: true } },
        performedBy: { select: { name: true } },
      },
      orderBy: { performedAt: 'desc' },
    });

    const rows: ComplianceRow[] = records.map((r) => ({
      performedAt: r.performedAt,
      taskCode: r.task?.code ?? '—',
      taskTitle: r.task?.title ?? '—',
      reference: [r.task?.referenceType, r.task?.referenceNumber].filter(Boolean).join(' ') || '—',
      hours: Number(r.aircraftHoursAtCompliance),
      cycles: r.aircraftCyclesAtCompliance,
      nextDue: r.nextDueDate ? fmtDate(r.nextDueDate) : r.nextDueHours != null ? `${fmtNumber(r.nextDueHours)} h` : '—',
      otSt: r.workOrderNumber ?? '—',
      performedBy: r.performedBy?.name ?? '—',
    }));

    return this.renderPdf(org, aircraft, rows);
  }

  private static renderPdf(
    org: { name: string; legalName: string | null; logoDataUri: string | null },
    aircraft: { registration: string; model: string; serialNumber: string },
    rows: ComplianceRow[],
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: MARGIN, bottom: 22, left: MARGIN, right: MARGIN },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawHeader(doc, org, aircraft, rows.length);
    this.drawTable(doc, rows, 112);
    this.drawFooters(doc, aircraft, org);

    doc.end();
    return done;
  }

  private static drawHeader(
    doc: Doc,
    org: { name: string; legalName: string | null; logoDataUri: string | null },
    aircraft: { registration: string; model: string; serialNumber: string },
    total: number,
  ): void {
    doc.rect(0, 0, PAGE.width, 88).fill(BAND);

    const logoW = drawOrganizationLogo(doc, org.logoDataUri, MARGIN, 14, 36);
    const textX = logoW > 0 ? MARGIN + logoW + 12 : MARGIN;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('INFORME DE CUMPLIMIENTO REGULATORIO', textX, 24);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(org.name.toUpperCase(), textX, 44);
    if (org.legalName) doc.fontSize(8).text(org.legalName, textX, 56);

    const boxW = 260;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 18, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('AERONAVE', boxX + 10, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(aircraft.registration, boxX + 10, 36);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${aircraft.model} · S/N ${aircraft.serialNumber}`, boxX + 90, 39);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('REGISTROS', boxX + 10, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(String(total), boxX + 10, 67);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 90, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(fmtDate(new Date()), boxX + 90, 67);

    doc.moveTo(MARGIN, 88).lineTo(PAGE.width - MARGIN, 88).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static tableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('FECHA', MARGIN + 6, y + 5, { width: 55 });
    doc.text('TAREA', MARGIN + 61, y + 5, { width: 70 });
    doc.text('DESCRIPCIÓN', MARGIN + 131, y + 5, { width: 190 });
    doc.text('REF. NORMATIVA', MARGIN + 321, y + 5, { width: 100 });
    doc.text('HORAS', MARGIN + 421, y + 5, { width: 50, align: 'right' });
    doc.text('CICLOS', MARGIN + 471, y + 5, { width: 50, align: 'right' });
    doc.text('PRÓX. VENCIMIENTO', MARGIN + 521, y + 5, { width: 80 });
    doc.text('OT/ST', MARGIN + 601, y + 5, { width: 50 });
    doc.text('REALIZADO POR', MARGIN + 651, y + 5, { width: 90 });
    doc.fillColor(INK);
    return y + 20;
  }

  private static ensureSpace(doc: Doc, y: number, needed: number): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return this.tableHeader(doc, MARGIN);
  }

  private static drawTable(doc: Doc, rows: ComplianceRow[], startY: number): void {
    let y = this.tableHeader(doc, startY);

    if (rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Sin cumplimientos registrados para esta aeronave.', MARGIN, y + 10);
      return;
    }

    for (const row of rows) {
      const titleHeight = doc.font('Helvetica').fontSize(7.5).heightOfString(row.taskTitle, { width: 220 });
      const rowHeight = Math.max(titleHeight, 10) + 6;
      y = this.ensureSpace(doc, y, rowHeight);

      doc.fillColor(INK).font('Helvetica').fontSize(7).text(fmtDate(row.performedAt), MARGIN + 6, y, { width: 55 });
      doc.font('Helvetica-Bold').text(row.taskCode, MARGIN + 61, y, { width: 70 });
      doc.font('Helvetica').fontSize(7.5).text(row.taskTitle, MARGIN + 131, y, { width: 190 });
      doc.fontSize(7).fillColor(MUTED).text(row.reference, MARGIN + 321, y, { width: 100 });
      doc.text(fmtNumber(row.hours), MARGIN + 421, y, { width: 50, align: 'right' });
      doc.text(String(row.cycles), MARGIN + 471, y, { width: 50, align: 'right' });
      doc.fillColor(INK).text(row.nextDue, MARGIN + 521, y, { width: 80 });
      doc.fillColor(MUTED).text(row.otSt, MARGIN + 601, y, { width: 50 });
      doc.text(row.performedBy, MARGIN + 651, y, { width: 90 });

      doc.fillColor(INK);
      y += rowHeight;
      doc.moveTo(MARGIN, y - 2).lineTo(PAGE.width - MARGIN, y - 2).lineWidth(0.3).stroke('#e2e8f0');
    }
  }

  private static drawFooters(
    doc: Doc,
    aircraft: { registration: string },
    org: { name: string },
  ): void {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE.width - MARGIN, FOOTER_TOP).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7);
      doc.text(`Cumplimiento Regulatorio ${aircraft.registration} · ${org.name}`, MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
