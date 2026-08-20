import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Paperclip, X, Plane, Cog } from 'lucide-react';
import { aircraftApi } from '@api/aircraft.api';
import { maintenancePlanApi, type MaintenancePlanItem } from '@api/maintenancePlan.api';
import { organizationApi } from '@api/organization.api';
import {
  CATEGORY_TABS, categoryLabel, exportDgacStatusReportPdf, getRowClass,
  lastComplianceLabel, mandatoryRowsFor, categoryCountsFor, rowsForCategory,
  nextDueLabel, remainingLabel, type CategoryFilter,
  EQUIPMENT_TABS, equipmentLabel, equipmentCountsFor, buildEquipmentSlots,
  type EquipmentFilter, type EquipmentSlot,
} from '@/shared/dgacReport';

interface AircraftStatusReportProps {
  aircraftId: string;
  registration: string;
  model: string;
  currentHours: number;
  onClose: () => void;
}

/** Ícono por equipo: la célula lleva avión, todo lo motriz engranaje. */
function iconFor(equipment: EquipmentSlot['equipment']): React.ElementType {
  return equipment === 'AERONAVE' ? Plane : Cog;
}

function EquipmentSection({ slot, isLoading, emptyLabel }: {
  slot: EquipmentSlot; isLoading: boolean; emptyLabel: string;
}) {
  const Icon = iconFor(slot.equipment);
  const rows = slot.rows;

  // Un equipo que no aplica se muestra igual, declarado: omitirlo no deja
  // constancia de que el punto se evaluó.
  if (!slot.applies) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-slate-400" />
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {slot.point} · {slot.label}
          </h4>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-200 rounded px-1.5 py-0.5">
            No aplica
          </span>
        </div>
        {slot.note && <p className="text-xs text-slate-500 mt-1.5">{slot.note}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-auto max-h-[42vh]">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-slate-500" />
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            {slot.point} · {slot.label} ({rows.length})
          </h4>
        </div>
        {slot.note && <p className="text-[11px] text-amber-700 mt-1">{slot.note}</p>}
      </div>
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 sticky top-[37px] z-10">
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
              <td colSpan={6} className="table-cell py-8 text-center text-slate-400">{emptyLabel}</td>
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
  );
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

  const { data: organization } = useQuery({ queryKey: ['organization'], queryFn: organizationApi.getCurrent });

  // Qué motores aplican se deriva de las posiciones registradas, no del tipo de aeronave.
  const { data: engines = [] } = useQuery({
    queryKey: ['aircraft-engines', aircraftId],
    queryFn: () => aircraftApi.listEngines(aircraftId),
    enabled: !!aircraftId,
  });

  const [category, setCategory] = useState<CategoryFilter>('PROGRAMA');
  const [equipment, setEquipment] = useState<EquipmentFilter>('ALL');
  const [exporting, setExporting] = useState(false);

  const mandatoryRows = useMemo(() => mandatoryRowsFor(data), [data]);
  const categoryCounts = useMemo(() => categoryCountsFor(mandatoryRows), [mandatoryRows]);
  const rows = useMemo(() => rowsForCategory(mandatoryRows, category), [mandatoryRows, category]);
  // El endpoint ya devuelve solo los motores activos de cada posición.
  const enginePositions = useMemo(() => engines.map((e) => e.position), [engines]);
  const slots = useMemo(() => buildEquipmentSlots(rows, enginePositions), [rows, enginePositions]);
  const equipmentCounts = useMemo(() => equipmentCountsFor(slots), [slots]);
  const visibleSlots = equipment === 'ALL' ? slots : slots.filter((s) => s.equipment === equipment);

  const exportPdf = async () => {
    setExporting(true);
    try {
      await exportDgacStatusReportPdf({ registration, model, currentHours, category, slots, equipment, logoDataUri: organization?.logoDataUri });
    } finally {
      setExporting(false);
    }
  };

  const emptyCategoryLabel = category === 'PROGRAMA'
    ? 'Sin tareas para este equipo.'
    : `Sin tareas de la categoría «${categoryLabel(category)}» para este equipo.`;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 p-4">
      <div className="mx-auto h-full max-h-[94vh] w-full max-w-7xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">AircraftStatusReport</h2>
            <p className="text-xs text-slate-500">Ficha clinica de aeronavegabilidad y cumplimiento DGAC</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportPdf} disabled={exporting} className="btn-secondary inline-flex items-center gap-1.5">
              <FileDown size={14} /> {exporting
                ? 'Generando…'
                : `Exportar PDF — ${categoryLabel(category)}${equipment === 'ALL' ? '' : ` · ${equipmentLabel(equipment)}`}`}
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

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Tipo de informe</p>
            <p className="text-xs text-slate-500 mb-2">
              Elige «General» para el programa completo, o una categoría para acotar la tabla y el PDF a solo esas tareas.
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_TABS.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    category === cat
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {categoryLabel(cat)} ({categoryCounts[cat]})
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Equipo</p>
            <p className="text-xs text-slate-500 mb-2">
              La DGAC pide el estatus de célula y el de motor como documentos separados (IV.2.1 y IV.2.2).
              Elige uno para exportar solo ese, o «Aeronave + Motor» para el informe combinado.
            </p>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_TABS.map((eq) => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setEquipment(eq)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    equipment === eq
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {equipmentLabel(eq)} ({equipmentCounts[eq]})
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {visibleSlots.map((slot) => (
              <EquipmentSection
                key={slot.equipment}
                slot={slot}
                isLoading={isLoading}
                emptyLabel={emptyCategoryLabel}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
