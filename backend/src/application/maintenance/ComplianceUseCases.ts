import { Compliance, CreateComplianceInput } from '../../domain/entities/Compliance';
import { IComplianceRepository, ComplianceFilters } from '../../domain/repositories/IComplianceRepository';
import { IAircraftRepository } from '../../domain/repositories/IAircraftRepository';
import { IComponentRepository } from '../../domain/repositories/IComponentRepository';
import { MaintenanceTask } from '../../domain/entities/MaintenanceTask';
import { ComplianceDueDateService } from '../../domain/services/ComplianceDueDateService';
import { NotFoundError, ValidationError } from '../../shared/errors/AppError';
import { PaginatedResult, PaginationOptions } from '../../domain/repositories/shared';
import { workRequestExecutionEligibilityService } from '../../domain/services/WorkRequestExecutionEligibilityService';

export interface RecordComplianceInput {
  organizationId: string;
  aircraftId: string;
  taskId: string;
  componentId?: string | null;
  aircraftHoursAtCompliance?: number;
  nextDueHours?: number | null;
  nextDueCycles?: number | null;
  nextDueDate?: Date | null;
  performedById: string;
  inspectedById?: string | null;
  performedAt: Date;
  workOrderNumber?: string | null;
  applicationType?: 'application' | 'replacement_start';
  notes?: string | null;
  deferralReference?: string | null;
  deferralExpiresAt?: Date | null;
}

export class RecordComplianceUseCase {
  private readonly dueDateService = new ComplianceDueDateService();

  constructor(
    private readonly complianceRepo: IComplianceRepository,
    private readonly aircraftRepo: IAircraftRepository,
    private readonly componentRepo: IComponentRepository,
    /** Map of taskId → MaintenanceTask, injected to avoid circular deps */
    private readonly getTask: (taskId: string, orgId: string) => Promise<MaintenanceTask | null>,
  ) {}

  async execute(input: RecordComplianceInput): Promise<Compliance> {
    // 1. Validate aircraft exists in tenant
    const aircraft = await this.aircraftRepo.findById(input.aircraftId, input.organizationId);
    if (!aircraft) throw new NotFoundError('Aircraft', input.aircraftId);

    // 2. Validate component (if applicable) belongs to the same aircraft
    if (input.componentId) {
      const component = await this.componentRepo.findById(
        input.componentId,
        input.organizationId,
      );
      if (!component) throw new NotFoundError('Component', input.componentId);
      if (component.aircraftId !== input.aircraftId) {
        throw new ValidationError(
          `Component '${input.componentId}' is not installed on aircraft '${input.aircraftId}'`,
        );
      }
    }

    // 3. Load task definition to calculate next-due values
    const task = await this.getTask(input.taskId, input.organizationId);
    if (!task) throw new NotFoundError('MaintenanceTask', input.taskId);

    const requiresExecutionGating = input.applicationType === 'application' || input.applicationType === 'replacement_start';
    if (requiresExecutionGating) {
      if (!input.workOrderNumber?.trim()) {
        throw new ValidationError('Debe indicar una OT recibida/firmada para registrar esta ejecucion.');
      }

      const executionType = input.applicationType === 'replacement_start'
        ? 'component_replacement'
        : 'maintenance_application';

      const eligibility = await workRequestExecutionEligibilityService.evaluate({
        organizationId: input.organizationId,
        aircraftId: input.aircraftId,
        sourceKind: 'maintenance_plan',
        sourceId: input.taskId,
        executionType,
      });

      if (!eligibility.eligible) {
        throw new ValidationError(eligibility.message);
      }

      if (eligibility.workOrderNumber !== input.workOrderNumber.trim()) {
        throw new ValidationError(
          `La OT indicada no corresponde a la OT firmada elegible. Debe usar ${eligibility.workOrderNumber}.`,
        );
      }
    }

    const hoursAtCompliance = input.aircraftHoursAtCompliance ?? aircraft.totalFlightHours;

    // 4. Calculate next-due — this is the integrity-critical calculation
    const computed = this.dueDateService.calculate(
      task,
      hoursAtCompliance,
      aircraft.totalCycles,
      input.performedAt,
    );

    const nextDueHours = input.nextDueHours ?? computed.nextDueHours;
    const nextDueCycles = input.nextDueCycles ?? computed.nextDueCycles;
    const nextDueDate = input.nextDueDate ?? computed.nextDueDate;

    const complianceInput: CreateComplianceInput = {
      ...input,
      workOrderNumber: input.workOrderNumber ?? null,
      componentId:     input.componentId     ?? null,
      inspectedById:   input.inspectedById   ?? null,
      notes:           input.notes           ?? null,
      deferralReference: input.deferralReference ?? null,
      deferralExpiresAt: input.deferralExpiresAt ?? null,
      aircraftHoursAtCompliance: hoursAtCompliance,
      aircraftCyclesAtCompliance: aircraft.totalCycles,
      nextDueHours,
      nextDueCycles,
      nextDueDate,
      applicationType: input.applicationType ?? 'application',
      isInitial: false,
    };

    return this.complianceRepo.create(complianceInput);
  }
}

export class GetComplianceUseCase {
  constructor(private readonly complianceRepo: IComplianceRepository) {}

  async findAllForAircraft(
    aircraftId: string,
    organizationId: string,
    filters?: ComplianceFilters,
    options?: PaginationOptions,
  ): Promise<PaginatedResult<Compliance>> {
    return this.complianceRepo.findAll(
      organizationId,
      { ...filters },
      options,
    );
  }

  async getLatestPerTask(
    aircraftId: string,
    organizationId: string,
  ): Promise<Compliance[]> {
    return this.complianceRepo.findLatestPerTask(aircraftId, organizationId);
  }

  async getHistoryForTask(
    aircraftId: string,
    taskId: string,
    organizationId: string,
  ): Promise<Compliance[]> {
    return this.complianceRepo.findHistoryForTask(aircraftId, taskId, organizationId);
  }
}
