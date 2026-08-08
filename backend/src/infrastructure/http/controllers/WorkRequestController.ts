import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { WorkRequestService } from '../../../domain/services/WorkRequestService';
import { WorkRequestDocumentService } from '../../../domain/services/WorkRequestDocumentService';
import { EmailService } from '../../../domain/services/EmailService';
import { FileStorageService } from '../../../domain/services/FileStorageService';
import { WORK_REQUEST_STATE_MACHINE } from '../../../domain/workflows/stateMachines';

const createSchema = z.object({
  aircraftId: z.string().uuid(),
  taskIds: z.array(z.string().uuid()).optional(),
});

const updateSchema = z.object({
  responsibleId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const addItemSchema = z.object({
  taskId: z.string().uuid().optional(),
  componentId: z.string().uuid().optional(),
  discrepancyId: z.string().uuid().optional(),
  sourceKind: z.enum(['maintenance_plan', 'component_inspection', 'discrepancy', 'compliance_due', 'manual']).optional(),
  sourceId: z.string().min(1).max(100).optional(),
  executionType: z.enum(['maintenance_application', 'component_replacement', 'discrepancy_action']).nullable().optional(),
  requiresComponentTracking: z.boolean().optional(),
  componentDefinitionId: z.string().uuid().nullable().optional(),
  category: z.enum(['MAINTENANCE_PLAN', 'NORMATIVE', 'COMPONENT_INSPECTION', 'DISCREPANCY', 'OTHER']).optional(),
  code: z.string().max(100).nullable().optional(),
  title: z.string().max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  source: z.string().max(20).optional(),
});
const emailSchema = z.object({ email: z.string().email().optional() });
const closeAndComplySchema = z.object({
  aircraftHoursAtClose: z.coerce.number().nonnegative().optional(),
  aircraftCyclesN1AtClose: z.coerce.number().int().nonnegative().optional(),
  aircraftCyclesN2AtClose: z.coerce.number().int().nonnegative().optional(),
  closedAt: z.coerce.date().optional(),
  notes: z.string().max(3000).optional(),
  evidenceUrl: z.string().url().optional(),
  evidenceFileName: z.string().max(255).optional(),
});

const executionEligibilityQuerySchema = z.object({
  sourceKind: z.enum(['maintenance_plan', 'component_inspection', 'discrepancy', 'compliance_due', 'manual']),
  sourceId: z.string().min(1).max(100),
  executionType: z.enum(['maintenance_application', 'component_replacement', 'discrepancy_action']),
  requiredComponentSourceId: z.string().min(1).max(100).optional(),
});

export class WorkRequestController {
  static async stateMachine(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ status: 'success', data: WORK_REQUEST_STATE_MACHINE });
    } catch (err) { next(err); }
  }

  static async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dispatch = z.object({
        repairShopId: z.string().uuid().nullable().optional(),
        repairShopContactId: z.string().uuid().nullable().optional(),
        dispatchMethod: z.enum(['EMAIL', 'MANUAL']).nullable().optional(),
        dispatchNotes: z.string().max(2000).nullable().optional(),
      }).parse(req.body ?? {});
      const data = await WorkRequestService.send(
        req.params.id, req.organizationId, req.currentUser.id, dispatch,
      );
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async createDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { aircraftId, taskIds } = createSchema.parse(req.body);
      const wr = await WorkRequestService.createDraft({
        aircraftId,
        taskIds,
        organizationId: req.organizationId,
        createdById: req.currentUser.id,
      });
      res.status(201).json({ status: 'success', data: wr });
    } catch (err) { next(err); }
  }

  static async listByAircraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await WorkRequestService.listByAircraft(req.params.aircraftId, req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await WorkRequestService.getById(req.params.id, req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async updateDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = updateSchema.parse(req.body);
      const data = await WorkRequestService.updateDraft(req.params.id, req.organizationId, body);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = addItemSchema.parse(req.body);
      const data = await WorkRequestService.addItem(req.params.id, req.organizationId, body);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await WorkRequestService.removeItem(req.params.id, req.params.itemId, req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async listCatalog(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const data = await WorkRequestService.getCatalog(req.params.aircraftId, req.organizationId, search);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async executionEligibility(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = executionEligibilityQuerySchema.parse(req.query);
      const data = await WorkRequestService.getExecutionEligibility({
        organizationId: req.organizationId,
        aircraftId: req.params.aircraftId,
        sourceKind: query.sourceKind,
        sourceId: query.sourceId,
        executionType: query.executionType,
        requiredComponentSourceId: query.requiredComponentSourceId,
      });
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async listResponsibles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await WorkRequestService.listResponsibles(req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async submitForReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reviewerId } = z.object({ reviewerId: z.string().uuid() }).parse(req.body);
      const data = await WorkRequestService.submitForReview({
        workRequestId: req.params.id,
        organizationId: req.organizationId,
        reviewerId,
        actorId: req.currentUser.id,
      });
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async reviewDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = z.object({
        approved: z.boolean(),
        reviewNotes: z.string().max(2000).optional().nullable(),
      }).parse(req.body);
      const data = await WorkRequestService.approveReview({
        workRequestId: req.params.id,
        organizationId: req.organizationId,
        actorId: req.currentUser.id,
        approved: body.approved,
        reviewNotes: body.reviewNotes ?? null,
      });
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async registerReceivedOt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = z.object({
        otNumber: z.string().trim().min(1).max(80),
        otReceivedAt: z.coerce.date().optional().nullable(),
        otDocumentUrl: z.string().max(1000).optional().nullable(),
      }).parse(req.body);
      const data = await WorkRequestService.registerReceivedOt({
        workRequestId: req.params.id,
        organizationId: req.organizationId,
        actorId: req.currentUser.id,
        otNumber: body.otNumber,
        otReceivedAt: body.otReceivedAt ?? null,
        otDocumentUrl: body.otDocumentUrl ?? (req.file ? `/uploads/${req.file.filename}` : null),
      });
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async generatePdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const wr = await WorkRequestService.getById(req.params.id, req.organizationId);
      const pdf = await WorkRequestDocumentService.generateSTDocument(wr.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${wr.number}.pdf"`);
      res.send(pdf);
    } catch (err) { next(err); }
  }

  static async sendEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = emailSchema.parse(req.body);
      const wr = await WorkRequestService.getById(req.params.id, req.organizationId);
      const pdf = await WorkRequestDocumentService.generateSTDocument(wr.id);
      const pdfPath = await WorkRequestDocumentService.savePdfToFile(pdf, `${wr.number}.pdf`);

      const target = email ?? wr.responsible?.email;
      if (!target) throw new Error('No se encontró email de responsable');

      EmailService.initialize();
      await EmailService.sendWorkRequestNotification({
        to: target,
        responsibleName: wr.responsible?.name ?? 'Responsable',
        workRequestNumber: wr.number,
        aircraftRegistration: wr.aircraft.registration,
        aircraftModel: wr.aircraft.model,
        pdfAttachmentPath: pdfPath,
      });

      res.json({ status: 'success', message: 'Correo enviado', data: { workRequestId: wr.id } });
    } catch (err) { next(err); }
  }

  static async runDailyJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await WorkRequestService.runDailyAutoGenerationForAllOrganizations();
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async closeAndComply(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = closeAndComplySchema.parse(req.body);

      let evidenceFileUrl = body.evidenceUrl;
      let evidenceFileName = body.evidenceFileName;

      if (req.file) {
        const uploaded = await FileStorageService.uploadEvidenceFile(
          req.file.buffer,
          req.params.id,
          req.file.originalname,
          req.organizationId,
        );
        evidenceFileUrl = uploaded.url;
        evidenceFileName = uploaded.originalName;
      }

      // Si la OT firmada ya se cargó al registrarla como recibida, sirve como
      // evidencia del cierre: pedirla dos veces es fricción sin respaldo extra.
      if (!evidenceFileUrl || !evidenceFileName) {
        const registered = await WorkRequestService.getById(req.params.id, req.organizationId);
        if (registered.otDocumentUrl) {
          evidenceFileUrl = registered.otDocumentUrl;
          evidenceFileName = registered.otNumber
            ? `OT ${registered.otNumber}`
            : 'OT recibida';
        }
      }

      if (!evidenceFileUrl || !evidenceFileName) {
        res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Debe adjuntar la OT firmada, o registrarla primero como OT recibida',
        });
        return;
      }

      const data = await WorkRequestService.closeAndComply({
        workRequestId: req.params.id,
        organizationId: req.organizationId,
        user: {
          id: req.currentUser.id,
          email: req.currentUser.email,
          role: req.currentUser.role,
        },
        aircraftHoursAtClose: body.aircraftHoursAtClose,
        aircraftCyclesN1AtClose: body.aircraftCyclesN1AtClose,
        aircraftCyclesN2AtClose: body.aircraftCyclesN2AtClose,
        closedAt: body.closedAt,
        evidenceFileUrl,
        evidenceFileName,
        notes: body.notes,
      });

      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }

  static async airworthinessHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await WorkRequestService.getAirworthinessHistory(req.params.aircraftId, req.organizationId);
      res.json({ status: 'success', data });
    } catch (err) { next(err); }
  }
}
