import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CounterReading } from '@api/aircraft.api';

// Los 5 contadores que se piden reflejar: horas de aeronave, aterrizajes,
// horas de motor, ciclos NG (generador de gas) y ciclos NF (turbina libre).
const RELEVANT_CODES = ['HT', 'LND', 'HRSM', 'CNG', 'CTL'];

/** Formatea una fecha 'YYYY-MM-DD' sin pasar por el huso horario local (evita el
 * corrimiento de un día que da `new Date('YYYY-MM-DD').toLocaleDateString()`). */
export function formatDateOnly(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}-${month}-${year}`;
}

export interface CounterCell {
  effective: number | null;
  accumulated: number;
}

export interface CounterHistoryRow {
  date: string;
  cells: Record<string, CounterCell>;
}

export interface CounterColumnGroup {
  key: string;
  label: string;
}

function seriesKey(code: string, enginePosition: string | null): string {
  return `${code}:${enginePosition ?? 'AC'}`;
}

export interface CounterHistoryResult {
  rows: CounterHistoryRow[];
  latest: Record<string, CounterCell>;
  enginePositions: string[];
  columnGroups: CounterColumnGroup[];
}

/** Convierte las lecturas crudas de contador en filas fechadas con efectivo/acumulado por columna. */
export function buildCounterHistory(readings: CounterReading[]): CounterHistoryResult {
  const relevant = readings.filter((r) => RELEVANT_CODES.includes(r.counterType.code.toUpperCase()));

  const bySeries = new Map<string, CounterReading[]>();
  const enginePositionsSet = new Set<string>();
  for (const r of relevant) {
    if (r.engine?.position) enginePositionsSet.add(r.engine.position);
    const key = seriesKey(r.counterType.code.toUpperCase(), r.engine?.position ?? null);
    const list = bySeries.get(key) ?? [];
    list.push(r);
    bySeries.set(key, list);
  }

  const cellsByDate = new Map<string, Map<string, CounterCell>>();
  const latest: Record<string, CounterCell> = {};

  for (const [key, list] of bySeries.entries()) {
    const sorted = [...list].sort((a, b) => new Date(a.readingDate).getTime() - new Date(b.readingDate).getTime());
    let prevValue: number | null = null;
    for (const reading of sorted) {
      const value = Number(reading.value);
      const dateKey = reading.readingDate.slice(0, 10);
      const cell: CounterCell = {
        accumulated: value,
        effective: prevValue == null ? null : Number((value - prevValue).toFixed(2)),
      };
      prevValue = value;

      let dateMap = cellsByDate.get(dateKey);
      if (!dateMap) {
        dateMap = new Map();
        cellsByDate.set(dateKey, dateMap);
      }
      dateMap.set(key, cell);
      latest[key] = cell;
    }
  }

  const rows: CounterHistoryRow[] = Array.from(cellsByDate.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([date, seriesMap]) => ({ date, cells: Object.fromEntries(seriesMap.entries()) }));

  const enginePositions = Array.from(enginePositionsSet).sort();
  const suffix = (position: string) => (enginePositions.length > 1 ? ` ${position}` : '');

  const columnGroups: CounterColumnGroup[] = [
    { key: seriesKey('HT', null), label: 'Horas Aeronave' },
    { key: seriesKey('LND', null), label: 'Aterrizajes' },
    ...enginePositions.flatMap((position) => [
      { key: seriesKey('HRSM', position), label: `Horas Motor${suffix(position)}` },
      { key: seriesKey('CNG', position), label: `Ciclos NG${suffix(position)}` },
      { key: seriesKey('CTL', position), label: `Ciclos NF${suffix(position)}` },
    ]),
  ];

  return { rows, latest, enginePositions, columnGroups };
}

function formatCell(cell: CounterCell | undefined): [string, string] {
  if (!cell) return ['—', '—'];
  const effective = cell.effective == null ? '—' : cell.effective.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const accumulated = cell.accumulated.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  return [effective, accumulated];
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
  const { rows, latest, columnGroups } = result;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const generatedAt = new Date();

  await drawOrganizationLogo(doc, logoDataUri, 40);

  doc.setFontSize(14);
  doc.text(`Registro de Horas / Ciclos / Aterrizajes — ${registration}`, 40, 42);
  doc.setFontSize(10);
  doc.text(`${registration} · ${model}`, 40, 60);
  doc.text(`Fecha emision: ${generatedAt.toLocaleString('es-CL')}`, 40, 74);

  let summaryY = 96;
  doc.setFontSize(9);
  for (const group of columnGroups) {
    const [, accumulated] = formatCell(latest[group.key]);
    doc.text(`${group.label}: ${accumulated}`, 40, summaryY);
    summaryY += 14;
  }

  const head = [
    [
      { content: 'Fecha', rowSpan: 2 },
      ...columnGroups.map((g) => ({ content: g.label, colSpan: 2 })),
    ],
    columnGroups.flatMap(() => ['Efect.', 'Acumul.']),
  ];

  const body = rows.map((row) => [
    formatDateOnly(row.date),
    ...columnGroups.flatMap((g) => formatCell(row.cells[g.key])),
  ]);

  autoTable(doc, {
    startY: summaryY + 10,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 4, halign: 'right' },
    headStyles: { fillColor: [30, 64, 175], halign: 'center' },
    columnStyles: { 0: { halign: 'left' } },
  });

  doc.save(`Registro_Contadores_${registration}.pdf`);
}
