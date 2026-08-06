import { prisma } from '../../infrastructure/database/prisma.client';

export type WorkRequestSourceKind =
  | 'maintenance_plan'
  | 'component_inspection'
  | 'discrepancy'
  | 'compliance_due'
  | 'manual';

export type WorkRequestExecutionType =
  | 'maintenance_application'
  | 'component_replacement'
  | 'discrepancy_action';

export type ExecutionEligibilityReason =
  | 'ELIGIBLE'
  | 'NO_VALID_ST_ITEM'
  | 'NO_SIGNED_WORK_ORDER'
  | 'INVALID_REQUIRED_COMPONENT';

export interface ExecutionEligibilityInput {
  organizationId: string;
  aircraftId: string;
  sourceKind: WorkRequestSourceKind;
  sourceId: string;
  executionType: WorkRequestExecutionType;
  requiredComponentSourceId?: string | null;
}

export interface ExecutionEligibilityResult {
  eligible: boolean;
  reason: ExecutionEligibilityReason;
  message: string;
  workRequestId: string | null;
  workRequestNumber: string | null;
  workOrderNumber: string | null;
  matchedItemId: string | null;
}

export class WorkRequestExecutionEligibilityService {
  async evaluate(input: ExecutionEligibilityInput): Promise<ExecutionEligibilityResult> {
    const sourceId = input.sourceId.trim();
    if (!sourceId) {
      return {
        eligible: false,
        reason: 'NO_VALID_ST_ITEM',
        message: 'Debe indicar un sourceId valido para evaluar elegibilidad.',
        workRequestId: null,
        workRequestNumber: null,
        workOrderNumber: null,
        matchedItemId: null,
      };
    }

    const candidates = await prisma.workRequestItem.findMany({
      where: {
        sourceKind: input.sourceKind,
        sourceId,
        executionType: input.executionType,
        workRequest: {
          organizationId: input.organizationId,
          aircraftId: input.aircraftId,
          status: 'SENT',
        },
      },
      include: {
        workRequest: {
          select: {
            id: true,
            number: true,
            sentAt: true,
          },
        },
      },
      orderBy: {
        workRequest: {
          sentAt: 'desc',
        },
      },
    });

    if (candidates.length === 0) {
      return {
        eligible: false,
        reason: 'NO_VALID_ST_ITEM',
        message: 'No existe un WorkRequestItem exacto en una ST valida para este tipo de ejecucion.',
        workRequestId: null,
        workRequestNumber: null,
        workOrderNumber: null,
        matchedItemId: null,
      };
    }

    const candidate = candidates[0];

    if (input.requiredComponentSourceId?.trim()) {
      const requiredComponentSourceId = input.requiredComponentSourceId.trim();
      const linkedComponentItem = await prisma.workRequestItem.findFirst({
        where: {
          workRequestId: candidate.workRequestId,
          sourceKind: 'component_inspection',
          sourceId: requiredComponentSourceId,
        },
        select: { id: true },
      });

      if (!linkedComponentItem) {
        return {
          eligible: false,
          reason: 'INVALID_REQUIRED_COMPONENT',
          message: 'La ST valida no contiene el item de componente requerido para esta ejecucion.',
          workRequestId: candidate.workRequest.id,
          workRequestNumber: candidate.workRequest.number,
          workOrderNumber: null,
          matchedItemId: candidate.id,
        };
      }
    }

    const signedWorkOrder = await prisma.workOrder.findFirst({
      where: {
        organizationId: input.organizationId,
        aircraftId: input.aircraftId,
        evidenceFileUrl: { not: null },
        OR: [
          { assignmentStatus: { in: ['EVIDENCE_UPLOADED', 'CLOSED'] } },
          { status: { in: ['QUALITY', 'CLOSED'] } },
        ],
      },
      orderBy: [
        { evidenceUploadedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        number: true,
      },
    });

    if (!signedWorkOrder) {
      return {
        eligible: false,
        reason: 'NO_SIGNED_WORK_ORDER',
        message: 'No existe una OT recibida/firmada para la aeronave asociada a esta ejecucion.',
        workRequestId: candidate.workRequest.id,
        workRequestNumber: candidate.workRequest.number,
        workOrderNumber: null,
        matchedItemId: candidate.id,
      };
    }

    return {
      eligible: true,
      reason: 'ELIGIBLE',
      message: 'Elegible para registrar ejecucion.',
      workRequestId: candidate.workRequest.id,
      workRequestNumber: candidate.workRequest.number,
      workOrderNumber: signedWorkOrder.number,
      matchedItemId: candidate.id,
    };
  }
}

export const workRequestExecutionEligibilityService = new WorkRequestExecutionEligibilityService();
