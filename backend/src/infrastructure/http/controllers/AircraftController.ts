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
import { NotFoundError, ValidationError } from '../../../shared/errors/AppError';


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

  /**
   * Cambia el estado operacional dejando constancia. Sacar de servicio o
   * devolver al servicio es una decisión de aeronavegabilidad: exige motivo y
   * queda con autor y fecha en el historial.
   */
  changeStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = z.object({
        status: z.enum(['OPERATIONAL', 'AOG', 'IN_MAINTENANCE', 'GROUNDED', 'DECOMMISSIONED']),
        reason: z.string().trim().min(1, 'Indique el motivo del cambio').max(2000),
      }).parse(req.body);

      const aircraft = await prisma.aircraft.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true, status: true, registration: true },
      });
      if (!aircraft) throw new NotFoundError('Aircraft', req.params.id);

      if (aircraft.status === body.status) {
        throw new ValidationError(`La aeronave ya está en estado ${body.status}`);
      }

      const [updated] = await prisma.$transaction([
        prisma.aircraft.update({ where: { id: aircraft.id }, data: { status: body.status } }),
        prisma.aircraftStatusChange.create({
          data: {
            organizationId: req.organizationId,
            aircraftId: aircraft.id,
            fromStatus: aircraft.status,
            toStatus: body.status,
            reason: body.reason,
            changedById: req.currentUser.id,
          },
        }),
      ]);

      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  listStatusChanges = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await prisma.aircraftStatusChange.findMany({
        where: { aircraftId: req.params.id, organizationId: req.organizationId },
        include: { changedBy: { select: { id: true, name: true, role: true } } },
        orderBy: { changedAt: 'desc' },
        take: 50,
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  /** Lecturas de contadores de la aeronave y de sus motores, la última primero. */
  listCounterReadings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const readings = await prisma.counterReading.findMany({
        where: {
          organizationId: req.organizationId,
          OR: [
            { aircraftId: req.params.id },
            { engine: { aircraftId: req.params.id } },
          ],
        },
        include: {
          counterType: { select: { id: true, code: true, name: true, unit: true, scope: true } },
          engine: { select: { id: true, position: true, model: true, serialNumber: true } },
          recordedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ readingDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      res.status(200).json({ status: 'success', data: readings });
    } catch (err) { next(err); }
  };

  /**
   * Registra una lectura. Los contadores no retroceden: una lectura menor a la
   * última suele ser un error de tipeo, y aceptarla adelantaría vencimientos.
   */
  createCounterReading = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = z.object({
        counterTypeId: z.string().uuid(),
        engineId: z.string().uuid().nullable().optional(),
        value: z.coerce.number().min(0),
        readingDate: z.coerce.date(),
        notes: z.string().max(1000).nullable().optional(),
      }).parse(req.body);

      const aircraft = await prisma.aircraft.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!aircraft) throw new NotFoundError('Aircraft', req.params.id);

      const counterType = await prisma.counterType.findFirst({
        where: { id: body.counterTypeId, organizationId: req.organizationId, isActive: true },
      });
      if (!counterType) throw new NotFoundError('CounterType', body.counterTypeId);

      if (body.engineId) {
        const engine = await prisma.aircraftEngine.findFirst({
          where: { id: body.engineId, aircraftId: aircraft.id },
          select: { id: true },
        });
        if (!engine) throw new NotFoundError('AircraftEngine', body.engineId);
        if (counterType.scope === 'AIRCRAFT') {
          throw new ValidationError(`${counterType.code} es un contador de aeronave, no de motor`);
        }
      } else if (counterType.scope === 'ENGINE') {
        throw new ValidationError(`${counterType.code} es un contador de motor: indica a cuál pertenece la lectura`);
      }

      const previous = await prisma.counterReading.findFirst({
        where: {
          counterTypeId: counterType.id,
          ...(body.engineId ? { engineId: body.engineId } : { aircraftId: aircraft.id }),
        },
        orderBy: [{ readingDate: 'desc' }, { createdAt: 'desc' }],
        select: { value: true, readingDate: true },
      });
      if (previous && body.value < Number(previous.value)) {
        throw new ValidationError(
          `La lectura (${body.value}) es menor que la última registrada (${Number(previous.value)} el ${previous.readingDate.toISOString().slice(0, 10)}).`,
        );
      }

      const created = await prisma.$transaction(async (tx) => {
        const reading = await tx.counterReading.create({
          data: {
            organizationId: req.organizationId,
            counterTypeId: counterType.id,
            aircraftId: body.engineId ? null : aircraft.id,
            engineId: body.engineId ?? null,
            value: body.value,
            readingDate: body.readingDate,
            notes: body.notes ?? null,
            recordedById: req.currentUser.id,
          },
          include: { counterType: { select: { code: true, name: true, unit: true } } },
        });

        // Los contadores que reflejan un campo previo lo actualizan también: el
        // plan calcula horas contra ese campo, y dos verdades para el mismo
        // número es peor que una sola en el lugar equivocado.
        if (counterType.legacyField === 'aircraftHours' || counterType.legacyField === 'aircraftCycles') {
          const last = await tx.aircraftUsageLog.findFirst({
            where: { aircraftId: aircraft.id },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          });
          const hours = counterType.legacyField === 'aircraftHours'
            ? body.value
            : Number(last?.totalHours ?? 0);
          const cycles = counterType.legacyField === 'aircraftCycles'
            ? Math.round(body.value)
            : Number(last?.totalCycles ?? 0);

          await tx.aircraftUsageLog.create({
            data: {
              organizationId: req.organizationId,
              aircraftId: aircraft.id,
              date: body.readingDate,
              totalHours: hours,
              totalCycles: cycles,
              source: 'manual',
              notes: `Registrado desde el contador ${counterType.code}`,
            },
          });
          await tx.aircraft.update({
            where: { id: aircraft.id },
            data: { totalFlightHours: hours, totalCycles: cycles },
          });
        }

        if ((counterType.legacyField === 'engineHours' || counterType.legacyField === 'engineCycles') && body.engineId) {
          const last = await tx.aircraftEngineUsageLog.findFirst({
            where: { engineId: body.engineId },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          });
          await tx.aircraftEngineUsageLog.create({
            data: {
              organizationId: req.organizationId,
              engineId: body.engineId,
              date: body.readingDate,
              hours: counterType.legacyField === 'engineHours' ? body.value : Number(last?.hours ?? 0),
              cycles: counterType.legacyField === 'engineCycles' ? Math.round(body.value) : Number(last?.cycles ?? 0),
            },
          });
        }

        return reading;
      });

      res.status(201).json({ status: 'success', data: created });
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
