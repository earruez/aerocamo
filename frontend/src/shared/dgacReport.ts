import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MaintenancePlanItem } from '@api/maintenancePlan.api';
import { MISSING_OPERATIONAL_CONTEXT_LABEL } from '@/shared/operationalContext';
import { classifyTaskCategory, TASK_CATEGORY_LABEL, type TaskCategory } from '@/shared/maintenanceCategory';

export type CategoryFilter = 'PROGRAMA' | TaskCategory;

export const CATEGORY_TABS: CategoryFilter[] = ['PROGRAMA', 'AD', 'SB', 'MIM', 'INSPECCIONES', 'COMPONENTES'];

export function categoryLabel(cat: CategoryFilter): string {
  return cat === 'PROGRAMA' ? 'General' : TASK_CATEGORY_LABEL[cat];
}

/**
 * Los equipos que la DGAC numera en su lista de presentación (IV.2.x). El
 * informe los recorre todos, incluso los que no aplican: un punto declarado
 * "No aplica" deja constancia de que se evaluó, mientras que uno omitido no
 * dice nada. Es el mismo criterio con que marcamos las AD que no aplican a
 * una matrícula en vez de sacarlas del plan.
 */
export type DgacEquipment = 'AERONAVE' | 'MOTOR_1' | 'MOTOR_2' | 'HELICE_1' | 'HELICE_2' | 'APU';

export type EquipmentFilter = 'ALL' | DgacEquipment;

export const EQUIPMENT_TABS: EquipmentFilter[] = [
  'ALL', 'AERONAVE', 'MOTOR_1', 'MOTOR_2', 'HELICE_1', 'HELICE_2', 'APU',
];

const EQUIPMENT_LABEL: Record<EquipmentFilter, string> = {
  ALL: 'Todos',
  AERONAVE: 'Aeronave',
  MOTOR_1: 'Motor 1',
  MOTOR_2: 'Motor 2',
  HELICE_1: 'Hélice 1',
  HELICE_2: 'Hélice 2',
  APU: 'APU',
};

/**
 * Punto de la lista de presentación de la DGAC, que depende del equipo Y de la
 * categoría: el estatus del programa de inspecciones del motor es IV.2.2, pero
 * el de sus AD es IV.4.2 y el de su plan de reemplazos es IV.3.2. Numerar por
 * equipo solamente etiquetaría mal el documento.
 *
 * Devuelve null cuando la combinación no corresponde a un punto de la lista
 * (SB no está numerado; "General" mezcla categorías; las AD no tienen punto de
 * APU). En ese caso el informe imprime el equipo sin número, que es preferible
 * a inventar uno.
 */
const DGAC_POINTS: Partial<Record<CategoryFilter, Partial<Record<DgacEquipment, string>>>> = {
  INSPECCIONES: {
    AERONAVE: 'IV.2.1', MOTOR_1: 'IV.2.2', MOTOR_2: 'IV.2.3',
    HELICE_1: 'IV.2.4', HELICE_2: 'IV.2.5', APU: 'IV.2.6',
  },
  COMPONENTES: {
    AERONAVE: 'IV.3.1', MOTOR_1: 'IV.3.2', MOTOR_2: 'IV.3.3',
    HELICE_1: 'IV.3.4', HELICE_2: 'IV.3.5', APU: 'IV.3.6',
  },
  AD: {
    AERONAVE: 'IV.4.1', MOTOR_1: 'IV.4.2', MOTOR_2: 'IV.4.3',
    HELICE_1: 'IV.4.4', HELICE_2: 'IV.4.5',
  },
  // DA-DAN-DAC repetitivos: la lista solo numera el de aeronave.
  MIM: { AERONAVE: 'IV.4.1.2' },
};

export function equipmentLabel(eq: EquipmentFilter): string {
  return EQUIPMENT_LABEL[eq];
}

export function dgacPoint(category: CategoryFilter, eq: DgacEquipment): string | null {
  return DGAC_POINTS[category]?.[eq] ?? null;
}

/** Lo que la aeronave tiene declarado, de aircraftApi.listEquipmentApplicability(). */
export interface EquipmentApplicabilityInput {
  equipment: DgacEquipment;
  applies: boolean;
  notes: string | null;
  changedAt: string;
  changedBy: { id: string; name: string } | null;
}

export interface EquipmentSlot {
  equipment: DgacEquipment;
  /** 'IV.2.2', o null si la combinación no está numerada en la lista. */
  point: string | null;
  /** 'Motor 1' */
  label: string;
  applies: boolean;
  /** Motivo del "No aplica", o advertencia cuando la atribución es imprecisa. */
  note: string | null;
  rows: MaintenancePlanItem[];
  /** "G. Pasmiño, 20-08-2026" si es una declaración; null si lo derivó el sistema. */
  declaredBy: string | null;
}

/**
 * Arma los seis puntos del informe a partir del plan y de los motores que la
 * aeronave tiene registrados.
 *
 * Qué aplica NO se asume por tipo de aeronave: los motores salen de las
 * posiciones registradas (N1/N2). Hélice y APU no están modelados en la
 * plataforma, así que se declaran "No aplica" diciendo exactamente eso.
 *
 * Ojo con la atribución por motor: MaintenanceTask.equipmentScope distingue
 * célula de motor, pero no en qué posición va la tarea. Con un solo motor
 * registrado la atribución es inequívoca; con dos no se puede repartir, y en
 * ese caso el slot lo advierte en vez de inventar un reparto.
 */
export function buildEquipmentSlots(
  rows: MaintenancePlanItem[],
  enginePositions: readonly ('N1' | 'N2')[],
  category: CategoryFilter,
  /** Declaraciones de Griselle, que priman sobre lo que deriva el sistema. */
  declared: readonly EquipmentApplicabilityInput[] = [],
): EquipmentSlot[] {
  const { aircraftRows, engineRows } = splitByEquipment(rows);
  const tieneN1 = enginePositions.includes('N1');
  const tieneN2 = enginePositions.includes('N2');
  const bimotor = tieneN1 && tieneN2;

  const sinModelar = 'La plataforma no registra este equipo para esta aeronave.';
  const sinMotor = 'La aeronave no tiene un motor registrado en esta posición.';
  const sinRepartir = bimotor
    ? `El plan no atribuye las tareas de motor a una posición: las ${engineRows.length} tareas de motor se listan sin separar entre Motor 1 y Motor 2.`
    : null;

  const declarados = new Map(declared.map((d) => [d.equipment, d]));

  /**
   * Una declaración explícita prima sobre lo derivado, y su motivo reemplaza al
   * genérico: "Aeronave de ala rotatoria, sin hélice — G. Pasmiño, 20-08-2026"
   * respalda mucho mejor que "la plataforma no registra este equipo".
   */
  const slot = (
    equipment: DgacEquipment,
    applies: boolean,
    note: string | null,
    slotRows: MaintenancePlanItem[],
  ): EquipmentSlot => {
    const d = declarados.get(equipment);
    if (!d) {
      return {
        equipment, point: dgacPoint(category, equipment), label: EQUIPMENT_LABEL[equipment],
        applies, note, rows: applies ? slotRows : [], declaredBy: null,
      };
    }
    const firma = d.changedBy
      ? `${d.changedBy.name}, ${new Date(d.changedAt).toLocaleDateString('es-CL')}`
      : new Date(d.changedAt).toLocaleDateString('es-CL');
    return {
      equipment, point: dgacPoint(category, equipment), label: EQUIPMENT_LABEL[equipment],
      applies: d.applies,
      note: d.notes ? `${d.notes} — ${firma}` : note,
      rows: d.applies ? slotRows : [],
      declaredBy: firma,
    };
  };

  return [
    slot('AERONAVE', true, null, aircraftRows),
    slot('MOTOR_1', tieneN1, tieneN1 ? sinRepartir : sinMotor, engineRows),
    slot('MOTOR_2', tieneN2, tieneN2 ? sinRepartir : sinMotor, bimotor ? engineRows : []),
    slot('HELICE_1', false, sinModelar, []),
    slot('HELICE_2', false, sinModelar, []),
    slot('APU', false, sinModelar, []),
  ];
}

export function equipmentCountsFor(slots: EquipmentSlot[]): Record<EquipmentFilter, number> {
  const counts = { ALL: 0 } as Record<EquipmentFilter, number>;
  let total = 0;
  for (const s of slots) {
    counts[s.equipment] = s.rows.length;
    total += s.rows.length;
  }
  counts.ALL = total;
  return counts;
}

export function mandatoryRowsFor(data: MaintenancePlanItem[]): MaintenancePlanItem[] {
  return data.filter((item) => item.isMandatory);
}

export function categoryCountsFor(mandatoryRows: MaintenancePlanItem[]): Record<CategoryFilter, number> {
  const counts: Record<CategoryFilter, number> = {
    PROGRAMA: mandatoryRows.length, AD: 0, SB: 0, MIM: 0, INSPECCIONES: 0, COMPONENTES: 0,
  };
  for (const item of mandatoryRows) counts[classifyTaskCategory(item)] += 1;
  return counts;
}

export function rowsForCategory(mandatoryRows: MaintenancePlanItem[], category: CategoryFilter): MaintenancePlanItem[] {
  return category === 'PROGRAMA' ? mandatoryRows : mandatoryRows.filter((item) => classifyTaskCategory(item) === category);
}

export interface EquipmentGroups {
  aircraftRows: MaintenancePlanItem[];
  engineRows: MaintenancePlanItem[];
}

/** Separa las tareas de una categoría entre las que aplican a la célula y las que aplican al motor. */
export function splitByEquipment(rows: MaintenancePlanItem[]): EquipmentGroups {
  return {
    aircraftRows: rows.filter((item) => item.equipmentScope === 'AIRCRAFT'),
    engineRows: rows.filter((item) => item.equipmentScope === 'ENGINE'),
  };
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

/** Dibuja el logo de la organización en la esquina superior derecha, si existe. Un logo corrupto no debe romper el PDF. */
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

function formatDate(value: string | null): string {
  if (!value) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return new Date(value).toLocaleDateString('es-CL');
}

export function getRowClass(item: MaintenancePlanItem): string {
  const isRedByHours = item.hoursRemaining != null && item.hoursRemaining < 10;
  const isRedByDays = item.daysRemaining != null && item.daysRemaining < 15;
  if (isRedByHours || isRedByDays) return 'bg-rose-50';
  const isYellow = item.hoursRemaining != null && item.hoursRemaining < 50;
  if (isYellow) return 'bg-amber-50';
  return '';
}

export function nextDueLabel(item: MaintenancePlanItem): string {
  const parts: string[] = [];
  if (item.nextDueHours != null) parts.push(`${item.nextDueHours.toFixed(1)} FH`);
  if (item.nextDueDate) parts.push(new Date(item.nextDueDate).toLocaleDateString('es-CL'));
  if (parts.length === 0) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return parts.join(' | ');
}

export function remainingLabel(item: MaintenancePlanItem): string {
  const parts: string[] = [];
  if (item.hoursRemaining != null) parts.push(`${item.hoursRemaining.toFixed(1)} h`);
  if (item.daysRemaining != null) parts.push(`${item.daysRemaining} d`);
  if (parts.length === 0) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return parts.join(' / ');
}

export function lastComplianceLabel(item: MaintenancePlanItem): string {
  if (!item.lastPerformedAt && item.controlStartAt) {
    const startDate = formatDate(item.controlStartAt);
    const startHours = item.controlStartHours != null ? `${item.controlStartHours.toFixed(1)} FH` : MISSING_OPERATIONAL_CONTEXT_LABEL;
    return `Inicio de control: ${startDate} / ${startHours}`;
  }

  const date = formatDate(item.lastPerformedAt);
  const hours = item.lastHoursAtCompliance != null ? `${item.lastHoursAtCompliance.toFixed(1)} FH` : MISSING_OPERATIONAL_CONTEXT_LABEL;
  return `${date} / ${hours}`;
}

const TABLE_HEAD = [[
  'Codigo ATA',
  'Descripcion',
  'Ultimo Cumplimiento (Fecha/Horas)',
  'Proximo Vencimiento',
  'Remanente',
  'Sustento',
  'Evidencia',
]];

/**
 * Dibuja un punto de la lista DGAC. Un equipo que no aplica NO se omite: se
 * imprime igual, encabezado y motivo, para que el documento deje constancia
 * de que el punto se evaluó.
 */
function drawEquipmentSection(doc: jsPDF, slot: EquipmentSlot, startY: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const sectionRows = slot.rows;
  let y = startY;
  if (y > pageHeight - 90) {
    doc.addPage();
    y = 50;
  }

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  const prefijo = slot.point ? `${slot.point}  ` : '';
  const heading = slot.applies
    ? `${prefijo}${slot.label.toUpperCase()} (${sectionRows.length})`
    : `${prefijo}${slot.label.toUpperCase()} — NO APLICA`;
  doc.text(heading, 40, y);
  doc.setFont('helvetica', 'normal');

  if (!slot.applies) {
    doc.setFontSize(9);
    doc.text(slot.note ?? 'No aplica a esta aeronave.', 40, y + 16, { maxWidth: 500 });
    return y + 34;
  }

  if (slot.note) {
    doc.setFontSize(8);
    doc.text(slot.note, 40, y + 14, { maxWidth: 500 });
    y += 12;
  }

  if (sectionRows.length === 0) {
    doc.setFontSize(9);
    doc.text('Sin tareas para este equipo.', 40, y + 16);
    return y + 34;
  }

  autoTable(doc, {
    startY: y + 10,
    head: TABLE_HEAD,
    body: sectionRows.map((item) => [
      item.taskCode,
      item.taskTitle,
      lastComplianceLabel(item),
      nextDueLabel(item),
      remainingLabel(item),
      item.legalSource,
      item.lastEvidenceUrl ?? '-',
    ]),
    styles: {
      fontSize: 8,
      cellPadding: 4,
    },
    headStyles: {
      fillColor: [15, 23, 42],
    },
    didParseCell: (hookData) => {
      if (hookData.section !== 'body') return;
      const row = sectionRows[hookData.row.index];
      const rowClass = getRowClass(row);
      if (rowClass === 'bg-rose-50') {
        hookData.cell.styles.fillColor = [254, 226, 226];
      } else if (rowClass === 'bg-amber-50') {
        hookData.cell.styles.fillColor = [254, 243, 199];
      }
    },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export async function exportDgacStatusReportPdf(params: {
  registration: string;
  model: string;
  currentHours: number;
  category: CategoryFilter;
  /** Los seis puntos de la lista DGAC, de buildEquipmentSlots(). */
  slots: EquipmentSlot[];
  /** Acota el documento a un equipo. Por defecto, todos los puntos. */
  equipment?: EquipmentFilter;
  logoDataUri?: string | null;
}): Promise<void> {
  const { registration, model, currentHours, category, slots, logoDataUri } = params;
  const equipment = params.equipment ?? 'ALL';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const generatedAt = new Date();

  await drawOrganizationLogo(doc, logoDataUri, 40);

  const scope = equipment === 'ALL'
    ? categoryLabel(category)
    : `${categoryLabel(category)} — ${equipmentLabel(equipment)}`;

  doc.setFontSize(14);
  doc.text(`Aircraft Status Report - DGAC (${scope})`, 40, 42);
  doc.setFontSize(10);
  doc.text(`Aeronave: ${registration} (${model})`, 40, 60);
  // Siempre horas de célula: es el contador contra el que el plan calcula los
  // remanentes de la tabla, también los de las tareas de motor.
  doc.text(`Horas actuales: ${currentHours.toFixed(1)} FH`, 40, 74);
  doc.text(`Fecha emision: ${generatedAt.toLocaleString('es-CL')}`, 40, 88);

  const seleccionados = equipment === 'ALL'
    ? slots
    : slots.filter((s) => s.equipment === equipment);

  let y = 112;
  for (const slot of seleccionados) {
    y = drawEquipmentSection(doc, slot, y) + 28;
  }

  const suffix = equipment === 'ALL' ? '' : `_${equipment}`;
  doc.save(`DGAC_Aircraft_Status_${registration}_${category}${suffix}.pdf`);
}
