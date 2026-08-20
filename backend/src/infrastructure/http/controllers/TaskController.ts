import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ConflictError, ValidationError } from '../../../shared/errors/AppError';
import { BaselineComplianceService } from '../../../domain/services/BaselineComplianceService';

const INTERVAL_TYPES = ['FLIGHT_HOURS','CYCLES','CALENDAR_DAYS','FLIGHT_HOURS_OR_CALENDAR','CYCLES_OR_CALENDAR','ON_CONDITION'] as const;
const REFERENCE_TYPES = ['AMM','AD','SB','CMR','CDCCL','MPD','ETOPS','INTERNAL'] as const;

const createSchema = z.object({
  code:                  z.string().min(1).max(100).toUpperCase(),
  ata:                   z.string().trim().max(20).optional().nullable(),
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

const updateSchema = createSchema.partial().omit({ code: true }).extend({
  /** Otras tareas de la flota (misma AD/SB) a las que aplicar el mismo cambio.
   * El frontend las obtiene de GET /tasks/:id/fleet-siblings y el operador
   * elige cuáles marcar — nunca se propaga sin que las mande explícitas. */
  propagateToTaskIds: z.array(z.string().uuid()).optional(),
});

const assignSchema = z.object({
  taskId: z.string().uuid(),
});

const applicabilitySchema = z.object({
  applies: z.boolean(),
  notes: z.string().max(2000).optional().nullable(),
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

  /**
   * Otras tareas de la organización que representan la MISMA normativa que
   * ésta (mismo referenceType + referenceNumber) pero son registros
   * separados, típicamente uno por aeronave. Una enmienda a una AD debería
   * aplicar a toda la flota, y sin esto habría que editarla una por una.
   */
  fleetSiblings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const task = await prisma.maintenanceTask.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
      });
      if (!task) throw new NotFoundError('MaintenanceTask', req.params.id);

      // Solo tiene sentido para normativa identificable por su número; una
      // tarea de manual sin referencia no tiene "la misma" en otro avión.
      if (!task.referenceNumber || !['AD', 'SB', 'CMR'].includes(task.referenceType)) {
        res.json({ status: 'success', data: [] });
        return;
      }

      const siblings = await prisma.maintenanceTask.findMany({
        where: {
          organizationId: req.organizationId,
          id: { not: task.id },
          referenceType: task.referenceType,
          referenceNumber: task.referenceNumber,
          isActive: true,
        },
        include: {
          aircraftLinks: {
            where: { isActive: true },
            select: { aircraft: { select: { id: true, registration: true } } },
          },
        },
        orderBy: { code: 'asc' },
      });

      res.json({
        status: 'success',
        data: siblings.map((s) => ({
          id: s.id,
          code: s.code,
          title: s.title,
          intervalHours: s.intervalHours != null ? Number(s.intervalHours) : null,
          intervalCycles: s.intervalCycles,
          intervalCalendarDays: s.intervalCalendarDays,
          intervalCalendarMonths: s.intervalCalendarMonths,
          aircraft: s.aircraftLinks.map((l) => l.aircraft.registration),
        })),
      });
    } catch (err) { next(err); }
  };

  // ── Update a task ──────────────────────────────────────────────────────────
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { propagateToTaskIds, ...body } = updateSchema.parse(req.body);
      const existing = await prisma.maintenanceTask.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
      });
      if (!existing) throw new NotFoundError('MaintenanceTask', req.params.id);

      // Las hermanas se validan contra la organización antes de tocarlas: un
      // id de otra empresa no debe poder colarse por el body.
      const siblingIds = propagateToTaskIds?.length
        ? (await prisma.maintenanceTask.findMany({
            where: { id: { in: propagateToTaskIds }, organizationId: req.organizationId },
            select: { id: true },
          })).map((t) => t.id)
        : [];

      const [task] = await prisma.$transaction([
        prisma.maintenanceTask.update({ where: { id: existing.id }, data: body }),
        ...(siblingIds.length
          // El código y el título identifican a la tarea en cada aeronave
          // (traen su S/N o su origen); la enmienda cambia intervalos y
          // referencia, no la identidad de cada registro.
          ? [prisma.maintenanceTask.updateMany({
              where: { id: { in: siblingIds } },
              data: { ...body, code: undefined, title: undefined },
            })]
          : []),
      ]);

      res.json({ status: 'success', data: task, propagatedTo: siblingIds.length });
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
  /**
   * Cambia la aplicabilidad de una tarea en una aeronave conservando el vínculo.
   * Marcar "no aplica" exige justificación: es una decisión de aeronavegabilidad
   * auditable y reversible (p. ej. descartada por ambiente salino, que vuelve a
   * aplicar si la aeronave cambia de base).
   */
  setApplicability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { aircraftId, taskId } = req.params;
      const { applies, notes } = applicabilitySchema.parse(req.body);

      const link = await prisma.aircraftTask.findFirst({
        where: { aircraftId, taskId, aircraft: { organizationId: req.organizationId } },
      });
      if (!link) throw new NotFoundError('AircraftTask');

      const trimmedNotes = notes?.trim() || null;
      if (!applies && !trimmedNotes) {
        throw new ValidationError('Debe indicar por qué la tarea no aplica a esta aeronave');
      }

      const updated = await prisma.aircraftTask.update({
        where: { aircraftId_taskId: { aircraftId, taskId } },
        data: {
          isActive: applies,
          applicabilityNotes: trimmedNotes ?? link.applicabilityNotes,
          applicabilityChangedAt: new Date(),
          applicabilityChangedById: req.currentUser.id,
        },
      });

      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

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
