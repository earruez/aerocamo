import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { upload } from '../middlewares/upload';
import { OrganizationController } from '../controllers/OrganizationController';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

router.get('/', OrganizationController.getCurrent);
router.post('/logo', requireRoles('ADMIN'), upload.single('logo'), OrganizationController.uploadLogo);
router.delete('/logo', requireRoles('ADMIN'), OrganizationController.removeLogo);

export { router as organizationRoutes };
