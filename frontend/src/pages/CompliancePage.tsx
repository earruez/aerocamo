import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aircraftApi } from '@api/aircraft.api';
import { complianceApi, type Compliance } from '@api/compliance.api';
import { Wrench, ChevronDown, Search } from 'lucide-react';
import {
  hasOperationalDueContext,
  MISSING_OPERATIONAL_CONTEXT_BADGE_CLASS,
  MISSING_OPERATIONAL_CONTEXT_LABEL,
} from '@/shared/operationalContext';
import { applySort, SortableHeader, toggleSort, type SortState } from '@/shared/tableSort';

function isBaselineRecord(c: Compliance): boolean {
  return c.applicationType === 'baseline' || (c.notes ?? '').trim().toLowerCase() === 'inicio de control';
}

function regulatoryRef(c: Compliance): string {
  if (!c.task) return '—';
  return c.task.referenceNumber?.toLowerCase().startsWith(c.task.referenceType?.toLowerCase() ?? '')
    ? (c.task.referenceNumber ?? '')
    : `${c.task.referenceType ?? ''} ${c.task.referenceNumber ?? ''}`.trim();
}

function dueBadge(c: Compliance): { label: string; cls: string } {
  const today = Date.now();
  const missingOperationalContext = !isBaselineRecord(c) && !hasOperationalDueContext({
    nextDueHours: c.nextDueHours,
    nextDueCycles: c.nextDueCycles,
    nextDueDate: c.nextDueDate,
  });

  if (c.deferralReference && c.deferralExpiresAt && new Date(c.deferralExpiresAt).getTime() >= today) {
    return { label: 'DIFERIDA', cls: 'badge-deferred' };
  }
  if (isBaselineRecord(c)) {
    return { label: 'INICIO DE CONTROL', cls: 'badge-state-neutral' };
  }
  if (missingOperationalContext) {
    return { label: MISSING_OPERATIONAL_CONTEXT_LABEL, cls: 'badge-state-neutral' };
  }
  if (
    (c.nextDueDate && new Date(c.nextDueDate).getTime() < today) ||
    (c.nextDueHours != null && c.aircraft?.totalFlightHours != null && c.nextDueHours < Number(c.aircraft.totalFlightHours)) ||
    (c.nextDueCycles != null && c.aircraft?.totalCycles != null && c.nextDueCycles < c.aircraft.totalCycles)
  ) {
    return { label: 'VENCIDA', cls: 'badge-overdue' };
  }
  return { label: 'AL DÍA', cls: 'badge-completed' };
}

export default function CompliancePage() {
  const [selectedAircraftId, setSelectedAircraftId] = useState<string>('');
  const [complianceTab, setComplianceTab] = useState<'ALL' | 'COMPONENT' | 'GENERAL'>('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const { data: aircraft = [] } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['compliance', 'latest', selectedAircraftId],
    queryFn: () => complianceApi.latestForAircraft(selectedAircraftId),
    enabled: !!selectedAircraftId,
  });

  const filteredRecords = useMemo(() => {
    const byTab = complianceTab === 'ALL'
      ? records
      : records.filter((record) => {
          const isComponentRecord = Boolean(record.componentId);
          return complianceTab === 'COMPONENT' ? isComponentRecord : !isComponentRecord;
        });

    const q = search.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter((c) => [
      c.task?.code, c.task?.ata, c.task?.title, c.task?.description, c.task?.referenceType, c.task?.referenceNumber,
      c.component?.partNumber, c.component?.serialNumber, c.workOrderNumber, c.inspectedBy?.name,
    ].some((field) => field?.toLowerCase().includes(q)));
  }, [records, complianceTab, search]);

  const getSortValue = (c: Compliance, key: string): unknown => {
    switch (key) {
      case 'tarea': return c.task?.code;
      case 'ref': return regulatoryRef(c);
      case 'ata': return c.task?.ata;
      case 'pn': return c.component?.partNumber;
      case 'sn': return c.component?.serialNumber;
      case 'ultimo': return new Date(c.performedAt);
      case 'horas': return Number(c.aircraftHoursAtCompliance);
      case 'proxh': return c.nextDueHours;
      case 'proxciclos': return c.nextDueCycles;
      case 'proxfecha': return c.nextDueDate ? new Date(c.nextDueDate) : null;
      case 'inspector': return isBaselineRecord(c) ? 'Registro inicial' : c.inspectedBy?.name;
      case 'estado': return dueBadge(c).label;
      default: return null;
    }
  };

  const sortedRecords = useMemo(() => applySort(filteredRecords, sort, getSortValue), [filteredRecords, sort]);

  const selected = aircraft.find((a) => a.id === selectedAircraftId);

  return (
    <div className="p-8 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
          <Wrench size={18} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cumplimientos</h1>
          <p className="text-sm text-slate-500">Estado actual de tareas por aeronave — registro de auditoría aeronáutico</p>
        </div>
      </div>

      {/* Aircraft selector */}
      <div className="filter-bar">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aeronave</label>
        <div className="relative">
          <select
            value={selectedAircraftId}
            onChange={(e) => setSelectedAircraftId(e.target.value)}
            className="filter-input pr-8 min-w-56 appearance-none cursor-pointer"
          >
            <option value="">— Seleccionar aeronave —</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        {selected && (
          <span className="text-xs text-slate-500 ml-1">
            {Number(selected.totalFlightHours).toFixed(1)} h · {selected.totalCycles} ciclos
          </span>
        )}
        {selectedAircraftId && (
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tarea, referencia, P/N, S/N…"
              className="filter-input min-w-72 pl-8"
            />
          </div>
        )}
      </div>

      {selectedAircraftId && (
        <div className="flex items-center gap-2">
          {([
            { key: 'ALL', label: 'Todos' },
            { key: 'COMPONENT', label: 'Componentes' },
            { key: 'GENERAL', label: 'General' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setComplianceTab(tab.key)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                complianceTab === tab.key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-1">Clasificación según vínculo explícito a componente</span>
        </div>
      )}

      {!selectedAircraftId && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-16 text-center text-slate-400">
          Selecciona una aeronave para ver sus cumplimientos
        </div>
      )}

      {selectedAircraftId && (
        <div
          className="bg-white rounded-xl border border-slate-200 shadow-card overflow-auto max-h-[70vh]
          [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-slate-100
          [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full
          [&::-webkit-scrollbar-thumb:hover]:bg-slate-500"
        >
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <SortableHeader label="Tarea" sortKey="tarea" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))}
                  className="table-header sticky left-0 top-0 z-20 bg-slate-50 w-[240px] min-w-[240px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]" />
                <SortableHeader label="Ref. regulatoria" sortKey="ref" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="ATA" sortKey="ata" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="P/N" sortKey="pn" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="S/N" sortKey="sn" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Último cumplimiento" sortKey="ultimo" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Horas aeronave" sortKey="horas" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} align="right" className="table-header text-right sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Próx. vto. (h)" sortKey="proxh" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} align="right" className="table-header text-right sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Próx. vto. (ciclos)" sortKey="proxciclos" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} align="right" className="table-header text-right sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Próx. vto. (fecha)" sortKey="proxfecha" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Inspector RII" sortKey="inspector" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
                <SortableHeader label="Estado" sortKey="estado" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header sticky top-0 z-10 bg-slate-50" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr><td colSpan={12} className="table-cell text-center text-slate-400 py-12">Cargando…</td></tr>
              )}
              {!isLoading && sortedRecords.length === 0 && (
                <tr><td colSpan={12} className="table-cell text-center text-slate-400 py-12">
                  {search ? 'Sin resultados para esa búsqueda' : 'No hay registros de cumplimiento para esta aeronave'}
                </td></tr>
              )}
              {sortedRecords.map((c) => {
                const { label, cls } = dueBadge(c);
                const isOverdue = cls === 'badge-overdue';
                const isBaseline = isBaselineRecord(c);
                const missingOperationalContext = !isBaseline && !hasOperationalDueContext({
                  nextDueHours: c.nextDueHours,
                  nextDueCycles: c.nextDueCycles,
                  nextDueDate: c.nextDueDate,
                });
                return (
                  <tr key={c.id} className={`group transition-colors ${isOverdue ? 'bg-rose-50 hover:bg-rose-100/70' : 'hover:bg-slate-50'}`}>
                    <td className={`table-cell font-medium sticky left-0 z-10 w-[240px] min-w-[240px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${
                      isOverdue ? 'text-rose-700 bg-rose-50 group-hover:bg-rose-100/70' : 'text-slate-700 bg-white group-hover:bg-slate-50'
                    }`}>
                      <span className="block">{c.task?.code ?? '—'}</span>
                      {c.task?.title && <span className="block text-xs font-normal text-slate-500 mt-0.5">{c.task.title}</span>}
                    </td>
                    <td className="table-cell text-xs text-slate-500">{regulatoryRef(c)}</td>
                    <td className="table-cell text-xs font-mono text-slate-500">{c.task?.ata ?? '—'}</td>
                    <td className="table-cell text-xs font-mono text-slate-500">{c.component?.partNumber ?? '—'}</td>
                    <td className="table-cell text-xs font-mono text-slate-500">{c.component?.serialNumber ?? '—'}</td>
                    <td className="table-cell text-xs text-slate-500">
                      {isBaseline
                        ? `Inicio de control: ${new Date(c.performedAt).toLocaleDateString('es-MX')}`
                        : new Date(c.performedAt).toLocaleDateString('es-MX')}
                    </td>
                    <td className="table-cell text-right tabular-nums">{Number(c.aircraftHoursAtCompliance).toFixed(1)}</td>
                    <td className={`table-cell text-right tabular-nums ${isOverdue ? 'text-rose-600 font-semibold' : ''}`}>
                      {missingOperationalContext ? MISSING_OPERATIONAL_CONTEXT_LABEL : c.nextDueHours != null ? c.nextDueHours.toFixed(1) : '—'}
                    </td>
                    <td className={`table-cell text-right tabular-nums ${isOverdue ? 'text-rose-600 font-semibold' : ''}`}>
                      {missingOperationalContext ? MISSING_OPERATIONAL_CONTEXT_LABEL : c.nextDueCycles != null ? c.nextDueCycles : '—'}
                    </td>
                    <td className={`table-cell text-xs ${isOverdue ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                      {missingOperationalContext ? MISSING_OPERATIONAL_CONTEXT_LABEL : c.nextDueDate ? new Date(c.nextDueDate).toLocaleDateString('es-MX') : '—'}
                    </td>
                    <td className="table-cell text-xs text-slate-500">{isBaseline ? 'Registro inicial' : c.inspectedBy?.name ?? '—'}</td>
                    <td className="table-cell">
                      {cls === 'badge-state-neutral'
                        ? <span className={MISSING_OPERATIONAL_CONTEXT_BADGE_CLASS}>{label}</span>
                        : <span className={cls}>{label}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
