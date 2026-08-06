import {
  ST_VISIBLE_BADGE_CONFIG,
  WorkRequestStatus,
} from '../../shared/workRequestTypes';
import { getVisibleState } from '../../shared/workflowVisibleState';
import { useWorkRequestStateMachine } from '../../shared/workflowStateMachineQueries';

export function WorkRequestBadge({ status }: { status: WorkRequestStatus }) {
  const { data: stateMachine } = useWorkRequestStateMachine();
  if (!stateMachine) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset ring-slate-200 bg-slate-100 text-slate-700">
        {status}
      </span>
    );
  }

  const visible = getVisibleState(stateMachine, status);
  const visibleStatus = visible === 'draft' ? 'borrador' : visible === 'cancelled' ? 'cancelada' : 'en_proceso';
  const config = ST_VISIBLE_BADGE_CONFIG[visibleStatus];

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ring-inset ring-slate-200 ${config.className}`}>
      {config.label}
    </span>
  );
}
