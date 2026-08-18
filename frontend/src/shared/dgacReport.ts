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

  autoTable(doc, {
    startY: 104,
    head: [[
      'Codigo ATA',
      'Descripcion',
      'Ultimo Cumplimiento (Fecha/Horas)',
      'Proximo Vencimiento',
      'Remanente',
      'Sustento',
      'Evidencia',
    ]],
    body: rows.map((item) => [
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
      const row = rows[hookData.row.index];
      const rowClass = getRowClass(row);
      if (rowClass === 'bg-rose-50') {
        hookData.cell.styles.fillColor = [254, 226, 226];
      } else if (rowClass === 'bg-amber-50') {
        hookData.cell.styles.fillColor = [254, 243, 199];
      }
    },
  });

  doc.save(`DGAC_Aircraft_Status_${registration}_${category}.pdf`);
}
