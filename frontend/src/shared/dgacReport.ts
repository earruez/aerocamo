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

function drawEquipmentSection(doc: jsPDF, title: string, sectionRows: MaintenancePlanItem[], startY: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = startY;
  if (y > pageHeight - 90) {
    doc.addPage();
    y = 50;
  }

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`${title} (${sectionRows.length})`, 40, y);
  doc.setFont('helvetica', 'normal');

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

export function exportDgacStatusReportPdf(params: {
  registration: string;
  model: string;
  currentHours: number;
  category: CategoryFilter;
  rows: MaintenancePlanItem[];
}): void {
  const { registration, model, currentHours, category, rows } = params;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const generatedAt = new Date();

  doc.setFontSize(14);
  doc.text(`Aircraft Status Report - DGAC (${categoryLabel(category)})`, 40, 42);
  doc.setFontSize(10);
  doc.text(`Aeronave: ${registration} (${model})`, 40, 60);
  doc.text(`Horas actuales: ${currentHours.toFixed(1)} FH`, 40, 74);
  doc.text(`Fecha emision: ${generatedAt.toLocaleString('es-CL')}`, 40, 88);

  const { aircraftRows, engineRows } = splitByEquipment(rows);

  let y = drawEquipmentSection(doc, 'AERONAVE', aircraftRows, 112);
  drawEquipmentSection(doc, 'MOTOR', engineRows, y + 28);

  doc.save(`DGAC_Aircraft_Status_${registration}_${category}.pdf`);
}
