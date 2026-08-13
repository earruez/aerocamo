// ─────────────────────────────────────────────────────────────────────────────
//  PDFGenerationService — PDF de la Orden de Trabajo (OT)
//
//  Documento de ejecución: qué se pide, quién la ejecuta, qué se completó y
//  quién firma el retorno al servicio. Se genera al asignar, se puede
//  descargar o enviar por correo en cualquier momento de su ciclo de vida.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 44;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 62;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BAND = '#f1f5f9';
const GREEN = '#059669';
const AMBER = '#b45309';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  OPEN: 'Abierta',
  IN_PROGRESS: 'En ejecución',
  QUALITY: 'Calidad',
  CLOSED: 'Cerrada',
};

const fmtDate = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d) : '—';

const fmtDateTime = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) : '—';

const fmtNumber = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};

type Doc = PDFKit.PDFDocument;

/**
 * PDFGenerationService
 * Genera el PDF de la Orden de Trabajo para impresión, descarga y correo.
 */
export class PDFGenerationService {
  static async generateWorkOrderPdf(workOrderId: string): Promise<Buffer> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        organization: true,
        aircraft: true,
        createdBy: { select: { name: true, role: true } },
        assignedTechnician: { select: { name: true, licenseNumber: true } },
        inspector: { select: { name: true, licenseNumber: true } },
        closedBy: { select: { name: true, licenseNumber: true } },
        tasks: {
          include: { task: true, completedBy: { select: { name: true } } },
          orderBy: [{ task: { isMandatory: 'desc' } }, { task: { code: 'asc' } }],
        },
        discrepancies: {
          orderBy: { createdAt: 'asc' },
          include: { foundBy: { select: { name: true } }, resolvedBy: { select: { name: true } } },
        },
      },
    });
    if (!wo) throw new Error('Work Order not found');

    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawHeader(doc, wo);
    let y = 128;
    y = this.drawAircraftBlock(doc, wo, y);
    y = this.drawAssignmentBlock(doc, wo, y);
    y = this.drawTasks(doc, wo, y);
    y = this.drawDiscrepancies(doc, wo, y);
    y = this.drawEvidence(doc, wo, y);
    this.drawSignatures(doc, wo, y);
    this.drawFooters(doc, wo);

    doc.end();
    return done;
  }

  // ── Encabezado ─────────────────────────────────────────────────────────────
  private static drawHeader(doc: Doc, wo: any): void {
    doc.rect(0, 0, PAGE.width, 96).fill(BAND);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
      .text('ORDEN DE TRABAJO', MARGIN, 26);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(wo.organization.name.toUpperCase(), MARGIN, 47);
    if (wo.organization.legalName) {
      doc.fontSize(8).text(wo.organization.legalName, MARGIN, 60, { width: 300 });
    }

    const boxW = 178;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 22, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('N° OT', boxX + 10, 30);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(wo.number, boxX + 10, 40);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 10, 60);
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(fmtDate(wo.createdAt), boxX + 46, 59);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('ESTADO', boxX + 108, 60);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
      .text(STATUS_LABELS[wo.status] ?? wo.status, boxX + 108, 69, { width: 62 });

    doc.moveTo(MARGIN, 96).lineTo(PAGE.width - MARGIN, 96).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static sectionTitle(doc: Doc, title: string, y: number): number {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), MARGIN, y);
    doc.moveTo(MARGIN, y + 12).lineTo(PAGE.width - MARGIN, y + 12).lineWidth(0.7).stroke(LINE);
    return y + 20;
  }

  private static field(doc: Doc, label: string, value: string, x: number, y: number, width: number): void {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(label.toUpperCase(), x, y, { width });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(value || '—', x, y + 9, { width });
  }

  private static ensureSpace(doc: Doc, y: number, needed: number, header?: (d: Doc, y: number) => number): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return header ? header(doc, MARGIN) : MARGIN;
  }

  // ── Aeronave ───────────────────────────────────────────────────────────────
  private static drawAircraftBlock(doc: Doc, wo: any, y: number): number {
    y = this.sectionTitle(doc, 'Aeronave', y);
    const col = CONTENT_WIDTH / 4;

    this.field(doc, 'Matrícula', wo.aircraft.registration, MARGIN, y, col - 8);
    this.field(doc, 'Modelo', wo.aircraft.model ?? '—', MARGIN + col, y, col - 8);
    const hoursAtOpen = wo.aircraftHoursAtOpen ?? wo.aircraft.totalFlightHours;
    this.field(doc, 'Horas al abrir', `${fmtNumber(hoursAtOpen)} FH`, MARGIN + col * 2, y, col - 8);
    this.field(doc, 'Ciclos al abrir', String(wo.aircraftCyclesAtOpen ?? wo.aircraft.totalCycles ?? '—'), MARGIN + col * 3, y, col - 8);
    return y + 30;
  }

  // ── Asignación / fechas ────────────────────────────────────────────────────
  private static drawAssignmentBlock(doc: Doc, wo: any, y: number): number {
    y = this.sectionTitle(doc, 'Asignación', y);
    const col = CONTENT_WIDTH / 3;

    this.field(doc, 'Emitida por', wo.createdBy?.name ?? '—', MARGIN, y, col - 8);
    this.field(doc, 'Técnico asignado', wo.assignedTechnician?.name ?? 'Por asignar', MARGIN + col, y, col - 8);
    this.field(doc, 'Inspector', wo.inspector?.name ?? '—', MARGIN + col * 2, y, col - 8);
    y += 28;

    this.field(doc, 'Inicio planificado', fmtDate(wo.plannedStartDate), MARGIN, y, col - 8);
    this.field(doc, 'Fin planificado', fmtDate(wo.plannedEndDate), MARGIN + col, y, col - 8);
    const actual = wo.actualStartDate
      ? `${fmtDate(wo.actualStartDate)}${wo.actualEndDate ? ` – ${fmtDate(wo.actualEndDate)}` : ' (en curso)'}`
      : '—';
    this.field(doc, 'Ejecución real', actual, MARGIN + col * 2, y, col - 8);
    return y + 32;
  }

  // ── Tareas ─────────────────────────────────────────────────────────────────
  private static taskTableHeader(doc: Doc, y: number): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(BAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7);
    doc.text('#', MARGIN + 6, y + 5, { width: 16 });
    doc.text('CÓDIGO', MARGIN + 24, y + 5, { width: 78 });
    doc.text('TAREA', MARGIN + 106, y + 5, { width: 260 });
    doc.text('OBLIG.', MARGIN + 370, y + 5, { width: 42 });
    doc.text('ESTADO', MARGIN + 416, y + 5, { width: 88, align: 'right' });
    doc.fillColor(INK);
    return y + 20;
  }

  private static drawTasks(doc: Doc, wo: any, y: number): number {
    y = this.sectionTitle(doc, 'Tareas', y);

    if (wo.tasks.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9)
        .text('Esta OT no tiene tareas asignadas.', MARGIN, y);
      doc.fillColor(INK);
      return y + 20;
    }

    y = this.taskTableHeader(doc, y);

    wo.tasks.forEach((wot: any, i: number) => {
      const task = wot.task;
      const title = task.title ?? '—';
      const titleHeight = doc.font('Helvetica').fontSize(8).heightOfString(title, { width: 260 });
      const rowHeight = Math.max(titleHeight, 10) + 8;

      y = this.ensureSpace(doc, y, rowHeight, this.taskTableHeader.bind(this));

      doc.fillColor(INK).font('Helvetica').fontSize(8);
      doc.text(String(i + 1), MARGIN + 6, y, { width: 16 });
      doc.font('Helvetica-Bold').fontSize(7.5).text(task.code, MARGIN + 24, y, { width: 78 });
      doc.font('Helvetica').fontSize(8).text(title, MARGIN + 106, y, { width: 260 });
      doc.fontSize(7.5).fillColor(MUTED).text(task.isMandatory ? 'Sí' : 'No', MARGIN + 370, y, { width: 42 });

      const done = wot.isCompleted;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(done ? GREEN : AMBER)
        .text(done ? 'COMPLETADA' : 'PENDIENTE', MARGIN + 416, y, { width: 88, align: 'right' });

      doc.fillColor(INK);
      y += rowHeight;

      if (done && (wot.completedAt || wot.completedBy?.name)) {
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(
            `Completada ${fmtDateTime(wot.completedAt)}${wot.completedBy?.name ? ` — ${wot.completedBy.name}` : ''}`,
            MARGIN + 106,
            y - 2,
            { width: 350 },
          );
        doc.fillColor(INK);
        y += 11;
      }
      if (wot.notes?.trim()) {
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
          .text(`Nota: ${wot.notes.trim()}`, MARGIN + 106, y - 2, { width: 350 });
        doc.fillColor(INK);
        y += 11;
      }

      doc.moveTo(MARGIN, y - 2).lineTo(PAGE.width - MARGIN, y - 2).lineWidth(0.3).stroke('#e2e8f0');
      y += 4;
    });

    return y + 8;
  }

  // ── Hallazgos ──────────────────────────────────────────────────────────────
  private static drawDiscrepancies(doc: Doc, wo: any, y: number): number {
    if (wo.discrepancies.length === 0) return y;

    y = this.ensureSpace(doc, y, 30, undefined);
    y = this.sectionTitle(doc, 'Hallazgos', y);

    wo.discrepancies.forEach((d: any, i: number) => {
      const desc = d.description ?? '';
      const height = doc.font('Helvetica').fontSize(8).heightOfString(desc, { width: CONTENT_WIDTH - 16 });
      y = this.ensureSpace(doc, y, height + 30, undefined);

      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
        .text(`${i + 1}. ${d.code ? `${d.code} — ` : ''}${d.title}`, MARGIN, y, { width: CONTENT_WIDTH - 90 });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(d.status === 'RESOLVED' ? GREEN : AMBER)
        .text(d.status, PAGE.width - MARGIN - 80, y, { width: 80, align: 'right' });
      y += 12;

      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(desc, MARGIN, y, { width: CONTENT_WIDTH - 16 });
      y += height + 4;

      if (d.resolutionNotes?.trim()) {
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
          .text(`Acción correctiva: ${d.resolutionNotes.trim()}`, MARGIN, y, { width: CONTENT_WIDTH - 16 });
        y += doc.heightOfString(`Acción correctiva: ${d.resolutionNotes.trim()}`, { width: CONTENT_WIDTH - 16 }) + 4;
      }
      doc.fillColor(INK);
      y += 6;
    });

    return y + 4;
  }

  // ── Evidencia ──────────────────────────────────────────────────────────────
  private static drawEvidence(doc: Doc, wo: any, y: number): number {
    if (!wo.evidenceFileUrl) return y;
    y = this.ensureSpace(doc, y, 30, undefined);
    y = this.sectionTitle(doc, 'Evidencia', y);
    doc.fillColor(INK).font('Helvetica').fontSize(9)
      .text(`Archivo: ${wo.evidenceFileName ?? wo.evidenceFileUrl}`, MARGIN, y, { width: CONTENT_WIDTH });
    y += 12;
    if (wo.evidenceUploadedAt) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
        .text(`Subida el ${fmtDateTime(wo.evidenceUploadedAt)}`, MARGIN, y);
      y += 10;
    }
    doc.fillColor(INK);
    return y + 14;
  }

  // ── Firmas ─────────────────────────────────────────────────────────────────
  private static drawSignatures(doc: Doc, wo: any, y: number): void {
    y = this.ensureSpace(doc, y, 96, undefined);
    y = this.sectionTitle(doc, 'Firmas', y);

    const boxes = [
      {
        role: 'Ejecuta (técnico)',
        name: wo.assignedTechnician?.name ?? '',
        detail: wo.assignedTechnician?.licenseNumber ? `Lic. ${wo.assignedTechnician.licenseNumber}` : '',
      },
      {
        role: 'Inspecciona',
        name: wo.inspector?.name ?? '',
        detail: wo.inspector?.licenseNumber ? `Lic. ${wo.inspector.licenseNumber}` : '',
      },
      {
        role: 'Cierra / retorno al servicio',
        name: wo.closedBy?.name ?? '',
        detail: wo.closedAt ? fmtDate(wo.closedAt) : '',
      },
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
  private static drawFooters(doc: Doc, wo: any): void {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE.width - MARGIN, FOOTER_TOP).lineWidth(0.5).stroke(LINE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7);
      doc.text(`${wo.number} · ${wo.aircraft.registration} · ${wo.organization.name}`, MARGIN, FOOTER_TOP + 6, {
        width: CONTENT_WIDTH - 90,
      });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, {
        width: 90,
        align: 'right',
      });
    }
    doc.fillColor(INK);
  }

  /**
   * Guardar PDF a archivo temporal
   */
  static async savePdfToFile(pdfBuffer: Buffer, filename: string): Promise<string> {
    const tmpDir = path.join(process.cwd(), 'tmp', 'pdfs');

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, pdfBuffer);

    return filePath;
  }

  /**
   * Obtener ruta del archivo PDF
   */
  static getPdfPath(workOrderId: string): string {
    const filename = `WO-${workOrderId}-${Date.now()}.pdf`;
    return path.join(process.cwd(), 'tmp', 'pdfs', filename);
  }

  /**
   * Limpiar archivos PDF temporales más antiguos de 24 horas
   */
  static async cleanupOldPdfs(): Promise<void> {
    const pdfDir = path.join(process.cwd(), 'tmp', 'pdfs');

    if (!fs.existsSync(pdfDir)) {
      return;
    }

    const files = fs.readdirSync(pdfDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas

    for (const file of files) {
      const filePath = path.join(pdfDir, file);
      const stat = fs.statSync(filePath);
      const age = now - stat.mtimeMs;

      if (age > maxAge) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
