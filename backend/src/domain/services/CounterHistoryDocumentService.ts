// ─────────────────────────────────────────────────────────────────────────────
//  CounterHistoryDocumentService — PDF del registro de horas/ciclos/aterrizajes
//
//  Reproduce el formato de la bitácora física: fecha, folio, y efectivo/
//  acumulado por contador (aeronave, motor, NG, NF, aterrizajes, carga
//  externa, ciclos de torque). Sigue el mismo patrón visual que
//  RemanentesDocumentService — banda de encabezado, logo, caja de aeronave,
//  tabla con paginación.
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

interface SeriesPoint {
  value: number;
  effective: number | null;
  folio: string | null;
}

interface HistoryRow {
  date: string;
  folio: string | null;
  hourEffective: number | null;
  aircraftHoursAccum: number | null;
  motorHoursAccum: number | null;
  ngEffective: number | null;
  ngAccum: number | null;
  nfEffective: number | null;
  nfAccum: number | null;
  landingsEffective: number | null;
  landingsAccum: number | null;
  cargoToday: number | null;
  cargoAccum: number | null;
  torqueToday: number | null;
  torqueAccum: number | null;
}

interface HistorySummary {
  aircraftHours: number | null;
  motorHours: number | null;
  ng: number | null;
  nf: number | null;
  landings: number | null;
  cargo: number | null;
  aircraftCycles: number | null;
}

interface RawReading {
  value: unknown;
  readingDate: Date;
  folio: string | null;
  counterType: { code: string };
  engine: { id: string; position: string } | null;
}

function buildSeriesByDate(readings: RawReading[], code: string, engineId: string | null): Map<string, SeriesPoint> {
  const filtered = readings.filter((r) => {
    if (r.counterType.code.toUpperCase() !== code) return false;
    return engineId === null ? !r.engine : r.engine?.id === engineId;
  });
  const sorted = [...filtered].sort((a, b) => a.readingDate.getTime() - b.readingDate.getTime());

  const map = new Map<string, SeriesPoint>();
  let prev: number | null = null;
  for (const r of sorted) {
    const value = Number(r.value);
    const dateKey = r.readingDate.toISOString().slice(0, 10);
    map.set(dateKey, {
      value,
      effective: prev == null ? null : Number((value - prev).toFixed(2)),
      folio: r.folio ?? null,
    });
    prev = value;
  }
  return map;
}

function findPrimaryEngineId(readings: RawReading[]): string | null {
  const positionById = new Map<string, string>();
  for (const r of readings) {
    if (r.engine) positionById.set(r.engine.id, r.engine.position);
  }
  for (const [id, position] of positionById) {
    if (position === 'N1') return id;
  }
  return positionById.size > 0 ? [...positionById.keys()][0] : null;
}

function lastValue(map: Map<string, SeriesPoint>): number | null {
  const dates = [...map.keys()].sort();
  const last = dates[dates.length - 1];
  return last ? map.get(last)!.value : null;
}

function buildCounterHistory(readings: RawReading[]): { rows: HistoryRow[]; summary: HistorySummary } {
  const engineId = findPrimaryEngineId(readings);

  const ht = buildSeriesByDate(readings, 'HT', null);
  const lnd = buildSeriesByDate(readings, 'LND', null);
  const cargo = buildSeriesByDate(readings, 'CARGA', null);
  const hrsm = engineId ? buildSeriesByDate(readings, 'HRSM', engineId) : new Map<string, SeriesPoint>();
  const cng = engineId ? buildSeriesByDate(readings, 'CNG', engineId) : new Map<string, SeriesPoint>();
  const ctl = engineId ? buildSeriesByDate(readings, 'CTL', engineId) : new Map<string, SeriesPoint>();
  const ctq = engineId ? buildSeriesByDate(readings, 'CTQ', engineId) : new Map<string, SeriesPoint>();

  const allDates = new Set<string>([
    ...ht.keys(), ...lnd.keys(), ...cargo.keys(), ...hrsm.keys(), ...cng.keys(), ...ctl.keys(), ...ctq.keys(),
  ]);

  const rows: HistoryRow[] = Array.from(allDates).sort().map((date) => ({
    date,
    folio: ht.get(date)?.folio ?? null,
    hourEffective: ht.get(date)?.effective ?? null,
    aircraftHoursAccum: ht.get(date)?.value ?? null,
    motorHoursAccum: hrsm.get(date)?.value ?? null,
    ngEffective: cng.get(date)?.effective ?? null,
    ngAccum: cng.get(date)?.value ?? null,
    nfEffective: ctl.get(date)?.effective ?? null,
    nfAccum: ctl.get(date)?.value ?? null,
    landingsEffective: lnd.get(date)?.effective ?? null,
    landingsAccum: lnd.get(date)?.value ?? null,
    cargoToday: cargo.get(date)?.effective ?? null,
    cargoAccum: cargo.get(date)?.value ?? null,
    torqueToday: ctq.get(date)?.effective ?? null,
    torqueAccum: ctq.get(date)?.value ?? null,
  }));

  const landingsLatest = lastValue(lnd);

  return {
    rows,
    summary: {
      aircraftHours: lastValue(ht),
      motorHours: lastValue(hrsm),
      ng: lastValue(cng),
      nf: lastValue(ctl),
      landings: landingsLatest,
      cargo: lastValue(cargo),
      aircraftCycles: landingsLatest,
    },
  };
}

const fmt = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('es-CL', { maximumFractionDigits: 2 });

const fmtDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  return `${day}-${month}-${year}`;
};

// [x, width] por columna, relativo al margen izquierdo de la tabla.
const COLS = [
  { key: 'fecha', label: 'Fecha', width: 52 },
  { key: 'folio', label: 'Folio', width: 36 },
  { key: 'hEfect', label: 'Efect.', width: 34, group: 'Hora Funcionamiento' },
  { key: 'hAc', label: 'Aeronave', width: 46 },
  { key: 'hMo', label: 'Motor', width: 46 },
  { key: 'ngEfect', label: 'Efect.', width: 34, group: 'Ciclos NG' },
  { key: 'ngAc', label: 'Acumul.', width: 46 },
  { key: 'nfEfect', label: 'Efect.', width: 34, group: 'Ciclos NF' },
  { key: 'nfAc', label: 'Acumul.', width: 46 },
  { key: 'ldEfect', label: 'Efect.', width: 34, group: 'Aterrizajes' },
  { key: 'ldAc', label: 'Acumul.', width: 46 },
  { key: 'cgHoy', label: 'Hoy', width: 34, group: 'Carga Externa' },
  { key: 'cgAc', label: 'Acumul.', width: 46 },
  { key: 'tqHoy', label: 'Hoy', width: 34, group: 'Ciclos de Torque' },
  { key: 'tqAc', label: 'Acumul.', width: 46 },
  { key: 'firma', label: 'Control Mantto. / Firma Responsable', width: 0 }, // se ajusta al ancho restante
] as const;

function columnPositions(): Array<{ x: number; width: number }> {
  const fixedWidth = COLS.reduce((sum, c) => sum + c.width, 0);
  const lastWidth = CONTENT_WIDTH - fixedWidth;
  let x = MARGIN;
  return COLS.map((c) => {
    const width = c.width || Math.max(lastWidth, 60);
    const pos = { x, width };
    x += width;
    return pos;
  });
}

function colGroup(col: (typeof COLS)[number]): string | undefined {
  return 'group' in col ? col.group : undefined;
}

/** Para cada columna con `group`, el ancho combinado de todas las columnas
 * consecutivas que comparten ese mismo grupo (para centrar el título arriba). */
function groupSpans(positions: Array<{ x: number; width: number }>): Map<number, number> {
  const spans = new Map<number, number>();
  let i = 0;
  while (i < COLS.length) {
    const group = colGroup(COLS[i]);
    if (!group) { i += 1; continue; }
    let span = positions[i].width;
    let j = i + 1;
    while (j < COLS.length && !colGroup(COLS[j])) {
      span += positions[j].width;
      j += 1;
    }
    spans.set(i, span);
    i = j;
  }
  return spans;
}

export class CounterHistoryDocumentService {
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

    const readings = await prisma.counterReading.findMany({
      where: {
        organizationId,
        OR: [{ aircraftId }, { engine: { aircraftId } }],
      },
      include: {
        counterType: { select: { code: true } },
        engine: { select: { id: true, position: true } },
      },
      orderBy: { readingDate: 'asc' },
    });

    const { rows, summary } = buildCounterHistory(readings);
    return this.renderPdf(org, aircraft, rows, summary);
  }

  private static renderPdf(
    org: { name: string; legalName: string | null; logoDataUri?: string | null },
    aircraft: { registration: string; model: string; manufacturer: string },
    rows: HistoryRow[],
    summary: HistorySummary,
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
    const y = this.drawSummary(doc, summary, 100);
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

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text('REGISTRO DE HORAS / CICLOS / ATERRIZAJES', textX, 22);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(org.name.toUpperCase(), textX, 42);
    if (org.legalName) doc.fontSize(8).text(org.legalName, textX, 54);

    const boxW = 240;
    const boxX = PAGE.width - MARGIN - boxW;
    doc.roundedRect(boxX, 18, boxW, 58, 4).fillAndStroke('#ffffff', LINE);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('AERONAVE Y MOTOR', boxX + 10, 26);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(aircraft.registration, boxX + 10, 36);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`${aircraft.manufacturer} ${aircraft.model}`, boxX + 90, 39);

    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('EMISIÓN', boxX + 10, 58);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(
      new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()),
      boxX + 10, 67,
    );

    doc.moveTo(MARGIN, 88).lineTo(PAGE.width - MARGIN, 88).lineWidth(1).stroke(LINE);
    doc.fillColor(INK);
  }

  private static drawSummary(doc: Doc, summary: HistorySummary, y: number): number {
    const items: Array<[string, number | null]> = [
      ['Horas Aeronave', summary.aircraftHours],
      ['Horas Motor', summary.motorHours],
      ['N g', summary.ng],
      ['N f', summary.nf],
      ['Landings', summary.landings],
      ['Cargas', summary.cargo],
      ['Ciclos Aeronave', summary.aircraftCycles],
    ];

    const cols = 4;
    const cardW = CONTENT_WIDTH / cols;
    const cardH = 26;

    items.forEach(([label, value], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + col * cardW;
      const cardY = y + row * (cardH + 4);

      doc.roundedRect(x, cardY, cardW - 6, cardH, 3).fillAndStroke(ACCENT_LIGHT, '#bfdbfe');
      doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7).text(label.toUpperCase(), x + 8, cardY + 6, { width: cardW - 20 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(fmt(value), x + 8, cardY + 14, { width: cardW - 20 });
    });

    doc.fillColor(INK);
    const rowCount = Math.ceil(items.length / cols);
    return y + rowCount * (cardH + 4) + 12;
  }

  private static tableHeader(doc: Doc, y: number, positions: Array<{ x: number; width: number }>): number {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 24).fill(ACCENT);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);

    const spans = groupSpans(positions);
    const noGroupCols = new Set(['fecha', 'folio', 'firma']);

    COLS.forEach((c, i) => {
      const pos = positions[i];
      const span = spans.get(i);
      const align = noGroupCols.has(c.key) ? 'left' : 'right';
      if (span) {
        doc.text((colGroup(c) ?? '').toUpperCase(), pos.x + 2, y + 3, { width: span - 4 });
        doc.text(c.label, pos.x + 2, y + 14, { width: pos.width - 4, align });
      } else if (noGroupCols.has(c.key)) {
        doc.text(c.label.toUpperCase(), pos.x + 2, y + 8, { width: pos.width - 4 });
      } else {
        doc.text(c.label, pos.x + 2, y + 14, { width: pos.width - 4, align });
      }
    });

    doc.fillColor(INK);
    return y + 24;
  }

  private static ensureSpace(doc: Doc, y: number, needed: number, positions: Array<{ x: number; width: number }>): number {
    if (y + needed <= FOOTER_TOP - 8) return y;
    doc.addPage();
    return this.tableHeader(doc, MARGIN, positions);
  }

  private static drawTable(doc: Doc, rows: HistoryRow[], startY: number): void {
    const positions = columnPositions();
    let y = this.tableHeader(doc, startY, positions);

    const cellValue = (row: HistoryRow, key: (typeof COLS)[number]['key']): string => {
      switch (key) {
        case 'fecha': return fmtDate(row.date);
        case 'folio': return row.folio ?? '—';
        case 'hEfect': return fmt(row.hourEffective);
        case 'hAc': return fmt(row.aircraftHoursAccum);
        case 'hMo': return fmt(row.motorHoursAccum);
        case 'ngEfect': return fmt(row.ngEffective);
        case 'ngAc': return fmt(row.ngAccum);
        case 'nfEfect': return fmt(row.nfEffective);
        case 'nfAc': return fmt(row.nfAccum);
        case 'ldEfect': return fmt(row.landingsEffective);
        case 'ldAc': return fmt(row.landingsAccum);
        case 'cgHoy': return fmt(row.cargoToday);
        case 'cgAc': return fmt(row.cargoAccum);
        case 'tqHoy': return fmt(row.torqueToday);
        case 'tqAc': return fmt(row.torqueAccum);
        case 'firma': return '';
        default: return '';
      }
    };

    rows.forEach((row, i) => {
      const rowH = 16;
      y = this.ensureSpace(doc, y, rowH, positions);

      if (i % 2 === 1) {
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowH).fill(BAND);
        doc.fillColor(INK);
      }

      doc.font('Helvetica').fontSize(7.5);
      COLS.forEach((c, colIdx) => {
        const pos = positions[colIdx];
        const align = c.key === 'fecha' || c.key === 'folio' || c.key === 'firma' ? 'left' : 'right';
        doc.fillColor(c.key === 'fecha' || c.key === 'folio' ? INK : MUTED)
          .text(cellValue(row, c.key), pos.x + 4, y + 4, { width: pos.width - 8, align });
      });

      doc.fillColor(INK);
      y += rowH;
      doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(0.3).stroke('#e2e8f0');
    });

    if (rows.length === 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Sin lecturas de contadores registradas para esta aeronave.', MARGIN, y + 12);
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
      doc.text(`Registro de contadores ${aircraft.registration} · ${org.name}`, MARGIN, FOOTER_TOP + 6, { width: CONTENT_WIDTH - 90 });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE.width - MARGIN - 90, FOOTER_TOP + 6, { width: 90, align: 'right' });
    }
    doc.fillColor(INK);
  }
}
