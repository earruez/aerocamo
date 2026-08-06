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
  async findLatestPerTask(
    aircraftId: string,
    organizationId: string,
  ): Promise<Compliance[]> {
    // Prisma raw query — PostgreSQL DISTINCT ON is the correct aeronautical query pattern
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
        SELECT DISTINCT ON ("taskId") *
        FROM compliances
        WHERE "aircraftId" = ${aircraftId}::uuid
          AND "organizationId" = ${organizationId}::uuid
        ORDER BY "taskId",
          CASE WHEN "applicationType" = 'baseline' OR COALESCE("notes", '') = ${BASELINE_NOTE} THEN 1 ELSE 0 END ASC,
          "performedAt" DESC
      `,
    );
    return rows.map(this.toEntity);
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
      prisma.compliance.findMany({ where, skip, take: limit, orderBy: { performedAt: 'desc' } }),
      prisma.compliance.count({ where }),
    ]);

    return { data: data.map(this.toEntity), total, page, limit, totalPages: Math.ceil(total / limit) };
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
}
