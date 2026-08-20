// ─────────────────────────────────────────────────────────────────────────────
//  AlterationsDocumentService — PDF del estatus de alteraciones y reparaciones
//  mayores.
//
//  Cubre el punto IV.5.1.2 de la lista de presentación de la DGAC: "Estatus de
//  alteraciones y reparaciones mayores con FMS y/o ICAS que apliquen". Por eso
//  el suplemento del manual de vuelo y las ICA van en columnas propias y no
//  escondidos en las observaciones: son el criterio por el que la autoridad
//  revisa la tabla.
//
//  Mismo patrón visual que CounterHistoryDocumentService y
//  RemanentesDocumentService — banda de encabezado, logo, caja de aeronave,
//  tabla paginada.
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
const ACCENT = '#1e40af';
const ACCENT_LIGHT = '#eff6ff';

type Doc = PDFKit.PDFDocument;

interface AlterationRow {
  documentNumber: string;
  description: string;
  approvalDate: Date | null;
  hasFlightManualSupplement: boolean;
  flightManualReference: string | null;
  hasIca: boolean;
  icaReference: string | null;
  reference: string | null;
  notes: string | null;
}

const COLS = [
  { key: 'documentNumber', label: 'Documento', width: 120 },
  { key: 'description', label: 'Descripción', width: 210 },
  { key: 'approvalDate', label: 'Aprobación', width: 70 },
  { key: 'fms', label: 'FMS', width: 125 },
  { key: 'ica', label: 'ICA', width: 125 },
  { key: 'reference', label: 'OT / Taller', width: 111 },
] as const;

/**
 * approvalDate es @db.Date: Prisma lo devuelve como medianoche UTC. Formatearlo
 * en la zona local retrocede un día en Chile (UTC-3), y una fecha de aprobación
 * corrida un día invalida el documento. Por eso se formatea en UTC.
 */
function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

/**
 * "Sí — ref" cuando hay referencia, "Sí" a secas cuando está marcado pero sin
 * documento, "No" cuando no aplica. La distinción importa: una alteración con
 * FMS marcado pero sin referencia es un hallazgo que la DGAC va a preguntar.
 */
function fmtFlag(flag: boolean, ref: string | null): string {
  if (!flag) return 'No';
  return ref ? `Sí — ${ref}` : 'Sí (sin referencia)';
}

export class AlterationsDocumentService {
  static async generateReport(organizationId: string, aircraftId: string): Promise<Buffer> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: { id: true, registration: true, model: true, manufacturer: true },
    });
    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalName: true, logoDataUri: true },
    });
    if (!org) throw new Error('Organization not found');

    const rows = await prisma.aircraftAlteration.findMany({
      where: { organizationId, aircraftId },
      select: {
        documentNumber: true, description: true, approvalDate: true,
        hasFlightManualSupplement: true, flightManualReference: true,
        hasIca: true, icaReference: true, reference: true, notes: true,
      },
      // Las más recientes primero: es el orden en que la autoridad las revisa.
      orderBy: [{ approvalDate: 'desc' }, { createdAt: 'desc' }],
    });

    return this.renderPdf(org, aircraft, rows);
  }

  private static renderPdf(
    org: { name: string; legalName: string | null; logoDataUri?: string | null },
    aircraft: { registration: string; model: string; manufacturer: string },
    rows: AlterationRow[],
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

    this.drawHeader(doc, org, aircraft);
    const y = this.drawSummary(doc, rows, 100);
    this.drawTable(doc, rows, y);
    this.drawFooters(doc, aircraft, org);

    doc.end();
    return done;
  }

  private static drawHeader(
    doc: Doc,
    org: { name: string; legalName: string | null; logoDataUri?: string | null },
    aircraft: { registration: string; model: string; manufacturer: string },
  ): void {
    doc.rect(0, 0, PAGE.width, 88).fill(BAND);

    const logoW = drawOrganizationLogo(doc, org.logoDataUri, MARGIN, 14, 36);
    const textX = logoW > 0 ? MARGIN + logoW + 12 : MARGIN;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(15)
      .text('ESTATUS DE ALTERACIONES Y REPARACIONES MAYORES', textX, 18);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('DGAC IV.5.1.2', textX, 37);
    doc.fontSize(9).text(org.name.toUpperCase(), textX, 50);
    if (org.legalName) doc.fontSize(8).text(org.legalName, textX, 62);

    const boxW = 240;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 18, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('AERONAVE', boxX + 10, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(aircraft.registration, boxX + 10, 36);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(`${aircraft.manufacturer} ${aircraft.model}`, boxX + 90, 39, { width: boxW - 100 });

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 10, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(
      new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()),
      boxX + 10, 67,
    );

    doc.moveTo(MARGIN, 88).lineTo(PAGE.width - MARGIN, 88).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static drawSummary(doc: Doc, rows: AlterationRow[], y: number): number {
    const items: Array<[string, string]> = [
      ['Alteraciones', String(rows.length)],
      ['Con FMS', String(rows.filter((r) => r.hasFlightManualSupplement).length)],
      ['Con ICA', String(rows.filter((r) => r.hasIca).length)],
    ];

    const cardW = CONTENT_WIDTH / 4;
    const cardH = 26;

    items.forEach(([label, value], i) => {
      const x = MARGIN + i * cardW;
      doc.roundedRect(x, y, cardW - 6, cardH, 3).fillAndStroke(ACCENT_LIGHT, '#bfdbfe');
      doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7)
        .text(label.toUpperCase(), x + 8, y + 6, { width: cardW - 20 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11)
        .text(value, x + 8, y + 14, { width: cardW - 20 });
    });

    doc.fillColor(INK);
    return y + cardH + 16;
  }

  private static drawTable(doc: Doc, rows: AlterationRow[], startY: number): void {
    if (rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
        .text('Esta aeronave no tiene alteraciones ni reparaciones mayores registradas.', MARGIN, startY + 10);
      doc.fillColor(INK);
      return;
    }

    let y = this.drawTableHead(doc, startY);

    for (const row of rows) {
      const celdas = [
        row.documentNumber,
        row.description,
        fmtDate(row.approvalDate),
        fmtFlag(row.hasFlightManualSupplement, row.flightManualReference),
        fmtFlag(row.hasIca, row.icaReference),
        row.reference ?? '—',
      ];

      // Alto real de la fila: la descripción y las referencias pueden envolver.
      doc.font('Helvetica').fontSize(8);
      const alto = Math.max(
        ...celdas.map((texto, i) => doc.heightOfString(texto, { width: COLS[i].width - 10 })),
        14,
      ) + 8;

      if (y + alto > FOOTER_TOP - 10) {
        doc.addPage();
        y = this.drawTableHead(doc, MARGIN);
      }

      let x = MARGIN;
      doc.fillColor(INK).font('Helvetica').fontSize(8);
      celdas.forEach((texto, i) => {
        doc.text(texto, x + 5, y + 4, { width: COLS[i].width - 10 });
        x += COLS[i].width;
      });

      y += alto;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).stroke(LINE);

      // Las observaciones van bajo la fila, a ancho completo: son texto libre y
      // no caben en una columna sin romper la tabla.
      if (row.notes) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7);
        const altoNotas = doc.heightOfString(row.notes, { width: CONTENT_WIDTH - 20 }) + 6;
        if (y + altoNotas > FOOTER_TOP - 10) {
          doc.addPage();
          y = this.drawTableHead(doc, MARGIN);
        }
        doc.text(row.notes, MARGIN + 10, y + 3, { width: CONTENT_WIDTH - 20 });
        y += altoNotas;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).stroke(LINE);
        doc.fillColor(INK);
      }
    }
  }

  private static drawTableHead(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill(INK);
    let x = MARGIN;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    for (const col of COLS) {
      doc.text(col.label.toUpperCase(), x + 5, y + 5, { width: col.width - 10 });
      x += col.width;
    }
    doc.fillColor(INK);
    return y + 18;
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
      doc.text(
        `Alteraciones y reparaciones mayores ${aircraft.registration} · ${org.name}`,
        MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 },
      );
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
