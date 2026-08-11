/**
 * import_access_ot.ts
 *
 * Trae la tabla OT del Access como órdenes de trabajo. Hasta ahora solo se
 * habían usado sus cumplimientos: la orden como documento —su fecha, el taller
 * que la ejecutó, los manuales citados, los contadores al cierre y el
 * certificado de retorno al servicio— no existía en la plataforma.
 *
 * Uso:
 *   npx tsx prisma/import_access_ot.ts --csv-dir data-tecnicopters --org-id <uuid> [--apply]
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

const IMPORT_MARKER = '[IMPORT ACCESS OT]';

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

const num = (v?: string) => {
  const raw = clean(v).replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

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

/** "CMA 492 - EAGLECOPTERS" → el nombre, que es como está el catálogo. */
function shopName(raw: string): string | null {
  const value = clean(raw);
  if (!value) return null;
  const m = value.match(/^CMA\s*[N°º]?\s*[0-9]+\s*[-–—:]\s*(.+)$/i);
  return (m ? m[1] : value).trim() || null;
}

async function main(): Promise<void> {
  const otPath = path.join(CSV_DIR, 'OT.csv');
  if (!fs.existsSync(otPath)) throw new Error(`OT.csv not found in ${CSV_DIR}`);

  const admin = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
    select: { id: true },
  });
  if (!admin) throw new Error('No hay un usuario ADMIN activo para atribuir las órdenes');

  const aircraftRows = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true },
  });
  const byRegistration = new Map(aircraftRows.map((a) => [a.registration.toUpperCase(), a.id]));

  const shops = await prisma.repairShop.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, name: true },
  });
  const shopByName = new Map(shops.map((s) => [s.name.toUpperCase(), s.id]));

  const rows = await readCsv(otPath);

  const summary = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    total: rows.length,
    creadas: 0,
    actualizadas: 0,
    conTaller: 0,
    tallerNoEncontrado: [] as string[],
    conManuales: 0,
    conContadoresAlCierre: 0,
    sinAeronave: [] as string[],
  };

  for (const row of rows) {
    const number = clean(row.OT);
    const registration = clean(row.MAT).toUpperCase();
    if (!number) continue;

    const aircraftId = byRegistration.get(registration);
    if (!aircraftId) { summary.sinAeronave.push(`${number} (${registration || 'sin matrícula'})`); continue; }

    const opened = parseDate(row.FECHA);
    const closed = parseDate(row.FECHAS);

    const rawShop = shopName(row.CMA);
    let repairShopId: string | null = null;
    if (rawShop) {
      repairShopId = shopByName.get(rawShop.toUpperCase()) ?? null;
      if (repairShopId) summary.conTaller += 1;
      else summary.tallerNoEncontrado.push(rawShop);
    }

    const aircraftManualRef = clean(row.DOCA) || null;
    const engineManualRef = clean(row.DOCM) || null;
    if (aircraftManualRef || engineManualRef) summary.conManuales += 1;

    const hoursAtClose = num(row.HSTOT);
    const cyclesAtClose = num(row.N1);
    if (hoursAtClose != null || cyclesAtClose != null) summary.conContadoresAlCierre += 1;

    const data = {
      aircraftId,
      title: `Orden de trabajo ${number}`,
      description: [
        IMPORT_MARKER,
        clean(row.HERRAM) ? `Trabajo: ${clean(row.HERRAM)}` : null,
      ].filter(Boolean).join('\n'),
      // Son órdenes históricas ya ejecutadas: nacen cerradas.
      status: 'CLOSED' as const,
      plannedStartDate: opened,
      actualStartDate: opened,
      actualEndDate: closed ?? opened,
      closedAt: closed ?? opened,
      closedById: admin.id,
      aircraftHoursAtClose: hoursAtClose,
      aircraftCyclesAtClose: cyclesAtClose != null ? Math.round(cyclesAtClose) : null,
      repairShopId,
      aircraftManualRef,
      engineManualRef,
      releaseToServiceNote: clean(row.PLA) || null,
    };

    if (!APPLY) { summary.creadas += 1; continue; }

    const existing = await prisma.workOrder.findFirst({
      where: { organizationId: ORG_ID, number },
      select: { id: true },
    });
    if (existing) {
      await prisma.workOrder.update({ where: { id: existing.id }, data });
      summary.actualizadas += 1;
    } else {
      await prisma.workOrder.create({
        data: { organizationId: ORG_ID, number, createdById: admin.id, ...data },
      });
      summary.creadas += 1;
    }
  }

  console.log(`=== OT → órdenes de trabajo (${summary.mode}) ===`);
  console.log(`Filas: ${summary.total} · creadas ${summary.creadas} · actualizadas ${summary.actualizadas}`);
  console.log(`Con taller enlazado: ${summary.conTaller} · con manuales citados: ${summary.conManuales} · con contadores al cierre: ${summary.conContadoresAlCierre}`);
  if (summary.tallerNoEncontrado.length) {
    console.log(`Talleres nombrados en OT que no están en el catálogo: ${[...new Set(summary.tallerNoEncontrado)].join(', ')}`);
  }
  if (summary.sinAeronave.length) {
    console.log(`Sin aeronave correspondiente: ${summary.sinAeronave.join(', ')}`);
  }
  if (!APPLY) console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
}

main()
  .catch((error) => {
    console.error('import_access_ot failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
