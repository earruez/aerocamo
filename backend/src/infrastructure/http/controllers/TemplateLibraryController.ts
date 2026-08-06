import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { authMiddleware, requireRoles } from '../middlewares/authMiddleware';
import {
  TemplateCloneService,
  type AssignPlanByCategoryInput,
  type PlanCategory,
} from '../../../domain/services/TemplateCloneService';

const prisma = new PrismaClient();

export const templateLibraryRouter = Router();

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface CreateTemplateInput {
  manufacturer: string;
  model: string;
  description?: string;
  version?: string;
}

interface CreateTemplateTaskInput {
  code: string;
  title: string;
  description: string;
  chapter?: string;
  section?: string;
  intervalType: 'FLIGHT_HOURS' | 'CYCLES' | 'CALENDAR_DAYS' | 'FLIGHT_HOURS_OR_CALENDAR' | 'CYCLES_OR_CALENDAR' | 'ON_CONDITION';
  intervalHours?: number;
  intervalCycles?: number;
  intervalCalendarDays?: number;
  intervalCalendarMonths?: number;
  referenceNumber?: string;
  referenceType?: string;
  isMandatory?: boolean;
  estimatedManHours?: number;
  requiresInspection?: boolean;
  applicableModel?: string;
  applicablePartNumber?: string;
}

interface UpdateTemplateTaskInput extends Partial<CreateTemplateTaskInput> {}

interface AssignPlansBundleInput {
  aircraftId: string;
  assignments: AssignPlanByCategoryInput[];
}

// ─── GET /templates ─ Listar todas las templates ────────────────────────────────

templateLibraryRouter.get(
  '/templates',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;

      const templates = await prisma.maintenanceTemplate.findMany({
        where: { organizationId: orgId },
        include: {
          tasks: {
            where: { isActive: true },
            orderBy: { chapter: 'asc' },
          },
        },
        orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
      });

      res.json(templates);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /templates/:id ─ Obtener template con detalles ─────────────────────────

templateLibraryRouter.get(
  '/templates/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { id } = req.params;

      const template = await prisma.maintenanceTemplate.findUnique({
        where: { id },
        include: {
          tasks: {
            where: { isActive: true },
            orderBy: [{ chapter: 'asc' }, { code: 'asc' }],
          },
        },
      });

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      if (template.organizationId !== orgId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      res.json(template);
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /templates ─ Crear nueva template ──────────────────────────────────────

templateLibraryRouter.post(
  '/templates',
  authMiddleware,
  requireRoles('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { manufacturer, model, description, version } = req.body as CreateTemplateInput;

      if (!manufacturer || !model) {
        return res.status(400).json({ message: 'manufacturer and model are required' });
      }

      const template = await prisma.maintenanceTemplate.create({
        data: {
          organizationId: orgId,
          manufacturer,
          model,
          description: description || undefined,
          version: version || '1.0',
        },
      });

      res.status(201).json(template);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res.status(409).json({ message: 'Template already exists for this manufacturer/model' });
      }
      next(err);
    }
  }
);

// ─── POST /templates/:id/tasks ─ Agregar tarea a template ────────────────────────

templateLibraryRouter.post(
  '/templates/:id/tasks',
  authMiddleware,
  requireRoles('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { id } = req.params;
      const taskData = req.body as CreateTemplateTaskInput;

      // Verificar que el template existe y pertenece a la org
      const template = await prisma.maintenanceTemplate.findUnique({
        where: { id },
      });

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      if (template.organizationId !== orgId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Crear tarea
      const task = await prisma.maintenanceTemplateTask.create({
        data: {
          templateId: id,
          code: taskData.code,
          title: taskData.title,
          description: taskData.description,
          chapter: taskData.chapter || undefined,
          section: taskData.section || undefined,
          intervalType: taskData.intervalType,
          intervalHours: taskData.intervalHours ? new Prisma.Decimal(taskData.intervalHours) : undefined,
          intervalCycles: taskData.intervalCycles || undefined,
          intervalCalendarDays: taskData.intervalCalendarDays || undefined,
          intervalCalendarMonths: taskData.intervalCalendarMonths || undefined,
          referenceNumber: taskData.referenceNumber || undefined,
          referenceType: (taskData.referenceType || 'AMM') as any,
          isMandatory: taskData.isMandatory || false,
          estimatedManHours: taskData.estimatedManHours ? new Prisma.Decimal(taskData.estimatedManHours) : undefined,
          requiresInspection: taskData.requiresInspection || false,
          applicableModel: taskData.applicableModel || undefined,
          applicablePartNumber: taskData.applicablePartNumber || undefined,
        },
      });

      res.status(201).json(task);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res.status(409).json({ message: 'Task code already exists in this template' });
      }
      next(err);
    }
  }
);

// ─── PUT /templates/tasks/:taskId ─ Actualizar tarea de template ────────────────

templateLibraryRouter.put(
  '/templates/tasks/:taskId',
  authMiddleware,
  requireRoles('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { taskId } = req.params;
      const updates = req.body as UpdateTemplateTaskInput;

      // Verificar que la tarea existe y pertenece a una template de la org
      const task = await prisma.maintenanceTemplateTask.findUnique({
        where: { id: taskId },
        include: { template: true },
      });

      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      if (task.template.organizationId !== orgId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Actualizar tarea
      const updated = await prisma.maintenanceTemplateTask.update({
        where: { id: taskId },
        data: {
          title: updates.title || undefined,
          description: updates.description || undefined,
          chapter: updates.chapter || undefined,
          section: updates.section || undefined,
          intervalType: updates.intervalType || undefined,
          intervalHours: updates.intervalHours ? new Prisma.Decimal(updates.intervalHours) : undefined,
          intervalCycles: updates.intervalCycles || undefined,
          intervalCalendarDays: updates.intervalCalendarDays || undefined,
          intervalCalendarMonths: updates.intervalCalendarMonths || undefined,
          referenceNumber: updates.referenceNumber || undefined,
          referenceType: (updates.referenceType || undefined) as any,
          isMandatory: updates.isMandatory,
          estimatedManHours: updates.estimatedManHours ? new Prisma.Decimal(updates.estimatedManHours) : undefined,
          requiresInspection: updates.requiresInspection,
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /templates/tasks/:taskId ─ Eliminar tarea de template ────────────────

templateLibraryRouter.delete(
  '/templates/tasks/:taskId',
  authMiddleware,
  requireRoles('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { taskId } = req.params;

      // Verificar ownership
      const task = await prisma.maintenanceTemplateTask.findUnique({
        where: { id: taskId },
        include: { template: true },
      });

      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }

      if (task.template.organizationId !== orgId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Soft delete
      const deleted = await prisma.maintenanceTemplateTask.update({
        where: { id: taskId },
        data: { isActive: false },
      });

      res.json(deleted);
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /templates/search ─ Buscar template por manufacturer/model ──────────────

templateLibraryRouter.get(
  '/templates/search',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { manufacturer, model } = req.query as { manufacturer?: string; model?: string };

      if (!manufacturer || !model) {
        return res.status(400).json({ message: 'manufacturer and model query params are required' });
      }

      const template = await prisma.maintenanceTemplate.findUnique({
        where: {
          manufacturer_model_organizationId: {
            manufacturer: manufacturer as string,
            model: model as string,
            organizationId: orgId,
          },
        },
        include: {
          tasks: {
            where: { isActive: true },
          },
        },
      });

      if (!template) {
        return res.json(null);
      }

      res.json(template);
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /templates/:id ─ Eliminar template ────────────────────────────────────

templateLibraryRouter.delete(
  '/templates/:id',
  authMiddleware,
  requireRoles('ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { id } = req.params;

      const template = await prisma.maintenanceTemplate.findUnique({
        where: { id },
      });

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      if (template.organizationId !== orgId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Soft delete + cascade to tasks
      const deleted = await prisma.maintenanceTemplate.update({
        where: { id },
        data: {
          isActive: false,
          tasks: {
            updateMany: {
              where: { templateId: id },
              data: { isActive: false },
            },
          },
        },
      });

      res.json(deleted);
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /templates/:id/clone-to-aircraft ─ Clonar template a nueva aeronave ───

templateLibraryRouter.post(
  '/templates/:id/clone-to-aircraft',
  authMiddleware,
  requireRoles('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.organizationId;
      const { id: templateId } = req.params;
      const { aircraftId } = req.body as { aircraftId: string };

      if (!aircraftId) {
        return res.status(400).json({ message: 'aircraftId is required' });
      }

      // Verify template belongs to org
      const template = await prisma.maintenanceTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      if (template.organizationId !== orgId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Clone the template
      const result = await TemplateCloneService.cloneTemplateToAircraft(
        templateId,
        aircraftId,
        orgId
      );

      res.json({
        message: `Successfully cloned ${result.tasksCloned} tasks from template to aircraft`,
        tasksCloned: result.tasksCloned,
      });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not found')) {
        return res.status(404).json({ message });
      }
      if (message.includes('Unauthorized')) {
        return res.status(403).json({ message });
      }
      next(err);
    }
  }
);

// ─── POST /templates/assign-bundle-to-aircraft ─ Assign one template per category ──

templateLibraryRouter.post(
  '/templates/assign-bundle-to-aircraft',
  authMiddleware,
  requireRoles('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { aircraftId, assignments } = req.body as AssignPlansBundleInput;
      if (!aircraftId) {
        return res.status(400).json({ message: 'aircraftId is required' });
      }

      const result = await TemplateCloneService.assignBundleToAircraft({
        organizationId: req.organizationId,
        aircraftId,
        assignments,
        actor: {
          id: req.currentUser.id,
          email: req.currentUser.email,
          role: req.currentUser.role,
        },
      });

      res.json({
        message: `Assigned ${result.assignments.length} maintenance plan categories`,
        assignments: result.assignments,
      });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('aircraft') || message.includes('Aircraft')) {
        return res.status(404).json({ message });
      }
      if (message.includes('Forbidden') || message.includes('Unauthorized')) {
        return res.status(403).json({ message });
      }
      if (message.includes('Invalid') || message.includes('repeated') || message.includes('assignments') || message.includes('inactive')) {
        return res.status(400).json({ message });
      }
      next(err);
    }
  },
);

// ─── GET /templates/aircraft/:aircraftId/assigned-plans ─ Last assigned plan by category ──

templateLibraryRouter.get(
  '/templates/aircraft/:aircraftId/assigned-plans',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { aircraftId } = req.params;

      const aircraft = await prisma.aircraft.findUnique({ where: { id: aircraftId } });
      if (!aircraft) {
        return res.status(404).json({ message: 'Aircraft not found' });
      }
      if (aircraft.organizationId !== req.organizationId) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const assignments = await TemplateCloneService.getAircraftAssignedPlans(
        aircraftId,
        req.organizationId,
      );

      res.json({ assignments });
    } catch (err) {
      next(err);
    }
  },
);
