import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../../shared/errors/AppError';
import { WorkOrderAutoGeneratorService } from '../../../domain/services/WorkOrderAutoGeneratorService';
import { WorkOrderAssignmentService } from '../../../domain/services/WorkOrderAssignmentService';
import { WorkOrderService } from '../../../domain/services/WorkOrderService';
import { PDFGenerationService } from '../../../domain/services/PDFGenerationService';
import { EmailService } from '../../../domain/services/EmailService';
import { FileStorageService } from '../../../domain/services/FileStorageService';
import { prisma } from '../../database/prisma.client';

const workOrderService = new WorkOrderService();

export class WorkOrderController {
  static async getPendingAssignmentWorkOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.currentUser?.organizationId;
      if (!organizationId) throw new AppError('Organization context required', 401);
      const workOrders = await WorkOrderAutoGeneratorService.getPendingAssignmentWorkOrders(organizationId);
      res.json({ success: true, data: workOrders, count: workOrders.length });
    } catch (error) { next(error); }
  }

  static async assignWorkOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { technicianId, sendEmail = true } = req.body;
      const organizationId = req.currentUser?.organizationId;
      const assignedById = req.currentUser?.id;
      if (!organizationId || !assignedById) throw new AppError('Authentication context required', 401);
      if (!technicianId) throw new AppError('Technician ID is required', 400);

      const workOrder = await prisma.workOrder.findUnique({ where: { id }, include: { aircraft: true } });
      if (!workOrder) throw new AppError('Work Order not found', 404);

      const assignedWO = await WorkOrderAssignmentService.assignToTechnician(id, technicianId, organizationId, assignedById);
      const technician = await prisma.user.findUnique({ where: { id: technicianId } });
      if (!technician) throw new AppError('Technician not found', 404);

      let pdfPath: string | undefined;
      try {
        const pdfBuffer = await PDFGenerationService.generateWorkOrderPdf(id);
        pdfPath = await PDFGenerationService.savePdfToFile(pdfBuffer, `WO-${assignedWO.number}.pdf`);
      } catch (pdfErr) {
        console.error('PDF generation failed:', pdfErr);
      }

      if (sendEmail) {
        try {
          EmailService.initialize();
          await EmailService.sendWorkOrderAssignmentNotification(
            technician.email, technician.name, assignedWO.number,
            workOrder.aircraft.registration, workOrder.aircraft.model,
            assignedWO.plannedEndDate || new Date(), pdfPath
          );
        } catch (emailErr) { console.error('Email failed:', emailErr); }
      }

      res.json({ success: true, message: 'Work Order assigned successfully', data: assignedWO });
    } catch (error) { next(error); }
  }

  static async startExecution(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.currentUser?.organizationId;
      const technicianId = req.currentUser?.id;
      if (!organizationId || !technicianId) throw new AppError('Authentication context required', 401);
      const workOrder = await WorkOrderAssignmentService.startExecution(id, technicianId, organizationId);
      res.json({ success: true, message: 'Execution started', data: workOrder });
    } catch (error) { next(error); }
  }

  static async uploadEvidence(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.currentUser?.organizationId;
      const technicianId = req.currentUser?.id;
      if (!organizationId || !technicianId) throw new AppError('Authentication context required', 401);
      if (!req.file) throw new AppError('File is required', 400);

      const workOrder = await prisma.workOrder.findUnique({ where: { id } });
      if (!workOrder) throw new AppError('Work Order not found', 404);
      if (workOrder.assignedTechnicianId !== technicianId) throw new AppError('Unauthorized: not assigned', 403);

      if (!FileStorageService.validateFileType(req.file.originalname)) throw new AppError('Invalid file type', 400);
      if (!FileStorageService.validateFileSize(req.file.size)) throw new AppError('File too large (max 10MB)', 400);

      const uploadResult = await FileStorageService.uploadEvidenceFile(req.file.buffer, id, req.file.originalname, organizationId);

      const updatedWO = await prisma.workOrder.update({
        where: { id },
        data: {
          evidenceFileUrl: uploadResult.url,
          evidenceFileName: uploadResult.originalName,
          evidenceUploadedAt: uploadResult.uploadedAt,
          evidenceUploadedBy: technicianId,
          evidenceType: req.file.originalname.toLowerCase().endsWith('.pdf') ? 'PDF' : 'PHOTO',
          assignmentStatus: 'EVIDENCE_UPLOADED',
        },
      });

      res.json({ success: true, message: 'Evidence uploaded successfully', data: { workOrder: updatedWO, fileInfo: uploadResult } });
    } catch (error) { next(error); }
  }

  static async closeWorkOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.currentUser?.organizationId;
      const userId = req.currentUser?.id;
      const userRole = req.currentUser?.role;
      const userEmail = req.currentUser?.email;
      if (!organizationId || !userId) throw new AppError('Authentication context required', 401);
      if (!userRole || !userEmail) throw new AppError('Authentication context incomplete', 401);

      const workOrder = await prisma.workOrder.findUnique({
        where: { id },
        include: { aircraft: true, tasks: { include: { task: true } }, assignedTechnician: true },
      });
      if (!workOrder) throw new AppError('Work Order not found', 404);
      if (!workOrder.evidenceFileUrl) throw new AppError('Cannot close: Evidence upload is required', 400);
      if (workOrder.assignmentStatus !== 'EVIDENCE_UPLOADED') {
        throw new AppError(`Cannot close: WO must be EVIDENCE_UPLOADED (currently: ${workOrder.assignmentStatus})`, 400);
      }

      await workOrderService.transition(id, 'CLOSED', organizationId, {
        id: userId,
        email: userEmail,
        role: userRole,
      });

      const closedWO = await prisma.workOrder.update({
        where: { id },
        data: {
          assignmentStatus: 'CLOSED',
        },
      });

      const supervisor = await prisma.user.findFirst({
        where: { organizationId, isActive: true, role: 'SUPERVISOR' },
      });
      if (supervisor && workOrder.assignedTechnician) {
        try {
          EmailService.initialize();
          await EmailService.sendWorkOrderClosedNotification(
            supervisor.email, supervisor.name, closedWO.number,
            workOrder.aircraft.registration, workOrder.assignedTechnician.name
          );
        } catch (emailErr) { console.error('Close notification failed:', emailErr); }
      }

      res.json({ success: true, message: 'Work Order closed successfully', data: closedWO });
    } catch (error) { next(error); }
  }

  static async generatePendingWorkOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { aircraftId } = req.params;
      const organizationId = req.currentUser?.organizationId;
      const userId = req.currentUser?.id;
      if (!organizationId || !userId) throw new AppError('Authentication context required', 401);

      const dueTasks = await WorkOrderAutoGeneratorService.findTasksDueSoon(aircraftId, organizationId);
      const createdWorkOrders = [];
      for (const task of dueTasks) {
        try {
          const wo = await WorkOrderAutoGeneratorService.generateWorkOrder(aircraftId, task.taskId, organizationId, userId);
          createdWorkOrders.push(wo);
        } catch (woErr) { console.error(`Failed to generate WO for task ${task.taskId}:`, woErr); }
      }

      res.json({
        success: true,
        message: `Generated ${createdWorkOrders.length} work order(s)`,
        data: { generatedCount: createdWorkOrders.length, workOrders: createdWorkOrders, dueTasks },
      });
    } catch (error) { next(error); }
  }

  static async downloadWorkOrderPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.currentUser?.organizationId;
      if (!organizationId) throw new AppError('Authentication context required', 401);

      const workOrder = await prisma.workOrder.findUnique({ where: { id } });
      if (!workOrder) throw new AppError('Work Order not found', 404);
      if (workOrder.organizationId !== organizationId) throw new AppError('Unauthorized', 403);

      const pdfBuffer = await PDFGenerationService.generateWorkOrderPdf(id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="WO-${workOrder.number}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) { next(error); }
  }

  static async emailWorkOrderPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { email } = req.body;
      const organizationId = req.currentUser?.organizationId;
      if (!organizationId) throw new AppError('Authentication context required', 401);
      if (!email) throw new AppError('Email address is required', 400);

      const workOrder = await prisma.workOrder.findUnique({ where: { id }, include: { aircraft: true } });
      if (!workOrder) throw new AppError('Work Order not found', 404);
      if (workOrder.organizationId !== organizationId) throw new AppError('Unauthorized', 403);

      const pdfBuffer = await PDFGenerationService.generateWorkOrderPdf(id);
      const pdfPath = await PDFGenerationService.savePdfToFile(pdfBuffer, `WO-${workOrder.number}.pdf`);

      EmailService.initialize();
      await EmailService.sendWorkOrderAssignmentNotification(
        email, 'Recipient', workOrder.number,
        workOrder.aircraft.registration, workOrder.aircraft.model,
        workOrder.plannedEndDate || new Date(), pdfPath
      );

      res.json({ success: true, message: 'PDF sent successfully' });
    } catch (error) { next(error); }
  }

  static async getAvailableTechnicians(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.currentUser?.organizationId;
      if (!organizationId) throw new AppError('Authentication context required', 401);
      const technicians = await WorkOrderAssignmentService.getAvailableTechnicians(organizationId);
      res.json({ status: 'ok', data: technicians });
    } catch (error) { next(error); }
  }
}
