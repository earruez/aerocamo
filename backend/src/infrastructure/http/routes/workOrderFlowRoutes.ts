import { Router } from 'express';
import { WorkOrderController } from '../controllers/WorkOrderFlowController';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { upload } from '../middlewares/upload';

/**
 * Work Order Flow Routes
 * Gestiona el flujo de trabajo completo de OT
 */
export const workOrderFlowRouter = Router();

// Middleware de autenticación en todas las rutas
workOrderFlowRouter.use(authMiddleware);

/**
 * GET /api/v1/work-orders/pending-assignment
 * Obtener OT pendientes de asignación
 */
workOrderFlowRouter.get('/pending-assignment', WorkOrderController.getPendingAssignmentWorkOrders);

/**
 * GET /api/v1/work-orders/available-technicians
 * Obtener técnicos disponibles para asignación
 */
workOrderFlowRouter.get('/available-technicians', WorkOrderController.getAvailableTechnicians);

/**
 * POST /api/v1/work-orders/:id/assign
 * Asignar OT a técnico
 */
workOrderFlowRouter.post('/:id/assign', requireRoles('ADMIN', 'SUPERVISOR'), WorkOrderController.assignWorkOrder);

/**
 * POST /api/v1/work-orders/:id/start-execution
 * Técnico inicia ejecución
 */
workOrderFlowRouter.post('/:id/start-execution', requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'), WorkOrderController.startExecution);

/**
 * POST /api/v1/work-orders/:id/upload-evidence
 * Subir evidencia fotográfica/PDF
 */
workOrderFlowRouter.post(
  '/:id/upload-evidence',
  requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'),
  upload.single('evidence'),
  WorkOrderController.uploadEvidence
);

/**
 * POST /api/v1/work-orders/:id/close
 * Cerrar OT (requiere evidencia)
 */
workOrderFlowRouter.post('/:id/close', requireRoles('ADMIN', 'INSPECTOR'), WorkOrderController.closeWorkOrder);

/**
 * POST /api/v1/work-orders/:aircraftId/generate-pending
 * Generar OT automáticamente para tareas próximas
 */
workOrderFlowRouter.post('/:aircraftId/generate-pending', requireRoles('ADMIN', 'SUPERVISOR'), WorkOrderController.generatePendingWorkOrders);

/**
 * GET /api/v1/work-orders/:id/download-pdf
 * Descargar PDF de OT
 */
workOrderFlowRouter.get('/:id/download-pdf', WorkOrderController.downloadWorkOrderPdf);

/**
 * POST /api/v1/work-orders/:id/email-pdf
 * Enviar PDF por email
 */
workOrderFlowRouter.post('/:id/email-pdf', requireRoles('ADMIN', 'SUPERVISOR'), WorkOrderController.emailWorkOrderPdf);
