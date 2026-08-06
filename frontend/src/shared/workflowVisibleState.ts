import type { WorkflowStateMachine } from '../api/workRequests.api';

type WorkflowTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const TONE_CLASS: Record<WorkflowTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20',
  info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20',
};

const UNKNOWN_BADGE_CLASS = TONE_CLASS.neutral;

function warnUnknownState<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  status: TStatus,
  context: string,
) {
  console.warn(`[workflow] Unknown state '${status}' for ${machine.entity} in ${context}`);
}

function resolveStateMeta<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  status: TStatus,
  context: string,
) {
  const stateMeta = machine.stateMeta[status];
  if (!stateMeta) {
    warnUnknownState(machine, status, context);
    return null;
  }
  return stateMeta;
}

export function ensureStateMachine<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus> | undefined,
  context: string,
): WorkflowStateMachine<TStatus> {
  if (!machine) {
    throw new Error(`[workflow] State machine contract is required in ${context}`);
  }
  return machine;
}

function getStatusTone<TStatus extends string>(machine: WorkflowStateMachine<TStatus>, status: TStatus): WorkflowTone {
  const stateMeta = resolveStateMeta(machine, status, 'getStatusTone') as (WorkflowStateMachine<TStatus>['stateMeta'][TStatus] & { uiTone?: WorkflowTone }) | null;
  if (!stateMeta) return 'neutral';
  return stateMeta.uiTone ?? 'neutral';
}

export function getVisibleState<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  status: TStatus,
): WorkflowStateMachine<TStatus>['stateMeta'][TStatus]['visible'] {
  const stateMeta = resolveStateMeta(machine, status, 'getVisibleState');
  if (!stateMeta) {
    return 'in_progress';
  }
  return stateMeta.visible;
}

export function getVisibleStateLabel<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  status: TStatus,
): string {
  const stateMeta = resolveStateMeta(machine, status, 'getVisibleStateLabel');
  return stateMeta?.visibleLabel ?? 'Unknown';
}

export function getStatusLabel<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  status: TStatus,
): string {
  const stateMeta = resolveStateMeta(machine, status, 'getStatusLabel');
  return stateMeta?.label ?? 'Unknown';
}

export function canTransitionTo<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  current: TStatus,
  target: TStatus,
): boolean {
  if (!machine.stateMeta[current] || !machine.stateMeta[target]) {
    warnUnknownState(machine, current, 'canTransitionTo.current');
    warnUnknownState(machine, target, 'canTransitionTo.target');
    return false;
  }
  return machine.transitions[current]?.includes(target) ?? false;
}

export function getOrderedStatuses<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
): TStatus[] {
  return [...machine.statuses]
    .filter((status) => {
      const known = Boolean(machine.stateMeta[status]);
      if (!known) warnUnknownState(machine, status, 'getOrderedStatuses');
      return known;
    })
    .sort((a, b) => {
      const aMeta = machine.stateMeta[a] as WorkflowStateMachine<TStatus>['stateMeta'][TStatus] & { order?: number };
      const bMeta = machine.stateMeta[b] as WorkflowStateMachine<TStatus>['stateMeta'][TStatus] & { order?: number };
      return (aMeta.order ?? 999) - (bMeta.order ?? 999);
    });
}

export function getStatusBadgeClass<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  status: TStatus,
): string {
  if (!machine.stateMeta[status]) {
    warnUnknownState(machine, status, 'getStatusBadgeClass');
    return UNKNOWN_BADGE_CLASS;
  }
  return TONE_CLASS[getStatusTone(machine, status)];
}
