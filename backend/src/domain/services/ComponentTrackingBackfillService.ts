import { prisma } from '../../infrastructure/database/prisma.client';

type BackfillDetail = {
  source: 'Component' | 'Compliance' | 'ComponentHistory';
  legacyId: string;
  reason: string;
};

export interface ComponentTrackingBackfillReport {
  componentInstances: {
    created: number;
    reused: number;
    skippedAmbiguous: number;
    skippedValidation: number;
    positionDefaulted: number;
  };
  componentApplications: {
    created: number;
    reused: number;
    skippedAmbiguous: number;
    skippedValidation: number;
  };
  componentMovements: {
    created: number;
    reused: number;
    skippedAmbiguous: number;
    skippedValidation: number;
    replacementEventsCreated: number;
    replacementGroupsAmbiguous: number;
  };
  validationFailures: BackfillDetail[];
  ambiguousRows: BackfillDetail[];
  unexpectedErrors: BackfillDetail[];
}

const MAX_DETAILS = 200;

function pushLimited(target: BackfillDetail[], value: BackfillDetail) {
  if (target.length < MAX_DETAILS) target.push(value);
}

function appendMarker(existing: string | null | undefined, marker: string): string {
  const base = (existing ?? '').trim();
  if (base.includes(marker)) return base;
  if (!base) return marker;
  return `${base} | ${marker}`;
}

function inferAtaChapter(code: string): string {
  const m = code.match(/(\d{2})/);
  return m?.[1] ?? '00';
}

function mapIntervalType(intervalType: string): 'hours' | 'cycles' | 'calendar' | 'mixed' {
  if (intervalType === 'FLIGHT_HOURS') return 'hours';
  if (intervalType === 'CYCLES') return 'cycles';
  if (intervalType === 'CALENDAR_DAYS') return 'calendar';
  return 'mixed';
}

function mapLegacyComponentStatus(status: string): 'installed' | 'removed' | 'spare' | 'scrapped' {
  if (status === 'INSTALLED') return 'installed';
  if (status === 'SCRAPPED') return 'scrapped';
  if (status === 'UNSERVICEABLE' || status === 'IN_SHOP') return 'removed';
  return 'spare';
}

export class ComponentTrackingBackfillService {
  private readonly report: ComponentTrackingBackfillReport = {
    componentInstances: {
      created: 0,
      reused: 0,
      skippedAmbiguous: 0,
      skippedValidation: 0,
      positionDefaulted: 0,
    },
    componentApplications: {
      created: 0,
      reused: 0,
      skippedAmbiguous: 0,
      skippedValidation: 0,
    },
    componentMovements: {
      created: 0,
      reused: 0,
      skippedAmbiguous: 0,
      skippedValidation: 0,
      replacementEventsCreated: 0,
      replacementGroupsAmbiguous: 0,
    },
    validationFailures: [],
    ambiguousRows: [],
    unexpectedErrors: [],
  };

  private readonly definitionByTaskKey = new Map<string, string>();
  private readonly instanceByLegacyComponentKey = new Map<string, string>();

  private async hasComplianceLifecycleColumns(): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'compliances' AND column_name IN ('applicationType', 'isInitial')",
    );
    const names = new Set(rows.map((r) => r.column_name));
    return names.has('applicationType') && names.has('isInitial');
  }

  async run(): Promise<ComponentTrackingBackfillReport> {
    await this.preloadInstanceCache();
    await this.backfillComponentInstances();
    await this.backfillComponentApplications();
    await this.backfillComponentMovements();
    return this.report;
  }

  private taskKey(organizationId: string, taskId: string): string {
    return `${organizationId}:${taskId}`;
  }

  private legacyComponentKey(organizationId: string, legacyComponentId: string): string {
    return `${organizationId}:${legacyComponentId}`;
  }

  private async preloadInstanceCache() {
    const rows = await prisma.componentInstance.findMany({
      where: { legacyComponentId: { not: null } },
      select: {
        id: true,
        organizationId: true,
        legacyComponentId: true,
      },
    });

    for (const row of rows) {
      if (!row.legacyComponentId) continue;
      this.instanceByLegacyComponentKey.set(
        this.legacyComponentKey(row.organizationId, row.legacyComponentId),
        row.id,
      );
    }
  }

  private async ensureDefinitionFromTask(organizationId: string, taskId: string): Promise<string | null> {
    const key = this.taskKey(organizationId, taskId);
    const cached = this.definitionByTaskKey.get(key);
    if (cached) return cached;

    const existing = await prisma.componentDefinition.findFirst({
      where: {
        organizationId,
        sourceGroup: 'legacy:maintenance_task',
        reference: taskId,
      },
      select: { id: true },
    });

    if (existing) {
      this.definitionByTaskKey.set(key, existing.id);
      return existing.id;
    }

    const task = await prisma.maintenanceTask.findFirst({
      where: { id: taskId, organizationId },
      select: {
        id: true,
        code: true,
        title: true,
        description: true,
        intervalType: true,
        intervalHours: true,
        intervalCycles: true,
        intervalCalendarDays: true,
        requiresInspection: true,
        applicablePartNumber: true,
      },
    });

    if (!task) return null;

    const created = await prisma.componentDefinition.create({
      data: {
        organizationId,
        ataChapter: inferAtaChapter(task.code),
        ataCode: task.code,
        name: task.title,
        description: task.description,
        executionType: task.applicablePartNumber || task.requiresInspection ? 'component_replacement' : 'maintenance',
        intervalType: mapIntervalType(task.intervalType),
        intervalHours: task.intervalHours != null ? Number(task.intervalHours) : null,
        intervalCycles: task.intervalCycles,
        intervalDays: task.intervalCalendarDays,
        requiresComponentTracking: true,
        sourceGroup: 'legacy:maintenance_task',
        reference: task.id,
      },
      select: { id: true },
    });

    this.definitionByTaskKey.set(key, created.id);
    return created.id;
  }

  private async resolveDefinitionForLegacyComponent(organizationId: string, componentId: string): Promise<string | null> {
    const taskLinks = await prisma.componentTask.findMany({
      where: { componentId, isActive: true },
      select: { taskId: true },
    });

    const complianceTaskLinks = await prisma.compliance.findMany({
      where: { organizationId, componentId },
      select: { taskId: true },
      distinct: ['taskId'],
    });

    const taskIdSet = new Set<string>();
    for (const t of taskLinks) taskIdSet.add(t.taskId);
    for (const t of complianceTaskLinks) {
      if (t.taskId) taskIdSet.add(t.taskId);
    }

    const taskIds = [...taskIdSet];

    if (taskIds.length === 1) {
      return this.ensureDefinitionFromTask(organizationId, taskIds[0]);
    }

    return null;
  }

  private async resolveInstanceByLegacyComponent(organizationId: string, legacyComponentId: string): Promise<string | null> {
    const key = this.legacyComponentKey(organizationId, legacyComponentId);
    const cached = this.instanceByLegacyComponentKey.get(key);
    if (cached) return cached;

    const existing = await prisma.componentInstance.findFirst({
      where: { organizationId, legacyComponentId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!existing) return null;

    this.instanceByLegacyComponentKey.set(key, existing.id);
    return existing.id;
  }

  private async backfillComponentInstances() {
    const components = await prisma.component.findMany({
      select: {
        id: true,
        organizationId: true,
        aircraftId: true,
        partNumber: true,
        serialNumber: true,
        position: true,
        status: true,
        installationDate: true,
        installationAircraftHours: true,
        installationAircraftCycles: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const component of components) {
      const legacyKey = this.legacyComponentKey(component.organizationId, component.id);

      try {
        const existing = await prisma.componentInstance.findFirst({
          where: { organizationId: component.organizationId, legacyComponentId: component.id },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });

        if (existing) {
          this.report.componentInstances.reused += 1;
          this.instanceByLegacyComponentKey.set(legacyKey, existing.id);
          continue;
        }

        const definitionId = await this.resolveDefinitionForLegacyComponent(component.organizationId, component.id);
        if (!definitionId) {
          this.report.componentInstances.skippedAmbiguous += 1;
          pushLimited(this.report.ambiguousRows, {
            source: 'Component',
            legacyId: component.id,
            reason: 'definition-not-resolvable-or-ambiguous',
          });
          continue;
        }

        let position = component.position?.trim() ?? null;
        if (!position) {
          position = 'UNSPECIFIED';
          this.report.componentInstances.positionDefaulted += 1;
        }

        const created = await prisma.componentInstance.create({
          data: {
            organizationId: component.organizationId,
            definitionId,
            aircraftId: component.aircraftId,
            legacyComponentId: component.id,
            partNumber: component.partNumber,
            serialNumber: component.serialNumber,
            position,
            status: mapLegacyComponentStatus(component.status),
            installedAt: component.installationDate,
            removedAt: null,
            installedAtHours: component.installationAircraftHours != null ? Number(component.installationAircraftHours) : null,
            removedAtHours: null,
            installedAtCycles: component.installationAircraftCycles,
            removedAtCycles: null,
            installWorkOrderNumber: null,
            removalWorkOrderNumber: null,
          },
          select: { id: true },
        });

        this.report.componentInstances.created += 1;
        this.instanceByLegacyComponentKey.set(legacyKey, created.id);
      } catch (err) {
        this.report.componentInstances.skippedValidation += 1;
        pushLimited(this.report.unexpectedErrors, {
          source: 'Component',
          legacyId: component.id,
          reason: String(err),
        });
      }
    }
  }

  private async resolveWorkRequestFromCompliance(input: {
    organizationId: string;
    aircraftId: string;
    taskId: string | null;
    componentId: string | null;
  }): Promise<{ workRequestId: string | null; ambiguous: boolean }> {
    if (!input.taskId) return { workRequestId: null, ambiguous: false };

    const candidates = await prisma.workRequestItem.findMany({
      where: {
        taskId: input.taskId,
        workRequest: {
          organizationId: input.organizationId,
          aircraftId: input.aircraftId,
        },
      },
      select: { workRequestId: true, componentId: true },
    });

    let filtered = candidates;
    if (input.componentId) {
      const exact = candidates.filter((c) => c.componentId === input.componentId);
      if (exact.length > 0) filtered = exact;
    }

    const unique = [...new Set(filtered.map((c) => c.workRequestId))];
    if (unique.length === 1) return { workRequestId: unique[0], ambiguous: false };
    if (unique.length > 1) return { workRequestId: null, ambiguous: true };
    return { workRequestId: null, ambiguous: false };
  }

  private async backfillComponentApplications() {
    const hasLifecycle = await this.hasComplianceLifecycleColumns();

    const compliances = hasLifecycle
      ? await prisma.compliance.findMany({
          where: { componentId: { not: null } },
          select: {
            id: true,
            organizationId: true,
            aircraftId: true,
            componentId: true,
            taskId: true,
            performedAt: true,
            aircraftHoursAtCompliance: true,
            aircraftCyclesAtCompliance: true,
            nextDueHours: true,
            nextDueCycles: true,
            nextDueDate: true,
            workOrderNumber: true,
            applicationType: true,
            isInitial: true,
            notes: true,
            performedById: true,
          },
          orderBy: { performedAt: 'asc' },
        })
      : await prisma.compliance.findMany({
          where: { componentId: { not: null } },
          select: {
            id: true,
            organizationId: true,
            aircraftId: true,
            componentId: true,
            taskId: true,
            performedAt: true,
            aircraftHoursAtCompliance: true,
            aircraftCyclesAtCompliance: true,
            nextDueHours: true,
            nextDueCycles: true,
            nextDueDate: true,
            workOrderNumber: true,
            notes: true,
            performedById: true,
          },
          orderBy: { performedAt: 'asc' },
        }).then((rows) => rows.map((r) => ({ ...r, applicationType: 'application' as const, isInitial: false })));

    for (const compliance of compliances) {
      const marker = `[legacy:compliance:${compliance.id}]`;
      try {
        const existing = await prisma.componentApplication.findFirst({
          where: {
            organizationId: compliance.organizationId,
            notes: { contains: marker },
          },
          select: { id: true },
        });

        if (existing) {
          this.report.componentApplications.reused += 1;
          continue;
        }

        if (!compliance.componentId) {
          this.report.componentApplications.skippedValidation += 1;
          pushLimited(this.report.validationFailures, {
            source: 'Compliance',
            legacyId: compliance.id,
            reason: 'componentId-null',
          });
          continue;
        }

        const componentInstanceId = await this.resolveInstanceByLegacyComponent(
          compliance.organizationId,
          compliance.componentId,
        );

        if (!componentInstanceId) {
          this.report.componentApplications.skippedAmbiguous += 1;
          pushLimited(this.report.ambiguousRows, {
            source: 'Compliance',
            legacyId: compliance.id,
            reason: 'component-instance-not-found',
          });
          continue;
        }

        const instance = await prisma.componentInstance.findFirst({
          where: { id: componentInstanceId, organizationId: compliance.organizationId },
          select: { definitionId: true },
        });

        if (!instance) {
          this.report.componentApplications.skippedValidation += 1;
          pushLimited(this.report.validationFailures, {
            source: 'Compliance',
            legacyId: compliance.id,
            reason: 'instance-definition-not-found',
          });
          continue;
        }

        const wrMapping = await this.resolveWorkRequestFromCompliance({
          organizationId: compliance.organizationId,
          aircraftId: compliance.aircraftId,
          taskId: compliance.taskId,
          componentId: compliance.componentId,
        });

        if (wrMapping.ambiguous) {
          this.report.componentApplications.skippedAmbiguous += 1;
          pushLimited(this.report.ambiguousRows, {
            source: 'Compliance',
            legacyId: compliance.id,
            reason: 'work-request-ambiguous',
          });
          continue;
        }

        const workOrder = compliance.workOrderNumber
          ? await prisma.workOrder.findFirst({
              where: {
                organizationId: compliance.organizationId,
                number: compliance.workOrderNumber,
              },
              select: { id: true },
            })
          : null;

        const notes = appendMarker(
          appendMarker(compliance.notes, marker),
          `[legacy:performedBy:${compliance.performedById}]`,
        );

        await prisma.componentApplication.create({
          data: {
            organizationId: compliance.organizationId,
            definitionId: instance.definitionId,
            componentInstanceId,
            aircraftId: compliance.aircraftId,
            taskId: compliance.taskId,
            workRequestId: wrMapping.workRequestId,
            officeOrderId: workOrder?.id ?? null,
            workOrderNumber: compliance.workOrderNumber,
            appliedAt: compliance.performedAt,
            aircraftHoursAtApplication: Number(compliance.aircraftHoursAtCompliance),
            aircraftCyclesAtApplication: compliance.aircraftCyclesAtCompliance,
            nextDueHours: compliance.nextDueHours != null ? Number(compliance.nextDueHours) : null,
            nextDueCycles: compliance.nextDueCycles,
            nextDueDate: compliance.nextDueDate,
            applicationType: compliance.applicationType,
            isInitial: compliance.isInitial,
            notes,
          },
        });

        this.report.componentApplications.created += 1;
      } catch (err) {
        pushLimited(this.report.unexpectedErrors, {
          source: 'Compliance',
          legacyId: compliance.id,
          reason: String(err),
        });
      }
    }
  }

  private movementGroupKey(row: {
    organizationId: string;
    aircraftId: string;
    workOrderId: string | null;
    position: string | null;
    movedAt: Date;
  }): string {
    return [
      row.organizationId,
      row.aircraftId,
      row.workOrderId ?? 'none',
      (row.position ?? '').trim().toUpperCase(),
      row.movedAt.toISOString(),
    ].join('|');
  }

  private async backfillComponentMovements() {
    const historyRows = await prisma.componentHistory.findMany({
      select: {
        id: true,
        organizationId: true,
        componentId: true,
        aircraftId: true,
        movementType: true,
        position: true,
        workOrderId: true,
        notes: true,
        movedAt: true,
        aircraftHoursAtMovement: true,
        aircraftCyclesAtMovement: true,
        performedById: true,
        workOrder: { select: { number: true } },
      },
      orderBy: { movedAt: 'asc' },
    });

    const byGroup = new Map<string, typeof historyRows>();
    for (const row of historyRows) {
      const key = this.movementGroupKey(row);
      const arr = byGroup.get(key) ?? [];
      arr.push(row);
      byGroup.set(key, arr);
    }

    const consumed = new Set<string>();

    for (const [, groupRows] of byGroup) {
      const installed = groupRows.filter((r) => r.movementType === 'INSTALLED');
      const removed = groupRows.filter((r) => r.movementType === 'REMOVED');

      if (installed.length === 1 && removed.length === 1) {
        const ins = installed[0];
        const rem = removed[0];
        const pairMarker = `[legacy:component_history_pair:${rem.id}:${ins.id}]`;

        try {
          const existing = await prisma.componentMovement.findFirst({
            where: {
              organizationId: ins.organizationId,
              notes: { contains: pairMarker },
            },
            select: { id: true },
          });

          if (existing) {
            this.report.componentMovements.reused += 1;
            consumed.add(ins.id);
            consumed.add(rem.id);
            continue;
          }

          const removedInstanceId = await this.resolveInstanceByLegacyComponent(rem.organizationId, rem.componentId);
          const installedInstanceId = await this.resolveInstanceByLegacyComponent(ins.organizationId, ins.componentId);

          if (!removedInstanceId || !installedInstanceId) {
            this.report.componentMovements.skippedAmbiguous += 1;
            pushLimited(this.report.ambiguousRows, {
              source: 'ComponentHistory',
              legacyId: `${rem.id},${ins.id}`,
              reason: 'replacement-instance-link-missing',
            });
            continue;
          }

          let position = ins.position ?? rem.position;
          if (!position) {
            const installedInstance = await prisma.componentInstance.findFirst({
              where: { id: installedInstanceId },
              select: { position: true },
            });
            position = installedInstance?.position ?? 'UNSPECIFIED';
          }

          await prisma.componentMovement.create({
            data: {
              organizationId: ins.organizationId,
              aircraftId: ins.aircraftId,
              position,
              movementType: 'replacement',
              removedComponentInstanceId: removedInstanceId,
              installedComponentInstanceId: installedInstanceId,
              workRequestId: null,
              officeOrderId: ins.workOrderId ?? rem.workOrderId,
              workOrderNumber: ins.workOrder?.number ?? rem.workOrder?.number ?? null,
              performedAt: ins.movedAt,
              aircraftHoursAtMovement: Number(ins.aircraftHoursAtMovement),
              aircraftCyclesAtMovement: ins.aircraftCyclesAtMovement,
              notes: appendMarker(
                appendMarker(appendMarker(ins.notes, `[legacy:component_history:${ins.id}]`), `[legacy:component_history:${rem.id}]`),
                pairMarker,
              ),
              performedById: ins.performedById,
            },
          });

          this.report.componentMovements.created += 1;
          this.report.componentMovements.replacementEventsCreated += 1;
          consumed.add(ins.id);
          consumed.add(rem.id);
        } catch (err) {
          pushLimited(this.report.unexpectedErrors, {
            source: 'ComponentHistory',
            legacyId: `${rem.id},${ins.id}`,
            reason: String(err),
          });
        }
      } else if (installed.length > 1 || removed.length > 1) {
        this.report.componentMovements.replacementGroupsAmbiguous += 1;
        for (const row of groupRows) {
          pushLimited(this.report.ambiguousRows, {
            source: 'ComponentHistory',
            legacyId: row.id,
            reason: 'replacement-group-ambiguous',
          });
        }
      }
    }

    for (const row of historyRows) {
      if (consumed.has(row.id)) continue;

      const marker = `[legacy:component_history:${row.id}]`;

      try {
        const existing = await prisma.componentMovement.findFirst({
          where: {
            organizationId: row.organizationId,
            notes: { contains: marker },
          },
          select: { id: true },
        });

        if (existing) {
          this.report.componentMovements.reused += 1;
          continue;
        }

        const instanceId = await this.resolveInstanceByLegacyComponent(row.organizationId, row.componentId);
        if (!instanceId) {
          this.report.componentMovements.skippedAmbiguous += 1;
          pushLimited(this.report.ambiguousRows, {
            source: 'ComponentHistory',
            legacyId: row.id,
            reason: 'component-instance-not-found',
          });
          continue;
        }

        let position = row.position;
        if (!position) {
          const instance = await prisma.componentInstance.findFirst({
            where: { id: instanceId },
            select: { position: true },
          });
          position = instance?.position ?? 'UNSPECIFIED';
        }

        await prisma.componentMovement.create({
          data: {
            organizationId: row.organizationId,
            aircraftId: row.aircraftId,
            position,
            movementType: row.movementType === 'INSTALLED' ? 'install' : 'remove',
            removedComponentInstanceId: row.movementType === 'REMOVED' ? instanceId : null,
            installedComponentInstanceId: row.movementType === 'INSTALLED' ? instanceId : null,
            workRequestId: null,
            officeOrderId: row.workOrderId,
            workOrderNumber: row.workOrder?.number ?? null,
            performedAt: row.movedAt,
            aircraftHoursAtMovement: Number(row.aircraftHoursAtMovement),
            aircraftCyclesAtMovement: row.aircraftCyclesAtMovement,
            notes: appendMarker(row.notes, marker),
            performedById: row.performedById,
          },
        });

        this.report.componentMovements.created += 1;
      } catch (err) {
        pushLimited(this.report.unexpectedErrors, {
          source: 'ComponentHistory',
          legacyId: row.id,
          reason: String(err),
        });
      }
    }
  }
}
