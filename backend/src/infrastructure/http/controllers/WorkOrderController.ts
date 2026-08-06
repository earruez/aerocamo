// ─────────────────────────────────────────────────────────────────────────────
//  WorkOrderController  —  REST endpoints for Órdenes de Trabajo
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WorkOrderStatus } from '@prisma/client';
import { workOrderService } from '../../../domain/services/WorkOrderService';
import { ValidationError } from '../../../shared/errors/AppError';
import { WORK_ORDER_STATE_MACHINE } from '../../../domain/workflows/stateMachines';

const STATUSES = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'QUALITY', 'CLOSED'] as const;

const createSchema = z.object({
  aircraftId:            z.string().uuid(),
  title:                 z.string().min(1).max(255),
  description:           z.string().optional().nullable(),
  plannedStartDate:      z.string().datetime().optional().nullable(),
  plannedEndDate:        z.string().datetime().optional().nullable(),
  assignedTechnicianId:  z.string().uuid().optional().nullable(),
  inspectorId:           z.string().uuid().optional().nullable(),
  notes:                 z.string().optional().nullable(),
  taskIds:               z.array(z.string().uuid()).optional(),
});

const updateSchema = createSchema.omit({ aircraftId: true, taskIds: true }).partial().extend({
  aircraftHoursAtOpen:  z.number().nonnegative().optional().nullable(),
  aircraftCyclesAtOpen: z.number().int().nonnegative().optional().nullable(),
});

const transitionSchema = z.object({
  status: z.enum(STATUSES),
});

const addTaskSchema = z.object({
  taskId: z.string().uuid(),
});

const completeTaskSchema = z.object({
  notes: z.string().optional(),
});

export class WorkOrderController {

  stateMachine = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ status: 'success', data: WORK_ORDER_STATE_MACHINE });
    } catch (err) { next(err); }
  };

  // ── List ───────────────────────────────────────────────────────────────────
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, aircraftId } = req.query as { status?: string; aircraftId?: string };

      if (status && !STATUSES.includes(status as WorkOrderStatus)) {
        throw new ValidationError(`Invalid status filter: ${status}`);
      }

      const data = await workOrderService.list(
        req.organizationId,
        { status: status as WorkOrderStatus | undefined, aircraftId },
      );
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  // ── Get by ID ──────────────────────────────────────────────────────────────
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await workOrderService.getById(req.params.id, req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  // ── Create ─────────────────────────────────────────────────────────────────
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createSchema.parse(req.body);
      const input = {
        ...body,
        plannedStartDate: body.plannedStartDate ? new Date(body.plannedStartDate) : null,
        plannedEndDate:   body.plannedEndDate   ? new Date(body.plannedEndDate)   : null,
      };
      const data = await workOrderService.create(input, req.organizationId, req.currentUser);
      res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  // ── Update metadata ────────────────────────────────────────────────────────
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateSchema.parse(req.body);
      const input = {
        ...body,
        plannedStartDate: body.plannedStartDate ? new Date(body.plannedStartDate) : (body.plannedStartDate as null | undefined),
        plannedEndDate:   body.plannedEndDate   ? new Date(body.plannedEndDate)   : (body.plannedEndDate   as null | undefined),
      };
      const data = await workOrderService.update(req.params.id, input, req.organizationId, req.currentUser);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  // ── Transition status ──────────────────────────────────────────────────────
  transition = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = transitionSchema.parse(req.body);
      const data = await workOrderService.transition(
        req.params.id,
        status as WorkOrderStatus,
        req.organizationId,
        req.currentUser,
      );
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  // ── Add task to WO ─────────────────────────────────────────────────────────
  addTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { taskId } = addTaskSchema.parse(req.body);
      const data = await workOrderService.addTask(req.params.id, taskId, req.organizationId);
      res.status(201).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  // ── Remove task from WO ────────────────────────────────────────────────────
  removeTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await workOrderService.removeTask(req.params.id, req.params.taskId, req.organizationId);
      res.json({ status: 'success', message: 'Task removed from Work Order' });
    } catch (err) { next(err); }
  };

  // ── Complete a task within WO ──────────────────────────────────────────────
  completeTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { notes } = completeTaskSchema.parse(req.body);
      const data = await workOrderService.completeTask(
        req.params.id,
        req.params.taskId,
        req.organizationId,
        req.currentUser,
        notes,
      );
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  };
}
