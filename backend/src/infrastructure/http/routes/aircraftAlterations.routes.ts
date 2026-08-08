import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { AircraftAlterationController } from '../controllers/AircraftAlterationController';

const router = Router();
const ctrl = new AircraftAlterationController();

router.use(authMiddleware, tenantMiddleware);

router.get('/aircraft/:aircraftId/alterations', ctrl.listByAircraft);
router.post('/aircraft/:aircraftId/alterations', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.create);
router.patch('/alterations/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.update);
router.delete('/alterations/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.remove);

export { router as aircraftAlterationRoutes };
