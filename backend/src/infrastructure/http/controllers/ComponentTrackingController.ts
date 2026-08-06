import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { componentTrackingService } from '../../../domain/services/ComponentTrackingService';

const listQuerySchema = z.object({
  aircraftId: z.string().uuid().optional(),
});

const createDefinitionSchema = z.object({
  ataChapter: z.string().min(1).max(20),
  ataCode: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  executionType: z.enum(['maintenance', 'component_replacement']),
  intervalType: z.enum(['hours', 'cycles', 'calendar', 'mixed']),
  intervalHours: z.number().nonnegative().nullable().optional(),
  intervalCycles: z.number().int().nonnegative().nullable().optional(),
  intervalDays: z.number().int().nonnegative().nullable().optional(),
  requiresComponentTracking: z.boolean().optional().default(false),
  sourceGroup: z.string().min(1).max(100),
  reference: z.string().nullable().optional(),
});

const createInstanceSchema = z.object({
  definitionId: z.string().uuid(),
  aircraftId: z.string().uuid().nullable().optional(),
  legacyComponentId: z.string().uuid().nullable().optional(),
  partNumber: z.string().min(1).max(100),
  serialNumber: z.string().min(1).max(100),
  position: z.string().min(1).max(150),
  status: z.enum(['installed', 'removed', 'spare', 'scrapped']).optional().default('spare'),
  installedAt: z.coerce.date().nullable().optional(),
  removedAt: z.coerce.date().nullable().optional(),
  installedAtHours: z.number().nonnegative().nullable().optional(),
  removedAtHours: z.number().nonnegative().nullable().optional(),
  installedAtCycles: z.number().int().nonnegative().nullable().optional(),
  removedAtCycles: z.number().int().nonnegative().nullable().optional(),
  installWorkOrderNumber: z.string().max(50).nullable().optional(),
  removalWorkOrderNumber: z.string().max(50).nullable().optional(),
});

const createApplicationSchema = z.object({
  definitionId: z.string().uuid(),
  componentInstanceId: z.string().uuid().nullable().optional(),
  aircraftId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  workRequestId: z.string().uuid().nullable().optional(),
  officeOrderId: z.string().max(100).nullable().optional(),
  workOrderNumber: z.string().max(50).nullable().optional(),
  appliedAt: z.coerce.date(),
  aircraftHoursAtApplication: z.number().nonnegative(),
  aircraftCyclesAtApplication: z.number().int().nonnegative(),
  nextDueHours: z.number().nonnegative().nullable().optional(),
  nextDueCycles: z.number().int().nonnegative().nullable().optional(),
  nextDueDate: z.coerce.date().nullable().optional(),
  applicationType: z.enum(['baseline', 'application', 'replacement_start']).optional().default('application'),
  isInitial: z.boolean().optional().default(false),
  notes: z.string().nullable().optional(),
});

const createMovementSchema = z.object({
  aircraftId: z.string().uuid(),
  position: z.string().min(1).max(150),
  movementType: z.enum(['install', 'remove', 'replacement']),
  removedComponentInstanceId: z.string().uuid().nullable().optional(),
  installedComponentInstanceId: z.string().uuid().nullable().optional(),
  workRequestId: z.string().uuid().nullable().optional(),
  officeOrderId: z.string().max(100).nullable().optional(),
  workOrderNumber: z.string().max(50).nullable().optional(),
  performedAt: z.coerce.date(),
  aircraftHoursAtMovement: z.number().nonnegative(),
  aircraftCyclesAtMovement: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
});

export class ComponentTrackingController {
  listDefinitions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await componentTrackingService.listDefinitions(req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createDefinition = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createDefinitionSchema.parse(req.body);
      const data = await componentTrackingService.createDefinition(req.organizationId, {
        ...body,
        intervalHours: body.intervalHours ?? null,
        intervalCycles: body.intervalCycles ?? null,
        intervalDays: body.intervalDays ?? null,
        reference: body.reference ?? null,
      });
      res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  listInstances = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listQuerySchema.parse(req.query);
      const data = await componentTrackingService.listInstances(req.organizationId, query.aircraftId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createInstance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createInstanceSchema.parse(req.body);
      const data = await componentTrackingService.createInstance(req.organizationId, {
        ...body,
        aircraftId: body.aircraftId ?? null,
        legacyComponentId: body.legacyComponentId ?? null,
        installedAt: body.installedAt ?? null,
        removedAt: body.removedAt ?? null,
        installedAtHours: body.installedAtHours ?? null,
        removedAtHours: body.removedAtHours ?? null,
        installedAtCycles: body.installedAtCycles ?? null,
        removedAtCycles: body.removedAtCycles ?? null,
        installWorkOrderNumber: body.installWorkOrderNumber ?? null,
        removalWorkOrderNumber: body.removalWorkOrderNumber ?? null,
      });
      res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  listApplications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listQuerySchema.parse(req.query);
      const data = await componentTrackingService.listApplications(req.organizationId, query.aircraftId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createApplicationSchema.parse(req.body);
      const data = await componentTrackingService.createApplication(req.organizationId, {
        ...body,
        componentInstanceId: body.componentInstanceId ?? null,
        taskId: body.taskId ?? null,
        workRequestId: body.workRequestId ?? null,
        officeOrderId: body.officeOrderId ?? null,
        workOrderNumber: body.workOrderNumber ?? null,
        nextDueHours: body.nextDueHours ?? null,
        nextDueCycles: body.nextDueCycles ?? null,
        nextDueDate: body.nextDueDate ?? null,
        notes: body.notes ?? null,
      });
      res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  listMovements = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listQuerySchema.parse(req.query);
      const data = await componentTrackingService.listMovements(req.organizationId, query.aircraftId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createMovement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createMovementSchema.parse(req.body);
      const data = await componentTrackingService.createMovement(req.organizationId, {
        ...body,
        removedComponentInstanceId: body.removedComponentInstanceId ?? null,
        installedComponentInstanceId: body.installedComponentInstanceId ?? null,
        workRequestId: body.workRequestId ?? null,
        officeOrderId: body.officeOrderId ?? null,
        workOrderNumber: body.workOrderNumber ?? null,
        notes: body.notes ?? null,
        performedById: req.currentUser.id,
      });
      res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
  };
}
