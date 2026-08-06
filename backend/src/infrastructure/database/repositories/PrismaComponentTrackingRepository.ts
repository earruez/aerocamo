import {
  ComponentApplication,
  ComponentDefinition,
  ComponentInstance,
  ComponentMovement,
  CreateComponentApplicationInput,
  CreateComponentDefinitionInput,
  CreateComponentInstanceInput,
  CreateComponentMovementInput,
} from '../../../domain/entities/ComponentTracking';
import { IComponentTrackingRepository } from '../../../domain/repositories/IComponentTrackingRepository';
import { prisma } from '../prisma.client';

function num(v: unknown): number | null {
  if (v == null) return null;
  return Number(v);
}

export class PrismaComponentTrackingRepository implements IComponentTrackingRepository {
  async listDefinitions(organizationId: string): Promise<ComponentDefinition[]> {
    const rows = await prisma.componentDefinition.findMany({
      where: { organizationId },
      orderBy: [{ ataCode: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      intervalHours: num(r.intervalHours),
    }));
  }

  async createDefinition(organizationId: string, input: CreateComponentDefinitionInput): Promise<ComponentDefinition> {
    const row = await prisma.componentDefinition.create({ data: { organizationId, ...input } });
    return { ...row, intervalHours: num(row.intervalHours) };
  }

  async listInstances(organizationId: string, aircraftId?: string): Promise<ComponentInstance[]> {
    const rows = await prisma.componentInstance.findMany({
      where: {
        organizationId,
        ...(aircraftId ? { aircraftId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      ...r,
      installedAtHours: num(r.installedAtHours),
      removedAtHours: num(r.removedAtHours),
    }));
  }

  async createInstance(organizationId: string, input: CreateComponentInstanceInput): Promise<ComponentInstance> {
    const row = await prisma.componentInstance.create({ data: { organizationId, ...input } });
    return {
      ...row,
      installedAtHours: num(row.installedAtHours),
      removedAtHours: num(row.removedAtHours),
    };
  }

  async listApplications(organizationId: string, aircraftId?: string): Promise<ComponentApplication[]> {
    const rows = await prisma.componentApplication.findMany({
      where: {
        organizationId,
        ...(aircraftId ? { aircraftId } : {}),
      },
      orderBy: { appliedAt: 'desc' },
    });

    return rows.map((r) => ({
      ...r,
      aircraftHoursAtApplication: Number(r.aircraftHoursAtApplication),
      nextDueHours: num(r.nextDueHours),
    }));
  }

  async createApplication(organizationId: string, input: CreateComponentApplicationInput): Promise<ComponentApplication> {
    const row = await prisma.componentApplication.create({ data: { organizationId, ...input } });
    return {
      ...row,
      aircraftHoursAtApplication: Number(row.aircraftHoursAtApplication),
      nextDueHours: num(row.nextDueHours),
    };
  }

  async listMovements(organizationId: string, aircraftId?: string): Promise<ComponentMovement[]> {
    const rows = await prisma.componentMovement.findMany({
      where: {
        organizationId,
        ...(aircraftId ? { aircraftId } : {}),
      },
      orderBy: { performedAt: 'desc' },
    });

    return rows.map((r) => ({
      ...r,
      aircraftHoursAtMovement: Number(r.aircraftHoursAtMovement),
    }));
  }

  async createMovement(organizationId: string, input: CreateComponentMovementInput): Promise<ComponentMovement> {
    const row = await prisma.componentMovement.create({ data: { organizationId, ...input } });
    return {
      ...row,
      aircraftHoursAtMovement: Number(row.aircraftHoursAtMovement),
    };
  }
}
