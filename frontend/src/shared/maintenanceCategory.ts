import type { MaintenancePlanItem } from '@api/maintenancePlan.api';

export type TaskCategory = 'AD' | 'SB' | 'MIM' | 'INSPECCIONES' | 'COMPONENTES';

export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  AD: 'AD',
  SB: 'SB',
  MIM: 'MIM',
  INSPECCIONES: 'Inspecciones',
  COMPONENTES: 'Componentes',
};

/**
 * Categoría normativa de la tarea, en el vocabulario del Access:
 * AD y SB vienen del tipo de referencia; MIM es la normativa nacional (INTERNAL);
 * el resto son manual de fabricante, separados por isComponentControl entre
 * inspecciones y control de vida de componentes.
 */
export function classifyTaskCategory(item: MaintenancePlanItem): TaskCategory {
  if (item.referenceType === 'AD') return 'AD';
  if (item.referenceType === 'SB') return 'SB';
  if (item.referenceType === 'INTERNAL') return 'MIM';
  return item.isComponentControl ? 'COMPONENTES' : 'INSPECCIONES';
}
