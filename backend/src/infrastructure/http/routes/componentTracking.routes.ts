import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { ComponentTrackingController } from '../controllers/ComponentTrackingController';

const router = Router();
const ctrl = new ComponentTrackingController();

router.use(authMiddleware, tenantMiddleware);

router.get('/tracking/definitions', ctrl.listDefinitions);
router.post('/tracking/definitions', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.createDefinition);

router.get('/tracking/instances', ctrl.listInstances);
router.post('/tracking/instances', requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'), ctrl.createInstance);

router.get('/tracking/applications', ctrl.listApplications);
router.post('/tracking/applications', requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'INSPECTOR'), ctrl.createApplication);

router.get('/tracking/movements', ctrl.listMovements);
router.post('/tracking/movements', requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'), ctrl.createMovement);

export { router as componentTrackingRoutes };
