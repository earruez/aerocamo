// ─────────────────────────────────────────────────────────────────────────────
//  FleetReportDocumentService — PDF del informe ejecutivo de flota
//
//  Versión imprimible de lo que ya se ve en Reportes: disponibilidad,
//  vencimientos y estado por aeronave, calculado con el mismo Due Engine
//  que usa el resto de la plataforma (no duplica lógica de negocio, solo
//  la dibuja). Pensado para llevar a una reunión o adjuntar a un correo.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { prisma } from '../../infrastructure/database/prisma.client';
import { PrismaAircraftRepository } from '../../infrastructure/database/repositories/PrismaAircraftRepository';
import { drawOrganizationLogo } from '../../shared/pdfLogo';

const PAGE = { width: 841.89, height: 595.28 }; // A4 apaisado
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 40;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';
const OK_COLOR = '#16a34a';
const WARN_COLOR = '#d97706';
const BAD_COLOR = '#dc2626';

const STATUS_LABEL: Record<string, string> = {
  OPERATIONAL: 'Operacional',
  IN_MAINTENANCE: 'En mantenimiento',
  GROUNDED: 'En tierra',
  AOG: 'AOG',
  DECOMMISSIONED: 'Retirada',
};

const STATUS_COLOR: Record<string, string> = {
  OPERATIONAL: OK_COLOR,
  IN_MAINTENANCE: WARN_COLOR,
  GROUNDED: WARN_COLOR,
  AOG: BAD_COLOR,
  DECOMMISSIONED: MUTED,
};

const fmtDate = (d: Date): string =>
  new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d);

const fmtNumber = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('es-CL', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
};

type Doc = PDFKit.PDFDocument;

interface FleetRow {
  registration: string;
  model: string;
  status: string;
  totalHours: number;
  totalCycles: number;
  totalTasks: number;
  overdue: number;
  dueSoon: number;
}

export class FleetReportDocumentService {
  static async generateExecutiveReport(organizationId: string): Promise<Buffer> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalName: true, logoDataUri: true },
    });
    if (!org) throw new Error('Organization not found');

    const aircraftList = await prisma.aircraft.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true, registration: true, model: true, status: true,
        totalFlightHours: true, totalCycles: true,
      },
      orderBy: { registration: 'asc' },
    });

    const repo = new PrismaAircraftRepository();
    const rows: FleetRow[] = await Promise.all(
      aircraftList.map(async (a) => {
        const plan = await repo.getMaintenancePlan(a.id, organizationId);
        const active = plan.filter((i) => i.isApplicable);
        return {
          registration: a.registration,
          model: a.model,
          status: a.status,
          totalHours: Number(a.totalFlightHours),
          totalCycles: a.totalCycles,
          totalTasks: active.length,
          overdue: active.filter((i) => i.status === 'OVERDUE').length,
          dueSoon: active.filter((i) => i.status === 'DUE_SOON').length,
        };
      }),
    );

    // Lo más urgente arriba: primero quien tiene vencidas, luego próx. a vencer.
    rows.sort((a, b) => (b.overdue - a.overdue) || (b.dueSoon - a.dueSoon) || a.registration.localeCompare(b.registration));

    return this.renderPdf(org, rows);
  }

  private static renderPdf(
    org: { name: string; legalName: string | null; logoDataUri: string | null },
    rows: FleetRow[],
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

    this.drawHeader(doc, org, rows.length);
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

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('INFORME EJECUTIVO DE FLOTA', textX, 24);
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

  private static drawSummary(doc: Doc, rows: FleetRow[], y: number): number {
    const total = rows.length;
    const operational = rows.filter((r) => r.status === 'OPERATIONAL').length;
    const availabilityPct = total > 0 ? Math.round((operational / total) * 100) : 0;
    const totalHours = rows.reduce((s, r) => s + r.totalHours, 0);
    const overdueTasks = rows.reduce((s, r) => s + r.overdue, 0);
    const dueSoonTasks = rows.reduce((s, r) => s + r.dueSoon, 0);

    const cards = [
      { label: 'Aeronaves', value: String(total), color: INK },
      { label: 'Disponibilidad', value: `${availabilityPct}%`, color: availabilityPct >= 80 ? OK_COLOR : availabilityPct >= 50 ? WARN_COLOR : BAD_COLOR },
      { label: 'Horas totales', value: fmtNumber(totalHours, 0), color: INK },
      { label: 'Tareas vencidas', value: String(overdueTasks), color: overdueTasks > 0 ? BAD_COLOR : OK_COLOR },
      { label: 'Próx. a vencer', value: String(dueSoonTasks), color: dueSoonTasks > 0 ? WARN_COLOR : OK_COLOR },
    ];
    const cardW = CONTENT_WIDTH / cards.length;
    cards.forEach((c, i) => {
      const x = MARGIN + i * cardW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(c.label.toUpperCase(), x, y, { width: cardW - 10 });
      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(16).text(c.value, x, y + 10, { width: cardW - 10 });
    });
    doc.fillColor(INK);
    return y + 44;
  }

  private static tableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('MATRÍCULA', MARGIN + 6, y + 5, { width: 90 });
    doc.text('MODELO', MARGIN + 96, y + 5, { width: 200 });
    doc.text('HORAS TOTALES', MARGIN + 296, y + 5, { width: 90, align: 'right' });
    doc.text('CICLOS', MARGIN + 386, y + 5, { width: 80, align: 'right' });
    doc.text('TAREAS', MARGIN + 466, y + 5, { width: 70, align: 'right' });
    doc.text('VENCIDAS', MARGIN + 536, y + 5, { width: 90, align: 'right' });
    doc.text('PRÓX. A VENCER', MARGIN + 626, y + 5, { width: 100, align: 'right' });
    doc.text('ESTADO', MARGIN + 726, y + 5, { width: 74 });
    doc.fillColor(INK);
    return y + 20;
  }

  private static ensureSpace(doc: Doc, y: number, needed: number): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return this.tableHeader(doc, MARGIN);
  }

  private static drawTable(doc: Doc, rows: FleetRow[], y: number): void {
    y = this.tableHeader(doc, y);

    for (const row of rows) {
      const rowHeight = 18;
      y = this.ensureSpace(doc, y, rowHeight);

      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(row.registration, MARGIN + 6, y + 2, { width: 90 });
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(row.model, MARGIN + 96, y + 3, { width: 200 });
      doc.fillColor(INK).text(`${fmtNumber(row.totalHours)} FH`, MARGIN + 296, y + 3, { width: 90, align: 'right' });
      doc.text(String(row.totalCycles), MARGIN + 386, y + 3, { width: 80, align: 'right' });
      doc.text(String(row.totalTasks), MARGIN + 466, y + 3, { width: 70, align: 'right' });
      doc.fillColor(row.overdue > 0 ? BAD_COLOR : MUTED).font('Helvetica-Bold')
        .text(String(row.overdue), MARGIN + 536, y + 3, { width: 90, align: 'right' });
      doc.fillColor(row.dueSoon > 0 ? WARN_COLOR : MUTED).font('Helvetica')
        .text(String(row.dueSoon), MARGIN + 626, y + 3, { width: 100, align: 'right' });
      doc.fillColor(STATUS_COLOR[row.status] ?? MUTED).font('Helvetica-Bold').fontSize(7.5)
        .text(STATUS_LABEL[row.status] ?? row.status, MARGIN + 726, y + 3, { width: 74 });

      doc.fillColor(INK);
      y += rowHeight;
      doc.moveTo(MARGIN, y - 2).lineTo(PAGE.width - MARGIN, y - 2).lineWidth(0.3).stroke('#e2e8f0');
    }

    if (rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Sin aeronaves activas registradas.', MARGIN, y + 10);
    }
  }

  private static drawFooters(doc: Doc, org: { name: string }): void {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE.width - MARGIN, FOOTER_TOP).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7);
      doc.text(`Informe Ejecutivo de Flota · ${org.name}`, MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
