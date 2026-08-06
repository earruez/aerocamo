import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { PrismaAircraftRepository } from '../../database/repositories/PrismaAircraftRepository';
import { WorkRequestService } from '../../../domain/services/WorkRequestService';
import { FileStorageService } from '../../../domain/services/FileStorageService';
import { AppError } from '../../../shared/errors/AppError';

const createWorkRequestSchema = z.object({
  aircraftId: z.string().uuid(),
  taskIds: z.array(z.string().uuid()).min(1),
  responsibleId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  autoSend: z.boolean().optional().default(false),
});

const closeComplianceSchema = z.object({
  aircraftHoursAtClose: z.coerce.number().nonnegative().optional(),
  aircraftCyclesN1AtClose: z.coerce.number().int().nonnegative().optional(),
  aircraftCyclesN2AtClose: z.coerce.number().int().nonnegative().optional(),
  closedAt: z.coerce.date().optional(),
  notes: z.string().max(3000).optional(),
  evidenceUrl: z.string().url().optional(),
  evidenceFileName: z.string().max(255).optional(),
});

const aircraftRepo = new PrismaAircraftRepository();

type RiskBucket = 'danger' | 'warning' | 'healthy';

function classifyByRemaining(
  hoursRemaining: number | null,
  daysRemaining: number | null,
  cyclesRemaining: number | null,
): { bucket: RiskBucket; selectedRemaining: number | null; selectedUnit: 'FH' | 'DAYS' | 'CYCLES' | 'N/A' } {
  const candidates: Array<{ value: number; unit: 'FH' | 'DAYS' | 'CYCLES' }> = [];
  if (hoursRemaining != null) candidates.push({ value: hoursRemaining, unit: 'FH' });
  if (daysRemaining != null) candidates.push({ value: daysRemaining, unit: 'DAYS' });
  if (cyclesRemaining != null) candidates.push({ value: cyclesRemaining, unit: 'CYCLES' });

  if (candidates.length === 0) {
    return { bucket: 'healthy', selectedRemaining: null, selectedUnit: 'N/A' };
  }

  const selected = candidates.reduce((min, cur) => (cur.value < min.value ? cur : min));

  if (selected.value <= 0) {
    return { bucket: 'danger', selectedRemaining: selected.value, selectedUnit: selected.unit };
  }

  if ((selected.unit === 'FH' && selected.value <= 50) || (selected.unit === 'DAYS' && selected.value <= 30)) {
    return { bucket: 'warning', selectedRemaining: selected.value, selectedUnit: selected.unit };
  }

  return { bucket: 'healthy', selectedRemaining: selected.value, selectedUnit: selected.unit };
}

function formatInterval(item: {
  intervalHours: number | null;
  intervalCycles: number | null;
  intervalCalendarDays: number | null;
  intervalCalendarMonths: number | null;
}): string {
  if (item.intervalHours != null && item.intervalHours > 0) return `${item.intervalHours}h`;
  if (item.intervalCycles != null && item.intervalCycles > 0) return `${item.intervalCycles} ciclos`;
  if (item.intervalCalendarMonths != null && item.intervalCalendarMonths > 0) return `${item.intervalCalendarMonths}m`;
  if (item.intervalCalendarDays != null && item.intervalCalendarDays > 0) return `${item.intervalCalendarDays} dias`;
  return 'N/A';
}

function formatGoal(item: { nextDueHours: number | null; nextDueDate: Date | null; nextDueCycles: number | null }): string {
  if (item.nextDueHours != null) return `${item.nextDueHours.toFixed(1)}h`;
  if (item.nextDueCycles != null) return `${item.nextDueCycles} ciclos`;
  if (item.nextDueDate) return item.nextDueDate.toISOString().slice(0, 10);
  return 'Sin meta';
}

function formatRemaining(item: { hoursRemaining: number | null; daysRemaining: number | null; cyclesRemaining: number | null }): string {
  if (item.hoursRemaining != null) return `${item.hoursRemaining.toFixed(1)}h`;
  if (item.cyclesRemaining != null) return `${item.cyclesRemaining} ciclos`;
  if (item.daysRemaining != null) return `${item.daysRemaining} dias`;
  return 'N/A';
}

export class GrisselleMroController {
  static async getEngineeringGrid(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const aircraft = await aircraftRepo.findById(req.params.id, req.organizationId);
      if (!aircraft) throw new AppError('Aeronave no encontrada', 404);

      const plan = await aircraftRepo.getMaintenancePlan(req.params.id, req.organizationId);

      const withRisk = plan.map((item) => {
        const risk = classifyByRemaining(item.hoursRemaining, item.daysRemaining, item.cyclesRemaining);
        const ultimoCumplimiento = item.lastPerformedAt
          ? item.lastPerformedAt.toISOString().slice(0, 10)
          : item.controlStartAt
            ? `Inicio de control: ${item.controlStartAt.toISOString().slice(0, 10)}`
            : 'Sin registro';
        return {
          tareaId: item.taskId,
          ata: item.taskCode,
          descripcion: item.taskTitle,
          intervalo: formatInterval(item),
          ultimoCumplimiento,
          meta: formatGoal(item),
          remanente: formatRemaining(item),
          estado: item.status,
          riesgo: risk.bucket,
          remanenteSeleccionado: risk.selectedRemaining,
          unidadSeleccionada: risk.selectedUnit,
          trazabilidad: {
            endpoint: `/api/historial/${item.taskId}`,
            texto: 'Ver Log',
          },
        };
      });

      const riskOrder: Record<RiskBucket, number> = { danger: 0, warning: 1, healthy: 2 };
      const grid = [...withRisk].sort((a, b) => riskOrder[a.riesgo] - riskOrder[b.riesgo]);
      const danger = grid.filter((item) => item.riesgo === 'danger');
      const warning = grid.filter((item) => item.riesgo === 'warning');
      const healthy = grid.filter((item) => item.riesgo === 'healthy');

      res.json({
        status: 'success',
        data: {
          encabezado: {
            matricula: aircraft.registration,
            contadoresActuales: {
              flightHours: Number(aircraft.totalFlightHours),
              cyclesN1: aircraft.totalCycles,
              cyclesN2: aircraft.totalCycles,
            },
            reporteDgacEndpoint: `/api/v1/work-requests/aircraft/${aircraft.id}/airworthiness-history`,
          },
          grillaIngenieria: grid,
          clasificacion: {
            danger,
            warning,
            healthy,
          },
        },
      });
    } catch (err) { next(err); }
  }

  static async createWorkRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createWorkRequestSchema.parse(req.body);
      const created = await WorkRequestService.createDraft({
        aircraftId: body.aircraftId,
        taskIds: body.taskIds,
        organizationId: req.organizationId,
        createdById: req.currentUser.id,
      });

      let updated = created;
      if (body.responsibleId !== undefined || body.notes !== undefined) {
        await WorkRequestService.updateDraft(created.id, req.organizationId, {
          responsibleId: body.responsibleId,
          notes: body.notes,
        });
        updated = await WorkRequestService.getById(created.id, req.organizationId);
      }

      if (body.autoSend) {
        const sent = await WorkRequestService.send(created.id, req.organizationId, req.currentUser.id);
        res.status(201).json({ status: 'success', message: 'ST creada y enviada', data: sent });
        return;
      }

      res.status(201).json({ status: 'success', message: 'ST creada desde seleccion de grilla', data: updated });
    } catch (err) { next(err); }
  }

  static async closeCompliance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = closeComplianceSchema.parse(req.body);
      const wr = await WorkRequestService.getById(req.params.id, req.organizationId);

      let evidenceFileUrl = body.evidenceUrl;
      let evidenceFileName = body.evidenceFileName;

      if (req.file) {
        const uploadResult = await FileStorageService.uploadEvidenceFile(
          req.file.buffer,
          req.params.id,
          req.file.originalname,
          req.organizationId,
        );
        evidenceFileUrl = uploadResult.url;
        evidenceFileName = uploadResult.originalName;
      }

      if (!evidenceFileUrl || !evidenceFileName) {
        throw new AppError('Debe adjuntar evidencia documental (foto/PDF de OT firmada)', 400);
      }

      const result = await WorkRequestService.closeAndComply({
        workRequestId: req.params.id,
        organizationId: req.organizationId,
        user: {
          id: req.currentUser.id,
          email: req.currentUser.email,
          role: req.currentUser.role,
        },
        aircraftHoursAtClose: body.aircraftHoursAtClose ?? Number(wr.aircraft.totalFlightHours),
        aircraftCyclesN1AtClose: body.aircraftCyclesN1AtClose ?? wr.aircraft.totalCycles,
        aircraftCyclesN2AtClose: body.aircraftCyclesN2AtClose ?? wr.aircraft.totalCycles,
        closedAt: body.closedAt,
        evidenceFileUrl,
        evidenceFileName,
        notes: body.notes,
      });

      res.json({ status: 'success', message: 'ST cerrada y cumplimiento registrado', data: result });
    } catch (err) { next(err); }
  }

  static async getTaskHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tareaId } = req.params;

      const [compliances, auditEntries] = await Promise.all([
        prisma.compliance.findMany({
          where: { organizationId: req.organizationId, taskId: tareaId },
          include: {
            performedBy: { select: { id: true, name: true, email: true, role: true } },
          },
          orderBy: { performedAt: 'desc' },
          take: 300,
        }),
        prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId,
            OR: [{ entityId: tareaId }, { metadata: { path: ['taskId'], equals: tareaId } as never }],
          },
          orderBy: { createdAt: 'desc' },
          take: 300,
        }),
      ]);

      const complianceEvents = compliances.map((row) => {
        const doc = row.notes?.match(/Archivo\s([^|]+)/i)?.[1]?.trim() ?? row.workOrderNumber ?? null;
        const note = row.notes?.trim() || null;
        return {
          tipo: 'CUMPLIMIENTO',
          fecha: row.performedAt,
          usuario: row.performedBy.name,
          usuarioEmail: row.performedBy.email,
          accion: 'Cumplimiento de inspeccion',
          documento: doc,
          nota: note,
          detalle: {
            complianceId: row.id,
            workOrderNumber: row.workOrderNumber,
          },
        };
      });

      const auditEvents = auditEntries.map((row) => ({
        tipo: 'AUDITORIA',
        fecha: row.createdAt,
        usuario: row.userEmail,
        usuarioEmail: row.userEmail,
        accion: row.action,
        documento: null,
        nota: typeof row.metadata === 'object' && row.metadata && 'message' in (row.metadata as object)
          ? String((row.metadata as Record<string, unknown>).message)
          : null,
        detalle: {
          auditLogId: row.id,
          previousValue: row.previousValue,
          newValue: row.newValue,
        },
      }));

      const timeline = [...complianceEvents, ...auditEvents]
        .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
        .map((event) => ({ ...event, fecha: event.fecha.toISOString() }));

      res.json({
        status: 'success',
        data: {
          tareaId,
          totalEventos: timeline.length,
          eventos: timeline,
        },
      });
    } catch (err) { next(err); }
  }
}