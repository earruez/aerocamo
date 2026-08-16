// ─────────────────────────────────────────────────────────────────────────────
//  FleetLookaheadDocumentService — PDF de vencimientos de toda la flota
//
//  Remanentes ya arma esto por aeronave; este informe hace lo mismo pero
//  agregado a nivel de flota, para planificar mantenimiento con anticipación
//  sin tener que abrir aeronave por aeronave. Solo vencidas y próximas a
//  vencer — lo que ya está OK no aporta a una reunión de planificación.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { prisma } from '../../infrastructure/database/prisma.client';
import { dueEngineService, type DueRow, type DueStatus } from './DueEngineService';
import { drawOrganizationLogo } from '../../shared/pdfLogo';

const PAGE = { width: 841.89, height: 595.28 }; // A4 apaisado
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 40;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';

const STATUS_LABELS: Record<string, string> = {
  OVERDUE: 'Vencidas',
  DUE_SOON: 'Próximas a vencer',
};
const STATUS_ORDER: DueStatus[] = ['OVERDUE', 'DUE_SOON'];
const STATUS_COLOR: Record<string, string> = {
  OVERDUE: '#dc2626',
  DUE_SOON: '#d97706',
};

const fmtDate = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';

const fmtNumber = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};

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

type Doc = PDFKit.PDFDocument;

interface FleetDueRow extends DueRow {
  aircraftRegistration: string;
}

export class FleetLookaheadDocumentService {
  static async generateReport(organizationId: string): Promise<Buffer> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalName: true, logoDataUri: true },
    });
    if (!org) throw new Error('Organization not found');

    const aircraftList = await prisma.aircraft.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, registration: true },
      orderBy: { registration: 'asc' },
    });

    const rowsPerAircraft = await Promise.all(
      aircraftList.map((a) => dueEngineService.getDueRows(organizationId, a.id)),
    );

    const rows: FleetDueRow[] = rowsPerAircraft
      .flatMap((rows, i) => rows.map((r) => ({ ...r, aircraftRegistration: aircraftList[i].registration })))
      .filter((r) => (r.status === 'OVERDUE' || r.status === 'DUE_SOON') && r.isApplicable);

    // Dentro de cada estado, lo más urgente primero (remanente menor = más cerca).
    rows.sort((a, b) => {
      const av = a.remainingValue ?? Number.POSITIVE_INFINITY;
      const bv = b.remainingValue ?? Number.POSITIVE_INFINITY;
      return av - bv;
    });

    return this.renderPdf(org, rows, aircraftList.length);
  }

  private static renderPdf(
    org: { name: string; legalName: string | null; logoDataUri: string | null },
    rows: FleetDueRow[],
    aircraftCount: number,
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

    this.drawHeader(doc, org, aircraftCount);
    let y = 112;
    y = this.drawSummary(doc, rows, y);
    this.drawTable(doc, rows, y);
    this.drawFooters(doc, org);

    doc.end();
    return done;
  }

  private static drawHeader(
    doc: Doc,
    org: { name: string; legalName: string | null; logoDataUri: string | null },
    aircraftCount: number,
  ): void {
    doc.rect(0, 0, PAGE.width, 88).fill(BAND);

    const logoW = drawOrganizationLogo(doc, org.logoDataUri, MARGIN, 14, 36);
    const textX = logoW > 0 ? MARGIN + logoW + 12 : MARGIN;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('INFORME DE VENCIMIENTOS DE FLOTA', textX, 24);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(org.name.toUpperCase(), textX, 44);
    if (org.legalName) doc.fontSize(8).text(org.legalName, textX, 56);

    const boxW = 200;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 18, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('AERONAVES', boxX + 10, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(String(aircraftCount), boxX + 10, 36);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 90, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(fmtDate(new Date()), boxX + 90, 38);

    doc.moveTo(MARGIN, 88).lineTo(PAGE.width - MARGIN, 88).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static drawSummary(doc: Doc, rows: FleetDueRow[], y: number): number {
    const overdue = rows.filter((r) => r.status === 'OVERDUE').length;
    const dueSoon = rows.filter((r) => r.status === 'DUE_SOON').length;
    const aircraftAffected = new Set(rows.map((r) => r.aircraftRegistration)).size;

    const cards = [
      { label: 'Tareas vencidas', value: String(overdue), color: STATUS_COLOR.OVERDUE },
      { label: 'Próximas a vencer', value: String(dueSoon), color: STATUS_COLOR.DUE_SOON },
      { label: 'Total a atender', value: String(rows.length), color: INK },
      { label: 'Aeronaves afectadas', value: String(aircraftAffected), color: INK },
    ];
    const cardW = CONTENT_WIDTH / cards.length;
    cards.forEach((c, i) => {
      const x = MARGIN + i * cardW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(c.label.toUpperCase(), x, y, { width: cardW - 10 });
      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(16).text(c.value, x, y + 10, { width: cardW - 10 });
    });
    doc.fillColor(INK);
    return y + 40;
  }

  private static tableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('MAT', MARGIN + 6, y + 5, { width: 44 });
    doc.text('TIPO', MARGIN + 50, y + 5, { width: 56 });
    doc.text('ATA', MARGIN + 106, y + 5, { width: 36 });
    doc.text('DESCRIPCIÓN', MARGIN + 142, y + 5, { width: 220 });
    doc.text('MÉTODO', MARGIN + 362, y + 5, { width: 44 });
    doc.text('PRÓXIMO', MARGIN + 406, y + 5, { width: 68 });
    doc.text('REMANENTE', MARGIN + 474, y + 5, { width: 80 });
    doc.text('OT/ST', MARGIN + 554, y + 5, { width: 60 });
    doc.text('ESTADO', MARGIN + 614, y + 5, { width: 60 });
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

  private static drawTable(doc: Doc, rows: FleetDueRow[], y: number): void {
    const grouped = STATUS_ORDER
      .map((status) => ({ status, items: rows.filter((r) => r.status === status) }))
      .filter((g) => g.items.length > 0);

    if (grouped.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('No hay tareas vencidas ni próximas a vencer en la flota.', MARGIN, y + 10);
      return;
    }

    for (const group of grouped) {
      y = this.ensureSpace(doc, y, 30, false);
      y = this.sectionTitle(doc, `${STATUS_LABELS[group.status]} (${group.items.length})`, y);
      y = this.tableHeader(doc, y);

      for (const row of group.items) {
        const descHeight = doc.font('Helvetica').fontSize(7.5).heightOfString(row.description, { width: 220 });
        const rowHeight = Math.max(descHeight, 10) + 6;
        y = this.ensureSpace(doc, y, rowHeight, true);

        doc.fillColor(INK).font('Helvetica-Bold').fontSize(7).text(row.aircraftRegistration, MARGIN + 6, y, { width: 44 });
        doc.font('Helvetica').fillColor(MUTED).text(row.sourceType, MARGIN + 50, y, { width: 56 });
        doc.text(row.ata ?? '—', MARGIN + 106, y, { width: 36 });
        doc.fillColor(INK).fontSize(7.5).text(row.description, MARGIN + 142, y, { width: 220 });
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(row.method, MARGIN + 362, y, { width: 44 });
        doc.text(fmtNext(row), MARGIN + 406, y, { width: 68 });
        doc.text(fmtRemaining(row), MARGIN + 474, y, { width: 80 });
        doc.text(row.referenceOt ?? row.referenceSt ?? '—', MARGIN + 554, y, { width: 60 });
        doc.fillColor(STATUS_COLOR[row.status] ?? MUTED).font('Helvetica-Bold')
          .text(STATUS_LABELS[row.status] ?? row.status, MARGIN + 614, y, { width: 60 });

        doc.fillColor(INK);
        y += rowHeight;
        doc.moveTo(MARGIN, y - 2).lineTo(PAGE.width - MARGIN, y - 2).lineWidth(0.3).stroke('#e2e8f0');
      }
      y += 10;
    }
  }

  private static drawFooters(doc: Doc, org: { name: string }): void {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE.width - MARGIN, FOOTER_TOP).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7);
      doc.text(`Informe de Vencimientos de Flota · ${org.name}`, MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
