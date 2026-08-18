import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CounterReading } from '@api/aircraft.api';

/** Formatea una fecha 'YYYY-MM-DD' sin pasar por el huso horario local (evita el
 * corrimiento de un día que da `new Date('YYYY-MM-DD').toLocaleDateString()`). */
export function formatDateOnly(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}-${month}-${year}`;
}

interface SeriesPoint {
  value: number;
  effective: number | null;
  folio: string | null;
}

function buildSeriesByDate(
  readings: CounterReading[],
  code: string,
  engineId: string | null,
): Map<string, SeriesPoint> {
  const filtered = readings.filter((r) => {
    if (r.counterType.code.toUpperCase() !== code) return false;
    return engineId === null ? !r.engine : r.engine?.id === engineId;
  });
  const sorted = [...filtered].sort((a, b) => new Date(a.readingDate).getTime() - new Date(b.readingDate).getTime());

  const map = new Map<string, SeriesPoint>();
  let prev: number | null = null;
  for (const r of sorted) {
    const value = Number(r.value);
    const dateKey = r.readingDate.slice(0, 10);
    map.set(dateKey, {
      value,
      effective: prev == null ? null : Number((value - prev).toFixed(2)),
      folio: r.folio ?? null,
    });
    prev = value;
  }
  return map;
}

/** El documento de referencia asume un solo motor por columna; con más de uno,
 * se prioriza N1 (o el primero que aparezca) como el motor de este reporte. */
function findPrimaryEngineId(readings: CounterReading[]): string | null {
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

export interface CounterHistoryRow {
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

export interface CounterHistorySummary {
  aircraftHours: number | null;
  motorHours: number | null;
  ng: number | null;
  nf: number | null;
  landings: number | null;
  cargo: number | null;
  /** Mismo valor que `landings`: en esta operación "Ciclos Aeronave" es otro nombre para Aterrizajes. */
  aircraftCycles: number | null;
}

export interface CounterHistoryResult {
  rows: CounterHistoryRow[];
  summary: CounterHistorySummary;
  hasCargoData: boolean;
  hasTorqueData: boolean;
}

/** Convierte las lecturas crudas de contador en el mismo formato de la bitácora
 * de referencia: fecha, folio, y efectivo/acumulado por columna. */
export function buildCounterHistory(readings: CounterReading[]): CounterHistoryResult {
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

  const rows: CounterHistoryRow[] = Array.from(allDates).sort().map((date) => ({
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
    hasCargoData: cargo.size > 0,
    hasTorqueData: ctq.size > 0,
  };
}

function fmt(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}

function logoFormat(dataUri: string): 'PNG' | 'JPEG' | null {
  if (dataUri.startsWith('data:image/png')) return 'PNG';
  if (dataUri.startsWith('data:image/jpeg') || dataUri.startsWith('data:image/jpg')) return 'JPEG';
  return null;
}

function loadImageSize(dataUri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('No se pudo leer el logo'));
    img.src = dataUri;
  });
}

async function drawOrganizationLogo(doc: jsPDF, logoDataUri: string | null | undefined, boxSize: number): Promise<void> {
  if (!logoDataUri) return;
  const format = logoFormat(logoDataUri);
  if (!format) return;
  try {
    const { width, height } = await loadImageSize(logoDataUri);
    const scale = Math.min(boxSize / width, boxSize / height);
    const drawW = width * scale;
    const drawH = height * scale;
    const pageWidth = doc.internal.pageSize.getWidth();
    const x = pageWidth - 40 - boxSize + (boxSize - drawW) / 2;
    const y = 12 + (boxSize - drawH) / 2;
    doc.addImage(logoDataUri, format, x, y, drawW, drawH);
  } catch {
    // Un logo corrupto o no soportado no debe romper la generación del documento.
  }
}

export async function exportCounterHistoryPdf(params: {
  registration: string;
  model: string;
  result: CounterHistoryResult;
  logoDataUri?: string | null;
}): Promise<void> {
  const { registration, model, result, logoDataUri } = params;
  const { rows, summary } = result;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });

  await drawOrganizationLogo(doc, logoDataUri, 40);

  doc.setFontSize(13);
  doc.text(`REGISTRO DE HORAS / CICLOS / ATERRIZAJES — AERONAVE Y MOTOR ${registration}`, 40, 32);
  doc.setFontSize(9);
  doc.text(`${registration} · ${model} · Emitido ${new Date().toLocaleString('es-CL')}`, 40, 46);

  const summaryLines: Array<[string, string]> = [
    ['HORAS AERONAVE :', fmt(summary.aircraftHours)],
    ['HORAS MOTOR :', fmt(summary.motorHours)],
    ['N g :', fmt(summary.ng)],
    ['N f :', fmt(summary.nf)],
    ['LANDINGS :', fmt(summary.landings)],
    ['CARGAS :', fmt(summary.cargo)],
    ['CICLOS AERONAVE :', fmt(summary.aircraftCycles)],
  ];

  let y = 64;
  doc.setFontSize(9);
  for (const [label, value] of summaryLines) {
    doc.setFillColor(219, 234, 254);
    doc.rect(40, y - 9, 150, 13, 'F');
    doc.setFont('helvetica', 'bold');
    doc.text(label, 42, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 170, y);
    y += 14;
  }

  const head = [
    [
      { content: 'Fecha', rowSpan: 2 },
      { content: 'Folio Nº', rowSpan: 2 },
      { content: 'Hora Funcionamiento', colSpan: 3 },
      { content: 'Ciclos NG', colSpan: 2 },
      { content: 'Ciclos NF', colSpan: 2 },
      { content: 'Aterrizajes', colSpan: 2 },
      { content: 'Carga Externa', colSpan: 2 },
      { content: 'Ciclos de Torque', colSpan: 2 },
      { content: 'Control Mantto. / Firma Responsable', rowSpan: 2 },
    ],
    ['Efect.', 'Aeronave', 'Motor', 'Efect.', 'Acumul.', 'Efect.', 'Acumul.', 'Efect.', 'Acumul.', 'Hoy', 'Acumul.', 'Hoy', 'Acumul.'],
  ];

  const body = rows.map((row) => [
    formatDateOnly(row.date),
    row.folio ?? '—',
    fmt(row.hourEffective),
    fmt(row.aircraftHoursAccum),
    fmt(row.motorHoursAccum),
    fmt(row.ngEffective),
    fmt(row.ngAccum),
    fmt(row.nfEffective),
    fmt(row.nfAccum),
    fmt(row.landingsEffective),
    fmt(row.landingsAccum),
    fmt(row.cargoToday),
    fmt(row.cargoAccum),
    fmt(row.torqueToday),
    fmt(row.torqueAccum),
    '',
  ]);

  autoTable(doc, {
    startY: y + 8,
    head,
    body,
    styles: { fontSize: 7, cellPadding: 3, halign: 'right' },
    headStyles: { fillColor: [30, 64, 175], halign: 'center', fontSize: 7 },
    columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' }, 15: { halign: 'left' } },
  });

  doc.save(`Registro_Contadores_${registration}.pdf`);
}
