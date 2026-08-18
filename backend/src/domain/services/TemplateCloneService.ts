import { PrismaClient, Prisma, TaskIntervalType } from '@prisma/client';
import { BaselineComplianceService } from './BaselineComplianceService';
import { auditLogService } from './AuditLogService';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors/AppError';

const prisma = new PrismaClient();

export type PlanCategory = 'manufacturer' | 'national_dgac' | 'engine_components' | 'origin_country';

export interface AssignPlanByCategoryInput {
  category: PlanCategory;
  templateIds: string[];
}

type AssignActor = {
  id: string;
  email: string;
  role: string;
};

/**
 * TemplateCloneService
 * Handles cloning maintenance tasks from a template to a newly created aircraft
 */
export class TemplateCloneService {
  private static readonly validCategories: PlanCategory[] = [
    'manufacturer',
    'national_dgac',
    'engine_components',
    'origin_country',
  ];

  /**
   * Clone all tasks from a template to a new aircraft
   *
   * @param templateId - ID of the maintenance template
   * @param aircraftId - ID of the newly created aircraft
   * @param organizationId - Organization context
   * @returns Count of tasks cloned
   */
  static async cloneTemplateToAircraft(
    templateId: string,
    aircraftId: string,
    organizationId: string
  ): Promise<{ tasksCloned: number }> {
    // Get the template with its tasks
    const template = await prisma.maintenanceTemplate.findUnique({
      where: { id: templateId },
      include: { tasks: { where: { isActive: true } } },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    if (template.organizationId !== organizationId) {
      throw new Error('Unauthorized: template does not belong to this organization');
    }

    // Get the aircraft to verify it exists and belongs to the org
    const aircraft = await prisma.aircraft.findUnique({
      where: { id: aircraftId },
    });

    if (!aircraft) {
      throw new Error('Aircraft not found');
    }

    if (aircraft.organizationId !== organizationId) {
      throw new Error('Unauthorized: aircraft does not belong to this organization');
    }

    let tasksCloned = 0;

    // For each task in the template, create a corresponding MaintenanceTask + AircraftTask
    for (const templateTask of template.tasks) {
      try {
        // Create or find the maintenance task
        const maintenanceTask = await prisma.maintenanceTask.upsert({
          where: {
            code_organizationId: {
              code: templateTask.code,
              organizationId,
            },
          },
          update: {
            // If task already exists, ensure it's active
            isActive: true,
          },
          create: {
            organizationId,
            code: templateTask.code,
            title: templateTask.title,
            description: templateTask.description,
            intervalType: templateTask.intervalType,
            intervalHours: templateTask.intervalHours,
            intervalCycles: templateTask.intervalCycles,
            intervalCalendarDays: templateTask.intervalCalendarDays,
            intervalCalendarMonths: templateTask.intervalCalendarMonths,
            referenceNumber: templateTask.referenceNumber,
            referenceType: templateTask.referenceType,
            isMandatory: templateTask.isMandatory,
            estimatedManHours: templateTask.estimatedManHours,
            requiresInspection: templateTask.requiresInspection,
            applicableModel: templateTask.applicableModel,
            applicablePartNumber: templateTask.applicablePartNumber,
          },
        });

        // Link the task to the aircraft
        await prisma.aircraftTask.upsert({
          where: {
            aircraftId_taskId: {
              aircraftId,
              taskId: maintenanceTask.id,
            },
          },
          update: { isActive: true },
          create: {
            aircraftId,
            taskId: maintenanceTask.id,
            isActive: true,
          },
        });

        await BaselineComplianceService.ensureBaselineForTask(
          aircraftId,
          maintenanceTask.id,
          organizationId,
          undefined,
        );

        tasksCloned++;
      } catch (err) {
        console.error(`Failed to clone task ${templateTask.code}:`, err);
        // Continue with next task instead of failing entirely
      }
    }

    return { tasksCloned };
  }

  /**
   * Detect the maintenance type (HORARIO/CALENDARIO/MIXTO) based on interval configuration
   *
   * @param hasHourLimit - True if the task has an hour limit
   * @param hasCalendarLimit - True if the task has a calendar limit (days or months)
   * @returns The detected interval type
   */
  static detectMaintenanceType(
    hasHourLimit: boolean,
    hasCalendarLimit: boolean
  ): TaskIntervalType {
    if (hasHourLimit && hasCalendarLimit) {
      return 'FLIGHT_HOURS_OR_CALENDAR'; // MIXTO
    }
    if (hasHourLimit) {
      return 'FLIGHT_HOURS'; // HORARIO
    }
    if (hasCalendarLimit) {
      return 'CALENDAR_DAYS'; // CALENDARIO
    }
    return 'ON_CONDITION'; // Default
  }

  /**
   * Extract all unique chapters/sections from a template's tasks
   * Used for organizing the library view
   */
  static async getTemplateChapters(templateId: string): Promise<
    Array<{ chapter: string | null; count: number }>
  > {
    const result = await prisma.maintenanceTemplateTask.groupBy({
      by: ['chapter'],
      where: {
        templateId,
        isActive: true,
      },
      _count: true,
    });

    return result
      .map(r => ({ chapter: r.chapter, count: r._count }))
      .sort((a, b) => {
        if (!a.chapter) return 1;
        if (!b.chapter) return -1;
        return a.chapter.localeCompare(b.chapter);
      });
  }

  static async assignBundleToAircraft(input: {
    organizationId: string;
    aircraftId: string;
    assignments: AssignPlanByCategoryInput[];
    actor?: AssignActor;
  }): Promise<{
    assignments: Array<{
      category: PlanCategory;
      templateId: string;
      templateLabel: string;
      assignedAt: Date;
      tasksCloned: number;
    }>;
  }> {
    if (!Array.isArray(input.assignments) || input.assignments.length === 0) {
      throw new ValidationError('assignments must be a non-empty array');
    }

    const categories = input.assignments.map((a) => a.category);
    const invalidCategory = categories.find((c) => !this.validCategories.includes(c));
    if (invalidCategory) {
      throw new ValidationError(`Invalid category '${invalidCategory}'`);
    }

    const duplicateCategory = categories.find((cat, index) => categories.indexOf(cat) !== index);
    if (duplicateCategory) {
      throw new ValidationError(`Category '${duplicateCategory}' is repeated`);
    }

    for (const assignment of input.assignments) {
      if (!Array.isArray(assignment.templateIds)) {
        throw new ValidationError(`Invalid templateIds: must be an array for category '${assignment.category}'`);
      }
      if (new Set(assignment.templateIds).size !== assignment.templateIds.length) {
        throw new ValidationError(`templateIds has a repeated template for category '${assignment.category}'`);
      }
    }

    const aircraft = await prisma.aircraft.findUnique({ where: { id: input.aircraftId } });
    if (!aircraft) {
      throw new NotFoundError('Aircraft', input.aircraftId);
    }
    if (aircraft.organizationId !== input.organizationId) {
      throw new ForbiddenError('Forbidden');
    }

    const desiredTemplateIds = Array.from(new Set(input.assignments.flatMap((a) => a.templateIds)));
    const templates = desiredTemplateIds.length > 0
      ? await prisma.maintenanceTemplate.findMany({
          where: {
            id: { in: desiredTemplateIds },
            organizationId: input.organizationId,
            isActive: true,
          },
          select: { id: true, manufacturer: true, model: true, description: true, version: true },
        })
      : [];

    if (templates.length !== desiredTemplateIds.length) {
      throw new ValidationError('One or more templates are invalid or inactive for this organization');
    }

    const templateById = new Map(templates.map((t) => [t.id, t]));
    const labelFor = (templateId: string) => {
      const t = templateById.get(templateId)!;
      return `${t.manufacturer} ${t.model} - ${t.description ?? t.version}`;
    };

    const clonedByTemplateId = new Map<string, number>();
    for (const templateId of desiredTemplateIds) {
      const result = await this.cloneTemplateToAircraft(templateId, input.aircraftId, input.organizationId);
      clonedByTemplateId.set(templateId, result.tasksCloned);
    }

    // Solo se tocan las filas de las categorías incluidas en esta solicitud; el resto
    // de categorías de la aeronave quedan intactas.
    const existingRows = await prisma.aircraftAssignedPlan.findMany({
      where: { aircraftId: input.aircraftId, category: { in: categories } },
    });
    const existingByCategory = new Map<PlanCategory, typeof existingRows>();
    for (const row of existingRows) {
      const category = row.category as PlanCategory;
      const list = existingByCategory.get(category) ?? [];
      list.push(row);
      existingByCategory.set(category, list);
    }

    const saved: Array<{
      category: PlanCategory;
      templateId: string;
      templateLabel: string;
      assignedAt: Date;
      tasksCloned: number;
    }> = [];

    for (const assignment of input.assignments) {
      const desiredIds = new Set(assignment.templateIds);
      const existing = existingByCategory.get(assignment.category) ?? [];
      const existingIds = new Set(existing.map((row) => row.templateId));
      const toRemove = existing.filter((row) => !desiredIds.has(row.templateId));
      const toAddIds = assignment.templateIds.filter((id) => !existingIds.has(id));

      if (toRemove.length > 0) {
        await prisma.aircraftAssignedPlan.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } });
        if (input.actor) {
          for (const removed of toRemove) {
            await auditLogService.log({
              organizationId: input.organizationId,
              entityType: 'Aircraft',
              entityId: input.aircraftId,
              action: 'MAINTENANCE_PLAN_CATEGORY_UNASSIGNED',
              previousValue: { category: assignment.category, templateId: removed.templateId },
              newValue: null,
              userId: input.actor.id,
              userEmail: input.actor.email,
              userRole: input.actor.role,
              metadata: {
                assignmentCategory: assignment.category,
                unassignedTemplateId: removed.templateId,
              },
            });
          }
        }
      }

      for (const templateId of toAddIds) {
        const record = await prisma.aircraftAssignedPlan.create({
          data: {
            organizationId: input.organizationId,
            aircraftId: input.aircraftId,
            category: assignment.category,
            templateId,
            assignedById: input.actor?.id ?? null,
          },
        });
        existing.push(record);

        if (input.actor) {
          await auditLogService.log({
            organizationId: input.organizationId,
            entityType: 'Aircraft',
            entityId: input.aircraftId,
            action: 'MAINTENANCE_PLAN_CATEGORY_ASSIGNED',
            previousValue: null,
            newValue: {
              category: assignment.category,
              templateId,
              templateLabel: labelFor(templateId),
            },
            userId: input.actor.id,
            userEmail: input.actor.email,
            userRole: input.actor.role,
            metadata: {
              assignmentCategory: assignment.category,
              assignedTemplateId: templateId,
            },
          });
        }
      }

      const finalRows = existing.filter((row) => desiredIds.has(row.templateId));
      for (const row of finalRows) {
        saved.push({
          category: assignment.category,
          templateId: row.templateId,
          templateLabel: labelFor(row.templateId),
          assignedAt: row.updatedAt,
          tasksCloned: clonedByTemplateId.get(row.templateId) ?? 0,
        });
      }
    }

    return { assignments: saved };
  }

  static async getAircraftAssignedPlans(
    aircraftId: string,
    organizationId: string,
  ): Promise<Array<{
    category: PlanCategory;
    templateId: string;
    templateLabel: string;
    assignedAt: Date;
  }>> {
    const rows = await prisma.aircraftAssignedPlan.findMany({
      where: { aircraftId, organizationId },
      include: {
        template: {
          select: {
            manufacturer: true,
            model: true,
            description: true,
            version: true,
          },
        },
      },
      orderBy: { category: 'asc' },
    });

    return rows.map((row) => ({
      category: row.category as PlanCategory,
      templateId: row.templateId,
      templateLabel: `${row.template.manufacturer} ${row.template.model} - ${row.template.description ?? row.template.version}`,
      assignedAt: row.updatedAt,
    }));
  }
}
