/**
 * import_access_eq_counters.ts
 *
 * Trae de la tabla EQ del Access los contadores de la pantalla principal:
 * qué contador ocupa cada ranura de cada equipo (HS, TN1, TN2) y su lectura
 * vigente (HSTOT, N1, N2).
 *
 * La ranura es posicional: el límite guardado en LIMN2 se mide contra la ranura
 * 2 de ese equipo, se llame CTL o CNF. Por eso se importa sin necesidad de
 * decidir qué significa cada sigla.
 *
 * Uso:
 *   npx tsx prisma/import_access_eq_counters.ts --csv-dir data-tecnicopters --org-id <uuid> [--apply]
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
const READING_DATE = new Date(getArgValue('--date') ?? new Date().toISOString().slice(0, 10));

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
  return Number.isFinite(n) ? n : null;
};

/** HRS y HT nombran lo mismo; se unifican para no tener dos contadores de horas. */
const canonical = (code: string): string => (code.toUpperCase() === 'HRS' ? 'HT' : code.toUpperCase());

const UNIT_BY_CODE: Record<string, string> = {
  HT: 'horas', LND: 'aterrizajes', ARD: 'aterrizajes', ETQ: 'eventos',
};

async function main(): Promise<void> {
  const eqPath = path.join(CSV_DIR, 'EQ.csv');
  if (!fs.existsSync(eqPath)) throw new Error(`EQ.csv not found in ${CSV_DIR}`);

  const admin = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  const aircraftRows = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true, engines: { select: { id: true, position: true } } },
  });
  const byRegistration = new Map(aircraftRows.map((a) => [a.registration.toUpperCase(), a]));

  const rows = await readCsv(eqPath);

  const summary = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    equipos: 0, sinAeronave: 0,
    tiposCreados: [] as string[],
    ranuras: 0, lecturas: 0, corregidas: 0,
    sinTipoDeclarado: [] as string[],
  };

  /** Devuelve el contador, creándolo si el Access lo usa y el catálogo no lo tiene. */
  const counterIdFor = async (rawCode: string, scope: 'AIRCRAFT' | 'ENGINE'): Promise<string | null> => {
    const code = canonical(rawCode);
    if (!code) return null;

    const existing = await prisma.counterType.findFirst({
      where: { organizationId: ORG_ID, code: { equals: code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing.id;

    if (!APPLY) { summary.tiposCreados.push(code); return null; }
    const created = await prisma.counterType.create({
      data: {
        organizationId: ORG_ID,
        code,
        name: code,
        unit: UNIT_BY_CODE[code] ?? 'ciclos',
        scope,
        sortOrder: 60,
      },
    });
    summary.tiposCreados.push(code);
    return created.id;
  };

  /**
   * Graba la lectura de EQ. Si ya hay una de la misma fecha con otro valor, la
   * corrige: estas cifras vienen de la pantalla que la operación mantiene, y
   * mandan sobre lo que hubiera quedado de una carga anterior.
   */
  const upsertReading = async (
    counterTypeId: string,
    target: { aircraftId: string | null; engineId: string | null },
    value: number,
  ): Promise<number> => {
    const existing = await prisma.counterReading.findFirst({
      where: { counterTypeId, ...target, readingDate: READING_DATE },
      select: { id: true, value: true },
    });
    if (!existing) {
      await prisma.counterReading.create({
        data: {
          organizationId: ORG_ID, counterTypeId, ...target,
          value, readingDate: READING_DATE,
          source: 'access', notes: 'Lectura inicial desde EQ del Access',
          recordedById: admin?.id ?? null,
        },
      });
      return 1;
    }
    if (Math.abs(Number(existing.value) - value) > 0.005) {
      await prisma.counterReading.update({
        where: { id: existing.id },
        data: { value, source: 'access', notes: 'Corregida con el valor de EQ del Access' },
      });
      summary.corregidas += 1;
    }
    return 0;
  };

  for (const row of rows) {
    const registration = clean(row.MAT).toUpperCase();
    const tip = clean(row.TIP).toUpperCase();
    if (!registration) continue;

    const aircraft = byRegistration.get(registration);
    if (!aircraft) { summary.sinAeronave += 1; continue; }

    const isEngine = tip.startsWith('EN');
    const scope: 'AIRCRAFT' | 'ENGINE' = isEngine ? 'ENGINE' : 'AIRCRAFT';
    // EQ trae un motor por fila; se toma el de la posición correspondiente.
    const engine = isEngine
      ? aircraft.engines.find((e) => e.position === (tip === 'EN2' ? 'N2' : 'N1'))
      : undefined;
    if (isEngine && !engine) { summary.sinAeronave += 1; continue; }
    summary.equipos += 1;

    const target = isEngine
      ? { engineId: engine!.id, aircraftId: null }
      : { aircraftId: aircraft.id, engineId: null };

    // Horas: fuera de ranura, es el contador base de todo equipo.
    const hoursCode = clean(row.HS) || 'HT';
    const hoursValue = num(row.HSTOT);
    const hoursId = await counterIdFor(hoursCode, scope);
    if (hoursId && hoursValue != null && APPLY) {
      summary.lecturas += await upsertReading(hoursId, target, hoursValue);
    }

    for (const [slot, codeCol, valueCol] of [[1, 'TN1', 'N1'], [2, 'TN2', 'N2']] as const) {
      const rawCode = clean(row[codeCol]);
      const value = num(row[valueCol]);
      if (!rawCode) {
        // Un valor sin tipo declarado no se puede asignar a ningún contador.
        if (value != null) summary.sinTipoDeclarado.push(`${registration} ${tip} ranura ${slot} = ${value}`);
        continue;
      }

      const counterId = await counterIdFor(rawCode, scope);
      if (!counterId) continue;

      if (APPLY) {
        const existingSlot = await prisma.equipmentCounterSlot.findFirst({
          where: { slot, ...target },
          select: { id: true },
        });
        if (existingSlot) {
          await prisma.equipmentCounterSlot.update({ where: { id: existingSlot.id }, data: { counterTypeId: counterId } });
        } else {
          await prisma.equipmentCounterSlot.create({
            data: { organizationId: ORG_ID, slot, counterTypeId: counterId, ...target },
          });
        }
      }
      summary.ranuras += 1;

      if (value != null && APPLY) {
        summary.lecturas += await upsertReading(counterId, target, value);
      }
    }
  }

  console.log(`=== EQ → contadores por equipo (${summary.mode}) ===`);
  console.log(`Equipos procesados: ${summary.equipos} · sin correspondencia: ${summary.sinAeronave}`);
  console.log(`Ranuras declaradas: ${summary.ranuras} · lecturas cargadas: ${summary.lecturas} · corregidas: ${summary.corregidas}`);
  if (summary.tiposCreados.length) {
    console.log(`Contadores que el Access usa y el catálogo no tenía: ${[...new Set(summary.tiposCreados)].join(', ')}`);
  }
  if (summary.sinTipoDeclarado.length) {
    console.log('Valores sin tipo declarado en EQ (no se importan):');
    for (const d of summary.sinTipoDeclarado) console.log(`   ${d}`);
  }
  if (!APPLY) console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
}

main()
  .catch((error) => {
    console.error('import_access_eq_counters failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
