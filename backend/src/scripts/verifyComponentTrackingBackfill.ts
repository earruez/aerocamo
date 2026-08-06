import { prisma } from '../infrastructure/database/prisma.client';
import { ComponentTrackingBackfillService } from '../domain/services/ComponentTrackingBackfillService';

type LegacyKind = 'component' | 'compliance';

type SampleCaseResult = {
  caseType: LegacyKind;
  legacyId: string;
  status: 'ok' | 'mismatch' | 'missing';
  checks: Record<string, boolean>;
  mismatches: string[];
  summary: Record<string, unknown>;
};

type TimelineResult = {
  componentId: string;
  instanceId: string | null;
  legacy: {
    historyCount: number;
    complianceCount: number;
    events: Array<{ at: string; type: string; ref: string }>;
  };
  canonical: {
    movementCount: number;
    applicationCount: number;
    events: Array<{ at: string; type: string; ref: string }>;
  };
  missingLegacyHistoryIds: string[];
  missingLegacyComplianceIds: string[];
  duplicatedLegacyHistoryIdsInCanonical: string[];
  duplicatedLegacyComplianceIdsInCanonical: string[];
};

function pct(n: number, d: number): number {
  if (d === 0) return 100;
  return Number(((n / d) * 100).toFixed(2));
}

function extractAll(text: string | null | undefined, regex: RegExp): string[] {
  if (!text) return [];
  const out: string[] = [];
  const clone = new RegExp(regex.source, regex.flags);
  let m = clone.exec(text);
  while (m) {
    out.push(m[1]);
    m = clone.exec(text);
  }
  return out;
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function main() {
  const startedAt = Date.now();

  const countsBefore = {
    componentInstance: await prisma.componentInstance.count(),
    componentApplication: await prisma.componentApplication.count(),
    componentMovement: await prisma.componentMovement.count(),
  };

  const backfillRun1 = await new ComponentTrackingBackfillService().run();

  const countsAfterRun1 = {
    componentInstance: await prisma.componentInstance.count(),
    componentApplication: await prisma.componentApplication.count(),
    componentMovement: await prisma.componentMovement.count(),
  };

  const backfillRun2 = await new ComponentTrackingBackfillService().run();

  const countsAfterRun2 = {
    componentInstance: await prisma.componentInstance.count(),
    componentApplication: await prisma.componentApplication.count(),
    componentMovement: await prisma.componentMovement.count(),
  };

  const [legacyComponents, legacyCompliancesAll, legacyCompliancesComponent, legacyHistory] = await Promise.all([
    prisma.component.findMany({ select: { id: true, organizationId: true, aircraftId: true, position: true, serialNumber: true, partNumber: true, installationDate: true, installationAircraftHours: true, installationAircraftCycles: true } }),
    prisma.compliance.findMany({ select: { id: true } }),
    prisma.compliance.findMany({ where: { componentId: { not: null } }, select: { id: true, organizationId: true, componentId: true, aircraftId: true, performedAt: true, aircraftHoursAtCompliance: true, aircraftCyclesAtCompliance: true, workOrderNumber: true, taskId: true } }),
    prisma.componentHistory.findMany({ select: { id: true, organizationId: true, componentId: true, aircraftId: true, movementType: true, position: true, movedAt: true, workOrderId: true } }),
  ]);

  const canonicalInstances = await prisma.componentInstance.findMany({
    select: { id: true, organizationId: true, legacyComponentId: true, aircraftId: true, position: true, installedAt: true, installedAtHours: true, installedAtCycles: true, serialNumber: true, partNumber: true },
  });

  const canonicalApplications = await prisma.componentApplication.findMany({
    select: { id: true, componentInstanceId: true, aircraftId: true, appliedAt: true, aircraftHoursAtApplication: true, aircraftCyclesAtApplication: true, workOrderNumber: true, workRequestId: true, officeOrderId: true, notes: true },
  });

  const canonicalMovements = await prisma.componentMovement.findMany({
    select: { id: true, removedComponentInstanceId: true, installedComponentInstanceId: true, aircraftId: true, position: true, movementType: true, performedAt: true, workOrderNumber: true, workRequestId: true, officeOrderId: true, notes: true },
  });

  const complianceMarkerRegex = /\[legacy:compliance:([0-9a-fA-F-]{36})\]/g;
  const historyMarkerRegex = /\[legacy:component_history:([0-9a-fA-F-]{36})\]/g;

  const mappedComplianceIds = new Map<string, number>();
  for (const app of canonicalApplications) {
    for (const id of extractAll(app.notes, complianceMarkerRegex)) {
      mappedComplianceIds.set(id, (mappedComplianceIds.get(id) ?? 0) + 1);
    }
  }

  const mappedHistoryIds = new Map<string, number>();
  for (const move of canonicalMovements) {
    for (const id of extractAll(move.notes, historyMarkerRegex)) {
      mappedHistoryIds.set(id, (mappedHistoryIds.get(id) ?? 0) + 1);
    }
  }

  const legacyComponentIds = new Set(legacyComponents.map((r) => r.id));
  const mappedInstanceLegacyIds = new Set(canonicalInstances.map((r) => r.legacyComponentId).filter((v): v is string => Boolean(v)));

  const legacyComplianceIds = new Set(legacyCompliancesAll.map((r) => r.id));
  const legacyHistoryIds = new Set(legacyHistory.map((r) => r.id));

  const missingComponentIds = [...legacyComponentIds].filter((id) => !mappedInstanceLegacyIds.has(id));
  const missingComplianceIds = [...legacyComplianceIds].filter((id) => !mappedComplianceIds.has(id));
  const missingHistoryIds = [...legacyHistoryIds].filter((id) => !mappedHistoryIds.has(id));

  const duplicateInstanceLegacy = (() => {
    const map = new Map<string, number>();
    for (const row of canonicalInstances) {
      if (!row.legacyComponentId) continue;
      const k = `${row.organizationId}:${row.legacyComponentId}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].filter(([, c]) => c > 1).map(([k, c]) => ({ key: k, count: c }));
  })();

  const duplicateComplianceMappings = [...mappedComplianceIds.entries()].filter(([, c]) => c > 1).map(([legacyId, count]) => ({ legacyId, count }));
  const duplicateHistoryMappings = [...mappedHistoryIds.entries()].filter(([, c]) => c > 1).map(([legacyId, count]) => ({ legacyId, count }));

  const sampleCandidates: Array<{ kind: LegacyKind; id: string }> = [
    ...legacyComponents.map((r) => ({ kind: 'component' as const, id: r.id })),
    ...legacyCompliancesComponent.map((r) => ({ kind: 'compliance' as const, id: r.id })),
  ];

  const sampled = shuffled(sampleCandidates).slice(0, Math.min(10, sampleCandidates.length));
  const sampleResults: SampleCaseResult[] = [];

  for (const sample of sampled) {
    if (sample.kind === 'component') {
      const legacy = legacyComponents.find((r) => r.id === sample.id)!;
      const instance = canonicalInstances.find((r) => r.legacyComponentId === legacy.id) ?? null;
      const applications = instance
        ? canonicalApplications.filter((a) => a.componentInstanceId === instance.id)
        : [];
      const movements = instance
        ? canonicalMovements.filter((m) => m.removedComponentInstanceId === instance.id || m.installedComponentInstanceId === instance.id)
        : [];

      const checks = {
        componentInstanceExists: Boolean(instance),
        aircraftContextMatches: instance ? instance.aircraftId === legacy.aircraftId : false,
        positionContextConsistent: instance ? (instance.position ?? '').trim().length > 0 : false,
        timestampConsistent: instance && legacy.installationDate
          ? new Date(instance.installedAt ?? 0).getTime() === new Date(legacy.installationDate).getTime()
          : true,
        hasApplicationOrMovement: applications.length > 0 || movements.length > 0,
      };

      const mismatches = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
      sampleResults.push({
        caseType: 'component',
        legacyId: legacy.id,
        status: !instance ? 'missing' : mismatches.length ? 'mismatch' : 'ok',
        checks,
        mismatches,
        summary: {
          instanceId: instance?.id ?? null,
          applications: applications.length,
          movements: movements.length,
          stLinks: applications.filter((a) => Boolean(a.workRequestId)).length,
          otLinks: applications.filter((a) => Boolean(a.workOrderNumber)).length,
        },
      });
      continue;
    }

    const legacy = legacyCompliancesComponent.find((r) => r.id === sample.id)!;
    const app = canonicalApplications.find((a) => extractAll(a.notes, complianceMarkerRegex).includes(legacy.id)) ?? null;
    const instance = app?.componentInstanceId
      ? canonicalInstances.find((i) => i.id === app.componentInstanceId) ?? null
      : null;

    const checks = {
      componentApplicationExists: Boolean(app),
      componentInstanceExists: Boolean(instance),
      aircraftContextMatches: app ? app.aircraftId === legacy.aircraftId : false,
      timestampConsistent: app ? new Date(app.appliedAt).getTime() === new Date(legacy.performedAt).getTime() : false,
      workOrderLinkConsistent: app ? (app.workOrderNumber ?? null) === (legacy.workOrderNumber ?? null) : false,
      stOtLinkAvailableIfLegacyOtExists: legacy.workOrderNumber ? Boolean(app?.officeOrderId || app?.workOrderNumber) : true,
    };

    const mismatches = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);

    sampleResults.push({
      caseType: 'compliance',
      legacyId: legacy.id,
      status: !app ? 'missing' : mismatches.length ? 'mismatch' : 'ok',
      checks,
      mismatches,
      summary: {
        applicationId: app?.id ?? null,
        instanceId: instance?.id ?? null,
        workRequestId: app?.workRequestId ?? null,
        officeOrderId: app?.officeOrderId ?? null,
      },
    });
  }

  const timelineCandidateIds = shuffled(legacyComponents.map((c) => c.id)).slice(0, Math.min(5, legacyComponents.length));
  const timelineResults: TimelineResult[] = [];

  for (const componentId of timelineCandidateIds) {
    const instance = canonicalInstances.find((r) => r.legacyComponentId === componentId) ?? null;

    const legacyH = legacyHistory
      .filter((h) => h.componentId === componentId)
      .sort((a, b) => new Date(a.movedAt).getTime() - new Date(b.movedAt).getTime());

    const legacyC = legacyCompliancesComponent
      .filter((c) => c.componentId === componentId)
      .sort((a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime());

    const canonM = instance
      ? canonicalMovements
          .filter((m) => m.removedComponentInstanceId === instance.id || m.installedComponentInstanceId === instance.id)
          .sort((a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime())
      : [];

    const canonA = instance
      ? canonicalApplications
          .filter((a) => a.componentInstanceId === instance.id)
          .sort((a, b) => new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime())
      : [];

    const mappedHistory = new Map<string, number>();
    for (const m of canonM) {
      for (const id of extractAll(m.notes, historyMarkerRegex)) {
        mappedHistory.set(id, (mappedHistory.get(id) ?? 0) + 1);
      }
    }

    const mappedCompliance = new Map<string, number>();
    for (const a of canonA) {
      for (const id of extractAll(a.notes, complianceMarkerRegex)) {
        mappedCompliance.set(id, (mappedCompliance.get(id) ?? 0) + 1);
      }
    }

    timelineResults.push({
      componentId,
      instanceId: instance?.id ?? null,
      legacy: {
        historyCount: legacyH.length,
        complianceCount: legacyC.length,
        events: [
          ...legacyH.map((e) => ({ at: new Date(e.movedAt).toISOString(), type: `history:${e.movementType}`, ref: e.id })),
          ...legacyC.map((e) => ({ at: new Date(e.performedAt).toISOString(), type: 'compliance:application', ref: e.id })),
        ].sort((a, b) => a.at.localeCompare(b.at)),
      },
      canonical: {
        movementCount: canonM.length,
        applicationCount: canonA.length,
        events: [
          ...canonM.map((e) => ({ at: new Date(e.performedAt).toISOString(), type: `movement:${e.movementType}`, ref: e.id })),
          ...canonA.map((e) => ({ at: new Date(e.appliedAt).toISOString(), type: 'application', ref: e.id })),
        ].sort((a, b) => a.at.localeCompare(b.at)),
      },
      missingLegacyHistoryIds: legacyH.map((e) => e.id).filter((id) => !mappedHistory.has(id)),
      missingLegacyComplianceIds: legacyC.map((e) => e.id).filter((id) => !mappedCompliance.has(id)),
      duplicatedLegacyHistoryIdsInCanonical: [...mappedHistory.entries()].filter(([, c]) => c > 1).map(([id]) => id),
      duplicatedLegacyComplianceIdsInCanonical: [...mappedCompliance.entries()].filter(([, c]) => c > 1).map(([id]) => id),
    });
  }

  const edgeCases = {
    componentsWithoutSerialNumber: await prisma.component.count({ where: { OR: [{ serialNumber: '' }, { serialNumber: ' ' }] } }),
    componentsWithMultipleReplacements: (() => {
      const groupCount = new Map<string, number>();
      const grouped = new Map<string, { hasInstall: boolean; hasRemove: boolean }>();
      for (const h of legacyHistory) {
        const key = `${h.componentId}|${h.aircraftId}|${h.workOrderId ?? 'none'}|${(h.position ?? '').trim().toUpperCase()}|${new Date(h.movedAt).toISOString()}`;
        const curr = grouped.get(key) ?? { hasInstall: false, hasRemove: false };
        if (h.movementType === 'INSTALLED') curr.hasInstall = true;
        if (h.movementType === 'REMOVED') curr.hasRemove = true;
        grouped.set(key, curr);
      }
      for (const [key, v] of grouped) {
        if (!(v.hasInstall && v.hasRemove)) continue;
        const componentId = key.split('|')[0];
        groupCount.set(componentId, (groupCount.get(componentId) ?? 0) + 1);
      }
      return [...groupCount.entries()].filter(([, c]) => c >= 2).length;
    })(),
    componentsMovedBetweenAircraft: (() => {
      const byComponent = new Map<string, Set<string>>();
      for (const h of legacyHistory) {
        const set = byComponent.get(h.componentId) ?? new Set<string>();
        set.add(h.aircraftId);
        byComponent.set(h.componentId, set);
      }
      return [...byComponent.values()].filter((s) => s.size > 1).length;
    })(),
    compliancesWithoutOT: await prisma.compliance.count({ where: { componentId: { not: null }, workOrderNumber: null } }),
    partialMetadataRecords: {
      componentsMissingPosition: await prisma.component.count({ where: { position: null } }),
      componentHistoryMissingPosition: await prisma.componentHistory.count({ where: { position: null } }),
      complianceMissingNotes: await prisma.compliance.count({ where: { componentId: { not: null }, notes: null } }),
    },
    invalidRelationships: {
      migratedApplicationsWithoutInstance: await prisma.componentApplication.count({
        where: {
          notes: { contains: '[legacy:compliance:' },
          componentInstanceId: null,
        },
      }),
      movementsWithoutInstanceLinks: await prisma.componentMovement.count({
        where: {
          OR: [
            { notes: { contains: '[legacy:component_history:' } },
            { notes: { contains: '[legacy:component_history_pair:' } },
          ],
          removedComponentInstanceId: null,
          installedComponentInstanceId: null,
        },
      }),
    },
  };

  const traceability = {
    instancesWithLegacyRef: await prisma.componentInstance.count({ where: { legacyComponentId: { not: null } } }),
    instancesWithoutLegacyRef: await prisma.componentInstance.count({ where: { legacyComponentId: null } }),
    applicationsWithLegacyMarker: canonicalApplications.filter((a) => extractAll(a.notes, complianceMarkerRegex).length > 0).length,
    applicationsWithoutLegacyMarker: canonicalApplications.filter((a) => extractAll(a.notes, complianceMarkerRegex).length === 0).length,
    movementsWithLegacyMarker: canonicalMovements.filter((m) => extractAll(m.notes, historyMarkerRegex).length > 0).length,
    movementsWithoutLegacyMarker: canonicalMovements.filter((m) => extractAll(m.notes, historyMarkerRegex).length === 0).length,
    orphanApplicationsByInstance: await prisma.componentApplication.count({
      where: {
        componentInstanceId: { not: null },
        componentInstance: { is: null },
      },
    }),
    orphanMovementsByInstanceRefs: {
      removed: await prisma.componentMovement.count({
        where: { removedComponentInstanceId: { not: null }, removedComponentInstance: { is: null } },
      }),
      installed: await prisma.componentMovement.count({
        where: { installedComponentInstanceId: { not: null }, installedComponentInstance: { is: null } },
      }),
    },
  };

  const globalCoverage = {
    components: {
      legacyTotal: legacyComponents.length,
      canonicalTotal: canonicalInstances.length,
      mappedLegacyIds: mappedInstanceLegacyIds.size,
      coveragePct: pct(mappedInstanceLegacyIds.size, legacyComponents.length),
      missingRecords: missingComponentIds.length,
      duplicateMappings: duplicateInstanceLegacy.length,
    },
    compliances: {
      legacyTotal: legacyCompliancesAll.length,
      legacyComponentScoped: legacyCompliancesComponent.length,
      canonicalTotal: canonicalApplications.length,
      mappedLegacyIds: mappedComplianceIds.size,
      coveragePctAgainstAllCompliance: pct(mappedComplianceIds.size, legacyCompliancesAll.length),
      coveragePctAgainstComponentCompliance: pct(mappedComplianceIds.size, legacyCompliancesComponent.length),
      missingRecords: missingComplianceIds.length,
      duplicateMappings: duplicateComplianceMappings.length,
    },
    componentHistory: {
      legacyTotal: legacyHistory.length,
      canonicalTotal: canonicalMovements.length,
      mappedLegacyIds: mappedHistoryIds.size,
      coveragePct: pct(mappedHistoryIds.size, legacyHistory.length),
      missingRecords: missingHistoryIds.length,
      duplicateMappings: duplicateHistoryMappings.length,
    },
  };

  const idempotency = {
    countsBefore,
    countsAfterRun1,
    countsAfterRun2,
    deltaRun1: {
      componentInstance: countsAfterRun1.componentInstance - countsBefore.componentInstance,
      componentApplication: countsAfterRun1.componentApplication - countsBefore.componentApplication,
      componentMovement: countsAfterRun1.componentMovement - countsBefore.componentMovement,
    },
    deltaRun2: {
      componentInstance: countsAfterRun2.componentInstance - countsAfterRun1.componentInstance,
      componentApplication: countsAfterRun2.componentApplication - countsAfterRun1.componentApplication,
      componentMovement: countsAfterRun2.componentMovement - countsAfterRun1.componentMovement,
    },
    backfillRun1,
    backfillRun2,
    isIdempotentOnSecondRun:
      (countsAfterRun2.componentInstance - countsAfterRun1.componentInstance) === 0
      && (countsAfterRun2.componentApplication - countsAfterRun1.componentApplication) === 0
      && (countsAfterRun2.componentMovement - countsAfterRun1.componentMovement) === 0,
  };

  const sampleSummary = {
    requested: 10,
    executed: sampleResults.length,
    ok: sampleResults.filter((r) => r.status === 'ok').length,
    mismatches: sampleResults.filter((r) => r.status === 'mismatch').length,
    missing: sampleResults.filter((r) => r.status === 'missing').length,
  };

  const blockingIssues: string[] = [];
  if (globalCoverage.components.missingRecords > 0) blockingIssues.push('missing-component-instance-records');
  if (globalCoverage.compliances.missingRecords > 0) blockingIssues.push('missing-component-application-records');
  if (globalCoverage.componentHistory.missingRecords > 0) blockingIssues.push('missing-component-movement-records');
  if (globalCoverage.components.duplicateMappings > 0) blockingIssues.push('duplicate-component-instance-mappings');
  if (globalCoverage.compliances.duplicateMappings > 0) blockingIssues.push('duplicate-component-application-mappings');
  if (globalCoverage.componentHistory.duplicateMappings > 0) blockingIssues.push('duplicate-component-movement-mappings');
  if (!idempotency.isIdempotentOnSecondRun) blockingIssues.push('non-idempotent-second-run');
  if (sampleSummary.executed < 10) blockingIssues.push('insufficient-random-sample-size');
  if (sampleSummary.mismatches > 0 || sampleSummary.missing > 0) blockingIssues.push('sample-validation-failures');
  if (traceability.orphanApplicationsByInstance > 0) blockingIssues.push('orphan-component-applications');
  if (traceability.orphanMovementsByInstanceRefs.removed > 0 || traceability.orphanMovementsByInstanceRefs.installed > 0) {
    blockingIssues.push('orphan-component-movements');
  }

  const conclusion = blockingIssues.length === 0 ? 'READY' : 'NOT_READY';

  const report = {
    status: 'ok',
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    globalCoverage,
    randomSampling: {
      summary: sampleSummary,
      cases: sampleResults,
    },
    timelineReconstruction: {
      requestedMin: 3,
      executed: timelineResults.length,
      components: timelineResults,
    },
    edgeCases,
    traceability,
    idempotency,
    conclusion,
    blockingIssues,
    diagnostics: {
      missingComponentIds: missingComponentIds.slice(0, 100),
      missingComplianceIds: missingComplianceIds.slice(0, 100),
      missingHistoryIds: missingHistoryIds.slice(0, 100),
      duplicateInstanceLegacy: duplicateInstanceLegacy.slice(0, 100),
      duplicateComplianceMappings: duplicateComplianceMappings.slice(0, 100),
      duplicateHistoryMappings: duplicateHistoryMappings.slice(0, 100),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error('[verify-component-tracking-backfill] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
