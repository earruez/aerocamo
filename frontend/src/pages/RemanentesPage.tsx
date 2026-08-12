import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { FileDown, X } from 'lucide-react';
import { aircraftApi } from '@api/aircraft.api';
import { dueApi, type DueMethod, type DueRow, type DueSourceType, type DueStatus } from '@api/due.api';
import { workOrdersApi } from '@api/workOrders.api';
import { complianceApi } from '@api/compliance.api';
import { useWorkRequestStore } from '@store/workRequestStore';
import { createSTFromSource } from '@/shared/createSTFromSource';
import { MISSING_OPERATIONAL_CONTEXT_LABEL } from '@/shared/operationalContext';

/** Source types respaldados por una MaintenanceTask (tienen taskId real, no componentId). */
const TASK_SOURCE_TYPES: DueSourceType[] = ['AD', 'SB', 'INSPECTION', 'MIM', 'DAN', 'MOD'];

const sourceTabs: Array<{ key: string; label: string; sourceType?: DueSourceType }> = [
  { key: 'all', label: 'Todos' },
  { key: 'AD', label: 'AD', sourceType: 'AD' },
  { key: 'SB', label: 'SB/TB', sourceType: 'SB' },
  { key: 'INSPECTION', label: 'Inspecciones', sourceType: 'INSPECTION' },
  { key: 'COMPONENT', label: 'Componentes', sourceType: 'COMPONENT' },
  { key: 'ENGINE_COMPONENT', label: 'Comp. motor', sourceType: 'ENGINE_COMPONENT' },
];

const dimensionOptions: Array<{ key: 'ALL' | DueMethod; label: string; value: 'ALL' | DueMethod }> = [
  { key: 'ALL', label: 'Todos', value: 'ALL' },
  { key: 'H', label: 'Horarios (H)', value: 'H' },
  { key: 'M', label: 'Calendarios (M)', value: 'M' },
  { key: 'C', label: 'Ciclos (C)', value: 'C' },
  { key: 'N1', label: 'N1', value: 'N1' },
  { key: 'N2', label: 'N2', value: 'N2' },
];

const statusClass: Record<DueStatus, string> = {
  OVERDUE: 'badge-state-critical',
  DUE_SOON: 'badge-state-warning',
  OK: 'badge-state-success',
  NO_CONTEXT: 'badge-state-neutral',
  NOT_APPLICABLE: 'badge-state-neutral',
  COMPLIED: 'badge-state-success',
};

const STATUS_PRIORITY: Record<DueStatus, number> = {
  OVERDUE: 1,
  DUE_SOON: 2,
  OK: 3,
  NO_CONTEXT: 4,
  COMPLIED: 5,
  NOT_APPLICABLE: 6,
};

function fmtNumber(v: number | null, suffix = '', fallback = MISSING_OPERATIONAL_CONTEXT_LABEL): string {
  if (v == null) return fallback;
  return `${v}${suffix}`;
}

function fmtDate(v: string | null): string {
  if (!v) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  return new Date(v).toLocaleDateString('es-MX');
}

function fmtRemainingValue(row: DueRow): string {
  if (row.remainingValue == null) return MISSING_OPERATIONAL_CONTEXT_LABEL;
  const unit = row.remainingUnit ? ` ${row.remainingUnit}` : '';
  if (row.remainingValue < 0) return `${Math.abs(row.remainingValue)}${unit} vencido`;
  return `${row.remainingValue}${unit}`;
}

function getOperationalDimension(row: DueRow): DueMethod | null {
  return row.activeDimension ?? row.primaryDueDimension ?? null;
}

function statusLabel(status: DueStatus): string {
  if (status === 'NO_CONTEXT') return 'Sin contexto';
  if (status === 'NOT_APPLICABLE') return 'No aplica';
  if (status === 'DUE_SOON') return 'Próx. vencer';
  if (status === 'OVERDUE') return 'Vencido';
  if (status === 'COMPLIED') return 'Cumplido';
  return 'OK';
}

const COMPLIANCE_STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completado',
  DEFERRED: 'Diferido',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
};

function HistoryModal({ row, onClose }: { row: DueRow; onClose: () => void }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['compliance-history', row.aircraftId, row.sourceId],
    queryFn: () => complianceApi.historyForTask(row.aircraftId, row.sourceId),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Historial de cumplimientos</h2>
            <p className="text-xs text-slate-500 mt-0.5">{row.description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 shrink-0">
            <X size={15} className="text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {isLoading ? (
            <p className="text-xs text-slate-400 py-6 text-center">Cargando…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Sin cumplimientos registrados todavía.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800">{fmtDate(c.performedAt)}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      c.status === 'COMPLETED' ? 'badge-state-success'
                        : c.status === 'OVERDUE' ? 'badge-state-critical'
                        : c.status === 'DEFERRED' ? 'badge-state-warning' : 'badge-state-neutral'
                    }`}>
                      {COMPLIANCE_STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {fmtNumber(c.aircraftHoursAtCompliance, ' FH')} · {fmtNumber(c.aircraftCyclesAtCompliance, ' CYC')}
                    {c.workOrderNumber ? ` · OT ${c.workOrderNumber}` : ''}
                    {c.isInitial ? ' · Inicio de control' : ''}
                  </p>
                  {c.notes && <p className="text-xs text-slate-500 mt-1.5">{c.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RemanentesPage() {
  type KpiCard = { label: string; value: number; status: DueStatus };

  const navigate = useNavigate();
  const selectWorkRequest = useWorkRequestStore((s) => s.selectWorkRequest);

  const [sourceTab, setSourceTab] = useState(sourceTabs[0]);
  const [aircraftId, setAircraftId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<DueStatus | null>(null);
  const [dimensionFilter, setDimensionFilter] = useState<'ALL' | DueMethod>('ALL');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [creatingSTRowId, setCreatingSTRowId] = useState<string | null>(null);
  const [loadingOTRowId, setLoadingOTRowId] = useState<string | null>(null);
  const [historyRow, setHistoryRow] = useState<DueRow | null>(null);

  const { data: aircraft = [] } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
  });

  const selectedAircraftId = aircraftId || aircraft[0]?.id || '';

  const { data: summary } = useQuery({
    queryKey: ['due-summary', selectedAircraftId],
    enabled: Boolean(selectedAircraftId),
    queryFn: () => dueApi.getSummary(selectedAircraftId),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['due-rows', selectedAircraftId],
    enabled: Boolean(selectedAircraftId),
    queryFn: () => dueApi.getRows(selectedAircraftId),
  });

  const kpiCards = useMemo(() => {
    if (!summary) return [] as KpiCard[];
    return [
      { label: 'Vencidos', value: summary.overdueCount, status: 'OVERDUE' as DueStatus },
      { label: 'Próx. vencer', value: summary.dueSoonCount, status: 'DUE_SOON' as DueStatus },
      { label: 'OK', value: summary.okCount, status: 'OK' as DueStatus },
      { label: 'Sin contexto', value: summary.noContextCount, status: 'NO_CONTEXT' as DueStatus },
    ] as KpiCard[];
  }, [summary]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (byStatus !== 0) return byStatus;

      const aRemaining = a.remainingValue == null ? Number.POSITIVE_INFINITY : a.remainingValue;
      const bRemaining = b.remainingValue == null ? Number.POSITIVE_INFINITY : b.remainingValue;
      if (aRemaining !== bRemaining) return aRemaining - bRemaining;

      return a.description.localeCompare(b.description);
    });
  }, [rows]);

  const visibleRows = useMemo(() => {
    return sortedRows.filter((row) => {
      if (sourceTab.sourceType && row.sourceType !== sourceTab.sourceType) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (dimensionFilter !== 'ALL') {
        const operationalDimension = getOperationalDimension(row);
        if (!operationalDimension || operationalDimension !== dimensionFilter) return false;
      }
      return true;
    });
  }, [sortedRows, sourceTab.sourceType, statusFilter, dimensionFilter]);

  const selectedAircraft = aircraft.find((a) => a.id === selectedAircraftId);

  const handleCreateST = async (row: DueRow) => {
    setCreatingSTRowId(row.id);
    try {
      const isComponent = row.sourceType === 'COMPONENT' || row.sourceType === 'ENGINE_COMPONENT';
      const stId = await createSTFromSource(isComponent ? 'component' : 'maintenance_plan', {
        aircraftId: row.aircraftId,
        sourceId: (isComponent ? row.componentId : null) ?? row.sourceId,
        ataCode: row.taskCode || '—',
        title: row.description,
        description: row.description,
        aircraftHoursAtRequest: selectedAircraft?.totalFlightHours ?? 0,
        aircraftCyclesAtRequest: selectedAircraft?.totalCycles ?? 0,
        priority: row.status === 'OVERDUE' ? 'alta' : row.status === 'DUE_SOON' ? 'media' : 'baja',
        requiresComponentTracking: row.requiresComponentTracking,
      });
      selectWorkRequest(stId, 'general');
      toast.success('Agregado a la Solicitud de Trabajo');
      navigate(`/work-requests?aircraftId=${row.aircraftId}&stId=${stId}`);
    } catch {
      toast.error('No se pudo crear/actualizar la ST');
    } finally {
      setCreatingSTRowId(null);
    }
  };

  const handleViewOT = async (row: DueRow) => {
    if (!row.referenceOt) return;
    setLoadingOTRowId(row.id);
    try {
      const workOrders = await workOrdersApi.list({ aircraftId: row.aircraftId });
      const wo = workOrders.find((w) => w.number === row.referenceOt);
      if (!wo) {
        toast.error(`No se encontró la OT ${row.referenceOt}`);
        return;
      }
      navigate(`/work-orders/${wo.id}`);
    } catch {
      toast.error('No se pudo abrir la OT');
    } finally {
      setLoadingOTRowId(null);
    }
  };

  const handleHistory = (row: DueRow) => {
    if (!TASK_SOURCE_TYPES.includes(row.sourceType)) {
      toast.error('El historial todavía no está disponible para componentes');
      return;
    }
    setHistoryRow(row);
  };

  const handleDownloadPdf = async () => {
    if (!selectedAircraftId) return;
    setDownloadingPdf(true);
    try {
      const blob = await dueApi.downloadReportPdf(selectedAircraftId);
      saveAs(blob, `Remanentes-${selectedAircraft?.registration ?? selectedAircraftId}.pdf`);
    } catch {
      toast.error('No se pudo generar el informe PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const totalRowsCount = summary?.totalRows ?? visibleRows.length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[96rem] mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Remanentes Operacionales</h1>
            <p className="text-sm text-slate-600 mt-1">
              Calculado automáticamente a partir de las horas, ciclos y cumplimientos registrados de la aeronave.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!selectedAircraftId || downloadingPdf}
            className="btn-secondary flex items-center gap-1.5 shrink-0"
          >
            <FileDown size={15} />
            {downloadingPdf ? 'Generando…' : 'Descargar informe PDF'}
          </button>
        </div>
        <div className="max-w-sm">
          <label className="form-label">Aeronave</label>
          <select className="input w-full" value={selectedAircraftId} onChange={(e) => setAircraftId(e.target.value)}>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>{a.registration} · {a.manufacturer} {a.model}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          {kpiCards.map((kpi) => {
            const active = statusFilter === kpi.status;
            return (
              <button
                key={kpi.label}
                type="button"
                onClick={() => setStatusFilter(active ? null : kpi.status)}
                className={`text-left bg-white border rounded-xl px-4 py-3 shadow-sm transition-colors ${active ? 'border-brand-500 ring-1 ring-brand-300' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{kpi.label}</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{kpi.value}</p>
              </button>
            );
          })}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm min-w-[140px]">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Total</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{totalRowsCount}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2">
          {sourceTabs.map((t) => (
            <button
              key={t.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${sourceTab.key === t.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              onClick={() => setSourceTab(t)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Dimensión operacional</span>
          {dimensionOptions.map((option) => {
            const active = dimensionFilter === option.value;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setDimensionFilter(option.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div
          className="overflow-x-auto [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-slate-100
          [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full
          [&::-webkit-scrollbar-thumb:hover]:bg-slate-500"
        >
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-header sticky left-0 z-10 bg-slate-50 w-[84px] min-w-[84px]">Tipo</th>
                <th className="table-header sticky left-[84px] z-10 bg-slate-50 w-[260px] min-w-[260px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Descripción</th>
                <th className="table-header">P/N</th>
                <th className="table-header">S/N</th>
                <th className="table-header">DIM</th>
                <th className="table-header">Método</th>
                <th className="table-header">Intervalo</th>
                <th className="table-header">Último cumplimiento</th>
                <th className="table-header">Próximo</th>
                <th className="table-header">Remanente</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Obs./Ref.</th>
                <th className="table-header">OT/ST</th>
                <th className="table-header">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td className="table-cell" colSpan={14}>Cargando...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td className="table-cell" colSpan={14}>{MISSING_OPERATIONAL_CONTEXT_LABEL}</td></tr>
              ) : visibleRows.map((row: DueRow) => (
                <tr key={row.id} className="group hover:bg-slate-50">
                  <td className="table-cell sticky left-0 z-10 bg-white group-hover:bg-slate-50 w-[84px] min-w-[84px]">{row.sourceType}</td>
                  <td className="table-cell sticky left-[84px] z-10 bg-white group-hover:bg-slate-50 w-[260px] min-w-[260px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">{row.description}</td>
                  <td className="table-cell font-mono">{row.partNumber ?? '—'}</td>
                  <td className="table-cell font-mono">{row.serialNumber ?? '—'}</td>
                  <td className="table-cell font-semibold">{getOperationalDimension(row) ?? MISSING_OPERATIONAL_CONTEXT_LABEL}</td>
                  <td className="table-cell">{row.method}</td>
                  <td className="table-cell">{fmtNumber(row.intervalValue, row.intervalUnit ? ` ${row.intervalUnit}` : '', '—')}</td>
                  <td className="table-cell">{row.lastComplianceDate ? `${fmtDate(row.lastComplianceDate)} · ${fmtNumber(row.lastComplianceValue)}` : MISSING_OPERATIONAL_CONTEXT_LABEL}</td>
                  <td className="table-cell">{row.nextDueDate ? fmtDate(row.nextDueDate) : row.nextDueValue != null ? fmtNumber(row.nextDueValue) : MISSING_OPERATIONAL_CONTEXT_LABEL}</td>
                  <td className="table-cell">{fmtRemainingValue(row)}</td>
                  <td className="table-cell">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass[row.status]}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="table-cell">{(row.observations ?? row.sourceDocumentReference ?? MISSING_OPERATIONAL_CONTEXT_LABEL).replace('Inicio de control registrado; falta cumplimiento real para ciclo operativo completo.', 'Inicio de control (sin cumplimiento real)')}</td>
                  <td className="table-cell">{row.referenceOt ?? '-'} / {row.referenceSt ?? '-'}</td>
                  <td className="table-cell">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => handleCreateST(row)}
                        disabled={creatingSTRowId === row.id}
                      >
                        {creatingSTRowId === row.id ? '…' : 'Crear ST'}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => handleViewOT(row)}
                        disabled={!row.referenceOt || loadingOTRowId === row.id}
                      >
                        {loadingOTRowId === row.id ? '…' : 'Ver OT'}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        onClick={() => handleHistory(row)}
                        disabled={!TASK_SOURCE_TYPES.includes(row.sourceType)}
                        title={TASK_SOURCE_TYPES.includes(row.sourceType) ? undefined : 'No disponible para componentes todavía'}
                      >
                        Historial
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {historyRow && <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
    </div>
  );
}
