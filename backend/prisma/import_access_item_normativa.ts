/**
 * import_access_item_normativa.ts
 *
 * Importa la tabla ITEM del Access (normativa AD / SB / MIM / Inspecciones / Componentes)
 * como MaintenanceTask + AircraftTask (aplicabilidad) + Compliance inicial (último cumplimiento).
 *
 * Uso:
 *   npx tsx prisma/import_access_item_normativa.ts --csv-dir data-tecnicopters --org-id <uuid> [--apply] [--user-id <uuid>]
 *
 * Sin --apply corre en modo dry-run: no escribe en la base, solo genera reportes:
 *   - item-normativa-report.json        (resumen y conflictos)
 *   - no-aplica-observaciones.csv       (observaciones de items marcados "No aplica")
 */
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient, Prisma, TaskIntervalType, ReferenceType } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return undefined;
}

const CSV_DIR = path.resolve(getArgValue('--csv-dir') ?? path.join(__dirname, '..', 'data'));
const ORG_ID = getArgValue('--org-id') ?? process.env.DEFAULT_ORG_ID ?? '';
const APPLY = args.includes('--apply');
const USER_ID_ARG = getArgValue('--user-id');

const IMPORT_MARKER = '[IMPORT ACCESS ITEM]';

if (!ORG_ID) {
  console.error('Missing organization id. Use --org-id=<uuid> or DEFAULT_ORG_ID in .env');
  process.exit(1);
}

type CsvRow = Record<string, string>;

type Domain = 'AD' | 'SB' | 'MIM' | 'IN' | 'COMP';

const DOMAIN_REFERENCE_TYPE: Record<Domain, ReferenceType> = {
  AD: 'AD',
  SB: 'SB',
  MIM: 'INTERNAL',
  IN: 'AMM',
  COMP: 'AMM',
};

const DOMAIN_LABEL: Record<Domain, string> = {
  AD: 'Normativa de fabricante (AD)',
  SB: 'Service Bulletin (SB)',
  MIM: 'Normativa nacional (DGAC / MIM)',
  IN: 'Inspecciones de manual',
  COMP: 'Componentes e inspecciones de motor',
};

interface EqInfo {
  mat: string;
  tip: string;
  marca: string;
  modelo: string;
}

interface ItemRecord {
  row: number;
  id: string;
  ide: string;
  domain: Domain;
  ata: string;
  pn: string;
  sn: string;
  objeto: string;
  rep: string;
  apl: string;
  met: string;
  limh: number | null;
  limt: number | null;
  limn1: number | null;
  hsult: number | null;
  fult: Date | null;
  n1ult: number | null;
  hscomp: number | null;
  fcomp: Date | null;
  n1comp: number | null;
  obs: string;
  eq: EqInfo;
}

function readCsv(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
      .on('data', (row: CsvRow) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function parseNumber(value: string | undefined): number | null {
  const raw = clean(value);
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** mdb-export emite fechas como MM/DD/YY HH:MM:SS (verificado con muestras dia>12). */
function parseMdbDate(value: string | undefined): Date | null {
  const raw = clean(value).split(' ')[0];
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year <= 68 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function resolveIntervalType(item: { limh: number | null; limt: number | null; limn1: number | null }): TaskIntervalType {
  if (item.limh != null && item.limt != null) return 'FLIGHT_HOURS_OR_CALENDAR';
  if (item.limn1 != null && item.limt != null) return 'CYCLES_OR_CALENDAR';
  if (item.limh != null) return 'FLIGHT_HOURS';
  if (item.limn1 != null) return 'CYCLES';
  if (item.limt != null) return 'CALENDAR_DAYS';
  return 'ON_CONDITION';
}

function slugModel(modelo: string): string {
  return modelo.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 12) || 'NA';
}

function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Muchas observaciones del Access llevan la referencia de la OT que sustentó el
 * cumplimiento ("OT DET/05-2026", "OT ABU/17-03"): la extraemos para que quede
 * visible como N° de OT del cumplimiento, sin perder el texto completo en notas.
 */
function extractWorkOrderRef(obs: string): string | null {
  // Formatos vistos: "OT DET/05-2026", "OT ABU/17-03", "OT DET 11/2025", "OT ANQ/23-06."
  const match = obs.match(/\bOT[\s.:]+([A-ZÑ0-9]+(?:[/\-.][A-ZÑ0-9/.\-]*)?(?:\s[0-9][0-9/.\-]*)?)/i);
  if (!match) return null;
  const ref = match[1].replace(/[.,;]+$/, '').trim();
  return ref ? `OT ${ref}`.slice(0, 50) : null;
}

/**
 * El Access no almacena el "PROXIMO": lo calcula como último + límite. En dominio
 * COMP, HSCOMP/N1COMP/FCOMP describen el estado del COMPONENTE al registrarlo
 * (horas/ciclos que ya traía y fecha FAB-OVH-INST), así que se descuentan:
 *   PROXIMO_H = HSULT + LIMH - HSCOMP   (palas CC-DET: 5430.8 + 20000 - 3630.2 = 21800.6 ✓)
 *   PROXIMO_F = FULT + LIMT meses       (battery: 12-nov-25 + 72M = nov-31 ✓)
 */
function computeNextDue(member: ItemRecord): {
  nextDueHours: number | null;
  nextDueDate: Date | null;
  nextDueCycles: number | null;
} {
  const isComponent = member.domain === 'COMP';
  const consumedHours = isComponent ? (member.hscomp ?? 0) : 0;
  const consumedCycles = isComponent ? (member.n1comp ?? 0) : 0;

  const nextDueHours = member.hsult != null && member.limh != null
    ? member.hsult + member.limh - consumedHours
    : null;
  const nextDueDate = member.fult != null && member.limt != null
    ? addMonthsUtc(member.fult, Math.round(member.limt))
    : null;
  const nextDueCycles = member.n1ult != null && member.limn1 != null
    ? Math.round(member.n1ult + member.limn1 - consumedCycles)
    : null;
  return { nextDueHours, nextDueDate, nextDueCycles };
}

async function main(): Promise<void> {
  const itemPath = path.join(CSV_DIR, 'ITEM.csv');
  const eqPath = path.join(CSV_DIR, 'EQ.csv');
  if (!fs.existsSync(itemPath)) throw new Error(`ITEM.csv not found in ${CSV_DIR}`);
  if (!fs.existsSync(eqPath)) throw new Error(`EQ.csv not found in ${CSV_DIR}`);

  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  if (!org) throw new Error(`Organization not found: ${ORG_ID}`);

  let performedById = USER_ID_ARG ?? null;
  if (!performedById) {
    const admin = await prisma.user.findFirst({
      where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    if (!admin) throw new Error('No active ADMIN user found for organization; pass --user-id');
    performedById = admin.id;
  }

  // ── EQ: IDE -> aeronave/equipo ────────────────────────────────────────────
  const eqRows = await readCsv(eqPath);
  const eqByIde = new Map<string, EqInfo>();
  for (const row of eqRows) {
    const ide = clean(row.IDE);
    if (!ide) continue;
    eqByIde.set(ide, {
      mat: clean(row.MAT).toUpperCase(),
      tip: clean(row.TIP).toUpperCase(),
      marca: clean(row.MARCA),
      modelo: clean(row.MODELO),
    });
  }

  const aircraftRows = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true, createdAt: true, totalFlightHours: true, totalCycles: true },
  });
  const aircraftByRegistration = new Map(aircraftRows.map((a) => [a.registration.toUpperCase(), a.id]));
  const aircraftById = new Map(aircraftRows.map((a) => [a.id, a]));

  // Componentes ya importados (import_access_csv --only componentes): clave aeronave|PN|SN
  const componentRows = await prisma.component.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, aircraftId: true, partNumber: true, serialNumber: true },
  });
  const componentByKey = new Map<string, string>();
  const componentsByAircraft = new Map<string, Array<{ id: string; pnN: string; snN: string }>>();
  const normAlnum = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  for (const component of componentRows) {
    if (!component.aircraftId) continue;
    const key = `${component.aircraftId}|${component.partNumber.toUpperCase().trim()}|${component.serialNumber.toUpperCase().trim()}`;
    componentByKey.set(key, component.id);
    const list = componentsByAircraft.get(component.aircraftId) ?? [];
    list.push({ id: component.id, pnN: normAlnum(component.partNumber), snN: normAlnum(component.serialNumber) });
    componentsByAircraft.set(component.aircraftId, list);
  }

  const MEANINGLESS_SN = new Set(['', 'SS', 'NA', 'SN', 'VARIOS']);

  /**
   * Match tolerante: el transform generó componentes "KIT ..." con PN/SN compuestos
   * (p. ej. "KIT S1820516-99 BATTERY (S1820506-01)"), así que si el match exacto
   * falla buscamos por contención de PN (y SN cuando es significativo); solo
   * vinculamos si hay exactamente un candidato.
   */
  const resolveComponentId = (aircraftId: string, pn: string, sn: string): string | null => {
    const exact = componentByKey.get(`${aircraftId}|${pn.toUpperCase().trim()}|${sn.toUpperCase().trim()}`);
    if (exact) return exact;

    const pnN = normAlnum(pn);
    if (!pnN) return null;
    const snN = normAlnum(sn);
    const snMeaningful = !MEANINGLESS_SN.has(snN);

    const candidates = (componentsByAircraft.get(aircraftId) ?? []).filter((c) => {
      const pnMatches = c.pnN.includes(pnN) || pnN.includes(c.pnN);
      if (!pnMatches) return false;
      if (!snMeaningful) return true;
      return c.snN.includes(snN) || snN.includes(c.snN);
    });

    return candidates.length === 1 ? candidates[0].id : null;
  };

  // Asociaciones tarea↔componente ya existentes (cualquier compliance con componentId)
  const existingAssociations = await prisma.compliance.findMany({
    where: { organizationId: ORG_ID, componentId: { not: null } },
    select: { taskId: true, aircraftId: true },
  });
  const associationKeys = new Set(existingAssociations.map((c) => `${c.taskId}|${c.aircraftId}`));

  // ── ITEM ──────────────────────────────────────────────────────────────────
  const rawItems = await readCsv(itemPath);
  const items: ItemRecord[] = [];
  const skipped: Array<{ row: number; id: string; reason: string; detail: string }> = [];

  rawItems.forEach((row, index) => {
    const rowNumber = index + 2;
    const domainRaw = clean(row.TIPO).toUpperCase();
    if (!['AD', 'SB', 'MIM', 'IN', 'COMP'].includes(domainRaw)) {
      skipped.push({ row: rowNumber, id: clean(row.Id), reason: 'unknown_domain', detail: domainRaw });
      return;
    }
    const ide = clean(row.IDE);
    const eq = eqByIde.get(ide);
    if (!eq) {
      skipped.push({ row: rowNumber, id: clean(row.Id), reason: 'ide_not_in_eq', detail: ide });
      return;
    }
    if (!aircraftByRegistration.has(eq.mat)) {
      skipped.push({ row: rowNumber, id: clean(row.Id), reason: 'aircraft_not_imported', detail: eq.mat });
      return;
    }

    items.push({
      row: rowNumber,
      id: clean(row.Id),
      ide,
      domain: domainRaw as Domain,
      ata: clean(row.ATA),
      pn: clean(row.PN),
      sn: clean(row.SN),
      objeto: clean(row.OBJETO),
      rep: clean(row.REP).toUpperCase(),
      apl: clean(row.APL),
      met: clean(row.MET).toUpperCase(),
      limh: parseNumber(row.LIMH),
      limt: parseNumber(row.LIMT),
      limn1: parseNumber(row.LIMN1),
      hsult: parseNumber(row.HSULT),
      fult: parseMdbDate(row.FULT),
      n1ult: parseNumber(row.N1ULT),
      hscomp: parseNumber(row.HSCOMP),
      fcomp: parseMdbDate(row.FCOMP),
      n1comp: parseNumber(row.N1COMP),
      obs: clean(row.OBS),
      eq,
    });
  });

  // ── Agrupar en tareas: una MaintenanceTask por (dominio, código, modelo) ──
  interface TaskGroup {
    key: string;
    code: string;
    domain: Domain;
    ata: string;
    modelo: string;
    title: string;
    members: ItemRecord[];
    intervalConflicts: string[];
  }

  const groups = new Map<string, TaskGroup>();
  const codeOwners = new Map<string, string>(); // code -> group key

  for (const item of items) {
    // COMP: un mismo capítulo ATA agrupa componentes físicos distintos (swashplate,
    // tornillos, eje...) y un mismo P/N puede tener varias instancias instaladas
    // (3 palas de rotor, 6 flanges) cada una con su propio control en Access —
    // P/N y S/N forman parte de la identidad de la tarea.
    const pnSlug = item.pn ? item.pn.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 16) : '';
    const snSlugRaw = item.sn ? item.sn.replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 16) : '';
    const snSlug = MEANINGLESS_SN.has(snSlugRaw) ? '' : snSlugRaw;
    const codeBase = item.domain === 'COMP' && item.ata && pnSlug
      ? `${item.ata}-${pnSlug}${snSlug ? `-${snSlug}` : ''}`
      : (item.ata || `ID${item.id}`);
    const key = `${item.domain}|${codeBase}|${item.eq.modelo.toUpperCase()}`;

    let group = groups.get(key);
    if (!group) {
      let code = truncate(`${item.domain}-${codeBase}`, 100);
      if (codeOwners.has(code) && codeOwners.get(code) !== key) {
        code = truncate(`${item.domain}-${codeBase}-${slugModel(item.eq.modelo)}`, 100);
      }
      let attempt = 2;
      while (codeOwners.has(code) && codeOwners.get(code) !== key) {
        code = truncate(`${item.domain}-${codeBase}-${slugModel(item.eq.modelo)}-${attempt}`, 100);
        attempt += 1;
      }
      codeOwners.set(code, key);
      const baseTitle = item.objeto || `${item.domain} ${codeBase}`;
      group = {
        key,
        code,
        domain: item.domain,
        ata: item.ata,
        modelo: item.eq.modelo,
        title: item.domain === 'COMP' && snSlug ? `${baseTitle} (S/N ${item.sn})` : baseTitle,
        members: [],
        intervalConflicts: [],
      };
      groups.set(key, group);
    }

    // Detectar conflictos de intervalos dentro del grupo (mismo código y modelo)
    const first = group.members[0];
    if (first) {
      for (const field of ['limh', 'limt', 'limn1'] as const) {
        if (first[field] != null && item[field] != null && first[field] !== item[field]) {
          group.intervalConflicts.push(
            `${field.toUpperCase()}: ${first[field]} (fila ${first.row}) vs ${item[field]} (fila ${item.row})`,
          );
        }
      }
    }
    group.members.push(item);
  }

  // ── Resumen previo ────────────────────────────────────────────────────────
  const summary = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    organizationId: ORG_ID,
    csvDir: CSV_DIR,
    itemRows: rawItems.length,
    usableItems: items.length,
    skipped: skipped.length,
    taskGroups: groups.size,
    byDomain: {} as Record<string, number>,
    byScope: { AIRCRAFT: 0, ENGINE: 0 } as Record<string, number>,
    links: { active: 0, inactive: 0 },
    compliances: { toCreate: 0, skippedNoDate: 0, alreadyImported: 0 },
    components: { linked: 0, baselinesToCreate: 0, unmatched: 0 },
    conflicts: [] as Array<{ code: string; detail: string[] }>,
    unmatchedComponents: [] as Array<{ mat: string; code: string; pn: string; sn: string }>,
    applied: { tasksCreated: 0, tasksUpdated: 0, linksUpserted: 0, compliancesCreated: 0, componentBaselinesCreated: 0, installationsBackfilled: 0 },
  };

  for (const item of items) {
    summary.byDomain[item.domain] = (summary.byDomain[item.domain] ?? 0) + 1;
    summary.byScope[item.eq.tip.startsWith('EN') ? 'ENGINE' : 'AIRCRAFT'] += 1;
  }
  for (const group of groups.values()) {
    if (group.intervalConflicts.length > 0) {
      summary.conflicts.push({ code: group.code, detail: group.intervalConflicts.slice(0, 5) });
    }
  }

  // Observaciones de "No aplica" (sidecar auditable; la plataforma aún no tiene campo por aeronave)
  const noAplicaRows: string[][] = [['MAT', 'CODIGO', 'DOMINIO', 'OBJETO', 'OBSERVACION']];
  for (const group of groups.values()) {
    for (const member of group.members) {
      if (member.apl === 'No') {
        noAplicaRows.push([member.eq.mat, group.code, member.domain, truncate(member.objeto, 120), member.obs]);
      }
    }
  }

  const existingImportedCompliances = await prisma.compliance.findMany({
    where: { organizationId: ORG_ID, notes: { startsWith: IMPORT_MARKER } },
    select: { id: true, taskId: true, aircraftId: true },
  });
  const importedComplianceIdByKey = new Map(existingImportedCompliances.map((c) => [`${c.taskId}|${c.aircraftId}`, c.id]));

  // ── Persistencia ──────────────────────────────────────────────────────────
  for (const group of groups.values()) {
    const representative = group.members[0];
    const intervalType = resolveIntervalType(representative);
    const isMandatory = group.domain === 'AD' || group.domain === 'MIM';
    const requiresInspection = group.domain === 'IN' || group.domain === 'COMP';
    const descriptionParts = [
      DOMAIN_LABEL[group.domain],
      representative.objeto,
      representative.rep ? `Recurrencia: ${representative.rep}` : null,
      representative.met ? `Método: ${representative.met}` : null,
      representative.sn ? `S/N: ${representative.sn}` : null,
      `${IMPORT_MARKER} fila ${representative.row}`,
    ].filter(Boolean);

    const taskData = {
      // EQ.TIP distingue célula (AN) de motor (EN1/EN2): es el criterio del propio
      // Access para separar sus vistas COMP1 / COMP.
      equipmentScope: representative.eq.tip.startsWith('EN') ? 'ENGINE' as const : 'AIRCRAFT' as const,
      title: truncate(group.title, 255),
      description: descriptionParts.join('\n'),
      intervalType,
      intervalHours: representative.limh != null ? new Prisma.Decimal(representative.limh) : null,
      intervalCycles: representative.limn1 != null ? Math.round(representative.limn1) : null,
      intervalCalendarDays: null as number | null,
      intervalCalendarMonths: representative.limt != null ? Math.round(representative.limt) : null,
      referenceType: DOMAIN_REFERENCE_TYPE[group.domain],
      referenceNumber: group.ata ? truncate(group.ata, 100) : null,
      isMandatory,
      requiresInspection,
      applicableModel: group.modelo ? truncate(group.modelo, 150) : null,
      applicablePartNumber: group.domain === 'COMP' && representative.pn ? truncate(representative.pn, 100) : null,
      isActive: true,
    };

    let taskId: string | null = null;

    if (APPLY) {
      const existing = await prisma.maintenanceTask.findUnique({
        where: { code_organizationId: { code: group.code, organizationId: ORG_ID } },
        select: { id: true },
      });
      if (existing) {
        await prisma.maintenanceTask.update({ where: { id: existing.id }, data: taskData });
        taskId = existing.id;
        summary.applied.tasksUpdated += 1;
      } else {
        const created = await prisma.maintenanceTask.create({
          data: { ...taskData, code: group.code, organizationId: ORG_ID },
          select: { id: true },
        });
        taskId = created.id;
        summary.applied.tasksCreated += 1;
      }
    }

    // Un link + (opcional) compliance inicial por aeronave del grupo
    const byAircraft = new Map<string, ItemRecord>();
    for (const member of group.members) {
      // Si hay filas duplicadas por aeronave, gana la que tenga cumplimiento más reciente
      const current = byAircraft.get(member.eq.mat);
      if (!current) {
        byAircraft.set(member.eq.mat, member);
      } else if ((member.fult?.getTime() ?? 0) > (current.fult?.getTime() ?? 0)) {
        byAircraft.set(member.eq.mat, member);
      }
    }

    for (const [mat, member] of byAircraft) {
      const aircraftId = aircraftByRegistration.get(mat)!;
      const isApplicable = member.apl !== 'No';
      if (isApplicable) summary.links.active += 1;
      else summary.links.inactive += 1;

      // Vincular con el componente físico importado (dominio COMP, match por PN+SN)
      let componentId: string | null = null;
      if (group.domain === 'COMP' && member.pn) {
        componentId = resolveComponentId(aircraftId, member.pn, member.sn);
        if (componentId) {
          summary.components.linked += 1;
        } else {
          summary.components.unmatched += 1;
          summary.unmatchedComponents.push({ mat, code: group.code, pn: member.pn, sn: member.sn });
        }
      }

      const hasCompliance = member.fult != null;
      if (member.hsult != null && member.fult == null) summary.compliances.skippedNoDate += 1;

      if (APPLY && taskId) {
        await prisma.aircraftTask.upsert({
          where: { aircraftId_taskId: { aircraftId, taskId } },
          create: { aircraftId, taskId, isActive: isApplicable },
          update: { isActive: isApplicable },
        });
        summary.applied.linksUpserted += 1;
      }

      if (!hasCompliance) {
        // Sin historial de cumplimiento: si el componente físico matchea, creamos el
        // "Inicio de control" con componente asociado (equivalente a /components/initial-registration)
        if (componentId && !(taskId && associationKeys.has(`${taskId}|${aircraftId}`))) {
          summary.components.baselinesToCreate += 1;
          if (APPLY && taskId) {
            const aircraft = aircraftById.get(aircraftId)!;
            const baseHours = Number(aircraft.totalFlightHours);
            const baseCycles = aircraft.totalCycles;
            const baseDate = aircraft.createdAt;
            // Con HSULT del Access (control por horas sin fecha) se usa ese punto real
            // de partida y se descuentan las horas/ciclos que el componente ya traía
            // (HSCOMP/N1COMP). Sin ningún dato, se parte de los contadores actuales.
            const hoursAt = member.hsult ?? baseHours;
            const cyclesAt = member.n1ult != null ? Math.round(member.n1ult) : baseCycles;
            const hasAccessControlData = member.hsult != null || member.n1ult != null;
            await prisma.compliance.create({
              data: {
                organizationId: ORG_ID,
                aircraftId,
                taskId,
                componentId,
                performedById: performedById!,
                inspectedById: null,
                performedAt: baseDate,
                aircraftHoursAtCompliance: new Prisma.Decimal(hoursAt),
                aircraftCyclesAtCompliance: cyclesAt,
                nextDueHours: member.limh != null
                  ? new Prisma.Decimal(hoursAt + member.limh - (member.hscomp ?? 0))
                  : null,
                nextDueCycles: member.limn1 != null
                  ? Math.round(cyclesAt + member.limn1 - (member.n1comp ?? 0))
                  : null,
                nextDueDate: member.limt != null && !hasAccessControlData
                  ? addMonthsUtc(baseDate, Math.round(member.limt))
                  : null,
                workOrderNumber: null,
                applicationType: 'baseline',
                isInitial: true,
                status: 'COMPLETED',
                notes: 'Inicio de control',
              },
            });
            associationKeys.add(`${taskId}|${aircraftId}`);
            summary.applied.componentBaselinesCreated += 1;
          }
        }
        continue;
      }

      const nextDue = computeNextDue(member);
      const existingComplianceId = taskId ? importedComplianceIdByKey.get(`${taskId}|${aircraftId}`) : undefined;

      if (existingComplianceId) {
        summary.compliances.alreadyImported += 1;
        if (APPLY) {
          const workOrderRef = extractWorkOrderRef(member.obs);
          await prisma.compliance.update({
            where: { id: existingComplianceId },
            data: {
              nextDueHours: nextDue.nextDueHours != null ? new Prisma.Decimal(nextDue.nextDueHours) : null,
              nextDueCycles: nextDue.nextDueCycles,
              nextDueDate: nextDue.nextDueDate,
              ...(componentId ? { componentId } : {}),
              ...(workOrderRef ? { workOrderNumber: workOrderRef } : {}),
            },
          });
        }
        continue;
      }
      summary.compliances.toCreate += 1;

      if (APPLY && taskId) {
        const notes = [
          `${IMPORT_MARKER} Último cumplimiento importado desde Access (fila ${member.row})`,
          member.obs ? `Obs: ${member.obs}` : null,
        ].filter(Boolean).join('\n');

        await prisma.compliance.create({
          data: {
            organizationId: ORG_ID,
            aircraftId,
            taskId,
            componentId,
            performedById: performedById!,
            inspectedById: null,
            performedAt: member.fult!,
            aircraftHoursAtCompliance: new Prisma.Decimal(member.hsult ?? 0),
            aircraftCyclesAtCompliance: member.n1ult != null ? Math.round(member.n1ult) : 0,
            nextDueHours: nextDue.nextDueHours != null ? new Prisma.Decimal(nextDue.nextDueHours) : null,
            nextDueCycles: nextDue.nextDueCycles,
            nextDueDate: nextDue.nextDueDate,
            workOrderNumber: extractWorkOrderRef(member.obs),
            applicationType: 'application',
            isInitial: true,
            status: 'COMPLETED',
            notes,
          },
        });
        summary.applied.compliancesCreated += 1;
      }
    }
  }

  // ── Respaldo de instalación ───────────────────────────────────────────────
  // El historial de movimientos exige un INSTALLED previo para poder registrar una
  // remoción. Los componentes importados llegan sin instalación registrada, así que
  // la derivamos del primer cumplimiento conocido (o de la línea base de la aeronave).
  if (APPLY) {
    const linkedComponents = await prisma.component.findMany({
      where: {
        organizationId: ORG_ID,
        aircraftId: { not: null },
        history: { none: {} },
      },
      select: { id: true, aircraftId: true, installationDate: true },
    });

    for (const component of linkedComponents) {
      const firstCompliance = await prisma.compliance.findFirst({
        where: { organizationId: ORG_ID, componentId: component.id },
        orderBy: { performedAt: 'asc' },
        select: { performedAt: true, aircraftHoursAtCompliance: true, aircraftCyclesAtCompliance: true },
      });

      const aircraft = aircraftById.get(component.aircraftId!);
      if (!aircraft) continue;

      const installedAt = firstCompliance?.performedAt ?? component.installationDate ?? aircraft.createdAt;
      const installedHours = firstCompliance ? Number(firstCompliance.aircraftHoursAtCompliance) : Number(aircraft.totalFlightHours);
      const installedCycles = firstCompliance ? firstCompliance.aircraftCyclesAtCompliance : aircraft.totalCycles;

      await prisma.$transaction(async (tx) => {
        await tx.component.update({
          where: { id: component.id },
          data: {
            installationDate: installedAt,
            installationAircraftHours: new Prisma.Decimal(installedHours),
            installationAircraftCycles: installedCycles,
            status: 'INSTALLED',
          },
        });

        await tx.componentHistory.create({
          data: {
            organizationId: ORG_ID,
            componentId: component.id,
            aircraftId: component.aircraftId!,
            movementType: 'INSTALLED',
            aircraftHoursAtMovement: new Prisma.Decimal(installedHours),
            aircraftCyclesAtMovement: installedCycles,
            componentHoursAtMovement: new Prisma.Decimal(0),
            componentCyclesAtMovement: 0,
            position: null,
            workOrderId: null,
            performedById: performedById!,
            notes: `${IMPORT_MARKER} Instalación de referencia derivada del historial de Access`,
            movedAt: installedAt,
          },
        });
      });

      summary.applied.installationsBackfilled += 1;
    }
  }

  // ── Reportes ──────────────────────────────────────────────────────────────
  const csvEscape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  fs.writeFileSync(
    path.join(CSV_DIR, 'no-aplica-observaciones.csv'),
    noAplicaRows.map((row) => row.map(csvEscape).join(',')).join('\n'),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(CSV_DIR, 'item-normativa-report.json'),
    JSON.stringify({ summary, skipped }, null, 2),
    'utf-8',
  );

  console.log('=== ITEM normativa import ===');
  console.log(`Mode: ${summary.mode}`);
  console.log(`ITEM rows: ${summary.itemRows} | usables: ${summary.usableItems} | descartadas: ${summary.skipped}`);
  console.log(`Tareas (grupos dominio+código+modelo): ${summary.taskGroups}`);
  console.log(`Por dominio: ${JSON.stringify(summary.byDomain)}`);
  console.log(`Por equipo: aeronave=${summary.byScope.AIRCRAFT} motor=${summary.byScope.ENGINE}`);
  console.log(`Links aeronave-tarea: activos=${summary.links.active} noAplica=${summary.links.inactive}`);
  console.log(`Cumplimientos: aCrear=${summary.compliances.toCreate} sinFecha=${summary.compliances.skippedNoDate} yaImportados=${summary.compliances.alreadyImported}`);
  console.log(`Componentes: vinculados=${summary.components.linked} iniciosDeControl=${summary.components.baselinesToCreate} sinMatch=${summary.components.unmatched}`);
  console.log(`Conflictos de intervalo: ${summary.conflicts.length} (ver item-normativa-report.json)`);
  if (APPLY) {
    console.log(`Aplicado: tareas +${summary.applied.tasksCreated} / ~${summary.applied.tasksUpdated}, links ${summary.applied.linksUpserted}, cumplimientos ${summary.applied.compliancesCreated}, iniciosDeControl ${summary.applied.componentBaselinesCreated}, instalacionesRespaldadas ${summary.applied.installationsBackfilled}`);
  } else {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
  }
}

main()
  .catch((error) => {
    console.error('import_access_item_normativa failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
