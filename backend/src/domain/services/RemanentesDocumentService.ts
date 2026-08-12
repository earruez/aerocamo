// ─────────────────────────────────────────────────────────────────────────────
//  RemanentesDocumentService — PDF del informe de remanentes operacionales
//
//  Resume, para una aeronave, todo lo que el Due Engine calculó: qué está
//  vencido, qué vence pronto, y qué remanente le queda a cada tarea. Se agrupa
//  por estado (vencido primero) para que lo más urgente quede al principio,
//  no enterrado entre cientos de filas en OK.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { dueEngineService, type DueRow, type DueStatus } from './DueEngineService';
import { prisma } from '../../infrastructure/database/prisma.client';

const PAGE = { width: 841.89, height: 595.28 }; // A4 apaisado: la tabla necesita el ancho
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 40;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';

const STATUS_LABELS: Record<DueStatus, string> = {
  OVERDUE: 'Vencido',
  DUE_SOON: 'Próx. a vencer',
  OK: 'OK',
  NO_CONTEXT: 'Sin contexto',
  NOT_APPLICABLE: 'No aplica',
  COMPLIED: 'Cumplido',
};

const STATUS_ORDER: DueStatus[] = ['OVERDUE', 'DUE_SOON', 'OK', 'NO_CONTEXT', 'NOT_APPLICABLE', 'COMPLIED'];

const STATUS_COLOR: Record<DueStatus, string> = {
  OVERDUE: '#dc2626',
  DUE_SOON: '#d97706',
  OK: '#16a34a',
  NO_CONTEXT: '#64748b',
  NOT_APPLICABLE: '#64748b',
  COMPLIED: '#16a34a',
};

const fmtDate = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';

const fmtNumber = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};

function fmtInterval(row: DueRow): string {
  if (row.intervalValue == null) return '—';
  return `${fmtNumber(row.intervalValue, row.intervalUnit === 'MONTHS' || row.intervalUnit === 'DAYS' ? 0 : 1)} ${row.intervalUnit ?? ''}`.trim();
}

function fmtNext(row: DueRow): string {
  if (row.nextDueDate) return fmtDate(row.nextDueDate);
  if (row.nextDueValue != null) return `${fmtNumber(row.nextDueValue, 1)} ${row.remainingUnit ?? ''}`.trim();
  return '—';
}

function fmtRemaining(row: DueRow): string {
  if (row.remainingValue == null) return '—';
  const unit = row.remainingUnit ? ` ${row.remainingUnit}` : '';
  if (row.remainingValue < 0) return `${fmtNumber(Math.abs(row.remainingValue))}${unit} vencido`;
  return `${fmtNumber(row.remainingValue)}${unit}`;
}

function fmtEngineRemaining(row: DueRow, method: 'N1' | 'N2'): string {
  const dim = row.dimensions.find((d) => d.method === method);
  if (!dim || dim.remainingValue == null) return '—';
  const unit = dim.remainingUnit ? ` ${dim.remainingUnit}` : '';
  if (dim.remainingValue < 0) return `${fmtNumber(Math.abs(dim.remainingValue))}${unit} vencido`;
  return `${fmtNumber(dim.remainingValue)}${unit}`;
}

type Doc = PDFKit.PDFDocument;

type DueReportData = Awaited<ReturnType<typeof dueEngineService.getDueReportData>>;

export class RemanentesDocumentService {
  static async generateReport(organizationId: string, aircraftId: string): Promise<Buffer> {
    const report = await dueEngineService.getDueReportData(organizationId, aircraftId);
    return this.renderPdf(organizationId, report);
  }

  static async renderPdf(organizationId: string, report: DueReportData): Promise<Buffer> {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, legalName: true } });
    if (!org) throw new Error('Organization not found');

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

    this.drawHeader(doc, org, report.aircraft);
    let y = 112;
    y = this.drawSummary(doc, report.summary, y);
    this.drawTable(doc, report.rows, y);
    this.drawFooters(doc, report.aircraft, org);

    doc.end();
    return done;
  }

  private static drawHeader(
    doc: Doc,
    org: { name: string; legalName: string | null },
    aircraft: { registration: string; model: string; serialNumber: string; totalHours: number; totalCycles: number },
  ): void {
    doc.rect(0, 0, PAGE.width, 88).fill(BAND);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('INFORME DE REMANENTES OPERACIONALES', MARGIN, 24);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(org.name.toUpperCase(), MARGIN, 44);
    if (org.legalName) doc.fontSize(8).text(org.legalName, MARGIN, 56);

    const boxW = 240;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 18, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('AERONAVE', boxX + 10, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(aircraft.registration, boxX + 10, 36);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${aircraft.model} · S/N ${aircraft.serialNumber}`, boxX + 90, 39);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('HORAS TOTALES', boxX + 10, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`${fmtNumber(aircraft.totalHours)} FH`, boxX + 10, 67);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('CICLOS', boxX + 90, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(String(aircraft.totalCycles), boxX + 90, 67);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 150, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(fmtDate(new Date()), boxX + 150, 67);

    doc.moveTo(MARGIN, 88).lineTo(PAGE.width - MARGIN, 88).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static drawSummary(
    doc: Doc,
    summary: { overdueCount: number; dueSoonCount: number; okCount: number; noContextCount: number; totalRows: number },
    y: number,
  ): number {
    const cards = [
      { label: 'Vencidos', value: summary.overdueCount, color: STATUS_COLOR.OVERDUE },
      { label: 'Próx. a vencer', value: summary.dueSoonCount, color: STATUS_COLOR.DUE_SOON },
      { label: 'OK', value: summary.okCount, color: STATUS_COLOR.OK },
      { label: 'Sin contexto', value: summary.noContextCount, color: STATUS_COLOR.NO_CONTEXT },
      { label: 'Total', value: summary.totalRows, color: INK },
    ];
    const cardW = CONTENT_WIDTH / cards.length;
    cards.forEach((c, i) => {
      const x = MARGIN + i * cardW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(c.label.toUpperCase(), x, y, { width: cardW - 10 });
      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(16).text(String(c.value), x, y + 10, { width: cardW - 10 });
    });
    doc.fillColor(INK);
    return y + 40;
  }

  private static tableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('TIPO', MARGIN + 6, y + 5, { width: 68 });
    doc.text('ATA', MARGIN + 78, y + 5, { width: 48 });
    doc.text('DESCRIPCIÓN', MARGIN + 132, y + 5, { width: 188 });
    doc.text('P/N', MARGIN + 326, y + 5, { width: 54 });
    doc.text('MÉTODO', MARGIN + 386, y + 5, { width: 34 });
    doc.text('INTERVALO', MARGIN + 426, y + 5, { width: 52 });
    doc.text('PRÓXIMO', MARGIN + 484, y + 5, { width: 52 });
    doc.text('REMANENTE', MARGIN + 542, y + 5, { width: 60 });
    doc.text('N1 REM', MARGIN + 608, y + 5, { width: 46 });
    doc.text('N2 REM', MARGIN + 660, y + 5, { width: 46 });
    doc.text('ESTADO', MARGIN + 712, y + 5, { width: 48 });
    doc.fillColor(INK);
    return y + 20;
  }

  private static sectionTitle(doc: Doc, title: string, y: number): number {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), MARGIN, y);
    doc.moveTo(MARGIN, y + 12).lineTo(PAGE.width - MARGIN, y + 12).lineWidth(0.7).stroke(LINE);
    return y + 20;
  }

  private static ensureSpace(doc: Doc, y: number, needed: number, withTableHeader: boolean): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return withTableHeader ? this.tableHeader(doc, MARGIN) : MARGIN;
  }

  private static drawTable(doc: Doc, rows: DueRow[], y: number): void {
    const grouped = STATUS_ORDER
      .map((status) => ({ status, items: rows.filter((r) => r.status === status) }))
      .filter((g) => g.items.length > 0);

    for (const group of grouped) {
      y = this.ensureSpace(doc, y, 30, false);
      y = this.sectionTitle(doc, `${STATUS_LABELS[group.status]} (${group.items.length})`, y);
      y = this.tableHeader(doc, y);

      for (const row of group.items) {
        const descHeight = doc.font('Helvetica').fontSize(7.5).heightOfString(row.description, { width: 188 });
        const rowHeight = Math.max(descHeight, 10) + 6;
        y = this.ensureSpace(doc, y, rowHeight, true);

        doc.fillColor(INK).font('Helvetica').fontSize(7).text(row.sourceType, MARGIN + 6, y, { width: 68 });
        doc.fillColor(MUTED).text(row.ata ?? '—', MARGIN + 78, y, { width: 48 });
        doc.fillColor(INK).fontSize(7.5).text(row.description, MARGIN + 132, y, { width: 188 });
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(row.partNumber ?? '—', MARGIN + 326, y, { width: 54 });
        doc.text(row.method, MARGIN + 386, y, { width: 34 });
        doc.text(fmtInterval(row), MARGIN + 426, y, { width: 52 });
        doc.text(fmtNext(row), MARGIN + 484, y, { width: 52 });
        doc.text(fmtRemaining(row), MARGIN + 542, y, { width: 60 });
        doc.text(fmtEngineRemaining(row, 'N1'), MARGIN + 608, y, { width: 46 });
        doc.text(fmtEngineRemaining(row, 'N2'), MARGIN + 660, y, { width: 46 });
        doc.fillColor(STATUS_COLOR[row.status]).font('Helvetica-Bold')
          .text(STATUS_LABELS[row.status], MARGIN + 712, y, { width: 48 });

        doc.fillColor(INK);
        y += rowHeight;
        doc.moveTo(MARGIN, y - 2).lineTo(PAGE.width - MARGIN, y - 2).lineWidth(0.3).stroke('#e2e8f0');
      }
      y += 10;
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
      doc.text(`Remanentes ${aircraft.registration} · ${org.name}`, MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
