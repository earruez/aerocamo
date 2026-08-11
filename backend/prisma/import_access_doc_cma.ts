/**
 * import_access_doc_cma.ts
 *
 * Importa dos catálogos del Access:
 *   - DOC → manuales de referencia por modelo (con su revisión)
 *   - CMA → talleres aeronáuticos
 *
 * Los talleres se toman de CMA.csv y además de la columna CMA de OT.csv, que
 * nombra al taller que ejecutó la orden y contiene talleres que no están en el
 * catálogo (extranjeros, sin código CMA chileno).
 *
 * Uso:
 *   npx tsx prisma/import_access_doc_cma.ts --csv-dir data-tecnicopters --org-id <uuid> [--apply]
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
      .on('data', (row: CsvRow) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * El Access escribe el taller como "CMA 492 - EAGLECOPTERS": el código es de la
 * autoridad y el nombre es del taller. Los extranjeros vienen sin código.
 */
function parseShop(raw: string): { code: string | null; name: string } | null {
  const value = clean(raw);
  if (!value) return null;
  const match = value.match(/^(CMA\s*[N°º]?\s*[0-9]+)\s*[-–—:]\s*(.+)$/i);
  if (match) {
    return { code: match[1].replace(/\s+/g, ' ').trim().slice(0, 40), name: match[2].trim().slice(0, 180) };
  }
  return { code: null, name: value.slice(0, 180) };
}

/** El modelo del motor suele venir en el propio texto del manual. */
function guessKind(model: string): string {
  const m = model.toUpperCase();
  if (/(ARRIEL|ARRIUS|RR\s*300|250|TURBO|ENGINE|MOTOR)/.test(m)) return 'ENGINE';
  if (/(BELL|AS\s*350|AS350|H125|R66|EC|AIRBUS|ROBINSON)/.test(m)) return 'AIRCRAFT';
  return 'OTHER';
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  if (!org) throw new Error(`Organization not found: ${ORG_ID}`);

  const admin = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  // ── Manuales (DOC) ────────────────────────────────────────────────────────
  const docPath = path.join(CSV_DIR, 'DOC.csv');
  const docRows = fs.existsSync(docPath) ? await readCsv(docPath) : [];
  let manualsCreated = 0;
  let manualsSkipped = 0;

  for (const row of docRows) {
    const model = clean(row.modelo);
    const reference = clean(row.doc);
    if (!model || !reference) { manualsSkipped += 1; continue; }

    if (APPLY) {
      const existing = await prisma.maintenanceManual.findFirst({
        where: { organizationId: ORG_ID, model, reference },
        select: { id: true },
      });
      if (!existing) {
        await prisma.maintenanceManual.create({
          data: {
            organizationId: ORG_ID,
            model: model.slice(0, 120),
            reference,
            kind: guessKind(model),
            createdById: admin?.id ?? null,
          },
        });
        manualsCreated += 1;
      }
    } else {
      manualsCreated += 1;
    }
  }

  // ── Talleres (CMA + columna CMA de OT) ────────────────────────────────────
  const cmaPath = path.join(CSV_DIR, 'CMA.csv');
  const otPath = path.join(CSV_DIR, 'OT.csv');
  const cmaRows = fs.existsSync(cmaPath) ? await readCsv(cmaPath) : [];
  const otRows = fs.existsSync(otPath) ? await readCsv(otPath) : [];

  const shopsByName = new Map<string, { code: string | null; name: string; fromOt: boolean }>();
  for (const row of cmaRows) {
    const parsed = parseShop(row.CMA ?? Object.values(row)[0]);
    if (parsed) shopsByName.set(parsed.name.toLowerCase(), { ...parsed, fromOt: false });
  }
  let onlyInOt = 0;
  for (const row of otRows) {
    const parsed = parseShop(row.CMA);
    if (!parsed) continue;
    const key = parsed.name.toLowerCase();
    if (!shopsByName.has(key)) {
      shopsByName.set(key, { ...parsed, fromOt: true });
      onlyInOt += 1;
    } else if (!shopsByName.get(key)!.code && parsed.code) {
      shopsByName.get(key)!.code = parsed.code;
    }
  }

  let shopsCreated = 0;
  if (APPLY) {
    for (const shop of shopsByName.values()) {
      const existing = await prisma.repairShop.findFirst({
        where: { organizationId: ORG_ID, name: { equals: shop.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.repairShop.create({
          data: {
            organizationId: ORG_ID,
            code: shop.code,
            name: shop.name,
            createdById: admin?.id ?? null,
          },
        });
        shopsCreated += 1;
      }
    }
  } else {
    shopsCreated = shopsByName.size;
  }

  console.log(`=== DOC / CMA → catálogos (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Manuales: ${docRows.length} filas en DOC · creados ${manualsCreated}` +
    (manualsSkipped ? ` · descartados ${manualsSkipped} (sin modelo o sin documento)` : ''));
  console.log(`Talleres: ${cmaRows.length} en CMA + ${onlyInOt} que solo aparecen en OT · creados ${shopsCreated}`);
  if (!APPLY) console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
}

main()
  .catch((error) => {
    console.error('import_access_doc_cma failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
