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
import { RemanentesDocumentService } from '../../../domain/services/RemanentesDocumentService';
import { CounterHistoryDocumentService } from '../../../domain/services/CounterHistoryDocumentService';
import { AlterationsDocumentService } from '../../../domain/services/AlterationsDocumentService';
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
  owner: z.string().trim().max(180).optional().nullable(),
  yearManufactured: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
  insuranceExpiryDate: z.coerce.date().optional().nullable(),
  assignedPlans: z.array(z.object({
    category: z.enum(['manufacturer', 'national_dgac', 'engine_components', 'origin_country']),
    templateIds: z.array(z.string().uuid()).min(1),
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
  owner: z.string().trim().max(180).optional().nullable(),
  yearManufactured: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
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

const DGAC_EQUIPMENT = ['AERONAVE', 'MOTOR_1', 'MOTOR_2', 'HELICE_1', 'HELICE_2', 'APU'] as const;

const setEquipmentApplicabilitySchema = z.object({
  applies: z.boolean(),
  // El motivo es obligatorio al declarar "no aplica": sin él la declaración no
  // sirve como respaldo ante la DGAC, que es justamente para lo que existe.
  notes: z.string().trim().max(500).optional(),
}).refine((v) => v.applies || (v.notes != null && v.notes.length > 0), {
  message: 'Declarar que un equipo no aplica requiere indicar el motivo',
  path: ['notes'],
});

const replaceEngineSchema = z.object({
  manufacturer: z.string().min(1).max(150),
  model: z.string().min(1).max(150),
  serialNumber: z.string().min(1).max(100),
  removalReason: z.string().max(1000).nullable().optional(),
  removalDate: z.coerce.date().optional(),
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
        owner:                aircraftPayload.owner                ?? null,
        yearManufactured:     aircraftPayload.yearManufactured     ?? null,
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
        folio: z.string().max(50).nullable().optional(),
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
            folio: body.folio ?? null,
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

      // Cargar el historial de horas de una aeronave a la que ya se le había
      // asignado un plan deja las líneas base ancladas en un valor anterior a
      // la realidad, y todo el plan aparece vencido. Se corrige acá, después
      // de que la lectura ya actualizó los totales.
      const reanchored = await BaselineComplianceService.reanchorStaleBaselines(
        aircraft.id,
        req.organizationId,
      );

      res.status(201).json({ status: 'success', data: created, reanchoredBaselines: reanchored });
    } catch (err) { next(err); }
  };

  /**
   * Borra una lectura de contador cargada por error. Si esa lectura había
   * actualizado el campo legado (horas/ciclos de aeronave o motor), se
   * recalcula contra la lectura que ahora queda como más reciente — así no
   * queda un número viejo/erróneo pegado en la aeronave o el motor.
   */
  deleteCounterReading = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reading = await prisma.counterReading.findFirst({
        where: {
          id: req.params.readingId,
          organizationId: req.organizationId,
          OR: [{ aircraftId: req.params.id }, { engine: { aircraftId: req.params.id } }],
        },
        include: { counterType: true },
      });
      if (!reading) throw new NotFoundError('CounterReading', req.params.readingId);

      await prisma.$transaction(async (tx) => {
        await tx.counterReading.delete({ where: { id: reading.id } });

        if (reading.counterType.legacyField === 'aircraftHours' || reading.counterType.legacyField === 'aircraftCycles') {
          await tx.aircraftUsageLog.deleteMany({
            where: {
              organizationId: req.organizationId,
              aircraftId: req.params.id,
              date: reading.readingDate,
              notes: `Registrado desde el contador ${reading.counterType.code}`,
            },
          });
          const latestLog = await tx.aircraftUsageLog.findFirst({
            where: { organizationId: req.organizationId, aircraftId: req.params.id },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          });
          if (latestLog) {
            await tx.aircraft.update({
              where: { id: req.params.id },
              data: { totalFlightHours: latestLog.totalHours, totalCycles: latestLog.totalCycles },
            });
          }
        }

        if ((reading.counterType.legacyField === 'engineHours' || reading.counterType.legacyField === 'engineCycles') && reading.engineId) {
          await tx.aircraftEngineUsageLog.deleteMany({
            where: { organizationId: req.organizationId, engineId: reading.engineId, date: reading.readingDate },
          });
        }
      });

      res.status(204).send();
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
          isActive: true,
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

  listEquipmentApplicability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const aircraft = await this.getUseCase.findById(req.params.id, req.organizationId);
      const rows = await prisma.aircraftEquipmentApplicability.findMany({
        where: { organizationId: req.organizationId, aircraftId: aircraft.id },
        include: { changedBy: { select: { id: true, name: true } } },
        orderBy: { equipment: 'asc' },
      });

      res.status(200).json({
        status: 'success',
        data: rows.map((row) => ({
          equipment: row.equipment,
          applies: row.applies,
          notes: row.notes,
          changedAt: row.changedAt,
          changedBy: row.changedBy ? { id: row.changedBy.id, name: row.changedBy.name } : null,
        })),
      });
    } catch (err) { next(err); }
  };

  setEquipmentApplicability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const aircraft = await this.getUseCase.findById(req.params.id, req.organizationId);
      const equipment = req.params.equipment as (typeof DGAC_EQUIPMENT)[number];
      if (!DGAC_EQUIPMENT.includes(equipment)) {
        throw new ValidationError(`Equipo desconocido: ${req.params.equipment}`);
      }
      const body = setEquipmentApplicabilitySchema.parse(req.body);

      const saved = await prisma.aircraftEquipmentApplicability.upsert({
        where: { aircraftId_equipment: { aircraftId: aircraft.id, equipment } },
        create: {
          organizationId: req.organizationId,
          aircraftId: aircraft.id,
          equipment,
          applies: body.applies,
          notes: body.notes ?? null,
          changedById: req.currentUser?.id ?? null,
        },
        update: {
          applies: body.applies,
          notes: body.notes ?? null,
          changedAt: new Date(),
          changedById: req.currentUser?.id ?? null,
        },
        include: { changedBy: { select: { id: true, name: true } } },
      });

      res.status(200).json({
        status: 'success',
        data: {
          equipment: saved.equipment,
          applies: saved.applies,
          notes: saved.notes,
          changedAt: saved.changedAt,
          changedBy: saved.changedBy ? { id: saved.changedBy.id, name: saved.changedBy.name } : null,
        },
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

  /** Reemplaza un motor: el motor actual queda archivado (isActive=false)
   * con todo su historial de horas/ciclos intacto, y se crea uno nuevo en la
   * misma posición. Los slots de contador (EquipmentCounterSlot) que
   * apuntaban al motor viejo pasan a apuntar al nuevo, para no perder esa
   * configuración. */
  replaceEngine = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const aircraft = await this.getUseCase.findById(req.params.id, req.organizationId);
      const oldEngine = await prisma.aircraftEngine.findFirst({
        where: { id: req.params.engineId, aircraftId: aircraft.id, organizationId: req.organizationId },
      });
      if (!oldEngine) throw new NotFoundError('AircraftEngine', req.params.engineId);
      if (!oldEngine.isActive) throw new ValidationError('Este motor ya fue reemplazado antes');

      const body = replaceEngineSchema.parse(req.body);

      const { retired, replacement } = await prisma.$transaction(async (tx) => {
        const retired = await tx.aircraftEngine.update({
          where: { id: oldEngine.id },
          data: { isActive: false, removedAt: body.removalDate ?? new Date(), removalReason: body.removalReason ?? null },
        });

        const replacement = await tx.aircraftEngine.create({
          data: {
            organizationId: req.organizationId,
            aircraftId: aircraft.id,
            position: oldEngine.position,
            manufacturer: body.manufacturer,
            model: body.model,
            serialNumber: body.serialNumber,
          },
        });

        await tx.equipmentCounterSlot.updateMany({
          where: { engineId: oldEngine.id },
          data: { engineId: replacement.id },
        });

        return { retired, replacement };
      });

      res.status(200).json({ status: 'success', data: { retired, replacement } });
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

  getDueReportPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await dueEngineService.getDueReportData(req.organizationId, req.params.id);
      const pdf = await RemanentesDocumentService.renderPdf(req.organizationId, report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Remanentes-${report.aircraft.registration}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };

  /** DGAC IV.5.1.2 — estatus de alteraciones y reparaciones mayores con FMS/ICA. */
  getAlterationsReportPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pdf = await AlterationsDocumentService.generateReport(req.organizationId, req.params.id);
      const aircraft = await prisma.aircraft.findUnique({
        where: { id: req.params.id }, select: { registration: true },
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Alteraciones_${aircraft?.registration ?? req.params.id}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };

  getCounterHistoryReportPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pdf = await CounterHistoryDocumentService.generateReport(req.organizationId, req.params.id);
      const aircraft = await prisma.aircraft.findUnique({ where: { id: req.params.id }, select: { registration: true } });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Registro_Contadores_${aircraft?.registration ?? req.params.id}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  };
}
