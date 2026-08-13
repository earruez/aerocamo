// ─────────────────────────────────────────────────────────────────────────────
//  Work Order routes
//  Base: /api/v1/work-orders
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { WorkOrderController } from '../controllers/WorkOrderController';
import { DiscrepancyController } from '../controllers/DiscrepancyController';
import { AuditLogController } from '../controllers/AuditLogController';
import { DocumentController } from '../controllers/DocumentController';

const router = Router();
const wo   = new WorkOrderController();
const disc = new DiscrepancyController();
const audit = new AuditLogController();
const doc  = new DocumentController();

router.use(authMiddleware);
router.use(tenantMiddleware);

// ── Work Order CRUD ────────────────────────────────────────────────────────
router.get('/state-machine', wo.stateMachine);
router.get('/',             wo.list);
router.post('/',            requireRoles('ADMIN', 'SUPERVISOR'), wo.create);
router.get('/:id',          wo.getById);
router.patch('/:id',        requireRoles('ADMIN', 'SUPERVISOR'), wo.update);

// ── State machine ──────────────────────────────────────────────────────────
// El rol correcto por transición ya lo exige assertWorkOrderTransitionRole
// dentro del servicio (varía según el estado origen/destino).
router.post('/:id/transition', wo.transition);

// ── Task management within WO ──────────────────────────────────────────────
router.post('/:id/tasks',   requireRoles('ADMIN', 'SUPERVISOR'), wo.addTask);
router.delete('/:id/tasks/:taskId', requireRoles('ADMIN', 'SUPERVISOR'), wo.removeTask);
router.post('/:id/tasks/:taskId/complete', requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'), wo.completeTask);

// ── Discrepancies ──────────────────────────────────────────────────────────
router.get('/:workOrderId/discrepancies',         disc.listForWorkOrder);
router.post('/:workOrderId/discrepancies',         requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'INSPECTOR'), disc.create);
router.get('/discrepancies/:id',                  disc.getById);
router.patch('/discrepancies/:id',                requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'INSPECTOR'), disc.update);

// ── Audit log ──────────────────────────────────────────────────────────────
router.get('/:id/audit-log', audit.getForWorkOrder);

// ── Document generation ────────────────────────────────────────────────────
router.get('/:id/document', doc.generateOTSummary);

export { router as workOrderRoutes };
