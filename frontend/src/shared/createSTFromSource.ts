import { useWorkRequestStore } from '../store/workRequestStore';
import type { WorkRequestOrigin } from './workRequestTypes';
import { workRequestsApi } from '../api/workRequests.api';
import { adaptApiWorkRequest, upsertWorkRequestCache } from './workRequestApiAdapter';

/**
 * Crea una nueva ST en estado draft y agrega un item automáticamente según el origen.
 * @param sourceType Tipo de origen ("maintenance_plan", "component", etc)
 * @param sourceData Datos mínimos requeridos para el item y la ST
 * @returns Promise<string> id de la ST creada
 */
export async function createSTFromSource(
  sourceType: 'maintenance_plan' | 'component' | 'discrepancy' | 'compliance_due' | 'manual',
  sourceData: {
    aircraftId: string;
    sourceId: string;
    ataCode: string;
    title: string;
    description: string;
    aircraftHoursAtRequest: number;
    aircraftCyclesAtRequest: number;
    priority?: 'alta' | 'media' | 'baja';
    requiresComponentTracking?: boolean;
    executionType?: 'maintenance_application' | 'component_replacement' | 'discrepancy_action';
    componentDefinitionId?: string;
  }
): Promise<string> {
  const store = useWorkRequestStore.getState();
  const sourceKind: WorkRequestOrigin = sourceType === 'component' ? 'component_inspection' : sourceType;

  const currentOpen = store.itemAlreadyInOpenWorkRequest(sourceKind, sourceData.sourceId);
  if (currentOpen) return currentOpen.id;

  const list = await workRequestsApi.listByAircraft(sourceData.aircraftId);
  const mapped = list.map(adaptApiWorkRequest);
  store.setWorkRequests([
    ...store.workRequests.filter((wr) => wr.aircraftId !== sourceData.aircraftId),
    ...mapped,
  ]);

  const existingOpen = mapped.find((wr) => (
    wr.status !== 'CANCELLED'
    && wr.items.some((it) => it.sourceKind === sourceKind && it.sourceId === sourceData.sourceId)
  ));
  if (existingOpen) return existingOpen.id;

  const draftFromApi = list.find((wr) => wr.status === 'DRAFT') ?? await workRequestsApi.createDraft(sourceData.aircraftId);

  const payload = sourceType === 'maintenance_plan'
    ? {
        taskId: sourceData.sourceId,
        category: 'MAINTENANCE_PLAN' as const,
      }
    : sourceType === 'component'
      ? {
          componentId: sourceData.sourceId,
          category: 'COMPONENT_INSPECTION' as const,
        }
      : sourceType === 'discrepancy'
        ? {
            discrepancyId: sourceData.sourceId,
            category: 'DISCREPANCY' as const,
          }
        : {
            sourceKind: sourceKind,
            sourceId: sourceData.sourceId,
            executionType: sourceData.executionType ?? null,
            requiresComponentTracking: sourceData.requiresComponentTracking ?? false,
            componentDefinitionId: sourceData.componentDefinitionId ?? null,
            category: 'OTHER' as const,
            code: sourceData.ataCode || 'N/A',
            title: sourceData.title,
            description: sourceData.description,
          };

  const updated = await workRequestsApi.addItem(draftFromApi.id, payload);
  const adapted = adaptApiWorkRequest(updated);
  store.setWorkRequests(upsertWorkRequestCache(useWorkRequestStore.getState().workRequests, adapted));

  return adapted.id;
}
