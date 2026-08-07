import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  CreateAircraftUseCase,
  GetAircraftUseCase,
  UpdateAircraftUseCase,
  GetMaintenancePlanUseCase,
  DeleteAircraftUseCase,
} from '../../../application/aircraft/AircraftUseCases';
import { BaselineComplianceService } from '../../../domain/services/BaselineComplianceService';
import { aircraftUsageService } from '../../../domain/services/AircraftUsageService';
import { TemplateCloneService } from '../../../domain/services/TemplateCloneService';
import { dueEngineService } from '../../../domain/services/DueEngineService';
import { prisma } from '../../database/prisma.client';
import { NotFoundError } from '../../../shared/errors/AppError';


const createSchema = z.object({
  registration: z.string().min(1).max(20).toUpperCase(),
  model: z.string().min(1).max(150),
  manufacturer: z.string().min(1).max(150),
  serialNumber: z.string().min(1).max(100),
  engineCount: z.number().int().min(1).max(4).default(2),
  engineModel: z.string().max(100).optional().nullable(),
  totalFlightHours: z.number().nonnegative().optional().default(0),
  totalCycles: z.number().int().nonnegative().optional().default(0),
  manufactureDate: z.coerce.date().optional().nullable(),
  registrationDate: z.coerce.date().optional().nullable(),
  coaExpiryDate: z.coerce.date().optional().nullable(),
  insuranceExpiryDate: z.coerce.date().optional().nullable(),
  assignedPlans: z.array(z.object({
    category: z.enum(['manufacturer', 'national_dgac', 'engine_components', 'origin_country']),
    templateId: z.string().uuid(),
  })).optional().default([]),
});

const updateSchema = z.object({
  model: z.string().max(150).optional(),
  manufacturer: z.string().max(150).optional(),
  serialNumber: z.string().max(100).optional(),
  engineModel: z.string().max(100).optional().nullable(),
  totalFlightHours: z.number().nonnegative().optional(),
  totalCycles: z.number().int().nonnegative().optional(),
  status: z.enum(['OPERATIONAL', 'AOG', 'IN_MAINTENANCE', 'GROUNDED', 'DECOMMISSIONED']).optional(),
  coaExpiryDate: z.coerce.date().optional().nullable(),
  insuranceExpiryDate: z.coerce.date().optional().nullable(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const usageLogCreateSchema = z.object({
  date: z.coerce.date(),
  totalHours: z.coerce.number().nonnegative(),
  totalCycles: z.coerce.number().int().nonnegative(),
  source: z.enum(['manual', 'flight_log', 'ot_close', 'import', 'baseline']),
  notes: z.string().max(2000).optional().nullable(),
});

const createEngineSchema = z.object({
  position: z.enum(['N1', 'N2']),
  manufacturer: z.string().min(1).max(150),
  model: z.string().min(1).max(150),
  serialNumber: z.string().min(1).max(100),
});

const createEngineUsageLogSchema = z.object({
  hours: z.coerce.number().nonnegative(),
  cycles: z.coerce.number().int().nonnegative(),
  date: z.coerce.date(),
});

const dueRowsQuerySchema = z.object({
  method: z.enum(['H', 'M', 'C', 'N1', 'N2', 'LND', 'RIN']).optional(),
  sourceType: z.enum(['AD', 'SB', 'INSPECTION', 'MIM', 'DAN', 'COMPONENT', 'ENGINE_COMPONENT', 'MOD']).optional(),
});

export class AircraftController {
  constructor(
    private readonly createUseCase: CreateAircraftUseCase,
    private readonly getUseCase: GetAircraftUseCase,
    private readonly updateUseCase: UpdateAircraftUseCase,
    private readonly planUseCase: GetMaintenancePlanUseCase,
    private readonly deleteUseCase: DeleteAircraftUseCase,
  ) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createSchema.parse(req.body);
      const { assignedPlans, ...aircraftPayload } = body;
      const aircraft = await this.createUseCase.execute({
        ...aircraftPayload,
        engineModel:          aircraftPayload.engineModel          ?? null,
        totalFlightHours:     aircraftPayload.totalFlightHours     ?? 0,
        totalCycles:          aircraftPayload.totalCycles          ?? 0,
        manufactureDate:      aircraftPayload.manufactureDate      ?? null,
        registrationDate:     aircraftPayload.registrationDate     ?? null,
        coaExpiryDate:        aircraftPayload.coaExpiryDate        ?? null,
        insuranceExpiryDate:  aircraftPayload.insuranceExpiryDate  ?? null,
        organizationId:       req.organizationId,
      });

      try {
        if (assignedPlans.length > 0) {
          await TemplateCloneService.assignBundleToAircraft({
            organizationId: req.organizationId,
            aircraftId: aircraft.id,
            assignments: assignedPlans,
            actor: {
              id: req.currentUser.id,
              email: req.currentUser.email,
              role: req.currentUser.role,
            },
          });
        }

        await BaselineComplianceService.ensureBaselinesForAircraft(
          aircraft.id,
          req.organizationId,
          req.currentUser.id,
        );

        await aircraftUsageService.recordUsage({
          organizationId: req.organizationId,
          aircraftId: aircraft.id,
          date: aircraft.createdAt,
          totalHours: Number(aircraft.totalFlightHours),
          totalCycles: aircraft.totalCycles,
          source: 'baseline',
          notes: 'Registro inicial de aeronave',
        });
      } catch (err) {
        await this.deleteUseCase.execute(aircraft.id, req.organizationId);
        throw err;
      }

      res.status(201).json({ status: 'success', data: aircraft });
    } catch (err) { next(err); }
  };

  findAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit } = paginationSchema.parse(req.query);
      const result = await this.getUseCase.findAll(req.organizationId, { page, limit });
      res.status(200).json({ status: 'success', ...result });
    } catch (err) { next(err); }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const aircraft = await this.getUseCase.findById(req.params.id, req.organizationId);
      res.status(200).json({ status: 'success', data: aircraft });
    } catch (err) { next(err); }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateSchema.parse(req.body);
      const aircraft = await this.updateUseCase.execute(req.params.id, req.organizationId, body);
      res.status(200).json({ status: 'success', data: aircraft });
    } catch (err) { next(err); }
  };

  getMaintenancePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const includeNotApplicable = String(req.query.includeNotApplicable ?? '') === 'true';
      const plan = await this.planUseCase.execute(req.params.id, req.organizationId, { includeNotApplicable });
      res.status(200).json({ status: 'success', data: plan });
    } catch (err) { next(err); }
  };

  getUsageHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [summary, logs] = await Promise.all([
        aircraftUsageService.getAircraftUsageSummary(req.params.id, req.organizationId),
        aircraftUsageService.listUsageHistory(req.params.id, req.organizationId),
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          aircraft: {
            totalHours: summary.totalHours,
            totalCycles: summary.totalCycles,
            lastUpdatedAt: summary.lastUpdatedAt,
          },
          history: logs.map((log) => ({
            id: log.id,
            aircraftId: log.aircraftId,
            date: log.date,
            totalHours: log.totalHours,
            totalCycles: log.totalCycles,
            source: log.source,
            notes: log.notes,
            createdAt: log.createdAt,
          })),
        },
      });
    } catch (err) { next(err); }
  };

  createUsageLog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = usageLogCreateSchema.parse(req.body);
      const created = await aircraftUsageService.recordUsage({
        organizationId: req.organizationId,
        aircraftId: req.params.id,
        date: input.date,
        totalHours: input.totalHours,
        totalCycles: input.totalCycles,
        source: input.source,
        notes: input.notes ?? null,
      });

      res.status(201).json({
        status: 'success',
        data: {
          id: created.id,
          aircraftId: created.aircraftId,
          date: created.date,
          totalHours: created.totalHours,
          totalCycles: created.totalCycles,
          source: created.source,
          notes: created.notes,
          createdAt: created.createdAt,
        },
      });
    } catch (err) { next(err); }
  };

  listEngines = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const aircraft = await this.getUseCase.findById(req.params.id, req.organizationId);
      const engines = await prisma.aircraftEngine.findMany({
        where: {
          organizationId: req.organizationId,
          aircraftId: aircraft.id,
        },
        include: {
          usageLogs: {
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            take: 1,
          },
        },
        orderBy: { position: 'asc' },
      });

      res.status(200).json({
        status: 'success',
        data: engines.map((engine) => ({
          id: engine.id,
          aircraftId: engine.aircraftId,
          position: engine.position,
          manufacturer: engine.manufacturer,
          model: engine.model,
          serialNumber: engine.serialNumber,
          latestUsage: engine.usageLogs[0]
            ? {
                hours: Number(engine.usageLogs[0].hours),
                cycles: engine.usageLogs[0].cycles,
                date: engine.usageLogs[0].date,
              }
            : null,
        })),
      });
    } catch (err) { next(err); }
  };

  createEngine = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const aircraft = await this.getUseCase.findById(req.params.id, req.organizationId);
      const body = createEngineSchema.parse(req.body);

      const created = await prisma.aircraftEngine.create({
        data: {
          organizationId: req.organizationId,
          aircraftId: aircraft.id,
          position: body.position,
          manufacturer: body.manufacturer,
          model: body.model,
          serialNumber: body.serialNumber,
        },
      });

      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  createEngineUsageLog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createEngineUsageLogSchema.parse(req.body);
      const engine = await prisma.aircraftEngine.findFirst({
        where: {
          id: req.params.engineId,
          aircraftId: req.params.id,
          organizationId: req.organizationId,
        },
        select: { id: true },
      });

      if (!engine) {
        throw new NotFoundError('AircraftEngine', req.params.engineId);
      }

      const created = await prisma.aircraftEngineUsageLog.create({
        data: {
          organizationId: req.organizationId,
          engineId: engine.id,
          hours: body.hours,
          cycles: body.cycles,
          date: body.date,
        },
      });

      res.status(201).json({
        status: 'success',
        data: {
          id: created.id,
          engineId: created.engineId,
          hours: Number(created.hours),
          cycles: created.cycles,
          date: created.date,
          createdAt: created.createdAt,
        },
      });
    } catch (err) { next(err); }
  };

  getDueRows = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = dueRowsQuerySchema.parse(req.query);
      const rows = await dueEngineService.getDueRows(req.organizationId, req.params.id, query);
      res.status(200).json({ status: 'success', data: rows });
    } catch (err) { next(err); }
  };

  getDueSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await dueEngineService.getDueSummary(req.organizationId, req.params.id);
      res.status(200).json({ status: 'success', data: summary });
    } catch (err) { next(err); }
  };

  getDueReportData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await dueEngineService.getDueReportData(req.organizationId, req.params.id);
      res.status(200).json({ status: 'success', data: report });
    } catch (err) { next(err); }
  };
}
