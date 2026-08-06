import { PrismaClient, Prisma, TaskIntervalType } from '@prisma/client';
import { BaselineComplianceService } from './BaselineComplianceService';
import { auditLogService } from './AuditLogService';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors/AppError';

const prisma = new PrismaClient();

export type PlanCategory = 'manufacturer' | 'national_dgac' | 'engine_components' | 'origin_country';

export interface AssignPlanByCategoryInput {
  category: PlanCategory;
  templateId: string;
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

    const aircraft = await prisma.aircraft.findUnique({ where: { id: input.aircraftId } });
    if (!aircraft) {
      throw new NotFoundError('Aircraft', input.aircraftId);
    }
    if (aircraft.organizationId !== input.organizationId) {
      throw new ForbiddenError('Forbidden');
    }

    const templateIds = Array.from(new Set(input.assignments.map((a) => a.templateId)));
    const templates = await prisma.maintenanceTemplate.findMany({
      where: {
        id: { in: templateIds },
        organizationId: input.organizationId,
        isActive: true,
      },
      select: { id: true, manufacturer: true, model: true, description: true, version: true },
    });

    if (templates.length !== templateIds.length) {
      throw new ValidationError('One or more templates are invalid or inactive for this organization');
    }

    const templateById = new Map(templates.map((t) => [t.id, t]));
    const clonedByTemplateId = new Map<string, number>();
    for (const templateId of templateIds) {
      const result = await this.cloneTemplateToAircraft(templateId, input.aircraftId, input.organizationId);
      clonedByTemplateId.set(templateId, result.tasksCloned);
    }

    const saved = [] as Array<{
      category: PlanCategory;
      templateId: string;
      templateLabel: string;
      assignedAt: Date;
      tasksCloned: number;
    }>;

    for (const assignment of input.assignments) {
      const template = templateById.get(assignment.templateId)!;
      const record = await prisma.aircraftAssignedPlan.upsert({
        where: {
          aircraftId_category: {
            aircraftId: input.aircraftId,
            category: assignment.category,
          },
        },
        update: {
          templateId: assignment.templateId,
          assignedById: input.actor?.id ?? null,
        },
        create: {
          organizationId: input.organizationId,
          aircraftId: input.aircraftId,
          category: assignment.category,
          templateId: assignment.templateId,
          assignedById: input.actor?.id ?? null,
        },
      });

      const templateLabel = `${template.manufacturer} ${template.model} - ${template.description ?? template.version}`;
      const tasksCloned = clonedByTemplateId.get(assignment.templateId) ?? 0;

      saved.push({
        category: assignment.category,
        templateId: assignment.templateId,
        templateLabel,
        assignedAt: record.updatedAt,
        tasksCloned,
      });

      if (input.actor) {
        await auditLogService.log({
          organizationId: input.organizationId,
          entityType: 'Aircraft',
          entityId: input.aircraftId,
          action: 'MAINTENANCE_PLAN_CATEGORY_ASSIGNED',
          previousValue: null,
          newValue: {
            category: assignment.category,
            templateId: assignment.templateId,
            templateLabel,
          },
          userId: input.actor.id,
          userEmail: input.actor.email,
          userRole: input.actor.role,
          metadata: {
            assignmentCategory: assignment.category,
            assignedTemplateId: assignment.templateId,
          },
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
