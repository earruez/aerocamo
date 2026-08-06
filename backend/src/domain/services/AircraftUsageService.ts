import { ValidationError, NotFoundError } from '../../shared/errors/AppError';
import { prisma } from '../../infrastructure/database/prisma.client';

export type AircraftUsageSource = 'manual' | 'flight_log' | 'ot_close' | 'import' | 'baseline';

export interface AircraftUsageSummary {
  aircraftId: string;
  totalHours: number;
  totalCycles: number;
  lastUpdatedAt: Date;
}

export interface AircraftUsageLogRow {
  id: string;
  aircraftId: string;
  date: Date;
  totalHours: number;
  totalCycles: number;
  source: AircraftUsageSource;
  notes: string | null;
  createdAt: Date;
}

export class AircraftUsageService {
  async getAircraftUsageSummary(aircraftId: string, organizationId: string): Promise<AircraftUsageSummary> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: {
        id: true,
        totalFlightHours: true,
        totalCycles: true,
        updatedAt: true,
      },
    });

    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);

    const latest = await prisma.aircraftUsageLog.findFirst({
      where: { aircraftId, organizationId },
      select: { date: true, createdAt: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      aircraftId: aircraft.id,
      totalHours: Number(aircraft.totalFlightHours),
      totalCycles: aircraft.totalCycles,
      lastUpdatedAt: latest?.date ?? aircraft.updatedAt,
    };
  }

  async listUsageHistory(aircraftId: string, organizationId: string): Promise<AircraftUsageLogRow[]> {
    const rows = await prisma.aircraftUsageLog.findMany({
      where: { aircraftId, organizationId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      aircraftId: row.aircraftId,
      date: row.date,
      totalHours: Number(row.totalHours),
      totalCycles: row.totalCycles,
      source: row.source,
      notes: row.notes,
      createdAt: row.createdAt,
    }));
  }

  async recordUsage(input: {
    organizationId: string;
    aircraftId: string;
    date: Date;
    totalHours: number;
    totalCycles: number;
    source: AircraftUsageSource;
    notes?: string | null;
    updateMaster?: boolean;
  }): Promise<AircraftUsageLogRow> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: input.aircraftId, organizationId: input.organizationId },
      select: { id: true },
    });

    if (!aircraft) throw new NotFoundError('Aircraft', input.aircraftId);

    const latest = await prisma.aircraftUsageLog.findFirst({
      where: { aircraftId: input.aircraftId, organizationId: input.organizationId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { date: true, totalHours: true, totalCycles: true },
    });

    if (latest) {
      if (input.date.getTime() < new Date(latest.date).getTime()) {
        throw new ValidationError('La fecha no puede ser menor al ultimo registro');
      }
      if (input.totalHours < Number(latest.totalHours)) {
        throw new ValidationError('Las horas no pueden ser menores al ultimo valor registrado');
      }
      if (input.totalCycles < latest.totalCycles) {
        throw new ValidationError('Los ciclos no pueden ser menores al ultimo valor registrado');
      }
    }

    const shouldUpdateMaster = input.updateMaster !== false;

    const created = await prisma.$transaction(async (tx) => {
      const usage = await tx.aircraftUsageLog.create({
        data: {
          organizationId: input.organizationId,
          aircraftId: input.aircraftId,
          date: input.date,
          totalHours: input.totalHours,
          totalCycles: input.totalCycles,
          source: input.source,
          notes: input.notes ?? null,
        },
      });

      if (shouldUpdateMaster) {
        await tx.aircraft.update({
          where: { id: input.aircraftId, organizationId: input.organizationId } as never,
          data: {
            totalFlightHours: input.totalHours,
            totalCycles: input.totalCycles,
          },
        });
      }

      return usage;
    });

    return {
      id: created.id,
      aircraftId: created.aircraftId,
      date: created.date,
      totalHours: Number(created.totalHours),
      totalCycles: created.totalCycles,
      source: created.source,
      notes: created.notes,
      createdAt: created.createdAt,
    };
  }
}

export const aircraftUsageService = new AircraftUsageService();
