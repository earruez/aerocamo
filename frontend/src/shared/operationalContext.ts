export const MISSING_OPERATIONAL_CONTEXT_LABEL = 'Sin datos operativos aún';
export const MISSING_OPERATIONAL_CONTEXT_HINT = 'El backend aún no reporta contexto operativo para este elemento.';

export const MISSING_OPERATIONAL_CONTEXT_BADGE_CLASS =
  'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-neutral';

export function hasOperationalDueContext(input: {
  nextDueHours?: number | null;
  nextDueCycles?: number | null;
  nextDueDate?: string | null;
  hoursRemaining?: number | null;
  daysRemaining?: number | null;
}): boolean {
  return input.nextDueHours != null
    || input.nextDueCycles != null
    || input.nextDueDate != null
    || input.hoursRemaining != null
    || input.daysRemaining != null;
}
