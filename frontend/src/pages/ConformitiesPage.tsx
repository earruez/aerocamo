import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { FileCheck2, ChevronDown, Search, FileDown } from 'lucide-react';
import { aircraftApi } from '@api/aircraft.api';
import { complianceApi } from '@api/compliance.api';
import { reportsApi } from '@api/reports.api';

const PAGE_SIZE = 100;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ConformitiesPage() {
  const [selectedAircraftId, setSelectedAircraftId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const { data: aircraft = [] } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });

  const handleDownloadPdf = async () => {
    if (!selectedAircraftId) return;
    setDownloadingPdf(true);
    try {
      const blob = await reportsApi.downloadComplianceHistoryPdf(selectedAircraftId);
      const reg = aircraft.find((a) => a.id === selectedAircraftId)?.registration ?? selectedAircraftId;
      saveAs(blob, `Cumplimiento-Regulatorio-${reg}.pdf`);
    } catch {
      toast.error('No se pudo generar el PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const { data: result, isLoading } = useQuery({
    queryKey: ['compliances', selectedAircraftId, page],
    queryFn: () => complianceApi.list({ aircraftId: selectedAircraftId || undefined, page, limit: PAGE_SIZE }),
  });

  const records = result?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((c) => [
      c.task?.code, c.task?.ata, c.task?.title,
      c.aircraft?.registration, c.workOrderNumber, c.performedBy?.name, c.inspectedBy?.name,
    ].some((field) => field?.toLowerCase().includes(q)));
  }, [records, search]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <FileCheck2 size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Conformidades</h1>
            <p className="text-sm text-slate-500">
              Libro de cumplimientos: tareas de mantenimiento firmadas al cerrar una ST o una OT.
            </p>
          </div>
        </div>
        <button
          onClick={handleDownloadPdf}
          disabled={!selectedAircraftId || downloadingPdf}
          title={!selectedAircraftId ? 'Selecciona una aeronave para generar el informe' : undefined}
          className="btn-primary flex items-center gap-1.5 shrink-0"
        >
          <FileDown size={14} />
          {downloadingPdf ? 'Generando…' : 'Informe de cumplimiento (PDF)'}
        </button>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aeronave</label>
        <div className="relative">
          <select
            value={selectedAircraftId}
            onChange={(e) => { setSelectedAircraftId(e.target.value); setPage(1); }}
            className="filter-input pr-8 min-w-56 appearance-none cursor-pointer"
          >
            <option value="">— Todas las aeronaves —</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarea, matrícula, OT/ST, quién firmó…"
            className="filter-input min-w-72 pl-8"
          />
        </div>
      </div>

      <div
        className="bg-white rounded-xl border border-slate-200 shadow-card overflow-auto max-h-[70vh]
        [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-slate-100
        [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full
        [&::-webkit-scrollbar-thumb:hover]:bg-slate-500"
      >
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">
          Total: {result?.total ?? 0}
        </div>
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="table-header sticky left-0 z-10 bg-slate-50 w-[260px] min-w-[260px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Tarea</th>
              <th className="table-header">Aeronave</th>
              <th className="table-header">Fecha de cumplimiento</th>
              <th className="table-header text-right">Horas</th>
              <th className="table-header text-right">Ciclos</th>
              <th className="table-header">Próximo vencimiento</th>
              <th className="table-header">Ref. OT/ST</th>
              <th className="table-header">Realizado por</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={8} className="table-cell text-center text-slate-400 py-12">Cargando…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={8} className="table-cell text-center text-slate-400 py-12">
                {search ? 'Sin resultados para esa búsqueda' : 'No hay conformidades registradas todavía'}
              </td></tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="table-cell sticky left-0 z-10 bg-white w-[260px] min-w-[260px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                  <p className="font-mono text-xs font-bold text-slate-700">{c.task?.code ?? '—'}</p>
                  <p className="text-xs text-slate-500 truncate max-w-[240px]">{c.task?.title ?? '—'}</p>
                </td>
                <td className="table-cell font-mono text-xs">{c.aircraft?.registration ?? '—'}</td>
                <td className="table-cell">{fmtDate(c.performedAt)}</td>
                <td className="table-cell text-right tabular-nums">{c.aircraftHoursAtCompliance?.toFixed(1) ?? '—'}</td>
                <td className="table-cell text-right tabular-nums">{c.aircraftCyclesAtCompliance ?? '—'}</td>
                <td className="table-cell text-xs">
                  {c.nextDueDate ? fmtDate(c.nextDueDate) : null}
                  {c.nextDueHours != null ? ` · ${c.nextDueHours.toFixed(1)} h` : ''}
                  {c.nextDueCycles != null ? ` · ${c.nextDueCycles} cyc` : ''}
                  {!c.nextDueDate && c.nextDueHours == null && c.nextDueCycles == null && '—'}
                </td>
                <td className="table-cell font-mono text-xs">{c.workOrderNumber ?? '—'}</td>
                <td className="table-cell text-xs">{c.performedBy?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="btn-secondary disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-slate-500 text-xs">Página {result.page} de {result.totalPages}</span>
          <button
            type="button"
            disabled={page >= result.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="btn-secondary disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
