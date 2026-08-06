import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { AircraftController } from '../controllers/AircraftController';
import {
  CreateAircraftUseCase,
  GetAircraftUseCase,
  UpdateAircraftUseCase,
  GetMaintenancePlanUseCase,
  DeleteAircraftUseCase,
} from '../../../application/aircraft/AircraftUseCases';
import { PrismaAircraftRepository } from '../../database/repositories/PrismaAircraftRepository';

const router = Router();
const repo = new PrismaAircraftRepository();
const ctrl = new AircraftController(
  new CreateAircraftUseCase(repo),
  new GetAircraftUseCase(repo),
  new UpdateAircraftUseCase(repo),
  new GetMaintenancePlanUseCase(repo),
  new DeleteAircraftUseCase(repo),
);

router.use(authMiddleware, tenantMiddleware);
router.get('/', ctrl.findAll);
router.get('/:id/maintenance-plan', ctrl.getMaintenancePlan);
router.get('/:id/due-summary', ctrl.getDueSummary);
router.get('/:id/due-rows', ctrl.getDueRows);
router.get('/:id/due-report-data', ctrl.getDueReportData);
router.get('/:id/usage-history', ctrl.getUsageHistory);
router.get('/:id/engines', ctrl.listEngines);
router.get('/:id', ctrl.findById);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.post('/:id/usage-history', ctrl.createUsageLog);
router.post('/:id/engines', ctrl.createEngine);
router.post('/:id/engines/:engineId/usage-history', ctrl.createEngineUsageLog);

export { router as aircraftRoutes };
