// ─────────────────────────────────────────────────────────────────────────────
//  WorkOrderLaborCostDocumentService — PDF de horas-hombre y costo estimado
//
//  La plataforma todavía no registra horas-hombre REALES en el backend (hoy
//  viven solo en localStorage del navegador, ver WorkOrderDetailPage.tsx) —
//  así que este informe es explícitamente de horas ESTIMADAS: la suma de
//  estimatedManHours de las tareas completadas de cada OT cerrada, valorizada
//  a una tarifa fija. Se rotula así en todo el documento para no hacer pasar
//  una estimación por un costo real.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { prisma } from '../../infrastructure/database/prisma.client';
import { drawOrganizationLogo } from '../../shared/pdfLogo';

const PAGE = { width: 841.89, height: 595.28 }; // A4 apaisado
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 40;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';

/** Misma tarifa placeholder que usa el frontend (WorkOrderDetailPage.tsx) para
 * mostrar un costo estimado — no hay tarifa configurable por organización aún. */
const LABOR_RATE_USD_PER_HOUR = 85;

const fmtDate = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';

const fmtNumber = (v: number, digits = 1): string =>
  v.toLocaleString('es-CL', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtCurrency = (v: number): string => `US$ ${v.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

type Doc = PDFKit.PDFDocument;

interface LaborRow {
  number: string;
  aircraftRegistration: string;
  title: string;
  technician: string;
  closedAt: Date | null;
  completedTasks: number;
  estimatedHours: number;
}

export class WorkOrderLaborCostDocumentService {
  static async generateReport(organizationId: string, options?: { from?: Date; to?: Date }): Promise<Buffer> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalName: true, logoDataUri: true },
    });
    if (!org) throw new Error('Organization not found');

    const workOrders = await prisma.workOrder.findMany({
      where: {
        organizationId,
        isActive: true,
        status: 'CLOSED',
        ...(options?.from || options?.to
          ? { closedAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
          : {}),
      },
      select: {
        number: true,
        closedAt: true,
        aircraft: { select: { registration: true } },
        assignedTechnician: { select: { name: true } },
        tasks: {
          where: { isCompleted: true },
          select: { task: { select: { estimatedManHours: true } } },
        },
      },
      orderBy: { closedAt: 'desc' },
    });

    const rows: LaborRow[] = workOrders.map((wo) => {
      const estimatedHours = wo.tasks.reduce((s, t) => s + Number(t.task.estimatedManHours ?? 0), 0);
      return {
        number: wo.number,
        aircraftRegistration: wo.aircraft.registration,
        title: wo.number,
        technician: wo.assignedTechnician?.name ?? '—',
        closedAt: wo.closedAt,
        completedTasks: wo.tasks.length,
        estimatedHours,
      };
    });

    return this.renderPdf(org, rows, options);
  }

  private static renderPdf(
    org: { name: string; legalName: string | null; logoDataUri: string | null },
    rows: LaborRow[],
    options?: { from?: Date; to?: Date },
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

    this.drawHeader(doc, org, options);
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
    options?: { from?: Date; to?: Date },
  ): void {
    doc.rect(0, 0, PAGE.width, 88).fill(BAND);

    const logoW = drawOrganizationLogo(doc, org.logoDataUri, MARGIN, 14, 36);
    const textX = logoW > 0 ? MARGIN + logoW + 12 : MARGIN;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('HORAS-HOMBRE Y COSTO ESTIMADO POR OT', textX, 24);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(org.name.toUpperCase(), textX, 44);
    if (org.legalName) doc.fontSize(8).text(org.legalName, textX, 56);

    const boxW = 260;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 18, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    const period = options?.from || options?.to
      ? `${options.from ? fmtDate(options.from) : '—'} – ${options.to ? fmtDate(options.to) : '—'}`
      : 'Todas las OT cerradas';
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('PERÍODO', boxX + 10, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(period, boxX + 10, 36, { width: boxW - 20 });

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('TARIFA USADA', boxX + 10, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`${fmtCurrency(LABOR_RATE_USD_PER_HOUR)} / h (estimada)`, boxX + 10, 67);

    doc.moveTo(MARGIN, 88).lineTo(PAGE.width - MARGIN, 88).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static drawSummary(doc: Doc, rows: LaborRow[], y: number): number {
    const totalHours = rows.reduce((s, r) => s + r.estimatedHours, 0);
    const totalCost = totalHours * LABOR_RATE_USD_PER_HOUR;

    const cards = [
      { label: 'OT cerradas', value: String(rows.length), color: INK },
      { label: 'Horas estimadas', value: `${fmtNumber(totalHours)} h`, color: INK },
      { label: 'Costo estimado', value: fmtCurrency(totalCost), color: INK },
    ];
    const cardW = CONTENT_WIDTH / cards.length;
    cards.forEach((c, i) => {
      const x = MARGIN + i * cardW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(c.label.toUpperCase(), x, y, { width: cardW - 10 });
      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(16).text(c.value, x, y + 10, { width: cardW - 10 });
    });

    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5).text(
      'Horas estimadas por tarea según el plan de mantenimiento — la plataforma aún no registra horas-hombre reales por OT.',
      MARGIN, y + 32, { width: CONTENT_WIDTH },
    );
    doc.fillColor(INK);
    return y + 52;
  }

  private static tableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('N° OT', MARGIN + 6, y + 5, { width: 90 });
    doc.text('AERONAVE', MARGIN + 96, y + 5, { width: 80 });
    doc.text('TÉCNICO', MARGIN + 176, y + 5, { width: 140 });
    doc.text('CERRADA EL', MARGIN + 316, y + 5, { width: 80 });
    doc.text('TAREAS COMPLETADAS', MARGIN + 396, y + 5, { width: 110, align: 'right' });
    doc.text('HORAS ESTIMADAS', MARGIN + 506, y + 5, { width: 110, align: 'right' });
    doc.text('COSTO ESTIMADO', MARGIN + 616, y + 5, { width: 100, align: 'right' });
    doc.fillColor(INK);
    return y + 20;
  }

  private static ensureSpace(doc: Doc, y: number, needed: number): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return this.tableHeader(doc, MARGIN);
  }

  private static drawTable(doc: Doc, rows: LaborRow[], y: number): void {
    y = this.tableHeader(doc, y);

    if (rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('No hay órdenes de trabajo cerradas en el período seleccionado.', MARGIN, y + 10);
      return;
    }

    for (const row of rows) {
      const rowHeight = 18;
      y = this.ensureSpace(doc, y, rowHeight);

      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(row.number, MARGIN + 6, y + 2, { width: 90 });
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(row.aircraftRegistration, MARGIN + 96, y + 3, { width: 80 });
      doc.text(row.technician, MARGIN + 176, y + 3, { width: 140 });
      doc.text(fmtDate(row.closedAt), MARGIN + 316, y + 3, { width: 80 });
      doc.fillColor(INK).text(String(row.completedTasks), MARGIN + 396, y + 3, { width: 110, align: 'right' });
      doc.text(`${fmtNumber(row.estimatedHours)} h`, MARGIN + 506, y + 3, { width: 110, align: 'right' });
      doc.font('Helvetica-Bold').text(fmtCurrency(row.estimatedHours * LABOR_RATE_USD_PER_HOUR), MARGIN + 616, y + 3, { width: 100, align: 'right' });

      doc.fillColor(INK);
      y += rowHeight;
      doc.moveTo(MARGIN, y - 2).lineTo(PAGE.width - MARGIN, y - 2).lineWidth(0.3).stroke('#e2e8f0');
    }
  }

  private static drawFooters(doc: Doc, org: { name: string }): void {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE.width - MARGIN, FOOTER_TOP).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7);
      doc.text(`Horas-Hombre y Costo Estimado · ${org.name}`, MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
