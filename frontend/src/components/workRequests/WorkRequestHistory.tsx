import { WorkRequestStatus, WorkRequestStatusHistory } from '../../shared/workRequestTypes';
import { ensureStateMachine, getStatusLabel } from '../../shared/workflowVisibleState';
import { useWorkRequestStateMachine } from '../../shared/workflowStateMachineQueries';

export function WorkRequestHistory({ history }: { history: WorkRequestStatusHistory[] }) {
  const { data: stateMachine } = useWorkRequestStateMachine();
  if (!stateMachine) {
    return <div className="text-slate-400">Cargando contrato de estado ST...</div>;
  }
  const machine = ensureStateMachine(stateMachine, 'WorkRequestHistory');

  const toLabel = (status: WorkRequestStatus) => {
    return getStatusLabel(machine, status);
  };

  if (!history.length) return <div className="text-slate-400">Aun no hay movimientos.</div>;
  return (
    <ul className="list-disc pl-5 text-sm text-slate-700">
      {history.map((h) => (
        <li key={h.id}>
          Paso de <b>{toLabel(h.fromStatus)}</b> a <b>{toLabel(h.toStatus)}</b>
          {' '}
          el {h.changedAt.slice(0, 10)}
          {h.comment && <span className="text-xs text-slate-500"> ({h.comment})</span>}
        </li>
      ))}
    </ul>
  );
}
