import { Router } from 'express';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import { tenantMiddleware } from '../middlewares/tenantMiddleware';
import { CatalogController } from '../controllers/CatalogController';

const router = Router();
const ctrl = new CatalogController();

router.use(authMiddleware, tenantMiddleware);

router.get('/manuals', ctrl.listManuals);
router.post('/manuals', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.createManual);
router.patch('/manuals/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.updateManual);
router.delete('/manuals/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.removeManual);

router.get('/repair-shops', ctrl.listShops);
router.post('/repair-shops', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.createShop);
router.patch('/repair-shops/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.updateShop);
router.delete('/repair-shops/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.removeShop);

router.get('/repair-shops/:shopId/contacts', ctrl.listContacts);
router.post('/repair-shops/:shopId/contacts', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.createContact);
router.patch('/repair-shop-contacts/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.updateContact);
router.delete('/repair-shop-contacts/:id', requireRoles('ADMIN', 'SUPERVISOR'), ctrl.removeContact);

export { router as catalogRoutes };
