/**
 * import_access_mod_alteraciones.ts
 *
 * Importa la tabla MOD del Access como alteraciones de aeronave
 * (STC / Formulario DGAC 337) con su suplemento de manual de vuelo (FMS)
 * e instrucciones de aeronavegabilidad continuada (ICA).
 *
 * Uso:
 *   npx tsx prisma/import_access_mod_alteraciones.ts --csv-dir data-tecnicopters --org-id <uuid> [--apply]
 *
 * Sin --apply corre en dry-run: no escribe nada y genera mod-alteraciones-report.json
 */
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient } from '@prisma/client';

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

if (!ORG_ID) {
  console.error('Missing organization id. Use --org-id=<uuid> or DEFAULT_ORG_ID in .env');
  process.exit(1);
}

type CsvRow = Record<string, string>;

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

/** mdb-export emite fechas como MM/DD/YY. */
function parseMdbDate(value: string | undefined): Date | null {
  const raw = clean(value).split(' ')[0];
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += year <= 68 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const NEGATIVE = new Set(['NO', 'N/A', 'NA', '-', '--', 'SIN', 'NINGUNO']);
const POSITIVE = new Set(['SI', 'SÍ', 'YES', 'X']);

/**
 * FMS e ICA responden "¿tiene?" pero a veces traen directamente la referencia del
 * documento (p. ej. "AFS-AS350B-IBF-ICA"): en ese caso la respuesta es sí y el
 * texto es la referencia.
 */
function parseFlag(value: string | undefined): { has: boolean; reference: string | null } {
  const raw = clean(value);
  if (!raw) return { has: false, reference: null };
  const upper = raw.toUpperCase();
  if (NEGATIVE.has(upper)) return { has: false, reference: null };
  if (POSITIVE.has(upper)) return { has: true, reference: null };
  return { has: true, reference: raw.slice(0, 255) };
}

async function main(): Promise<void> {
  const modPath = path.join(CSV_DIR, 'MOD.csv');
  const eqPath = path.join(CSV_DIR, 'EQ.csv');
  if (!fs.existsSync(modPath)) throw new Error(`MOD.csv not found in ${CSV_DIR}`);
  if (!fs.existsSync(eqPath)) throw new Error(`EQ.csv not found in ${CSV_DIR}`);

  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  if (!org) throw new Error(`Organization not found: ${ORG_ID}`);

  const admin = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  const eqRows = await readCsv(eqPath);
  const matByIde = new Map<string, string>();
  for (const row of eqRows) {
    const ide = clean(row.IDE);
    if (ide) matByIde.set(ide, clean(row.MAT).toUpperCase());
  }

  const aircraftRows = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true },
  });
  const aircraftByRegistration = new Map(aircraftRows.map((a) => [a.registration.toUpperCase(), a.id]));

  const modRows = await readCsv(modPath);

  const summary = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    totalRows: modRows.length,
    ready: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    withFms: 0,
    withIca: 0,
    withReference: 0,
    byAircraft: {} as Record<string, number>,
  };
  const skipped: Array<{ row: number; reason: string; detail: string }> = [];

  for (const [index, row] of modRows.entries()) {
    const rowNumber = index + 2;
    const ide = clean(row.IDE);
    const registration = matByIde.get(ide);
    if (!registration) {
      skipped.push({ row: rowNumber, reason: 'ide_not_in_eq', detail: ide });
      summary.skipped += 1;
      continue;
    }
    const aircraftId = aircraftByRegistration.get(registration);
    if (!aircraftId) {
      skipped.push({ row: rowNumber, reason: 'aircraft_not_imported', detail: registration });
      summary.skipped += 1;
      continue;
    }

    const documentNumber = clean(row.DOCUMENTO);
    const description = clean(row.DESCRIPCION);
    if (!documentNumber || !description) {
      skipped.push({ row: rowNumber, reason: 'missing_document_or_description', detail: `${documentNumber} | ${description}` });
      summary.skipped += 1;
      continue;
    }

    const fms = parseFlag(row.FMS);
    const ica = parseFlag(row.ICA);
    const reference = clean(row.REFERENCIAS) || null;

    summary.ready += 1;
    summary.byAircraft[registration] = (summary.byAircraft[registration] ?? 0) + 1;
    if (fms.has) summary.withFms += 1;
    if (ica.has) summary.withIca += 1;
    if (reference) summary.withReference += 1;

    if (!APPLY) continue;

    const data = {
      description,
      approvalDate: parseMdbDate(row.FECHAAP),
      hasFlightManualSupplement: fms.has,
      flightManualReference: fms.reference,
      hasIca: ica.has,
      icaReference: ica.reference,
      reference: reference?.slice(0, 255) ?? null,
    };

    const existing = await prisma.aircraftAlteration.findFirst({
      where: { aircraftId, documentNumber: documentNumber.slice(0, 255), description },
      select: { id: true },
    });

    if (existing) {
      await prisma.aircraftAlteration.update({ where: { id: existing.id }, data });
      summary.updated += 1;
    } else {
      await prisma.aircraftAlteration.create({
        data: {
          organizationId: ORG_ID,
          aircraftId,
          documentNumber: documentNumber.slice(0, 255),
          createdById: admin?.id ?? null,
          ...data,
        },
      });
      summary.created += 1;
    }
  }

  fs.writeFileSync(
    path.join(CSV_DIR, 'mod-alteraciones-report.json'),
    JSON.stringify({ summary, skipped }, null, 2),
    'utf-8',
  );

  console.log('=== MOD → alteraciones ===');
  console.log(`Mode: ${summary.mode}`);
  console.log(`Filas MOD: ${summary.totalRows} | importables: ${summary.ready} | descartadas: ${summary.skipped}`);
  console.log(`Con FMS: ${summary.withFms} | con ICA: ${summary.withIca} | con referencia OT/taller: ${summary.withReference}`);
  console.log(`Por aeronave: ${JSON.stringify(summary.byAircraft)}`);
  if (APPLY) {
    console.log(`Aplicado: creadas ${summary.created}, actualizadas ${summary.updated}`);
  } else {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
  }
}

main()
  .catch((error) => {
    console.error('import_access_mod_alteraciones failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
