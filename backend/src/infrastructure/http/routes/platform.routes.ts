import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { PlatformController } from '../controllers/PlatformController';

const router = Router();
const ctrl = new PlatformController();

// Sin tenantMiddleware a propósito: estas rutas operan sobre todas las
// organizaciones y solo las alcanza el rol SUPER_ADMIN.
router.use(authMiddleware, requireRoles('SUPER_ADMIN'));

router.get('/organizations', ctrl.listOrganizations);
router.post('/organizations', ctrl.createOrganization);
router.patch('/organizations/:id', ctrl.updateOrganization);

router.get('/organizations/:id/users', ctrl.listOrganizationUsers);
router.post('/organizations/:id/users', ctrl.createUser);
router.patch('/users/:userId', ctrl.updateUser);
router.delete('/users/:userId', ctrl.deleteUser);

export { router as platformRoutes };
