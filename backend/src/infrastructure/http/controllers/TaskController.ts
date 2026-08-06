import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ConflictError } from '../../../shared/errors/AppError';
import { BaselineComplianceService } from '../../../domain/services/BaselineComplianceService';

const INTERVAL_TYPES = ['FLIGHT_HOURS','CYCLES','CALENDAR_DAYS','FLIGHT_HOURS_OR_CALENDAR','CYCLES_OR_CALENDAR','ON_CONDITION'] as const;
const REFERENCE_TYPES = ['AMM','AD','SB','CMR','CDCCL','MPD','ETOPS','INTERNAL'] as const;

const createSchema = z.object({
  code:                  z.string().min(1).max(100).toUpperCase(),
  title:                 z.string().min(1).max(255),
  description:           z.string().min(1),
  intervalType:          z.enum(INTERVAL_TYPES),
  intervalHours:         z.number().positive().optional().nullable(),
  intervalCycles:        z.number().int().positive().optional().nullable(),
  intervalCalendarDays:  z.number().int().positive().optional().nullable(),
  intervalCalendarMonths:z.number().int().positive().optional().nullable(),
  toleranceHours:        z.number().nonnegative().optional().nullable(),
  toleranceCycles:       z.number().int().nonnegative().optional().nullable(),
  toleranceCalendarDays: z.number().int().nonnegative().optional().nullable(),
  referenceType:         z.enum(REFERENCE_TYPES).default('AMM'),
  referenceNumber:       z.string().max(100).optional().nullable(),
  isMandatory:           z.boolean().default(false),
  estimatedManHours:     z.number().positive().optional().nullable(),
  requiresInspection:    z.boolean().default(false),
  applicableModel:       z.string().max(150).optional().nullable(),
  applicablePartNumber:  z.string().max(100).optional().nullable(),
});

const updateSchema = createSchema.partial().omit({ code: true });

const assignSchema = z.object({
  taskId: z.string().uuid(),
});

export class TaskController {
  // ── List all tasks in org ──────────────────────────────────────────────────
  listAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tasks = await prisma.maintenanceTask.findMany({
        where: { organizationId: req.organizationId, isActive: true },
        orderBy: [{ isMandatory: 'desc' }, { code: 'asc' }],
      });
      res.json({ status: 'success', data: tasks });
    } catch (err) { next(err); }
  };

  // ── Create a task ──────────────────────────────────────────────────────────
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createSchema.parse(req.body);
      const existing = await prisma.maintenanceTask.findFirst({
        where: { code: body.code, organizationId: req.organizationId },
      });
      if (existing) throw new ConflictError(`Task code '${body.code}' already exists`);
      const task = await prisma.maintenanceTask.create({
        data: { ...body, organizationId: req.organizationId },
      });
      res.status(201).json({ status: 'success', data: task });
    } catch (err) { next(err); }
  };

  // ── Update a task ──────────────────────────────────────────────────────────
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateSchema.parse(req.body);
      const existing = await prisma.maintenanceTask.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
      });
      if (!existing) throw new NotFoundError('MaintenanceTask', req.params.id);
      const task = await prisma.maintenanceTask.update({
        where: { id: req.params.id },
        data: body,
      });
      res.json({ status: 'success', data: task });
    } catch (err) { next(err); }
  };

  // ── Assign task to aircraft ────────────────────────────────────────────────
  assignToAircraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { taskId } = assignSchema.parse(req.body);
      const aircraftId = req.params.aircraftId;

      const [aircraft, task] = await Promise.all([
        prisma.aircraft.findFirst({ where: { id: aircraftId, organizationId: req.organizationId } }),
        prisma.maintenanceTask.findFirst({ where: { id: taskId, organizationId: req.organizationId } }),
      ]);
      if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);
      if (!task) throw new NotFoundError('MaintenanceTask', taskId);

      const link = await prisma.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId, taskId } },
        create: { aircraftId, taskId },
        update: { isActive: true },
      });

      await BaselineComplianceService.ensureBaselineForTask(
        aircraftId,
        taskId,
        req.organizationId,
        req.currentUser.id,
      );

      res.status(201).json({ status: 'success', data: link });
    } catch (err) { next(err); }
  };

  // ── Remove task from aircraft plan ─────────────────────────────────────────
  removeFromAircraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { aircraftId, taskId } = req.params;
      const link = await prisma.aircraftTask.findFirst({
        where: { aircraftId, taskId, aircraft: { organizationId: req.organizationId } },
      });
      if (!link) throw new NotFoundError('AircraftTask');
      await prisma.aircraftTask.update({
        where: { aircraftId_taskId: { aircraftId, taskId } },
        data: { isActive: false },
      });
      res.status(204).send();
    } catch (err) { next(err); }
  };
}
