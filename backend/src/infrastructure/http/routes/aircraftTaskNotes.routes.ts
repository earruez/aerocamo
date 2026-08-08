import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { AircraftTaskNoteController } from '../controllers/AircraftTaskNoteController';

const router = Router();
const ctrl = new AircraftTaskNoteController();

router.use(authMiddleware, tenantMiddleware);

router.get('/aircraft/:aircraftId/task-notes', ctrl.countsByAircraft);
router.get('/aircraft/:aircraftId/task/:taskId/notes', ctrl.listForTask);
router.post('/aircraft/:aircraftId/task/:taskId/notes', ctrl.create);
router.patch('/task-notes/:id', ctrl.update);
router.delete('/task-notes/:id', ctrl.remove);

export { router as aircraftTaskNoteRoutes };
