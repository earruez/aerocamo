import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { WorkRequestController } from '../controllers/WorkRequestController';
import { upload } from '../middlewares/upload';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.get('/responsibles', WorkRequestController.listResponsibles);
router.get('/state-machine', WorkRequestController.stateMachine);
router.get('/aircraft/:aircraftId', WorkRequestController.listByAircraft);
router.get('/aircraft/:aircraftId/catalog', WorkRequestController.listCatalog);
router.get('/aircraft/:aircraftId/execution-eligibility', WorkRequestController.executionEligibility);
router.get('/aircraft/:aircraftId/airworthiness-history', WorkRequestController.airworthinessHistory);

router.post('/', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.createDraft);
router.get('/:id', WorkRequestController.getById);
router.patch('/:id', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.updateDraft);
router.post('/:id/items', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.addItem);
router.delete('/:id/items/:itemId', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.removeItem);

router.get('/:id/pdf', WorkRequestController.generatePdf);
router.post('/:id/cancel', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.cancel);
router.delete('/:id', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.remove);
router.post('/:id/submit-review', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.submitForReview);
router.post('/:id/review', requireRoles('ADMIN', 'SUPERVISOR', 'INSPECTOR'), WorkRequestController.reviewDecision);
router.post(
	'/:id/received-ot',
	requireRoles('ADMIN', 'SUPERVISOR', 'INSPECTOR'),
	upload.single('otDocument'),
	WorkRequestController.registerReceivedOt,
);
router.post('/:id/send', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.send);
router.post('/:id/send-email', requireRoles('ADMIN', 'SUPERVISOR'), WorkRequestController.sendEmail);
router.post(
	'/:id/close-and-comply',
	requireRoles('ADMIN', 'SUPERVISOR', 'INSPECTOR'),
	upload.single('evidence'),
	WorkRequestController.closeAndComply,
);

router.post('/jobs/run-daily', requireRoles('ADMIN'), WorkRequestController.runDailyJob);

export { router as workRequestRoutes };
