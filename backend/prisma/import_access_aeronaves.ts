/**
 * import_access_aeronaves.ts
 *
 * Completa la ficha de aeronave con lo que la tabla AERONAVES del Access guarda
 * y no se había importado: propietario (PROP), año de fabricación (AÑO) y
 * vencimiento del certificado de aeronavegabilidad (FVEN).
 *
 * Uso:
 *   npx tsx prisma/import_access_aeronaves.ts --csv-dir data-tecnicopters --org-id <uuid> [--apply]
 */
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}

const CSV_DIR = path.resolve(getArgValue('--csv-dir') ?? path.join(__dirname, '..', 'data'));
const ORG_ID = getArgValue('--org-id') ?? process.env.DEFAULT_ORG_ID ?? '';
const APPLY = args.includes('--apply');

if (!ORG_ID) {
  console.error('Missing organization id. Use --org-id=<uuid>');
  process.exit(1);
}

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

/** mdb-export emite fechas como MM/DD/YY. */
function parseDate(value?: string): Date | null {
  const raw = clean(value).split(' ')[0];
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += year <= 68 ? 2000 : 1900;
  const d = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main(): Promise<void> {
  const csvPath = path.join(CSV_DIR, 'AERONAVES.csv');
  if (!fs.existsSync(csvPath)) throw new Error(`AERONAVES.csv not found in ${CSV_DIR}`);

  const rows = await readCsv(csvPath);
  const aircraftRows = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true },
  });
  const byRegistration = new Map(aircraftRows.map((a) => [a.registration.toUpperCase(), a.id]));

  const summary = { total: rows.length, actualizadas: 0, sinAeronave: [] as string[], detalle: [] as string[] };

  for (const row of rows) {
    const registration = clean(row.MAT).toUpperCase();
    if (!registration) continue;

    const aircraftId = byRegistration.get(registration);
    if (!aircraftId) { summary.sinAeronave.push(registration); continue; }

    const owner = clean(row.PROP) || null;
    const yearRaw = clean(row.AÑO);
    const yearManufactured = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
    const coaExpiryDate = parseDate(row.FVEN);

    // Solo se escribe lo que el Access trae: un campo vacío no borra lo cargado.
    const data: Record<string, unknown> = {};
    if (owner) data.owner = owner;
    if (yearManufactured) data.yearManufactured = yearManufactured;
    if (coaExpiryDate) data.coaExpiryDate = coaExpiryDate;
    if (Object.keys(data).length === 0) continue;

    summary.detalle.push(
      `${registration}: ${[
        owner ? `propietario ${owner}` : null,
        yearManufactured ? `año ${yearManufactured}` : null,
        coaExpiryDate ? `CdN vence ${coaExpiryDate.toISOString().slice(0, 10)}` : null,
      ].filter(Boolean).join(' · ')}`,
    );

    if (APPLY) {
      await prisma.aircraft.update({ where: { id: aircraftId }, data });
      summary.actualizadas += 1;
    } else {
      summary.actualizadas += 1;
    }
  }

  console.log(`=== AERONAVES → ficha (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Filas: ${summary.total} · aeronaves actualizadas: ${summary.actualizadas}`);
  for (const d of summary.detalle) console.log(`   ${d}`);
  if (summary.sinAeronave.length) console.log(`Sin correspondencia: ${summary.sinAeronave.join(', ')}`);
  if (!APPLY) console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
}

main()
  .catch((error) => {
    console.error('import_access_aeronaves failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
