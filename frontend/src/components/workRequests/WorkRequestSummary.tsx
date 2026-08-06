import { useWorkRequestStore } from '../../store/workRequestStore';
import {
  WorkRequestVisibleStatus,
} from '../../shared/workRequestTypes';
import { getVisibleState } from '../../shared/workflowVisibleState';
import { useWorkRequestStateMachine } from '../../shared/workflowStateMachineQueries';

const SUMMARY_ORDER: WorkRequestVisibleStatus[] = ['borrador', 'en_proceso', 'cancelada'];

const SUMMARY_LABELS: Record<WorkRequestVisibleStatus, string> = {
  borrador: 'Borradores',
  en_proceso: 'En proceso',
  cancelada: 'Canceladas',
};

export function WorkRequestSummary() {
  const workRequests = useWorkRequestStore((s) => s.workRequests);
  const filterStatus = useWorkRequestStore((s) => s.filterStatus);
  const setFilterStatus = useWorkRequestStore((s) => s.setFilterStatus);
  const { data: stateMachine } = useWorkRequestStateMachine();

  if (!stateMachine) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Cargando estado de flujo...
      </div>
    );
  }

  const toVisible = (status: (typeof workRequests)[number]['status']): WorkRequestVisibleStatus => {
    const visible = getVisibleState(stateMachine, status);
    if (visible === 'draft') return 'borrador';
    if (visible === 'cancelled') return 'cancelada';
    return 'en_proceso';
  };

  const counts = workRequests.reduce<Record<WorkRequestVisibleStatus, number>>((acc, wr) => {
    const visible = toVisible(wr.status);
    acc[visible] = (acc[visible] || 0) + 1;
    return acc;
  }, {
    borrador: 0,
    en_proceso: 0,
    cancelada: 0,
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {SUMMARY_ORDER.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => setFilterStatus(filterStatus === status ? null : status)}
          className={`bg-white rounded-xl border px-4 py-4 shadow-sm transition-all hover:shadow-md text-center ${
            filterStatus === status
              ? 'border-brand-300 ring-2 ring-brand-100'
              : 'border-slate-200'
          }`}
          aria-pressed={filterStatus === status}
          title={filterStatus === status ? 'Quitar filtro' : `Filtrar por ${SUMMARY_LABELS[status]}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 text-center">{SUMMARY_LABELS[status]}</p>
          <p className="text-3xl font-extrabold text-slate-900 mt-1 tabular-nums text-center">{counts[status]}</p>
        </button>
      ))}
    </div>
  );
}
