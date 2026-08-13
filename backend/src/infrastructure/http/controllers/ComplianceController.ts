import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { RecordComplianceUseCase, GetComplianceUseCase } from '../../../application/maintenance/ComplianceUseCases';

const listSchema = z.object({
  aircraftId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const recordSchema = z.object({
  aircraftId: z.string().uuid(),
  taskId: z.string().uuid(),
  componentId: z.string().uuid().optional().nullable(),
  performedAt: z.coerce.date(),
  aircraftHoursAtCompliance: z.number().nonnegative().optional(),
  nextDueHours: z.number().nonnegative().optional().nullable(),
  nextDueCycles: z.number().int().nonnegative().optional().nullable(),
  nextDueDate: z.coerce.date().optional().nullable(),
  inspectedById: z.string().uuid().optional().nullable(),
  workOrderNumber: z.string().max(50).optional().nullable(),
  applicationType: z.enum(['application', 'replacement_start']).optional(),
  notes: z.string().optional().nullable(),
  deferralReference: z.string().max(100).optional().nullable(),
  deferralExpiresAt: z.coerce.date().optional().nullable(),
});

export class ComplianceController {
  constructor(
    private readonly recordUseCase: RecordComplianceUseCase,
    private readonly getUseCase: GetComplianceUseCase,
  ) {}

  record = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = recordSchema.parse(req.body);
      const compliance = await this.recordUseCase.execute({
        ...body,
        organizationId: req.organizationId,
        performedById: req.currentUser.id,
      });
      res.status(201).json({ status: 'success', data: compliance });
    } catch (err) { next(err); }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { aircraftId, page, limit } = listSchema.parse(req.query);
      const result = await this.getUseCase.findAllForAircraft(
        aircraftId,
        req.organizationId,
        {},
        { page, limit },
      );
      res.status(200).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  };

  latestPerTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.getUseCase.getLatestPerTask(req.params.aircraftId, req.organizationId);
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  /** Historial completo de una tarea en una aeronave, del más reciente al más antiguo. */
  historyForTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.getUseCase.getHistoryForTask(
        req.params.aircraftId,
        req.params.taskId,
        req.organizationId,
      );
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };
}
