/**
 * seed_counter_types.ts
 *
 * Siembra el catálogo de contadores desde la tabla TN del Access y trae al nuevo
 * modelo las lecturas que ya existían en los campos fijos (horas y ciclos de
 * aeronave y de motor), para que haya una sola verdad y no dos.
 *
 * Uso:
 *   npx tsx prisma/seed_counter_types.ts --org-id <uuid> [--csv-dir data-tecnicopters] [--apply]
 */
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}

const ORG_ID = getArgValue('--org-id') ?? process.env.DEFAULT_ORG_ID ?? '';
const CSV_DIR = path.resolve(getArgValue('--csv-dir') ?? path.join(__dirname, '..', 'data'));
const APPLY = args.includes('--apply');

if (!ORG_ID) {
  console.error('Missing organization id. Use --org-id=<uuid>');
  process.exit(1);
}

/**
 * Alcance y unidad por contador. El Access guarda solo código y designación, así
 * que el resto se deduce del uso conocido: CNG y CTL son del motor, LND y RIN de
 * la aeronave, y las horas aplican a ambos.
 */
const KNOWN: Record<string, { scope: 'AIRCRAFT' | 'ENGINE' | 'BOTH'; unit: string; legacyField?: string; sortOrder: number }> = {
  HT:  { scope: 'BOTH',     unit: 'horas',       legacyField: 'aircraftHours', sortOrder: 1 },
  LND: { scope: 'AIRCRAFT', unit: 'aterrizajes', legacyField: 'aircraftCycles', sortOrder: 2 },
  RIN: { scope: 'AIRCRAFT', unit: 'ciclos',      sortOrder: 3 },
  CNG: { scope: 'ENGINE',   unit: 'ciclos',      legacyField: 'engineCycles',   sortOrder: 4 },
  CTL: { scope: 'ENGINE',   unit: 'ciclos',      sortOrder: 5 },
  CN1: { scope: 'ENGINE',   unit: 'ciclos',      sortOrder: 6 },
  CN2: { scope: 'ENGINE',   unit: 'ciclos',      sortOrder: 7 },
  CY:  { scope: 'BOTH',     unit: 'ciclos',      sortOrder: 8 },
  ARD: { scope: 'AIRCRAFT', unit: 'aterrizajes', sortOrder: 9 },
  SC:  { scope: 'BOTH',     unit: 'ciclos',      sortOrder: 10 },
  ETQ: { scope: 'ENGINE',   unit: 'eventos',     sortOrder: 11 },
  CCA: { scope: 'BOTH',     unit: 'ciclos',      sortOrder: 12 },
  HC:  { scope: 'BOTH',     unit: 'horas',       sortOrder: 13 },
};

type CsvRow = Record<string, string>;

function readCsv(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
      .on('data', (r: CsvRow) => rows.push(r))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

const clean = (v?: string) => (v ?? '').replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  const tnPath = path.join(CSV_DIR, 'TN.csv');
  const tnRows = fs.existsSync(tnPath) ? await readCsv(tnPath) : [];

  const admin = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  // ── Catálogo ──────────────────────────────────────────────────────────────
  let created = 0;
  const skipped: string[] = [];

  for (const row of tnRows) {
    const code = clean(row.TN).toUpperCase();
    const name = clean(row.DESIGNACION) || code;
    if (!code) continue;

    const known = KNOWN[code] ?? { scope: 'BOTH' as const, unit: 'ciclos', sortOrder: 50 };

    const existing = await prisma.counterType.findFirst({
      where: { organizationId: ORG_ID, code: { equals: code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) { skipped.push(code); continue; }

    if (APPLY) {
      await prisma.counterType.create({
        data: {
          organizationId: ORG_ID,
          code,
          name,
          unit: known.unit,
          scope: known.scope,
          legacyField: known.legacyField ?? null,
          sortOrder: known.sortOrder,
        },
      });
    }
    created += 1;
  }

  // Las horas del motor no tienen fila propia en TN pero sí se controlan.
  const engineHoursExists = await prisma.counterType.findFirst({
    where: { organizationId: ORG_ID, code: 'HRSM' },
    select: { id: true },
  });
  if (!engineHoursExists) {
    if (APPLY) {
      await prisma.counterType.create({
        data: {
          organizationId: ORG_ID,
          code: 'HRSM',
          name: 'HORAS MOTOR',
          unit: 'horas',
          scope: 'ENGINE',
          legacyField: 'engineHours',
          sortOrder: 4,
        },
      });
    }
    created += 1;
  }

  // ── Lecturas que ya existían ──────────────────────────────────────────────
  let readings = 0;
  if (APPLY) {
    const types = await prisma.counterType.findMany({
      where: { organizationId: ORG_ID, legacyField: { not: null } },
      select: { id: true, legacyField: true },
    });
    const byLegacy = new Map(types.map((t) => [t.legacyField as string, t.id]));

    const aircraftLogs = await prisma.aircraftUsageLog.findMany({
      where: { organizationId: ORG_ID },
      orderBy: { date: 'asc' },
    });
    for (const log of aircraftLogs) {
      for (const [field, value] of [
        ['aircraftHours', log.totalHours as Prisma.Decimal],
        ['aircraftCycles', new Prisma.Decimal(log.totalCycles)],
      ] as const) {
        const counterTypeId = byLegacy.get(field);
        if (!counterTypeId) continue;
        const dup = await prisma.counterReading.findFirst({
          where: { counterTypeId, aircraftId: log.aircraftId, readingDate: log.date },
          select: { id: true },
        });
        if (dup) continue;
        await prisma.counterReading.create({
          data: {
            organizationId: ORG_ID,
            counterTypeId,
            aircraftId: log.aircraftId,
            value,
            readingDate: log.date,
            source: log.source,
            recordedById: admin?.id ?? null,
          },
        });
        readings += 1;
      }
    }

    const engineLogs = await prisma.aircraftEngineUsageLog.findMany({
      where: { organizationId: ORG_ID },
      orderBy: { date: 'asc' },
    });
    for (const log of engineLogs) {
      for (const [field, value] of [
        ['engineHours', log.hours as Prisma.Decimal],
        ['engineCycles', new Prisma.Decimal(log.cycles)],
      ] as const) {
        const counterTypeId = byLegacy.get(field);
        if (!counterTypeId) continue;
        const dup = await prisma.counterReading.findFirst({
          where: { counterTypeId, engineId: log.engineId, readingDate: log.date },
          select: { id: true },
        });
        if (dup) continue;
        await prisma.counterReading.create({
          data: {
            organizationId: ORG_ID,
            counterTypeId,
            engineId: log.engineId,
            value,
            readingDate: log.date,
            source: 'manual',
            recordedById: admin?.id ?? null,
          },
        });
        readings += 1;
      }
    }
  }

  console.log(`=== Contadores configurables (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`TN del Access: ${tnRows.length} filas · tipos creados: ${created}` +
    (skipped.length ? ` · ya existían: ${skipped.join(', ')}` : ''));
  console.log(`Lecturas traídas desde los campos fijos: ${readings}`);
  if (!APPLY) console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
}

main()
  .catch((error) => {
    console.error('seed_counter_types failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
