import { Aircraft, CreateAircraftInput, UpdateAircraftInput, AircraftStatus } from '../../../domain/entities/Aircraft';
import { IAircraftRepository, MaintenancePlanItem, PlanItemStatus, DueByType } from '../../../domain/repositories/IAircraftRepository';
import { PaginatedResult, PaginationOptions } from '../../../domain/repositories/shared';
import { prisma } from '../prisma.client';
import { ComplianceDueDateService } from '../../../domain/services/ComplianceDueDateService';
import { BASELINE_NOTE } from '../../../domain/services/BaselineComplianceService';

const AVG_FLIGHT_HOURS_PER_DAY = 2;
const MS_PER_DAY = 864e5;
const dueService = new ComplianceDueDateService();

export class PrismaAircraftRepository implements IAircraftRepository {
  async findById(id: string, organizationId: string): Promise<Aircraft | null> {
    const row = await prisma.aircraft.findFirst({ where: { id, organizationId } });
    return row ? this.toEntity(row) : null;
  }

  async findByRegistration(registration: string, organizationId: string): Promise<Aircraft | null> {
    const row = await prisma.aircraft.findFirst({ where: { registration, organizationId } });
    return row ? this.toEntity(row) : null;
  }

  async findAll(
    organizationId: string,
    options: PaginationOptions = { page: 1, limit: 20 },
    statusFilter?: AircraftStatus,
  ): Promise<PaginatedResult<Aircraft>> {
    const { page, limit } = options;
    const skip = (page - 1) * limit;
    const where = { organizationId, ...(statusFilter && { status: statusFilter }) };

    const [data, total] = await prisma.$transaction([
      prisma.aircraft.findMany({ where, skip, take: limit, orderBy: { registration: 'asc' } }),
      prisma.aircraft.count({ where }),
    ]);

    return { data: data.map(this.toEntity), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(input: CreateAircraftInput): Promise<Aircraft> {
    const row = await prisma.aircraft.create({ data: input });
    return this.toEntity(row);
  }

  async update(id: string, organizationId: string, input: UpdateAircraftInput): Promise<Aircraft> {
    const row = await prisma.aircraft.update({
      where: { id, organizationId } as never,
      data: input,
    });
    return this.toEntity(row);
  }

  async delete(id: string, organizationId: string): Promise<void> {
    await prisma.aircraft.delete({ where: { id, organizationId } as never });
  }

  async getMaintenancePlan(aircraftId: string, organizationId: string): Promise<MaintenancePlanItem[]> {
    const aircraft = await prisma.aircraft.findFirst({ where: { id: aircraftId, organizationId } });
    const now = new Date();
    const currentHours = aircraft ? Number(aircraft.totalFlightHours) : 0;
    const currentCycles = aircraft ? aircraft.totalCycles : 0;

    // All tasks assigned to this aircraft with their latest compliance
    const links = await prisma.aircraftTask.findMany({
      where: { aircraftId, isActive: true },
      include: {
        task: {
          include: {
            componentLinks: {
              where: { isActive: true },
              select: { componentId: true },
              take: 1,
            },
          },
        },
        aircraft: { select: { totalFlightHours: true, totalCycles: true } },
      },
    });

    // Get latest compliance per task preferring a real compliance over baseline.
    const taskIds = links.map((l) => l.taskId);
    const complianceRows = taskIds.length > 0
      ? await prisma.compliance.findMany({
          where: {
            aircraftId,
            organizationId,
            taskId: { in: taskIds },
          },
          select: {
            taskId: true,
            notes: true,
            performedAt: true,
            aircraftHoursAtCompliance: true,
            aircraftCyclesAtCompliance: true,
            nextDueHours: true,
            nextDueCycles: true,
            nextDueDate: true,
            workOrderNumber: true,
          },
          orderBy: [
            { taskId: 'asc' },
            { performedAt: 'desc' },
          ],
        })
      : [];

    const isBaselineCompliance = (row: { notes: string | null }): boolean => (
      (row.notes ?? '').trim().toLowerCase() === BASELINE_NOTE.toLowerCase()
    );

    const compByTask = new Map<string, Record<string, unknown>>();
    for (const row of complianceRows) {
      const current = compByTask.get(row.taskId) as { notes?: string | null } | undefined;
      if (!current) {
        compByTask.set(row.taskId, row as unknown as Record<string, unknown>);
        continue;
      }

      const currentIsBaseline = isBaselineCompliance({
        notes: current.notes ?? null,
      });
      const candidateIsBaseline = isBaselineCompliance({
        notes: row.notes,
      });

      // Replace baseline candidate if we find a real compliance for the same task.
      if (currentIsBaseline && !candidateIsBaseline) {
        compByTask.set(row.taskId, row as unknown as Record<string, unknown>);
      }
    }

    const sentWrItems = await prisma.workRequestItem.findMany({
      where: {
        taskId: { in: taskIds },
        workRequest: {
          aircraftId,
          organizationId,
          status: 'SENT',
        },
      },
      include: {
        workRequest: {
          select: { id: true, number: true, sentAt: true },
        },
      },
      orderBy: { workRequest: { sentAt: 'desc' } },
    });

    const wrByTask = new Map<string, { id: string; number: string }>();
    for (const item of sentWrItems) {
      if (item.taskId && !wrByTask.has(item.taskId)) {
        wrByTask.set(item.taskId, { id: item.workRequest.id, number: item.workRequest.number });
      }
    }

    return links.map(({ task }) => {
      const requiresComponentTracking =
        task.componentLinks.length > 0
        || Boolean(task.applicablePartNumber);
      const executionType: MaintenancePlanItem['executionType'] = requiresComponentTracking
        ? 'component_replacement'
        : 'maintenance';
      const intervalCalendarMonths =
        ((task as unknown as Record<string, unknown>).intervalCalendarMonths as number | null | undefined) ?? null;

      let comp = compByTask.get(task.id);

      if (!comp && aircraft) {
        const syntheticDue = dueService.calculate(
          {
            id: task.id,
            organizationId,
            code: task.code,
            title: task.title,
            description: task.description,
            intervalType: task.intervalType,
            intervalHours: task.intervalHours != null ? Number(task.intervalHours) : null,
            intervalCycles: task.intervalCycles,
            intervalCalendarDays: task.intervalCalendarDays,
            intervalCalendarMonths: intervalCalendarMonths,
            toleranceHours: task.toleranceHours != null ? Number(task.toleranceHours) : null,
            toleranceCycles: task.toleranceCycles,
            toleranceCalendarDays: task.toleranceCalendarDays,
            referenceNumber: task.referenceNumber,
            referenceType: task.referenceType,
            isMandatory: task.isMandatory,
            estimatedManHours: task.estimatedManHours != null ? Number(task.estimatedManHours) : null,
            requiresInspection: task.requiresInspection,
            applicableModel: task.applicableModel,
            applicablePartNumber: task.applicablePartNumber,
            isActive: task.isActive,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
          Number(aircraft.totalFlightHours),
          aircraft.totalCycles,
          aircraft.createdAt,
        );

        comp = {
          performedAt: aircraft.createdAt.toISOString(),
          aircraftHoursAtCompliance: Number(aircraft.totalFlightHours),
          nextDueHours: syntheticDue.nextDueHours,
          nextDueCycles: syntheticDue.nextDueCycles,
          nextDueDate: syntheticDue.nextDueDate,
          workOrderNumber: null,
          notes: BASELINE_NOTE,
        };
      }

      const complianceNotes = (comp?.notes as string | null) ?? null;
      const isBaseline = (comp?.applicationType as string | null) === 'baseline'
        || (complianceNotes ?? '').trim().toLowerCase() === BASELINE_NOTE.toLowerCase();
      const evidenceMatch = complianceNotes?.match(/Evidencia\s([^|]+)/i);
      const referenceText = `${task.referenceType} ${task.referenceNumber ?? ''}`.toUpperCase();
      const legalSource: 'FABRICANTE' | 'DGAC' | 'EASA' =
        referenceText.includes('DGAC') || task.referenceType === 'INTERNAL'
          ? 'DGAC'
          : referenceText.includes('EASA') || task.referenceType === 'AD'
            ? 'EASA'
            : 'FABRICANTE';
      const calendarMonths = intervalCalendarMonths ?? 0;
      const nextDueHours  = comp?.nextDueHours  != null ? Number(comp.nextDueHours)  : null;
      const nextDueCycles = comp?.nextDueCycles != null ? Number(comp.nextDueCycles) : null;
      const nextDueDate   = comp?.nextDueDate   != null ? new Date(comp.nextDueDate as string) : null;

      const rawHoursRemaining = nextDueHours != null ? nextDueHours - currentHours : null;
      const rawDaysRemaining = nextDueDate != null
        ? (nextDueDate.getTime() - now.getTime()) / MS_PER_DAY
        : null;
      const hoursFromCalendar = rawDaysRemaining != null
        ? rawDaysRemaining * AVG_FLIGHT_HOURS_PER_DAY
        : null;

      const effectiveHoursRemaining =
        rawHoursRemaining != null && hoursFromCalendar != null
          ? Math.min(rawHoursRemaining, hoursFromCalendar)
          : rawHoursRemaining ?? hoursFromCalendar;

      const dueBy: DueByType | null =
        rawHoursRemaining != null && hoursFromCalendar != null
          ? (rawHoursRemaining <= hoursFromCalendar ? 'HOURS' : 'CALENDAR')
          : rawHoursRemaining != null
            ? 'HOURS'
            : rawDaysRemaining != null
              ? 'CALENDAR'
              : null;

      let status: PlanItemStatus = 'NEVER_PERFORMED';
      if (comp) {
        const hasHourLimit = task.intervalHours != null && Number(task.intervalHours) > 0;
        const hasCalendarLimit =
          (task.intervalCalendarDays != null && task.intervalCalendarDays > 0)
          || calendarMonths > 0;
        const isMixed = hasHourLimit && hasCalendarLimit;

        const calendarIntervalDays =
          task.intervalCalendarDays
          ?? (calendarMonths > 0 ? calendarMonths * 30 : null);

        const overdueH  = nextDueHours  != null && currentHours  > nextDueHours;
        const overdueC  = nextDueCycles != null && currentCycles > nextDueCycles;
        const overdueD  = nextDueDate   != null && nextDueDate   < now;

        const dueSoonH  = nextDueHours  != null && (
          isMixed && task.intervalHours != null
            ? (nextDueHours - currentHours) <= Number(task.intervalHours) * 0.1
            : (nextDueHours - currentHours) <= 50
        );
        const dueSoonC  = nextDueCycles != null && (nextDueCycles - currentCycles) <= 25;
        const dueSoonD  = nextDueDate   != null && (
          isMixed && calendarIntervalDays != null
            ? (nextDueDate.getTime() - now.getTime()) <= calendarIntervalDays * 0.1 * 864e5
            : (nextDueDate.getTime() - now.getTime()) <= 30 * 864e5
        );

        if (overdueH || overdueC || overdueD)       status = 'OVERDUE';
        else if (dueSoonH || dueSoonC || dueSoonD)  status = 'DUE_SOON';
        else                                         status = 'OK';
      }

      return {
        taskId:              task.id,
        taskCode:            task.code,
        taskTitle:           task.title,
        executionType,
        requiresComponentTracking,
        componentDefinitionId: requiresComponentTracking ? task.id : null,
        intervalType:        task.intervalType,
        intervalHours:       task.intervalHours != null ? Number(task.intervalHours) : null,
        intervalCycles:      task.intervalCycles,
        intervalCalendarDays:task.intervalCalendarDays,
        intervalCalendarMonths,
        referenceType:       task.referenceType,
        referenceNumber:     task.referenceNumber,
        isMandatory:         task.isMandatory,
        estimatedManHours:   task.estimatedManHours != null ? Number(task.estimatedManHours) : null,
        hasRealCompliance:   Boolean(comp) && !isBaseline,
        controlStartAt:      comp?.performedAt != null && isBaseline ? new Date(comp.performedAt as string) : null,
        controlStartHours:   comp?.aircraftHoursAtCompliance != null && isBaseline ? Number(comp.aircraftHoursAtCompliance) : null,
        controlStartCycles:  comp?.aircraftCyclesAtCompliance != null && isBaseline ? Number(comp.aircraftCyclesAtCompliance) : null,
        effectiveApplicationType: (isBaseline ? 'baseline' : 'application') as MaintenancePlanItem['effectiveApplicationType'],
        lastPerformedAt:     comp?.performedAt != null && !isBaseline ? new Date(comp.performedAt as string) : null,
        lastWorkOrder:       (comp?.workOrderNumber as string | null) ?? null,
        lastHoursAtCompliance: comp?.aircraftHoursAtCompliance != null && !isBaseline ? Number(comp.aircraftHoursAtCompliance) : null,
        nextDueHours,
        nextDueCycles,
        nextDueDate,
        hoursRemaining:  effectiveHoursRemaining != null ? Math.round(effectiveHoursRemaining) : null,
        cyclesRemaining: nextDueCycles != null ? Math.round(nextDueCycles - currentCycles) : null,
        daysRemaining:   rawDaysRemaining != null ? Math.ceil(rawDaysRemaining) : null,
        dueBy,
        status,
        inWorkRequestId: wrByTask.get(task.id)?.id ?? null,
        inWorkRequestNumber: wrByTask.get(task.id)?.number ?? null,
        legalSource,
        lastEvidenceUrl: evidenceMatch?.[1]?.trim() ?? null,
      };
    }).sort((a, b) => {
      const order = { OVERDUE: 0, DUE_SOON: 1, NEVER_PERFORMED: 2, OK: 3 };
      return order[a.status] - order[b.status];
    });
  }

  private toEntity(r: Record<string, unknown>): Aircraft {
    return {
      id: r.id as string,
      organizationId: r.organizationId as string,
      registration: r.registration as string,
      model: r.model as string,
      manufacturer: r.manufacturer as string,
      serialNumber: r.serialNumber as string,
      engineCount: r.engineCount as number,
      engineModel: r.engineModel as string | null,
      totalFlightHours: Number(r.totalFlightHours),
      totalCycles: r.totalCycles as number,
      status: r.status as Aircraft['status'],
      manufactureDate: r.manufactureDate as Date | null,
      registrationDate: r.registrationDate as Date | null,
      coaExpiryDate: r.coaExpiryDate as Date | null,
      insuranceExpiryDate: r.insuranceExpiryDate as Date | null,
      isActive: r.isActive as boolean,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    };
  }
}
