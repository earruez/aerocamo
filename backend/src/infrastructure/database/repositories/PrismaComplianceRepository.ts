import { Compliance, CreateComplianceInput } from '../../../domain/entities/Compliance';
import {
  IComplianceRepository,
  ComplianceFilters,
} from '../../../domain/repositories/IComplianceRepository';
import { PaginatedResult, PaginationOptions } from '../../../domain/repositories/shared';
import { prisma } from '../prisma.client';
import { Prisma } from '@prisma/client';
import { BASELINE_NOTE } from '../../../domain/services/BaselineComplianceService';

export class PrismaComplianceRepository implements IComplianceRepository {
  async findById(id: string, organizationId: string): Promise<Compliance | null> {
    const row = await prisma.compliance.findFirst({ where: { id, organizationId } });
    return row ? this.toEntity(row) : null;
  }

  /**
   * Returns the most recent compliance record per task for an aircraft.
   * Uses a DISTINCT ON query via raw SQL to guarantee only the latest per task.
   */
  async findHistoryForTask(
    aircraftId: string,
    taskId: string,
    organizationId: string,
  ): Promise<Compliance[]> {
    const rows = await prisma.compliance.findMany({
      where: { aircraftId, taskId, organizationId },
      orderBy: { performedAt: 'desc' },
      include: {
        performedBy: { select: { id: true, name: true } },
        inspectedBy: { select: { id: true, name: true } },
        component: { select: { id: true, partNumber: true, serialNumber: true } },
      },
    });
    return rows.map((r) => this.toEntityWithRelations(r));
  }

  async findLatestPerTask(
    aircraftId: string,
    organizationId: string,
  ): Promise<Compliance[]> {
    // Prisma raw query — PostgreSQL DISTINCT ON is the correct aeronautical query pattern.
    // It only resolves *which* row is the latest per task; the relations (task, component,
    // inspector) are hydrated below via a normal Prisma query, since $queryRaw can't `include`.
    const latestIds = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT DISTINCT ON ("taskId") id
        FROM compliances
        WHERE "aircraftId" = ${aircraftId}::uuid
          AND "organizationId" = ${organizationId}::uuid
        ORDER BY "taskId",
          CASE WHEN "applicationType" = 'baseline' OR COALESCE("notes", '') = ${BASELINE_NOTE} THEN 1 ELSE 0 END ASC,
          "performedAt" DESC
      `,
    );
    if (latestIds.length === 0) return [];

    const rows = await prisma.compliance.findMany({
      where: { id: { in: latestIds.map((r) => r.id) } },
      include: {
        task: { select: { code: true, ata: true, title: true, description: true, referenceType: true, referenceNumber: true } },
        component: { select: { id: true, partNumber: true, serialNumber: true } },
        inspectedBy: { select: { id: true, name: true } },
        aircraft: { select: { id: true, registration: true, model: true, totalFlightHours: true, totalCycles: true } },
      },
    });

    // findMany doesn't preserve the `in` array order — re-sort to match the DISTINCT ON result.
    const order = new Map(latestIds.map((r, i) => [r.id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return rows.map((r) => this.toEntityWithRelations(r));
  }

  async findAll(
    organizationId: string,
    filters: ComplianceFilters = {},
    options: PaginationOptions = { page: 1, limit: 20 },
  ): Promise<PaginatedResult<Compliance>> {
    const { page, limit } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.ComplianceWhereInput = {
      organizationId,
      ...(filters.aircraftId && { aircraftId: filters.aircraftId }),
      ...(filters.taskId && { taskId: filters.taskId }),
      ...(filters.componentId && { componentId: filters.componentId }),
      ...(filters.status && { status: filters.status }),
      ...(filters.nextDueHoursLte != null && {
        nextDueHours: { lte: filters.nextDueHoursLte },
      }),
      ...(filters.nextDueDateLte && {
        nextDueDate: { lte: filters.nextDueDateLte },
      }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.compliance.findMany({
        where, skip, take: limit, orderBy: { performedAt: 'desc' },
        include: {
          task: { select: { code: true, ata: true, title: true, description: true, referenceType: true, referenceNumber: true } },
          component: { select: { id: true, partNumber: true, serialNumber: true } },
          inspectedBy: { select: { id: true, name: true } },
          performedBy: { select: { id: true, name: true } },
          aircraft: { select: { id: true, registration: true, model: true, totalFlightHours: true, totalCycles: true } },
        },
      }),
      prisma.compliance.count({ where }),
    ]);

    return { data: data.map((r) => this.toEntityWithRelations(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Append-only: no update or delete on compliance records */
  async create(input: CreateComplianceInput): Promise<Compliance> {
    const row = await prisma.compliance.create({ data: input });
    return this.toEntity(row);
  }

  private toEntity(r: Record<string, unknown>): Compliance {
    return {
      id: r.id as string,
      organizationId: r.organizationId as string,
      aircraftId: r.aircraftId as string,
      taskId: r.taskId as string,
      componentId: r.componentId as string | null,
      performedById: r.performedById as string,
      inspectedById: r.inspectedById as string | null,
      performedAt: r.performedAt as Date,
      aircraftHoursAtCompliance: Number(r.aircraftHoursAtCompliance),
      aircraftCyclesAtCompliance: r.aircraftCyclesAtCompliance as number,
      nextDueHours: r.nextDueHours != null ? Number(r.nextDueHours) : null,
      nextDueCycles: r.nextDueCycles as number | null,
      nextDueDate: r.nextDueDate as Date | null,
      workOrderNumber: r.workOrderNumber as string | null,
      applicationType: r.applicationType as Compliance['applicationType'],
      isInitial: r.isInitial as boolean,
      status: r.status as Compliance['status'],
      deferralReference: r.deferralReference as string | null,
      deferralExpiresAt: r.deferralExpiresAt as Date | null,
      notes: r.notes as string | null,
      createdAt: r.createdAt as Date,
    };
  }

  /** Same numeric normalization as toEntity, plus whatever relations were `include`d. */
  private toEntityWithRelations(r: Record<string, unknown>): Compliance {
    const aircraft = r.aircraft as { id: string; registration: string; model: string; totalFlightHours: unknown; totalCycles: number } | null | undefined;
    return {
      ...this.toEntity(r),
      task: (r.task as Compliance['task']) ?? null,
      component: (r.component as Compliance['component']) ?? null,
      inspectedBy: (r.inspectedBy as Compliance['inspectedBy']) ?? null,
      performedBy: (r.performedBy as Compliance['performedBy']) ?? null,
      aircraft: aircraft
        ? { ...aircraft, totalFlightHours: Number(aircraft.totalFlightHours) }
        : null,
    };
  }
}
