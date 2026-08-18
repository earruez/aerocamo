import { prisma } from '../../infrastructure/database/prisma.client';
import { PrismaAircraftRepository } from '../../infrastructure/database/repositories/PrismaAircraftRepository';
import type { MaintenancePlanItem } from '../repositories/IAircraftRepository';
import { NotFoundError } from '../../shared/errors/AppError';

export type DueSourceType =
  | 'AD'
  | 'SB'
  | 'INSPECTION'
  | 'MIM'
  | 'DAN'
  | 'COMPONENT'
  | 'ENGINE_COMPONENT'
  | 'MOD';

export type DueMethod = 'H' | 'M' | 'C' | 'N1' | 'N2' | 'LND' | 'RIN';

export type DueStatus =
  | 'OVERDUE'
  | 'DUE_SOON'
  | 'OK'
  | 'NO_CONTEXT'
  | 'NOT_APPLICABLE'
  | 'COMPLIED';

export type DueComplianceType = 'REP' | 'UNA_VEZ' | 'AL_EVENTO';

export interface DueDimension {
  method: DueMethod;
  intervalValue: number | null;
  intervalUnit: string;
  nextDueValue: number | null;
  nextDueDate: Date | null;
  remainingValue: number | null;
  remainingUnit: string;
  status: DueStatus;
}

export interface DueRow {
  id: string;
  aircraftId: string;
  aircraftRegistration: string;
  sourceType: DueSourceType;
  sourceId: string;
  taskCode: string;
  ata: string | null;
  category: string;
  description: string;
  componentId: string | null;
  partNumber: string | null;
  serialNumber: string | null;
  requiresComponentTracking: boolean;
  equipmentScope: 'AIRCRAFT' | 'ENGINE';
  controlStartAt: Date | null;
  controlStartHours: number | null;
  hasRealCompliance: boolean;
  method: DueMethod;
  intervalValue: number | null;
  intervalUnit: string;
  lastComplianceValue: number | null;
  lastComplianceDate: Date | null;
  nextDueValue: number | null;
  nextDueDate: Date | null;
  remainingValue: number | null;
  remainingUnit: string;
  status: DueStatus;
  referenceOt: string | null;
  referenceSt: string | null;
  observations: string | null;
  evidenceReference: string | null;
  isApplicable: boolean;
  complianceType: DueComplianceType;
  sortKey: string;
  sourceDocumentReference: string | null;
  dimensions: DueDimension[];
  activeDimension: DueMethod;
  primaryDueDimension: DueMethod;
}

export interface DueSummary {
  totalRows: number;
  overdueCount: number;
  dueSoonCount: number;
  okCount: number;
  noContextCount: number;
  notApplicableCount: number;
  nearestDueItems: DueRow[];
  groupedByMethod: Record<string, number>;
  groupedBySourceType: Record<string, number>;
}

export interface DueRowsFilters {
  method?: DueMethod;
  sourceType?: DueSourceType;
}

const DUE_SOON_HOURS = 50;
const DUE_SOON_CYCLES = 25;
const DUE_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_ORDER: Record<DueStatus, number> = {
  OVERDUE: 0,
  DUE_SOON: 1,
  NO_CONTEXT: 2,
  OK: 3,
  COMPLIED: 4,
  NOT_APPLICABLE: 5,
};

const repo = new PrismaAircraftRepository();

type EngineCounterSnapshot = {
  hours: number;
  cycles: number;
};

function startsWithAny(input: string, values: string[]): boolean {
  return values.some((v) => input.includes(v));
}

const IMPORT_NOTE_PREFIX = /^\[IMPORT ACCESS ITEM\].*$/gm;

/**
 * Devuelve la observación operativa legible de un cumplimiento. Los registros
 * importados guardan la observación del Access tras "Obs:", precedida por una
 * línea técnica de trazabilidad que no aporta al usuario.
 */
function extractObservation(notes: string | null): string | null {
  if (!notes) return null;
  const obsMatch = notes.match(/^Obs:\s*(.+)$/m);
  const value = obsMatch
    ? obsMatch[1].trim()
    : notes.replace(IMPORT_NOTE_PREFIX, '').trim();
  if (!value) return null;
  // El marcador de baseline ya se comunica por el estado de la fila.
  if (value.toLowerCase() === 'inicio de control') return null;
  return value;
}

function mapSourceType(item: MaintenancePlanItem): DueSourceType {
  const refType = (item.referenceType ?? '').toUpperCase();
  const reference = `${item.referenceType ?? ''} ${item.referenceNumber ?? ''} ${item.taskCode} ${item.taskTitle}`.toUpperCase();

  if (refType === 'AD' || reference.includes(' AD ') || reference.startsWith('AD-')) return 'AD';
  if (refType === 'SB' || reference.includes(' SB ') || reference.includes(' TB ') || reference.includes('TB-')) return 'SB';
  if (reference.includes('MIM')) return 'MIM';
  if (reference.includes('DAN')) return 'DAN';
  if (startsWithAny(reference, ['MOD', 'ALTER', 'ALTERACION'])) return 'MOD';
  if (item.executionType === 'component_replacement') {
    // El ámbito viene del equipo de origen (EQ.TIP en Access), no de adivinar por texto.
    return item.equipmentScope === 'ENGINE' ? 'ENGINE_COMPONENT' : 'COMPONENT';
  }
  return 'INSPECTION';
}

function mapComplianceType(item: MaintenancePlanItem): DueComplianceType {
  if (item.intervalType === 'ON_CONDITION') return 'AL_EVENTO';
  if (item.referenceType === 'AD' && item.intervalType === 'ON_CONDITION') return 'UNA_VEZ';
  return 'REP';
}

/**
 * Las dimensiones de control se derivan de los límites efectivamente cargados, no
 * solo del intervalType declarado: una tarea puede tener límite por horas Y por
 * ciclos a la vez (el enum no tiene un tipo "horas o ciclos"), y descartar uno de
 * ellos ocultaría un vencimiento real. El intervalType queda como respaldo cuando
 * no hay ningún límite numérico cargado.
 */
function toIntervalDimensions(item: MaintenancePlanItem): Array<{ method: DueMethod; intervalValue: number | null; intervalUnit: string }> {
  const dims: Array<{ method: DueMethod; intervalValue: number | null; intervalUnit: string }> = [];

  if ((item.intervalHours ?? 0) > 0) {
    dims.push({ method: 'H', intervalValue: item.intervalHours, intervalUnit: 'FH' });
  }
  if ((item.intervalCycles ?? 0) > 0) {
    dims.push({ method: 'C', intervalValue: item.intervalCycles, intervalUnit: 'CYC' });
  }
  if ((item.intervalCalendarMonths ?? 0) > 0) {
    dims.push({ method: 'M', intervalValue: item.intervalCalendarMonths, intervalUnit: 'MONTHS' });
  } else if ((item.intervalCalendarDays ?? 0) > 0) {
    dims.push({ method: 'M', intervalValue: item.intervalCalendarDays, intervalUnit: 'DAYS' });
  }

  if (dims.length > 0) return dims;

  // Sin límites numéricos: conserva la dimensión declarada para no perder la fila.
  const intervalType = item.intervalType;
  if (intervalType === 'FLIGHT_HOURS' || intervalType === 'FLIGHT_HOURS_OR_CALENDAR') {
    return [{ method: 'H', intervalValue: item.intervalHours, intervalUnit: 'FH' }];
  }
  if (intervalType === 'CYCLES' || intervalType === 'CYCLES_OR_CALENDAR') {
    return [{ method: 'C', intervalValue: item.intervalCycles, intervalUnit: 'CYC' }];
  }
  if (intervalType === 'CALENDAR_DAYS') {
    return [{ method: 'M', intervalValue: item.intervalCalendarDays, intervalUnit: 'DAYS' }];
  }
  return [];
}

function computeDimensionStatus(method: DueMethod, remainingValue: number | null): DueStatus {
  if (remainingValue == null) return 'NO_CONTEXT';
  if (remainingValue < 0) return 'OVERDUE';
  if (method === 'H' && remainingValue <= DUE_SOON_HOURS) return 'DUE_SOON';
  if ((method === 'C' || method === 'N1' || method === 'N2' || method === 'LND' || method === 'RIN') && remainingValue <= DUE_SOON_CYCLES) {
    return 'DUE_SOON';
  }
  if (method === 'M' && remainingValue <= DUE_SOON_DAYS) return 'DUE_SOON';
  return 'OK';
}

function pickWorstDimension(dimensions: DueDimension[]): DueDimension {
  return [...dimensions].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])[0];
}

function renderSortKey(status: DueStatus, remainingValue: number | null): string {
  const remaining = remainingValue == null ? Number.MAX_SAFE_INTEGER : remainingValue;
  const normalized = String(Math.round(remaining * 100)).padStart(12, '0');
  return `${String(STATUS_ORDER[status]).padStart(2, '0')}-${normalized}`;
}

function methodUnit(method: DueMethod): string {
  if (method === 'H') return 'FH';
  if (method === 'M') return 'DAYS';
  if (method === 'C' || method === 'N1' || method === 'N2' || method === 'LND' || method === 'RIN') return 'CYC';
  return 'UNIT';
}

function nowDate(): Date {
  return new Date();
}

export class DueEngineService {
  private async getEngineCounterSnapshot(
    organizationId: string,
    aircraftId: string,
  ): Promise<Partial<Record<'N1' | 'N2', EngineCounterSnapshot>>> {
    const engines = await prisma.aircraftEngine.findMany({
      where: {
        organizationId,
        aircraftId,
      },
      include: {
        usageLogs: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
    });

    const map: Partial<Record<'N1' | 'N2', EngineCounterSnapshot>> = {};
    for (const engine of engines) {
      const latest = engine.usageLogs[0];
      if (!latest) continue;
      map[engine.position as 'N1' | 'N2'] = {
        hours: Number(latest.hours),
        cycles: latest.cycles,
      };
    }

    return map;
  }

  /**
   * Contexto por tarea tomado del último cumplimiento: componente físico asociado
   * (P/N + S/N) y la observación operativa registrada. Se resuelve en una sola
   * consulta por aeronave para no multiplicar queries por fila.
   */
  private async getComplianceContextByTask(
    organizationId: string,
    aircraftId: string,
  ): Promise<Map<string, {
    componentId: string | null;
    partNumber: string | null;
    serialNumber: string | null;
    observations: string | null;
  }>> {
    const rows = await prisma.compliance.findMany({
      where: { organizationId, aircraftId },
      select: {
        taskId: true,
        componentId: true,
        notes: true,
        performedAt: true,
        applicationType: true,
        component: { select: { partNumber: true, serialNumber: true } },
      },
      orderBy: { performedAt: 'desc' },
    });

    const map = new Map<string, {
      componentId: string | null;
      partNumber: string | null;
      serialNumber: string | null;
      observations: string | null;
    }>();

    for (const row of rows) {
      const current = map.get(row.taskId);
      // El primero (más reciente) fija la observación; un registro posterior con
      // componente completa el P/N-S/N si el más reciente no lo traía.
      if (!current) {
        map.set(row.taskId, {
          componentId: row.componentId,
          partNumber: row.component?.partNumber ?? null,
          serialNumber: row.component?.serialNumber ?? null,
          observations: extractObservation(row.notes),
        });
        continue;
      }
      if (!current.componentId && row.componentId) {
        current.componentId = row.componentId;
        current.partNumber = row.component?.partNumber ?? null;
        current.serialNumber = row.component?.serialNumber ?? null;
      }
      if (!current.observations) {
        current.observations = extractObservation(row.notes);
      }
    }

    return map;
  }

  async getDueRows(organizationId: string, aircraftId: string, filters?: DueRowsFilters): Promise<DueRow[]> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: {
        id: true,
        registration: true,
        totalFlightHours: true,
        totalCycles: true,
        model: true,
        serialNumber: true,
      },
    });

    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);

    const plan = await repo.getMaintenancePlan(aircraftId, organizationId);
    const currentHours = Number(aircraft.totalFlightHours);
    const currentCycles = aircraft.totalCycles;
    const engineCounters = await this.getEngineCounterSnapshot(organizationId, aircraftId);
    const complianceContext = await this.getComplianceContextByTask(organizationId, aircraftId);
    const now = nowDate();

    const rows: DueRow[] = plan.map((item) => {
      const sourceType = mapSourceType(item);
      const complianceType = mapComplianceType(item);
      const dimsConfig = toIntervalDimensions(item);

      const dimensions: DueDimension[] = dimsConfig.map((d) => {
        let nextDueValue: number | null = null;
        let nextDueDate: Date | null = null;
        let remainingValue: number | null = null;

        if (d.method === 'H') {
          nextDueValue = item.nextDueHours;
          remainingValue = item.nextDueHours != null ? item.nextDueHours - currentHours : null;
        } else if (d.method === 'C') {
          // item.cyclesRemaining ya lo calculó PrismaAircraftRepository contra el
          // contador correcto por equipo (célula o motor específico vía
          // EquipmentCounterSlot/CounterReading) — no contra aircraft.totalCycles
          // a secas, que es incorrecto para tareas de motor (ver comentario en
          // PrismaAircraftRepository.getMaintenancePlan).
          nextDueValue = item.nextDueCycles;
          remainingValue = item.cyclesRemaining;
        } else if (d.method === 'N1' || d.method === 'N2') {
          const engineCounter = engineCounters[d.method];
          const useHoursForDimension = item.nextDueHours != null && item.nextDueCycles == null;
          nextDueValue = useHoursForDimension
            ? item.nextDueHours
            : item.nextDueCycles;
          const authoritativeCounter = !engineCounter
            ? null
            : useHoursForDimension
              ? engineCounter.hours
              : engineCounter.cycles;
          remainingValue = nextDueValue != null && authoritativeCounter != null
            ? nextDueValue - authoritativeCounter
            : null;
        } else if (d.method === 'M') {
          nextDueDate = item.nextDueDate;
          remainingValue = item.nextDueDate ? Math.ceil((item.nextDueDate.getTime() - now.getTime()) / DAY_MS) : null;
        }

        return {
          method: d.method,
          intervalValue: d.intervalValue,
          intervalUnit: d.intervalUnit,
          nextDueValue,
          nextDueDate,
          remainingValue,
          remainingUnit: d.method === 'N1' || d.method === 'N2'
            ? (item.nextDueHours != null && item.nextDueCycles == null ? 'FH' : 'CYC')
            : methodUnit(d.method),
          status: computeDimensionStatus(d.method, remainingValue),
        };
      });

      const effectiveDimensions = dimensions.length > 0
        ? dimensions
        : [{
            method: 'H' as const,
            intervalValue: null,
            intervalUnit: 'FH',
            nextDueValue: item.nextDueHours,
            nextDueDate: item.nextDueDate,
            remainingValue: item.nextDueHours != null ? item.nextDueHours - currentHours : null,
            remainingUnit: 'FH',
            status: 'NO_CONTEXT' as DueStatus,
          }];

      const worst = pickWorstDimension(effectiveDimensions);
      const primaryDueDimension = worst.method;
      const isApplicable = true;

      const context = complianceContext.get(item.taskId);
      const observations = context?.observations
        ?? (!item.hasRealCompliance && item.controlStartAt
          ? 'Inicio de control registrado; falta cumplimiento real para ciclo operativo completo.'
          : null);

      return {
        id: `task-${item.taskId}`,
        aircraftId,
        aircraftRegistration: aircraft.registration,
        sourceType,
        sourceId: item.taskId,
        taskCode: item.taskCode,
        ata: item.taskAta,
        category: item.referenceType,
        description: item.taskTitle,
        componentId: context?.componentId ?? null,
        partNumber: context?.partNumber ?? null,
        serialNumber: context?.serialNumber ?? null,
        requiresComponentTracking: item.requiresComponentTracking,
        equipmentScope: item.equipmentScope,
        controlStartAt: item.controlStartAt,
        controlStartHours: item.controlStartHours,
        hasRealCompliance: item.hasRealCompliance,
        method: worst.method,
        intervalValue: worst.intervalValue,
        intervalUnit: worst.intervalUnit,
        lastComplianceValue: item.lastHoursAtCompliance,
        lastComplianceDate: item.lastPerformedAt,
        nextDueValue: worst.nextDueValue,
        nextDueDate: worst.nextDueDate,
        remainingValue: worst.remainingValue,
        remainingUnit: worst.remainingUnit,
        status: isApplicable ? worst.status : 'NOT_APPLICABLE',
        referenceOt: item.lastWorkOrder,
        referenceSt: item.inWorkRequestNumber,
        observations,
        evidenceReference: item.lastEvidenceUrl,
        isApplicable,
        complianceType,
        sortKey: renderSortKey(isApplicable ? worst.status : 'NOT_APPLICABLE', worst.remainingValue),
        sourceDocumentReference: `${item.referenceType} ${item.referenceNumber ?? item.taskCode}`,
        dimensions: effectiveDimensions,
        activeDimension: primaryDueDimension,
        primaryDueDimension,
      };
    });

    const componentRows = await this.buildComponentRows({
      organizationId,
      aircraftId,
      aircraftRegistration: aircraft.registration,
      currentHours,
      currentCycles,
      now,
    });

    const combined = [...rows, ...componentRows, ...this.buildNoContextCounterRows(aircraftId, aircraft.registration)];

    let filtered = combined;

    if (filters?.sourceType) {
      filtered = filtered.filter((row) => row.sourceType === filters.sourceType);
    }

    if (filters?.method) {
      filtered = filtered
        .filter((row) => row.dimensions.some((d) => d.method === filters.method))
        .map((row) => this.projectRowForMethod(row, filters.method!));
    }

    return filtered.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }

  async getDueSummary(organizationId: string, aircraftId: string): Promise<DueSummary> {
    const rows = await this.getDueRows(organizationId, aircraftId);

    const summary: DueSummary = {
      totalRows: rows.length,
      overdueCount: rows.filter((r) => r.status === 'OVERDUE').length,
      dueSoonCount: rows.filter((r) => r.status === 'DUE_SOON').length,
      okCount: rows.filter((r) => r.status === 'OK').length,
      noContextCount: rows.filter((r) => r.status === 'NO_CONTEXT').length,
      notApplicableCount: rows.filter((r) => r.status === 'NOT_APPLICABLE').length,
      nearestDueItems: rows
        .filter((r) => r.status === 'OVERDUE' || r.status === 'DUE_SOON' || r.status === 'OK')
        .slice(0, 8),
      groupedByMethod: {},
      groupedBySourceType: {},
    };

    for (const row of rows) {
      summary.groupedByMethod[row.method] = (summary.groupedByMethod[row.method] ?? 0) + 1;
      summary.groupedBySourceType[row.sourceType] = (summary.groupedBySourceType[row.sourceType] ?? 0) + 1;
    }

    return summary;
  }

  async getDueReportData(organizationId: string, aircraftId: string): Promise<{
    aircraft: {
      id: string;
      registration: string;
      model: string;
      serialNumber: string;
      totalHours: number;
      totalCycles: number;
    };
    summary: DueSummary;
    rows: DueRow[];
  }> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: {
        id: true,
        registration: true,
        model: true,
        serialNumber: true,
        totalFlightHours: true,
        totalCycles: true,
      },
    });

    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);

    const [summary, rows] = await Promise.all([
      this.getDueSummary(organizationId, aircraftId),
      this.getDueRows(organizationId, aircraftId),
    ]);

    return {
      aircraft: {
        id: aircraft.id,
        registration: aircraft.registration,
        model: aircraft.model,
        serialNumber: aircraft.serialNumber,
        totalHours: Number(aircraft.totalFlightHours),
        totalCycles: aircraft.totalCycles,
      },
      summary,
      rows,
    };
  }

  private projectRowForMethod(row: DueRow, method: DueMethod): DueRow {
    const dim = row.dimensions.find((d) => d.method === method);
    if (!dim) return row;
    return {
      ...row,
      method,
      intervalValue: dim.intervalValue,
      intervalUnit: dim.intervalUnit,
      nextDueValue: dim.nextDueValue,
      nextDueDate: dim.nextDueDate,
      remainingValue: dim.remainingValue,
      remainingUnit: dim.remainingUnit,
      status: dim.status,
      sortKey: renderSortKey(dim.status, dim.remainingValue),
      activeDimension: method,
    };
  }

  private buildNoContextCounterRows(aircraftId: string, aircraftRegistration: string): DueRow[] {
    const methods: DueMethod[] = ['N1', 'N2', 'LND', 'RIN'];
    return methods.map((method) => ({
      id: `counter-${method}`,
      aircraftId,
      aircraftRegistration,
      sourceType: 'ENGINE_COMPONENT',
      sourceId: `counter-${method}`,
      taskCode: `COUNTER-${method}`,
      ata: null,
      category: 'COUNTER',
      description: `Counter ${method}`,
      componentId: null,
      partNumber: null,
      serialNumber: null,
      requiresComponentTracking: false,
      equipmentScope: 'ENGINE' as const,
      controlStartAt: null,
      controlStartHours: null,
      hasRealCompliance: false,
      method,
      intervalValue: null,
      intervalUnit: methodUnit(method),
      lastComplianceValue: null,
      lastComplianceDate: null,
      nextDueValue: null,
      nextDueDate: null,
      remainingValue: null,
      remainingUnit: methodUnit(method),
      status: 'NO_CONTEXT',
      referenceOt: null,
      referenceSt: null,
      observations: 'No hay fuente explícita de contador operacional para este método.',
      evidenceReference: null,
      isApplicable: true,
      complianceType: 'REP',
      sortKey: renderSortKey('NO_CONTEXT', null),
      sourceDocumentReference: null,
      activeDimension: method,
      primaryDueDimension: method,
      dimensions: [
        {
          method,
          intervalValue: null,
          intervalUnit: methodUnit(method),
          nextDueValue: null,
          nextDueDate: null,
          remainingValue: null,
          remainingUnit: methodUnit(method),
          status: 'NO_CONTEXT',
        },
      ],
    }));
  }

  private async buildComponentRows(input: {
    organizationId: string;
    aircraftId: string;
    aircraftRegistration: string;
    currentHours: number;
    currentCycles: number;
    now: Date;
  }): Promise<DueRow[]> {
    const instances = await prisma.componentInstance.findMany({
      where: {
        organizationId: input.organizationId,
        aircraftId: input.aircraftId,
        status: 'installed',
      },
      include: {
        definition: true,
        applications: {
          where: {
            organizationId: input.organizationId,
            aircraftId: input.aircraftId,
          },
          orderBy: { appliedAt: 'desc' },
          take: 20,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const workRequestIds = Array.from(new Set(
      instances.flatMap((instance) => instance.applications.map((app) => app.workRequestId).filter(Boolean) as string[]),
    ));

    const workRequestById = new Map<string, string>();
    if (workRequestIds.length > 0) {
      const workRequests = await prisma.workRequest.findMany({
        where: {
          id: { in: workRequestIds },
          organizationId: input.organizationId,
        },
        select: { id: true, number: true },
      });
      for (const wr of workRequests) workRequestById.set(wr.id, wr.number);
    }

    return instances.map((instance) => {
      const real = instance.applications.find((a) => a.applicationType !== 'baseline') ?? null;
      const baseline = instance.applications.find((a) => a.applicationType === 'baseline') ?? null;
      const effective = real ?? baseline;

      const isEngine = instance.position.toUpperCase().includes('ENGINE')
        || instance.definition.ataCode.startsWith('72')
        || instance.definition.name.toUpperCase().includes('ENGINE')
        || instance.definition.description.toUpperCase().includes('ENGINE');

      const sourceType: DueSourceType = isEngine ? 'ENGINE_COMPONENT' : 'COMPONENT';

      const dimensions: DueDimension[] = [];
      const pushHourDimension = () => {
        const nextDueHours = effective?.nextDueHours != null ? Number(effective.nextDueHours) : null;
        const remaining = nextDueHours != null ? nextDueHours - input.currentHours : null;
        dimensions.push({
          method: 'H',
          intervalValue: instance.definition.intervalHours != null ? Number(instance.definition.intervalHours) : null,
          intervalUnit: 'FH',
          nextDueValue: nextDueHours,
          nextDueDate: null,
          remainingValue: remaining,
          remainingUnit: 'FH',
          status: computeDimensionStatus('H', remaining),
        });
      };
      const pushCycleDimension = () => {
        const nextDueCycles = effective?.nextDueCycles ?? null;
        const remaining = nextDueCycles != null ? nextDueCycles - input.currentCycles : null;
        dimensions.push({
          method: 'C',
          intervalValue: instance.definition.intervalCycles,
          intervalUnit: 'CYC',
          nextDueValue: nextDueCycles,
          nextDueDate: null,
          remainingValue: remaining,
          remainingUnit: 'CYC',
          status: computeDimensionStatus('C', remaining),
        });
      };
      const pushCalendarDimension = () => {
        const nextDueDate = effective?.nextDueDate ?? null;
        const remaining = nextDueDate ? Math.ceil((new Date(nextDueDate).getTime() - input.now.getTime()) / DAY_MS) : null;
        dimensions.push({
          method: 'M',
          intervalValue: instance.definition.intervalDays,
          intervalUnit: 'DAYS',
          nextDueValue: null,
          nextDueDate,
          remainingValue: remaining,
          remainingUnit: 'DAYS',
          status: computeDimensionStatus('M', remaining),
        });
      };

      if (instance.definition.intervalType === 'hours') pushHourDimension();
      else if (instance.definition.intervalType === 'cycles') pushCycleDimension();
      else if (instance.definition.intervalType === 'calendar') pushCalendarDimension();
      else {
        pushHourDimension();
        pushCycleDimension();
        pushCalendarDimension();
      }

      const effectiveDimensions = dimensions.length > 0
        ? dimensions
        : [{
            method: 'H' as const,
            intervalValue: null,
            intervalUnit: 'FH',
            nextDueValue: null,
            nextDueDate: null,
            remainingValue: null,
            remainingUnit: 'FH',
            status: 'NO_CONTEXT' as DueStatus,
          }];

      const worst = pickWorstDimension(effectiveDimensions);
      const primaryDueDimension = worst.method;

      const referenceSt = effective?.workRequestId ? (workRequestById.get(effective.workRequestId) ?? effective.workRequestId) : null;
      const observations = real
        ? null
        : baseline
          ? 'Inicio de control registrado; falta aplicación real posterior.'
          : 'Sin historial de aplicaciones para este componente.';

      return {
        id: `component-${instance.id}`,
        aircraftId: input.aircraftId,
        aircraftRegistration: input.aircraftRegistration,
        sourceType,
        sourceId: instance.id,
        taskCode: instance.definition.ataCode,
        ata: instance.definition.ataCode,
        category: instance.definition.ataCode,
        description: instance.definition.name,
        componentId: instance.id,
        partNumber: instance.partNumber,
        serialNumber: instance.serialNumber,
        requiresComponentTracking: true,
        equipmentScope: isEngine ? 'ENGINE' as const : 'AIRCRAFT' as const,
        controlStartAt: baseline?.appliedAt ?? null,
        controlStartHours: baseline ? Number(baseline.aircraftHoursAtApplication) : null,
        hasRealCompliance: Boolean(real),
        method: worst.method,
        intervalValue: worst.intervalValue,
        intervalUnit: worst.intervalUnit,
        lastComplianceValue: real ? Number(real.aircraftHoursAtApplication) : null,
        lastComplianceDate: real ? real.appliedAt : null,
        nextDueValue: worst.nextDueValue,
        nextDueDate: worst.nextDueDate,
        remainingValue: worst.remainingValue,
        remainingUnit: worst.remainingUnit,
        status: worst.status,
        referenceOt: effective?.workOrderNumber ?? null,
        referenceSt,
        observations,
        evidenceReference: null,
        isApplicable: true,
        complianceType: instance.definition.intervalType === 'mixed' ? 'REP' : 'REP',
        sortKey: renderSortKey(worst.status, worst.remainingValue),
        sourceDocumentReference: instance.definition.reference,
        dimensions: effectiveDimensions,
        activeDimension: primaryDueDimension,
        primaryDueDimension,
      };
    });
  }
}

export const dueEngineService = new DueEngineService();

export const dueEngineUtils = {
  computeDimensionStatus,
  pickWorstDimension,
  mapSourceType,
  toIntervalDimensions,
};
