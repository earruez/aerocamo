import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { ComplianceController } from '../controllers/ComplianceController';
import { RecordComplianceUseCase, GetComplianceUseCase } from '../../../application/maintenance/ComplianceUseCases';
import { PrismaComplianceRepository } from '../../database/repositories/PrismaComplianceRepository';
import { PrismaAircraftRepository } from '../../database/repositories/PrismaAircraftRepository';
import { PrismaComponentRepository } from '../../database/repositories/PrismaComponentRepository';
import { prisma } from '../../database/prisma.client';

const router = Router();

const complianceRepo = new PrismaComplianceRepository();
const aircraftRepo = new PrismaAircraftRepository();
const componentRepo = new PrismaComponentRepository();

const getTask = async (taskId: string, organizationId: string) => {
  const row = await prisma.maintenanceTask.findFirst({ where: { id: taskId, organizationId } });
  return row as import('../../../domain/entities/MaintenanceTask').MaintenanceTask | null;
};

const ctrl = new ComplianceController(
  new RecordComplianceUseCase(complianceRepo, aircraftRepo, componentRepo, getTask),
  new GetComplianceUseCase(complianceRepo),
);

router.use(authMiddleware, tenantMiddleware);
router.post('/', ctrl.record);
router.get('/aircraft/:aircraftId/latest', ctrl.latestPerTask);
router.get('/aircraft/:aircraftId/task/:taskId/history', ctrl.historyForTask);

export { router as complianceRoutes };
