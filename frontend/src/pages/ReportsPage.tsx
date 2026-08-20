import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { aircraftApi, type Aircraft } from '@api/aircraft.api';
import { maintenancePlanApi } from '@api/maintenancePlan.api';
import { organizationApi } from '@api/organization.api';
import { reportsApi } from '@api/reports.api';
import { BarChart2, Plane, AlertTriangle, CheckCircle, TrendingUp, FileDown, FileCheck2, Wrench } from 'lucide-react';
import {
  CATEGORY_TABS, categoryLabel, exportDgacStatusReportPdf,
  mandatoryRowsFor, categoryCountsFor, rowsForCategory, type CategoryFilter,
  EQUIPMENT_TABS, equipmentLabel, equipmentCountsFor, buildEquipmentSlots, type EquipmentFilter,
} from '@/shared/dgacReport';

function StatCard({ label, value, sub, Icon, color }: {
  label: string; value: string | number; sub?: string;
  Icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-xl ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-600 w-28 shrink-0 truncate font-mono">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold tabular-nums text-slate-700 w-8 text-right">{value}</span>
    </div>
  );
}

function ReportDownloadCard({ Icon, title, description, onDownload, downloading }: {
  Icon: React.ElementType; title: string; description: string;
  onDownload: () => void; downloading: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
      <button
        onClick={onDownload}
        disabled={downloading}
        className="btn-secondary flex items-center justify-center gap-1.5 text-xs"
      >
        <FileDown size={13} />
        {downloading ? 'Generando…' : 'Descargar PDF'}
      </button>
    </div>
  );
}

function DgacReportCard({ aircraftList }: { aircraftList: Aircraft[] }) {
  const [aircraftId, setAircraftId] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('PROGRAMA');
  const [equipment, setEquipment] = useState<EquipmentFilter>('ALL');
  const [downloading, setDownloading] = useState(false);
  const selected = aircraftList.find((a) => a.id === aircraftId);

  const { data = [] } = useQuery({
    queryKey: ['aircraft-status-report', aircraftId],
    queryFn: () => maintenancePlanApi.getForAircraft(aircraftId),
    enabled: !!aircraftId,
  });

  const { data: organization } = useQuery({ queryKey: ['organization'], queryFn: organizationApi.getCurrent });

  // Las posiciones registradas deciden qué motores aplican: no se asume por tipo.
  const { data: engines = [] } = useQuery({
    queryKey: ['aircraft-engines', aircraftId],
    queryFn: () => aircraftApi.listEngines(aircraftId),
    enabled: !!aircraftId,
  });

  // Declaraciones de aplicabilidad por equipo: priman sobre lo derivado.
  const { data: declared = [] } = useQuery({
    queryKey: ['aircraft-equipment-applicability', aircraftId],
    queryFn: () => aircraftApi.listEquipmentApplicability(aircraftId),
    enabled: !!aircraftId,
  });

  const mandatoryRows = useMemo(() => mandatoryRowsFor(data), [data]);
  const categoryCounts = useMemo(() => categoryCountsFor(mandatoryRows), [mandatoryRows]);
  const rows = useMemo(() => rowsForCategory(mandatoryRows, category), [mandatoryRows, category]);
  // El endpoint ya devuelve solo los motores activos de cada posición.
  const enginePositions = useMemo(() => engines.map((e) => e.position), [engines]);
  const slots = useMemo(() => buildEquipmentSlots(rows, enginePositions, category, declared), [rows, enginePositions, category, declared]);
  const equipmentCounts = useMemo(() => equipmentCountsFor(slots), [slots]);

  const handleDownload = async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      await exportDgacStatusReportPdf({
        registration: selected.registration,
        model: selected.model,
        currentHours: Number(selected.totalFlightHours),
        category,
        slots,
        equipment,
        logoDataUri: organization?.logoDataUri,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 flex flex-col gap-4 md:col-span-2">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
          <FileCheck2 size={16} className="text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Informe DGAC por Aeronave</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Aircraft Status Report de aeronavegabilidad y cumplimiento: elige la aeronave y la categoría (General, AD, SB, MIM, Inspecciones, Componentes).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Aeronave</label>
          <select
            value={aircraftId}
            onChange={(e) => { setAircraftId(e.target.value); setCategory('PROGRAMA'); setEquipment('ALL'); }}
            className="filter-input w-full mt-1"
          >
            <option value="">— Selecciona una aeronave —</option>
            {aircraftList.map((a) => (
              <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
            ))}
          </select>
        </div>

        {aircraftId && (
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
        )}
      </div>

      {aircraftId && (
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Equipo</label>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">
            Los puntos IV.2.1 a IV.2.6 de la lista de presentación de la DGAC. Elige uno para generar
            solo ese documento, o «Todos» para el informe completo. Los equipos que no aplican salen
            igual, declarados como tal.
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
      )}

      <button
        onClick={handleDownload}
        disabled={!aircraftId || downloading}
        className="btn-secondary flex items-center justify-center gap-1.5 text-xs self-start"
      >
        <FileDown size={13} />
        {downloading
          ? 'Generando…'
          : `Descargar PDF — ${categoryLabel(category)}${equipment === 'ALL' ? '' : ` · ${equipmentLabel(equipment)}`}`}
      </button>
    </div>
  );
}

/**
 * DGAC IV.5.1.2 — estatus de alteraciones y reparaciones mayores.
 *
 * El mismo informe se descarga desde Alteraciones por Aeronave. Está en los dos
 * lugares a propósito: ahí se llega desde la alteración que se acaba de cargar,
 * y acá desde la vista de "qué le entrego a la DGAC".
 */
function AlterationsReportCard({ aircraftList }: { aircraftList: Aircraft[] }) {
  const [aircraftId, setAircraftId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const selected = aircraftList.find((a) => a.id === aircraftId);

  const handleDownload = async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      const blob = await aircraftApi.downloadAlterationsReportPdf(selected.id);
      saveAs(blob, `Alteraciones_${selected.registration}.pdf`);
    } catch {
      toast.error('No se pudo generar el informe');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 flex flex-col gap-4 md:col-span-2">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
          <Wrench size={16} className="text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Alteraciones y Reparaciones Mayores</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Punto IV.5.1.2 de la lista de la DGAC: STC y Formularios 337 con sus suplementos del
            manual de vuelo (FMS) e instrucciones de aeronavegabilidad continuada (ICA).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Aeronave</label>
          <select
            value={aircraftId}
            onChange={(e) => setAircraftId(e.target.value)}
            className="filter-input w-full mt-1"
          >
            <option value="">— Selecciona una aeronave —</option>
            {aircraftList.map((a) => (
              <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleDownload}
        disabled={!aircraftId || downloading}
        className="btn-secondary flex items-center justify-center gap-1.5 text-xs self-start"
      >
        <FileDown size={13} />
        {downloading ? 'Generando…' : 'Descargar PDF'}
      </button>
    </div>
  );
}

type ReportId = 'fleet-summary' | 'fleet-lookahead';

export default function ReportsPage() {
  const [downloadingReport, setDownloadingReport] = useState<ReportId | null>(null);
  const { data: aircraft = [], isLoading: loadingAc } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });

  const downloadReport = async (id: ReportId, run: () => Promise<Blob>, filename: string) => {
    setDownloadingReport(id);
    try {
      const blob = await run();
      saveAs(blob, filename);
    } catch {
      toast.error('No se pudo generar el PDF');
    } finally {
      setDownloadingReport(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  const planQueries = useQuery({
    queryKey: ['maintenance-plan-all-reports', aircraft.map(a => a.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(aircraft.map(a => maintenancePlanApi.getForAircraft(a.id)));
      // Solo el plan vigente: las tareas marcadas "no aplica" vienen en la
      // respuesta para que la UI pueda revertirlas, pero no son tareas de la
      // aeronave y no deben entrar en las estadísticas de flota.
      return results.flatMap((items, i) => items
        .filter(it => it.isApplicable)
        .map(it => ({ ...it, aircraftId: aircraft[i].id })));
    },
    enabled: aircraft.length > 0,
  });

  const records = planQueries.data ?? [];

  const stats = useMemo(() => {
    const totalHours = aircraft.reduce((s, a) => s + Number(a.totalFlightHours), 0);
    const totalCycles = aircraft.reduce((s, a) => s + a.totalCycles, 0);
    const overdue   = records.filter(r => r.status === 'OVERDUE').length;
    const dueSoon   = records.filter(r => r.status === 'DUE_SOON').length;
    const completed = records.filter(r => r.status === 'OK').length;

    const byAircraft = aircraft.map(a => ({
      reg: a.registration,
      overdue: records.filter(r => r.aircraftId === a.id && r.status === 'OVERDUE').length,
      total:   records.filter(r => r.aircraftId === a.id).length,
    }));

    const statusPct = records.length > 0 ? {
      overdue:   Math.round((overdue / records.length) * 100),
      dueSoon:   Math.round((dueSoon / records.length) * 100),
      completed: Math.round((completed / records.length) * 100),
    } : { overdue: 0, dueSoon: 0, completed: 0 };

    return { totalHours, totalCycles, overdue, dueSoon, completed, byAircraft, statusPct, totalRecords: records.length };
  }, [aircraft, records]);

  const loading = loadingAc || planQueries.isLoading;

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
          <BarChart2 size={18} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reportes</h1>
          <p className="text-sm text-slate-500">Resumen ejecutivo de la flota</p>
        </div>
      </div>

      {/* Informes en PDF */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportDownloadCard
          Icon={FileDown}
          title="Informe Ejecutivo de Flota"
          description="Disponibilidad, horas y vencimientos por aeronave. Para presentar a gerencia."
          downloading={downloadingReport === 'fleet-summary'}
          onDownload={() => downloadReport('fleet-summary', reportsApi.downloadFleetSummaryPdf, `Informe-Ejecutivo-Flota-${today}.pdf`)}
        />
        <ReportDownloadCard
          Icon={AlertTriangle}
          title="Vencimientos de Flota"
          description="Tareas vencidas y próximas a vencer en toda la flota, para planificar mantenimiento."
          downloading={downloadingReport === 'fleet-lookahead'}
          onDownload={() => downloadReport('fleet-lookahead', reportsApi.downloadFleetLookaheadPdf, `Vencimientos-Flota-${today}.pdf`)}
        />
        <DgacReportCard aircraftList={aircraft} />
        <AlterationsReportCard aircraftList={aircraft} />
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando datos…</p>}

      {!loading && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Aeronaves" value={aircraft.length} Icon={Plane} color="bg-brand-600"
              sub={`${aircraft.filter(a => a.status === 'OPERATIONAL').length} operacionales`} />
            <StatCard label="Horas totales" value={stats.totalHours.toFixed(0)} Icon={TrendingUp} color="bg-violet-500"
              sub={`${stats.totalCycles.toLocaleString()} ciclos totales`} />
            <StatCard label="Tareas vencidas" value={stats.overdue} Icon={AlertTriangle} color="bg-rose-500"
              sub={`${stats.statusPct.overdue}% del total de tareas`} />
            <StatCard label="Tareas al día" value={stats.completed} Icon={CheckCircle} color="bg-emerald-500"
              sub={`${stats.statusPct.completed}% del total de tareas`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Estado de tareas por aeronave */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Tareas vencidas por aeronave</h3>
              {stats.byAircraft.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">Sin datos</p>
              ) : (
                <div className="space-y-3">
                  {stats.byAircraft.map(({ reg, overdue, total }) => (
                    <HBar
                      key={reg}
                      label={reg}
                      value={overdue}
                      max={Math.max(...stats.byAircraft.map(x => x.total), 1)}
                      color={overdue > 0 ? 'bg-rose-400' : 'bg-emerald-400'}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Distribución de estado global */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Distribución global de tareas</h3>
              <div className="space-y-4">
                {[
                  { label: 'Al día',            count: stats.completed, color: 'bg-emerald-500', pct: stats.statusPct.completed },
                  { label: 'Próximas a vencer', count: stats.dueSoon,   color: 'bg-amber-400',   pct: stats.statusPct.dueSoon   },
                  { label: 'Vencidas',          count: stats.overdue,   color: 'bg-rose-500',    pct: stats.statusPct.overdue   },
                ].map(({ label, count, color, pct }) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-slate-600">{label}</span>
                      <span className="font-semibold tabular-nums">{count} <span className="text-slate-400 font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-400 text-center">
                  Total de registros analizados: <span className="font-semibold text-slate-600">{stats.totalRecords}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Estado de flota */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-auto max-h-[70vh]">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Estado de flota</h3>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="table-header">Matrícula</th>
                  <th className="table-header">Modelo</th>
                  <th className="table-header text-right">Horas totales</th>
                  <th className="table-header text-right">Ciclos</th>
                  <th className="table-header text-right">Tareas totales</th>
                  <th className="table-header text-right">Vencidas</th>
                  <th className="table-header">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aircraft.map(a => {
                  const ac = stats.byAircraft.find(x => x.reg === a.registration);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="table-cell font-mono font-bold text-slate-900">{a.registration}</td>
                      <td className="table-cell text-slate-600">{a.model}</td>
                      <td className="table-cell text-right tabular-nums">{Number(a.totalFlightHours).toFixed(1)}</td>
                      <td className="table-cell text-right tabular-nums">{a.totalCycles}</td>
                      <td className="table-cell text-right tabular-nums">{ac?.total ?? 0}</td>
                      <td className={`table-cell text-right tabular-nums font-semibold ${(ac?.overdue ?? 0) > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {ac?.overdue ?? 0}
                      </td>
                      <td className="table-cell">
                        <span className={`badge-${a.status.toLowerCase().replace('_', '-')}`}>{a.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
