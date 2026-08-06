import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient({ log: ['warn', 'error'] });

const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.split('=')[1];

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

const csvDirArg = getArgValue('--csv-dir') ?? path.join(__dirname, '..', 'data');
const orgIdArg = getArgValue('--org-id') ?? process.env.DEFAULT_ORG_ID;

if (!orgIdArg) {
  console.error('Missing organization id. Use --org-id=<uuid> or DEFAULT_ORG_ID in .env');
  process.exit(1);
}

const CSV_DIR = path.resolve(csvDirArg);
const ORG_ID = orgIdArg;

type CsvRow = Record<string, string>;

type PendingRow = {
  row: number;
  registration: string;
  numOt: string;
  taskCodeOrigen: string;
  performedAt: string;
  motivo: string;
  suggestedNormalizedKey: string;
};

type FrequencyRow = {
  taskCodeOrigen: string;
  frecuencia: number;
  primerasMatriculas: string;
  primerasOt: string;
};

function clean(val: string): string {
  return String(val ?? '').trim();
}

function cleanReg(val: string): string {
  return clean(val).toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
}

function get(row: CsvRow, ...keys: string[]): string {
  const sourceKeys = Object.keys(row);
  for (const key of keys) {
    if (row[key] != null) return clean(row[key]);
    const found = sourceKeys.find((k) => k.toLowerCase() === key.toLowerCase());
    if (found) return clean(row[found]);
  }
  return '';
}

function normalizeTaskKey(taskCode: string): string {
  return taskCode
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, string | number>>): string {
  const lines: string[] = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    const line = headers.map((header) => csvEscape(row[header] ?? '')).join(',');
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
  if (!fs.existsSync(filePath)) return [];

  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    fs.createReadStream(filePath, { encoding: 'utf-8' })
      .pipe(csv({ separator: ',', mapHeaders: ({ header }) => clean(header).replace(/^\uFEFF/, '') }))
      .on('data', (row) => {
        const cleanRow: CsvRow = {};
        for (const [k, v] of Object.entries(row)) {
          cleanRow[clean(k)] = clean(String(v ?? ''));
        }
        rows.push(cleanRow);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function resolveOtCsv(): Promise<{ fileName: string; rows: CsvRow[] }> {
  const candidates = ['ot_normalizado.csv', 'OT_NORMALIZADO.csv', 'ot.csv', 'OT.csv'];
  for (const fileName of candidates) {
    const fullPath = path.join(CSV_DIR, fileName);
    if (!fs.existsSync(fullPath)) continue;
    const rows = await readCsv(fullPath);
    return { fileName, rows };
  }
  throw new Error(`OT CSV not found in ${CSV_DIR}`);
}

function firstNJoined(values: string[], n = 5): string {
  return values.slice(0, n).join(' | ');
}

async function main(): Promise<void> {
  if (!fs.existsSync(CSV_DIR)) {
    throw new Error(`CSV directory does not exist: ${CSV_DIR}`);
  }

  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  if (!org) {
    throw new Error(`Organization not found: ${ORG_ID}`);
  }

  const { fileName, rows } = await resolveOtCsv();

  const maintenanceTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: ORG_ID },
    select: { code: true },
  });
  const maintenanceTaskCodes = new Set(maintenanceTasks.map((task) => clean(task.code).toUpperCase()));

  const pending: PendingRow[] = [];

  for (const [idx, row] of rows.entries()) {
    const rowNumber = idx + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const numOt = get(row, 'NUM_OT', 'NumOT', 'OT', 'workOrderNumber');
    const taskCodeOrigen = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO').toUpperCase();
    const performedAt = get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt');

    if (!taskCodeOrigen) continue;
    if (maintenanceTaskCodes.has(taskCodeOrigen)) continue;

    pending.push({
      row: rowNumber,
      registration,
      numOt,
      taskCodeOrigen,
      performedAt,
      motivo: 'MaintenanceTask no encontrada para CODIGO_TAREA exacto',
      suggestedNormalizedKey: normalizeTaskKey(taskCodeOrigen),
    });
  }

  const frequencyMap = new Map<string, { count: number; regs: string[]; ots: string[] }>();
  for (const item of pending) {
    const existing = frequencyMap.get(item.taskCodeOrigen) ?? { count: 0, regs: [], ots: [] };
    existing.count += 1;
    if (item.registration && !existing.regs.includes(item.registration)) existing.regs.push(item.registration);
    if (item.numOt && !existing.ots.includes(item.numOt)) existing.ots.push(item.numOt);
    frequencyMap.set(item.taskCodeOrigen, existing);
  }

  const frequencyRows: FrequencyRow[] = Array.from(frequencyMap.entries())
    .map(([taskCodeOrigen, data]) => ({
      taskCodeOrigen,
      frecuencia: data.count,
      primerasMatriculas: firstNJoined(data.regs, 5),
      primerasOt: firstNJoined(data.ots, 5),
    }))
    .sort((a, b) => b.frecuencia - a.frecuencia || a.taskCodeOrigen.localeCompare(b.taskCodeOrigen));

  const pendingPath = path.join(CSV_DIR, 'ot-task-mapping-pending.csv');
  const frequencyPath = path.join(CSV_DIR, 'ot-task-frequency.csv');

  const pendingCsv = toCsv(
    ['row', 'registration', 'num_ot', 'taskCode_origen', 'performedAt', 'motivo', 'suggested_normalized_key'],
    pending.map((item) => ({
      row: item.row,
      registration: item.registration,
      num_ot: item.numOt,
      taskCode_origen: item.taskCodeOrigen,
      performedAt: item.performedAt,
      motivo: item.motivo,
      suggested_normalized_key: item.suggestedNormalizedKey,
    })),
  );

  const frequencyCsv = toCsv(
    ['taskCode_origen', 'frecuencia', 'primeras_matriculas', 'primeras_ot'],
    frequencyRows.map((item) => ({
      taskCode_origen: item.taskCodeOrigen,
      frecuencia: item.frecuencia,
      primeras_matriculas: item.primerasMatriculas,
      primeras_ot: item.primerasOt,
    })),
  );

  await fs.promises.writeFile(pendingPath, pendingCsv, 'utf-8');
  await fs.promises.writeFile(frequencyPath, frequencyCsv, 'utf-8');

  console.log('OT pending mapping reports generated:');
  console.log(`- Source OT CSV: ${fileName}`);
  console.log(`- Pending rows: ${pending.length}`);
  console.log(`- Unique pending task codes: ${frequencyRows.length}`);
  console.log(`- Pending mapping file: ${pendingPath}`);
  console.log(`- Frequency file: ${frequencyPath}`);
}

main()
  .catch((error) => {
    console.error('Report generation failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
