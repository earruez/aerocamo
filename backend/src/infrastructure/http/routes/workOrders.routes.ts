// ─────────────────────────────────────────────────────────────────────────────
//  Work Order routes
//  Base: /api/v1/work-orders
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
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
router.post('/',            wo.create);
router.get('/:id',          wo.getById);
router.patch('/:id',        wo.update);

// ── State machine ──────────────────────────────────────────────────────────
router.post('/:id/transition', wo.transition);

// ── Task management within WO ──────────────────────────────────────────────
router.post('/:id/tasks',   wo.addTask);
router.delete('/:id/tasks/:taskId', wo.removeTask);
router.post('/:id/tasks/:taskId/complete', wo.completeTask);

// ── Discrepancies ──────────────────────────────────────────────────────────
router.get('/:workOrderId/discrepancies',         disc.listForWorkOrder);
router.post('/:workOrderId/discrepancies',         disc.create);
router.get('/discrepancies/:id',                  disc.getById);
router.patch('/discrepancies/:id',                disc.update);

// ── Audit log ──────────────────────────────────────────────────────────────
router.get('/:id/audit-log', audit.getForWorkOrder);

// ── Document generation ────────────────────────────────────────────────────
router.get('/:id/document', doc.generateOTSummary);

export { router as workOrderRoutes };
