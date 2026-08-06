import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { PrismaComponentRepository } from '../../database/repositories/PrismaComponentRepository';
import { prisma } from '../../database/prisma.client';
import { ComplianceDueDateService } from '../../../domain/services/ComplianceDueDateService';
import { BASELINE_NOTE } from '../../../domain/services/BaselineComplianceService';

const router = Router();
const repo = new PrismaComponentRepository();
const dueService = new ComplianceDueDateService();

const createSchema = z.object({
  partNumber:   z.string().min(1).max(100),
  serialNumber: z.string().min(1).max(100),
  description:  z.string().min(1).max(255),
  manufacturer: z.string().min(1).max(150),
  aircraftId:   z.string().uuid().optional().nullable(),
  position:     z.string().max(150).optional().nullable(),
  tboHours:     z.number().nonnegative().optional().nullable(),
  tboCycles:    z.number().int().nonnegative().optional().nullable(),
  tboCalendarDays: z.number().int().nonnegative().optional().nullable(),
  lifeLimitHours:  z.number().nonnegative().optional().nullable(),
  lifeLimitCycles: z.number().int().nonnegative().optional().nullable(),
});

const updateSchema = z.object({
  partNumber: z.string().min(1).max(100).optional(),
  serialNumber: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(255).optional(),
  manufacturer: z.string().min(1).max(150).optional(),
  position: z.string().max(150).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const installationSchema = z.object({
  aircraftId: z.string().uuid(),
  installationDate: z.coerce.date(),
  position: z.string().max(150).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const initialRegistrationSchema = z.object({
  aircraftId: z.string().uuid(),
  taskId: z.string().uuid(),
  partNumber: z.string().min(1).max(100),
  serialNumber: z.string().min(1).max(100),
  description: z.string().min(1).max(255),
  manufacturer: z.string().min(1).max(150),
  position: z.string().max(150).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.use(authMiddleware, tenantMiddleware);

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const data = await repo.create({
      ...body,
      organizationId: req.organizationId,
      aircraftId:     body.aircraftId     ?? null,
      position:       body.position       ?? null,
      tboHours:       body.tboHours       ?? null,
      tboCycles:      body.tboCycles      ?? null,
      tboCalendarDays: body.tboCalendarDays ?? null,
      lifeLimitHours:  body.lifeLimitHours  ?? null,
      lifeLimitCycles: body.lifeLimitCycles ?? null,
    });
    res.status(201).json({ status: 'success', data });
  } catch (err) { next(err); }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await repo.findAll(req.organizationId, { page: 1, limit: 100 });
    res.status(200).json({ status: 'success', data: result.data });
  } catch (err) { next(err); }
});

router.get('/aircraft/:aircraftId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await repo.findByAircraft(req.params.aircraftId, req.organizationId);
    res.status(200).json({ status: 'success', data });
  } catch (err) { next(err); }
});

router.get('/:id/compliances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.compliance.findMany({
      where: {
        componentId: req.params.id,
        organizationId: req.organizationId,
      },
      include: {
        task: {
          select: {
            id: true,
            code: true,
            title: true,
            referenceType: true,
            referenceNumber: true,
          },
        },
        performedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        component: {
          select: {
            installationDate: true,
          },
        },
      },
      orderBy: { performedAt: 'desc' },
      take: 100,
    });

    const data = rows.map((row) => {
      const note = (row.notes ?? '').trim().toLowerCase();
      const explicitType = row.applicationType as string | null;
      const isBaseline = explicitType === 'baseline' || note === BASELINE_NOTE.toLowerCase();
      const installedAt = row.component?.installationDate ? new Date(row.component.installationDate).getTime() : null;
      const performedAt = new Date(row.performedAt).getTime();
      const isReplacementStart = explicitType === 'replacement_start'
        || (!isBaseline && row.workOrderNumber != null && installedAt != null && installedAt === performedAt);

      return {
        ...row,
        applicationType: isBaseline ? 'baseline' : isReplacementStart ? 'replacement_start' : 'application',
        isInitial: row.isInitial ?? isBaseline,
      };
    });

    res.status(200).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const data = await repo.update(req.params.id, req.organizationId, {
      partNumber: body.partNumber,
      serialNumber: body.serialNumber,
      description: body.description,
      manufacturer: body.manufacturer,
      position: body.position,
      notes: body.notes,
    });
    res.status(200).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/installation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = installationSchema.parse(req.body);

    const component = await repo.findById(req.params.id, req.organizationId);
    if (!component) {
      return res.status(404).json({ status: 'error', message: 'Component not found' });
    }

    const aircraft = await prisma.aircraft.findFirst({
      where: { id: body.aircraftId, organizationId: req.organizationId },
    });
    if (!aircraft) {
      return res.status(404).json({ status: 'error', message: 'Aircraft not found' });
    }

    const data = await repo.update(req.params.id, req.organizationId, {
      aircraftId: body.aircraftId,
      position: body.position ?? component.position,
      installationDate: body.installationDate,
      installationAircraftHours: Number(aircraft.totalFlightHours),
      installationAircraftCycles: aircraft.totalCycles,
      status: 'INSTALLED',
      notes: body.notes ?? component.notes,
    });

    res.status(200).json({ status: 'success', data });
  } catch (err) {
    next(err);
  }
});

router.post('/initial-registration', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = initialRegistrationSchema.parse(req.body);

    const aircraft = await prisma.aircraft.findFirst({
      where: { id: body.aircraftId, organizationId: req.organizationId },
      select: {
        id: true,
        organizationId: true,
        createdAt: true,
        totalFlightHours: true,
        totalCycles: true,
      },
    });

    if (!aircraft) {
      return res.status(404).json({ status: 'error', message: 'Aircraft not found' });
    }

    const taskLink = await prisma.aircraftTask.findFirst({
      where: {
        aircraftId: aircraft.id,
        taskId: body.taskId,
        isActive: true,
      },
      include: {
        task: {
          include: {
            componentLinks: {
              where: { isActive: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!taskLink || taskLink.task.organizationId !== req.organizationId) {
      return res.status(404).json({ status: 'error', message: 'Task not assigned to aircraft' });
    }

    const requiresTracking = Boolean(taskLink.task.applicablePartNumber) || taskLink.task.componentLinks.length > 0;
    if (!requiresTracking) {
      return res.status(400).json({ status: 'error', message: 'Task does not require component tracking' });
    }

    const existingForTask = await prisma.compliance.findFirst({
      where: {
        organizationId: req.organizationId,
        aircraftId: aircraft.id,
        taskId: body.taskId,
        componentId: { not: null },
      },
      orderBy: { performedAt: 'desc' },
      select: { id: true },
    });

    if (existingForTask) {
      return res.status(409).json({ status: 'error', message: 'Task already has an associated component' });
    }

    const hoursAt = Number(aircraft.totalFlightHours);
    const cyclesAt = aircraft.totalCycles;
    const baselineDate = aircraft.createdAt;

    const due = dueService.calculate(
      {
        id: taskLink.task.id,
        organizationId: taskLink.task.organizationId,
        code: taskLink.task.code,
        title: taskLink.task.title,
        description: taskLink.task.description,
        intervalType: taskLink.task.intervalType as any,
        intervalHours: taskLink.task.intervalHours != null ? Number(taskLink.task.intervalHours) : null,
        intervalCycles: taskLink.task.intervalCycles,
        intervalCalendarDays: taskLink.task.intervalCalendarDays,
        intervalCalendarMonths: taskLink.task.intervalCalendarMonths,
        toleranceHours: taskLink.task.toleranceHours != null ? Number(taskLink.task.toleranceHours) : null,
        toleranceCycles: taskLink.task.toleranceCycles,
        toleranceCalendarDays: taskLink.task.toleranceCalendarDays,
        referenceNumber: taskLink.task.referenceNumber,
        referenceType: taskLink.task.referenceType as any,
        isMandatory: taskLink.task.isMandatory,
        estimatedManHours: taskLink.task.estimatedManHours != null ? Number(taskLink.task.estimatedManHours) : null,
        requiresInspection: taskLink.task.requiresInspection,
        applicableModel: taskLink.task.applicableModel,
        applicablePartNumber: taskLink.task.applicablePartNumber,
        isActive: taskLink.task.isActive,
        createdAt: taskLink.task.createdAt,
        updatedAt: taskLink.task.updatedAt,
      },
      hoursAt,
      cyclesAt,
      baselineDate,
    );

    const created = await prisma.$transaction(async (tx) => {
      const component = await tx.component.create({
        data: {
          organizationId: req.organizationId,
          aircraftId: aircraft.id,
          partNumber: body.partNumber,
          serialNumber: body.serialNumber,
          description: body.description,
          manufacturer: body.manufacturer,
          position: body.position ?? null,
          installationDate: baselineDate,
          installationAircraftHours: hoursAt,
          installationAircraftCycles: cyclesAt,
          status: 'INSTALLED',
          notes: body.notes ?? null,
        },
      });

      const compliance = await tx.compliance.create({
        data: {
          organizationId: req.organizationId,
          aircraftId: aircraft.id,
          taskId: body.taskId,
          componentId: component.id,
          performedById: req.currentUser.id,
          inspectedById: null,
          performedAt: baselineDate,
          aircraftHoursAtCompliance: hoursAt,
          aircraftCyclesAtCompliance: cyclesAt,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
          workOrderNumber: null,
          applicationType: 'baseline',
          isInitial: true,
          status: 'COMPLETED',
          deferralReference: null,
          deferralExpiresAt: null,
          notes: BASELINE_NOTE,
        },
      });

      await tx.componentHistory.create({
        data: {
          organizationId: req.organizationId,
          componentId: component.id,
          aircraftId: aircraft.id,
          movementType: 'INSTALLED',
          aircraftHoursAtMovement: hoursAt,
          aircraftCyclesAtMovement: cyclesAt,
          componentHoursAtMovement: 0,
          componentCyclesAtMovement: 0,
          position: body.position ?? null,
          workOrderId: null,
          performedById: req.currentUser.id,
          notes: 'Registro inicial',
          movedAt: baselineDate,
        },
      });

      return { component, compliance };
    });

    res.status(201).json({ status: 'success', data: created });
  } catch (err) {
    next(err);
  }
});

export { router as componentRoutes };
