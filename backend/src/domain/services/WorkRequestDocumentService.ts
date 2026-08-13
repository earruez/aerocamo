// ─────────────────────────────────────────────────────────────────────────────
//  WorkRequestDocumentService — PDF de la Solicitud de Trabajo
//
//  El documento sale de la organización hacia un taller externo, así que tiene
//  que sostenerse solo: quién lo emite, para qué aeronave, con qué horas, qué se
//  pide, a quién va y quién firma. Se imprime y se entrega en mano cuando el
//  taller no trabaja por correo, por eso lleva bloque de firmas y paginación.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../infrastructure/database/prisma.client';
import { drawOrganizationLogo } from '../../shared/pdfLogo';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 44;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 62;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';

const CATEGORY_LABELS: Record<string, string> = {
  MAINTENANCE_PLAN: 'Plan de mantenimiento',
  NORMATIVE: 'Normativa (AD / SB)',
  COMPONENT_INSPECTION: 'Componentes e inspecciones',
  DISCREPANCY: 'Discrepancias',
  OTHER: 'Otros',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  SENT: 'Enviada',
  OT_RECEIVED: 'OT recibida',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
};

const fmtDate = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';

const fmtNumber = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};

type Doc = PDFKit.PDFDocument;

export class WorkRequestDocumentService {
  static async generateSTDocument(workRequestId: string): Promise<Buffer> {
    const wr = await prisma.workRequest.findUnique({
      where: { id: workRequestId },
      include: {
        organization: true,
        aircraft: true,
        createdBy: { select: { name: true, email: true, role: true } },
        reviewer: { select: { name: true, email: true } },
        repairShop: { select: { code: true, name: true } },
        repairShopContact: { select: { name: true, role: true, email: true, phone: true } },
        items: {
          include: { task: true, component: true, discrepancy: true },
          orderBy: { addedAt: 'asc' },
        },
      },
    });
    if (!wr) throw new Error('Work request not found');

    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawHeader(doc, wr);
    let y = 128;
    y = this.drawAircraftBlock(doc, wr, y);
    y = this.drawDestinationBlock(doc, wr, y);
    y = this.drawItems(doc, wr, y);
    y = this.drawNotes(doc, wr, y);
    this.drawSignatures(doc, wr, y);
    this.drawFooters(doc, wr);

    doc.end();
    return done;
  }

  // ── Encabezado ─────────────────────────────────────────────────────────────
  private static drawHeader(doc: Doc, wr: any): void {
    doc.rect(0, 0, PAGE.width, 96).fill(BAND);

    const logoW = drawOrganizationLogo(doc, wr.organization.logoDataUri, MARGIN, 16, 40);
    const textX = logoW > 0 ? MARGIN + logoW + 12 : MARGIN;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
      .text('SOLICITUD DE TRABAJO', textX, 26);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(wr.organization.name.toUpperCase(), textX, 47);
    if (wr.organization.legalName) {
      doc.fontSize(8).text(wr.organization.legalName, textX, 60, { width: 300 - (textX - MARGIN) });
    }

    // Bloque de identificación, alineado a la derecha
    const boxW = 178;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 22, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('N° SOLICITUD', boxX + 10, 30);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(wr.number, boxX + 10, 40);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 10, 60);
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(fmtDate(wr.createdAt), boxX + 46, 59);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('ESTADO', boxX + 108, 60);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
      .text(STATUS_LABELS[wr.status] ?? wr.status, boxX + 108, 69, { width: 62 });

    doc.moveTo(MARGIN, 96).lineTo(PAGE.width - MARGIN, 96).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  /** Título de sección con línea, devuelve la Y siguiente. */
  private static sectionTitle(doc: Doc, title: string, y: number): number {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), MARGIN, y);
    doc.moveTo(MARGIN, y + 12).lineTo(PAGE.width - MARGIN, y + 12).lineWidth(0.7).stroke(LINE);
    return y + 20;
  }

  /** Par etiqueta/valor en una columna. */
  private static field(doc: Doc, label: string, value: string, x: number, y: number, width: number): void {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(label.toUpperCase(), x, y, { width });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(value || '—', x, y + 9, { width });
  }

  // ── Aeronave ───────────────────────────────────────────────────────────────
  private static drawAircraftBlock(doc: Doc, wr: any, y: number): number {
    y = this.sectionTitle(doc, 'Aeronave', y);
    const col = CONTENT_WIDTH / 4;

    this.field(doc, 'Matrícula', wr.aircraft.registration, MARGIN, y, col - 8);
    this.field(doc, 'Marca / Modelo', `${wr.aircraft.manufacturer ?? ''} ${wr.aircraft.model ?? ''}`.trim(), MARGIN + col, y, col - 8);
    this.field(doc, 'N° de serie', wr.aircraft.serialNumber ?? '—', MARGIN + col * 2, y, col - 8);
    this.field(doc, 'Año', wr.aircraft.yearManufactured ? String(wr.aircraft.yearManufactured) : '—', MARGIN + col * 3, y, col - 8);
    y += 30;

    const hours = wr.aircraftHoursAtRequest ?? wr.aircraft.totalFlightHours;
    this.field(doc, 'Horas totales', `${fmtNumber(hours)} FH`, MARGIN, y, col - 8);
    this.field(doc, 'Ciclos N1', String(wr.aircraftCyclesN1 ?? wr.aircraft.totalCycles ?? '—'), MARGIN + col, y, col - 8);
    this.field(doc, 'Ciclos N2', String(wr.aircraftCyclesN2 ?? '—'), MARGIN + col * 2, y, col - 8);
    this.field(doc, 'Ítems solicitados', String(wr.items.length), MARGIN + col * 3, y, col - 8);
    return y + 34;
  }

  // ── Destinatario ───────────────────────────────────────────────────────────
  private static drawDestinationBlock(doc: Doc, wr: any, y: number): number {
    y = this.sectionTitle(doc, 'Dirigida a', y);
    const col = CONTENT_WIDTH / 3;

    const shop = wr.repairShop
      ? `${wr.repairShop.code ? `${wr.repairShop.code} — ` : ''}${wr.repairShop.name}`
      : 'Por asignar';
    this.field(doc, 'Taller', shop, MARGIN, y, col - 8);
    this.field(doc, 'Contacto', wr.repairShopContact?.name ?? 'Por asignar', MARGIN + col, y, col - 8);
    this.field(
      doc,
      'Correo / teléfono',
      wr.repairShopContact?.email ?? wr.repairShopContact?.phone ?? '—',
      MARGIN + col * 2,
      y,
      col - 8,
    );
    return y + 32;
  }

  // ── Ítems ──────────────────────────────────────────────────────────────────
  private static tableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('#', MARGIN + 6, y + 5, { width: 16 });
    doc.text('CÓDIGO', MARGIN + 24, y + 5, { width: 96 });
    doc.text('DESCRIPCIÓN', MARGIN + 124, y + 5, { width: 250 });
    doc.text('INTERVALO', MARGIN + 378, y + 5, { width: 68 });
    doc.text('EJECUTADO', MARGIN + 452, y + 5, { width: 52, align: 'right' });
    doc.fillColor(INK);
    return y + 20;
  }

  /** Salta de página conservando el encabezado de la tabla. */
  private static ensureSpace(doc: Doc, y: number, needed: number, withTableHeader: boolean): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return withTableHeader ? this.tableHeader(doc, MARGIN) : MARGIN;
  }

  private static intervalOf(item: any): string {
    const parts: string[] = [];
    if (item.task?.intervalHours != null) parts.push(`${fmtNumber(item.task.intervalHours, 0)} FH`);
    if (item.task?.intervalCycles != null) parts.push(`${item.task.intervalCycles} cic`);
    if (item.task?.intervalCalendarMonths != null) parts.push(`${item.task.intervalCalendarMonths} M`);
    else if (item.task?.intervalCalendarDays != null) parts.push(`${item.task.intervalCalendarDays} d`);
    return parts.join(' / ') || 'Según condición';
  }

  private static drawItems(doc: Doc, wr: any, y: number): number {
    y = this.sectionTitle(doc, 'Trabajos solicitados', y);

    if (wr.items.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9)
        .text('Esta solicitud no tiene trabajos incluidos.', MARGIN, y);
      doc.fillColor(INK);
      return y + 20;
    }

    const grouped = wr.items.reduce((acc: Record<string, any[]>, item: any) => {
      (acc[item.category] ??= []).push(item);
      return acc;
    }, {});

    y = this.tableHeader(doc, y);
    let index = 0;

    for (const [category, items] of Object.entries(grouped) as [string, any[]][]) {
      y = this.ensureSpace(doc, y, 26, true);
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
        .text(`${CATEGORY_LABELS[category] ?? category}  (${items.length})`, MARGIN + 4, y + 2);
      y += 14;

      for (const item of items) {
        index += 1;
        const title = item.itemTitle ?? '—';
        const code = item.itemCode ?? '—';
        // El código también envuelve: la fila la manda el más alto de los dos.
        const titleHeight = doc.font('Helvetica').fontSize(8).heightOfString(title, { width: 250 });
        const codeHeight = doc.font('Helvetica-Bold').fontSize(7.5).heightOfString(code, { width: 96 });
        const rowHeight = Math.max(titleHeight, codeHeight, 10) + 8;

        y = this.ensureSpace(doc, y, rowHeight, true);

        doc.fillColor(INK).font('Helvetica').fontSize(8);
        doc.text(String(index), MARGIN + 6, y, { width: 16 });
        doc.font('Helvetica-Bold').fontSize(7.5)
          .text(code, MARGIN + 24, y, { width: 96 });
        doc.font('Helvetica').fontSize(8)
          .text(title, MARGIN + 124, y, { width: 250 });
        doc.fontSize(7.5).fillColor(MUTED)
          .text(this.intervalOf(item), MARGIN + 378, y, { width: 68 });

        // Casilla que el taller marca al ejecutar, para el envío impreso
        doc.rect(PAGE.width - MARGIN - 16, y - 1, 10, 10).lineWidth(0.7).stroke(LINE);

        doc.fillColor(INK);
        y += rowHeight;
        doc.moveTo(MARGIN, y - 3).lineTo(PAGE.width - MARGIN, y - 3).lineWidth(0.3).stroke('#e2e8f0');
      }
      y += 4;
    }
    return y + 8;
  }

  // ── Observaciones ──────────────────────────────────────────────────────────
  private static drawNotes(doc: Doc, wr: any, y: number): number {
    const notes = (wr.notes ?? '').trim();
    if (!notes) return y;

    const height = doc.font('Helvetica').fontSize(9).heightOfString(notes, { width: CONTENT_WIDTH - 16 });
    y = this.ensureSpace(doc, y, height + 40, false);
    y = this.sectionTitle(doc, 'Observaciones', y);
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(notes, MARGIN + 4, y, { width: CONTENT_WIDTH - 16 });
    return y + height + 14;
  }

  // ── Firmas ─────────────────────────────────────────────────────────────────
  private static drawSignatures(doc: Doc, wr: any, y: number): void {
    y = this.ensureSpace(doc, y, 96, false);
    y = this.sectionTitle(doc, 'Firmas', y);

    const boxes = [
      { role: 'Solicita', name: wr.createdBy?.name ?? '', detail: wr.createdBy?.role ?? '' },
      { role: 'Revisa', name: wr.reviewer?.name ?? '', detail: wr.reviewedAt ? fmtDate(wr.reviewedAt) : '' },
      { role: 'Recibe (taller)', name: wr.repairShopContact?.name ?? '', detail: wr.repairShop?.name ?? '' },
    ];

    const boxW = (CONTENT_WIDTH - 24) / 3;
    boxes.forEach((box, i) => {
      const x = MARGIN + i * (boxW + 12);
      doc.moveTo(x, y + 40).lineTo(x + boxW, y + 40).lineWidth(0.7).stroke(LINE);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(box.name || ' ', x, y + 45, { width: boxW });
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(box.detail || ' ', x, y + 56, { width: boxW });
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(box.role.toUpperCase(), x, y + 68, { width: boxW });
    });
    doc.fillColor(INK);
  }

  // ── Pie con paginación ─────────────────────────────────────────────────────
  private static drawFooters(doc: Doc, wr: any): void {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE.width - MARGIN, FOOTER_TOP).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7);
      doc.text(`${wr.number} · ${wr.aircraft.registration} · ${wr.organization.name}`, MARGIN, FOOTER_TOP + 6, {
        width: CONTENT_WIDTH - 90,
      });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, {
        width: 90,
        align: 'right',
      });
    }
    doc.fillColor(INK);
  }

  static async savePdfToFile(pdfBuffer: Buffer, filename: string): Promise<string> {
    const tmpDir = path.join(process.cwd(), 'tmp', 'pdfs');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, pdfBuffer);
    return filePath;
  }
}
