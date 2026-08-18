import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { ReportsController } from '../controllers/ReportsController';

const router = Router();
const ctrl = new ReportsController();

router.use(authMiddleware, tenantMiddleware);

router.get('/fleet-summary.pdf', ctrl.getFleetSummaryPdf);
router.get('/compliance-history.pdf', ctrl.getComplianceHistoryPdf);
router.get('/fleet-lookahead.pdf', ctrl.getFleetLookaheadPdf);

export { router as reportsRoutes };
