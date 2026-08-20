import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { TaskController } from '../controllers/TaskController';

const router = Router();
const ctrl = new TaskController();

router.use(authMiddleware, tenantMiddleware);
router.get('/', ctrl.listAll);
router.post('/', ctrl.create);
router.get('/:id/fleet-siblings', ctrl.fleetSiblings);
router.patch('/:id', ctrl.update);

// Aircraft plan management
router.post('/aircraft/:aircraftId/assign', ctrl.assignToAircraft);
router.patch('/aircraft/:aircraftId/tasks/:taskId/applicability', ctrl.setApplicability);
router.delete('/aircraft/:aircraftId/tasks/:taskId', ctrl.removeFromAircraft);

export { router as taskRoutes };
