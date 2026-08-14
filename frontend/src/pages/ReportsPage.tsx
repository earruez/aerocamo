import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aircraftApi } from '@api/aircraft.api';
import { maintenancePlanApi } from '@api/maintenancePlan.api';
import { BarChart2, Plane, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';

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

export default function ReportsPage() {
  const { data: aircraft = [], isLoading: loadingAc } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });

  const planQueries = useQuery({
    queryKey: ['maintenance-plan-all-reports', aircraft.map(a => a.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(aircraft.map(a => maintenancePlanApi.getForAircraft(a.id)));
      return results.flatMap((items, i) => items.map(it => ({ ...it, aircraftId: aircraft[i].id })));
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">Estado de flota</h3>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
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
