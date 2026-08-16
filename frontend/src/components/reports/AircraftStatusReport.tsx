import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Paperclip, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { maintenancePlanApi, type MaintenancePlanItem } from '@api/maintenancePlan.api';
import { MISSING_OPERATIONAL_CONTEXT_LABEL } from '@/shared/operationalContext';

interface AircraftStatusReportProps {
  aircraftId: string;
  registration: string;
  model: string;
  currentHours: number;
  onClose: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return new Date(value).toLocaleDateString('es-CL');
}

function getRowClass(item: MaintenancePlanItem): string {
  const isRedByHours = item.hoursRemaining != null && item.hoursRemaining < 10;
  const isRedByDays = item.daysRemaining != null && item.daysRemaining < 15;
  if (isRedByHours || isRedByDays) return 'bg-rose-50';
  const isYellow = item.hoursRemaining != null && item.hoursRemaining < 50;
  if (isYellow) return 'bg-amber-50';
  return '';
}

function nextDueLabel(item: MaintenancePlanItem): string {
  const parts: string[] = [];
  if (item.nextDueHours != null) parts.push(`${item.nextDueHours.toFixed(1)} FH`);
  if (item.nextDueDate) parts.push(new Date(item.nextDueDate).toLocaleDateString('es-CL'));
  if (parts.length === 0) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return parts.join(' | ');
}

function remainingLabel(item: MaintenancePlanItem): string {
  const parts: string[] = [];
  if (item.hoursRemaining != null) parts.push(`${item.hoursRemaining.toFixed(1)} h`);
  if (item.daysRemaining != null) parts.push(`${item.daysRemaining} d`);
  if (parts.length === 0) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return parts.join(' / ');
}

function lastComplianceLabel(item: MaintenancePlanItem): string {
  if (!item.lastPerformedAt && item.controlStartAt) {
    const startDate = formatDate(item.controlStartAt);
    const startHours = item.controlStartHours != null ? `${item.controlStartHours.toFixed(1)} FH` : MISSING_OPERATIONAL_CONTEXT_LABEL;
    return `Inicio de control: ${startDate} / ${startHours}`;
  }

  const date = formatDate(item.lastPerformedAt);
  const hours = item.lastHoursAtCompliance != null ? `${item.lastHoursAtCompliance.toFixed(1)} FH` : MISSING_OPERATIONAL_CONTEXT_LABEL;
  return `${date} / ${hours}`;
}

export function AircraftStatusReport({
  aircraftId,
  registration,
  model,
  currentHours,
  onClose,
}: AircraftStatusReportProps) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['aircraft-status-report', aircraftId],
    queryFn: () => maintenancePlanApi.getForAircraft(aircraftId),
    enabled: !!aircraftId,
  });

  const rows = useMemo(() => data.filter((item) => item.isMandatory), [data]);

  const exportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const generatedAt = new Date();

    doc.setFontSize(14);
    doc.text('Aircraft Status Report - DGAC', 40, 42);
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

    doc.save(`DGAC_Aircraft_Status_${registration}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 p-4">
      <div className="mx-auto h-full max-h-[94vh] w-full max-w-7xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">AircraftStatusReport</h2>
            <p className="text-xs text-slate-500">Ficha clinica de aeronavegabilidad y cumplimiento DGAC</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportPdf} className="btn-secondary inline-flex items-center gap-1.5">
              <FileDown size={14} /> Exportar PDF para DGAC
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
              <X size={16} className="text-slate-500" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-auto h-[calc(94vh-70px)] space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Aeronave</p>
              <p className="font-semibold text-slate-900">{registration}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Modelo</p>
              <p className="font-semibold text-slate-900">{model}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Horas Actuales</p>
              <p className="font-semibold text-slate-900">{currentHours.toFixed(1)} FH</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-auto max-h-[50vh]">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="table-header">Codigo ATA</th>
                  <th className="table-header">Descripcion</th>
                  <th className="table-header">Ultimo Cumplimiento (Fecha/Horas)</th>
                  <th className="table-header">Proximo Vencimiento</th>
                  <th className="table-header">Remanente</th>
                  <th className="table-header">Evidencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="table-cell py-10 text-center text-slate-400">Cargando reporte...</td>
                  </tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table-cell py-10 text-center text-slate-400">Sin tareas para esta aeronave.</td>
                  </tr>
                )}
                {!isLoading && rows.map((item) => (
                  <tr key={item.taskId} className={getRowClass(item)}>
                    <td className="table-cell font-mono text-xs font-bold text-slate-800">{item.taskCode}</td>
                    <td className="table-cell">
                      <p className="text-slate-700">{item.taskTitle}</p>
                      <p className="text-[11px] text-slate-500">Origen: {item.legalSource}</p>
                    </td>
                    <td className="table-cell text-slate-700">{lastComplianceLabel(item)}</td>
                    <td className="table-cell text-slate-700">{nextDueLabel(item)}</td>
                    <td className="table-cell font-semibold text-slate-800">{remainingLabel(item)}</td>
                    <td className="table-cell">
                      {item.lastEvidenceUrl ? (
                        <button
                          className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                          onClick={() => window.open(item.lastEvidenceUrl as string, '_blank', 'noopener,noreferrer')}
                          title="Ver evidencia OT"
                        >
                          <Paperclip size={14} /> Ver OT
                        </button>
                      ) : (
                        <span className="text-slate-400">Sin OT</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
