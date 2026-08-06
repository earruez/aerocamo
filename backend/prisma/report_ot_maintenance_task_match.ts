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

type MatchReportRow = {
  row: number;
  registration: string;
  num_ot: string;
  task_origen: string;
  chapter_or_ata: string;
  matchedMaintenanceTaskId: string;
  matchedMaintenanceTaskCode: string;
  confidence: string;
  reason: string;
};

type MaintenanceTaskLite = {
  id: string;
  code: string;
  title: string;
  referenceNumber: string | null;
};

function clean(value: string): string {
  return String(value ?? '').trim();
}

function cleanReg(value: string): string {
  return clean(value).toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
}

function get(row: CsvRow, ...keys: string[]): string {
  const sourceKeys = Object.keys(row);
  for (const key of keys) {
    if (row[key] != null) return clean(row[key]);
    const found = sourceKeys.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found) return clean(row[found]);
  }
  return '';
}

function normalizeTextKey(value: string): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeChapter(value: string): string {
  return clean(value)
    .toUpperCase()
    .replace(/CAPITULO|CAP\.?|ATA/g, '')
    .replace(/[^0-9-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractChapterOrAtaCandidates(taskText: string): string[] {
  const source = taskText.toUpperCase();
  const out = new Set<string>();

  const chapterRegex = /\b(?:ATA|CAP(?:ITULO|\.)?)\s*[:.-]?\s*([0-9]{2}(?:-[0-9]{2}(?:-[0-9]{2})?)?)\b/g;
  let chapterMatch = chapterRegex.exec(source);
  while (chapterMatch) {
    const normalized = normalizeChapter(chapterMatch[1]);
    if (normalized) out.add(normalized);
    chapterMatch = chapterRegex.exec(source);
  }

  const nakedRegex = /\b([0-9]{2}-[0-9]{2}-[0-9]{2})\b/g;
  let nakedMatch = nakedRegex.exec(source);
  while (nakedMatch) {
    const normalized = normalizeChapter(nakedMatch[1]);
    if (normalized) out.add(normalized);
    nakedMatch = nakedRegex.exec(source);
  }

  return Array.from(out.values());
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

async function resolveCsv(fileNames: string[]): Promise<{ fileName: string | null; rows: CsvRow[] }> {
  for (const fileName of fileNames) {
    const fullPath = path.join(CSV_DIR, fileName);
    if (!fs.existsSync(fullPath)) continue;
    const rows = await readCsv(fullPath);
    return { fileName, rows };
  }
  return { fileName: null, rows: [] };
}

async function main(): Promise<void> {
  if (!fs.existsSync(CSV_DIR)) {
    throw new Error(`CSV directory does not exist: ${CSV_DIR}`);
  }

  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
  if (!org) {
    throw new Error(`Organization not found: ${ORG_ID}`);
  }

  const otFile = await resolveCsv(['ot_normalizado.csv', 'OT_NORMALIZADO.csv', 'ot.csv', 'OT.csv']);
  const rawOtFile = await resolveCsv(['OT.csv', 'ot.csv']);
  const itemFile = await resolveCsv(['ITEM.csv', 'item.csv']);

  if (!otFile.fileName) {
    throw new Error('OT source not found (expected ot_normalizado.csv or OT.csv)');
  }

  const maintenanceTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, code: true, title: true, referenceNumber: true },
  });

  const byExactCode = new Map<string, MaintenanceTaskLite[]>();
  const byExactReference = new Map<string, MaintenanceTaskLite[]>();
  const byChapterToken = new Map<string, MaintenanceTaskLite[]>();

  const pushMap = (map: Map<string, MaintenanceTaskLite[]>, key: string, task: MaintenanceTaskLite) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    list.push(task);
    map.set(key, list);
  };

  for (const task of maintenanceTasks) {
    const lite: MaintenanceTaskLite = task;
    pushMap(byExactCode, normalizeTextKey(task.code), lite);
    pushMap(byExactReference, normalizeTextKey(task.referenceNumber ?? ''), lite);

    const chapterFromCode = extractChapterOrAtaCandidates(task.code);
    const chapterFromTitle = extractChapterOrAtaCandidates(task.title);
    const chapterFromRef = extractChapterOrAtaCandidates(task.referenceNumber ?? '');
    const chapters = new Set([...chapterFromCode, ...chapterFromTitle, ...chapterFromRef]);
    for (const chapter of chapters) {
      pushMap(byChapterToken, chapter, lite);
    }
  }

  const rawOtByNumber = new Map<string, CsvRow>();
  for (const row of rawOtFile.rows) {
    const numOt = get(row, 'OT', 'NumOT', 'NUM_OT', 'workOrderNumber');
    if (numOt) rawOtByNumber.set(numOt, row);
  }

  const itemByIde = new Map<string, CsvRow[]>();
  for (const row of itemFile.rows) {
    const ide = get(row, 'IDE', 'ide');
    if (!ide) continue;
    const list = itemByIde.get(ide) ?? [];
    list.push(row);
    itemByIde.set(ide, list);
  }

  const reportRows: MatchReportRow[] = [];
  let matchedByExactCode = 0;
  let matchedByExactChapter = 0;
  let unmatched = 0;

  for (const [idx, row] of otFile.rows.entries()) {
    const rowNumber = idx + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const numOt = get(row, 'NUM_OT', 'NumOT', 'OT', 'workOrderNumber');
    const taskOrigen = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO');
    const performedAt = get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt');

    const normalizedTask = normalizeTextKey(taskOrigen);
    const chapterCandidates = extractChapterOrAtaCandidates(taskOrigen);

    let chapterOrAta = chapterCandidates.join('|');
    if (!chapterOrAta && numOt) {
      const rawOt = rawOtByNumber.get(numOt);
      const ide = rawOt ? get(rawOt, 'ide', 'IDE') : '';
      if (ide) {
        const items = itemByIde.get(ide) ?? [];
        const ataCandidates = new Set<string>();
        for (const item of items) {
          const ataRaw = get(item, 'ATA', 'ata');
          for (const extracted of extractChapterOrAtaCandidates(ataRaw)) {
            ataCandidates.add(extracted);
          }
        }
        chapterOrAta = Array.from(ataCandidates.values()).join('|');
      }
    }

    let matchedTaskId = '';
    let matchedTaskCode = '';
    let confidence = 'none';
    let reason = '';

    const exactCodeMatches = byExactCode.get(normalizedTask) ?? [];
    if (exactCodeMatches.length === 1) {
      matchedTaskId = exactCodeMatches[0].id;
      matchedTaskCode = exactCodeMatches[0].code;
      confidence = 'high';
      reason = 'Exact match by task code';
      matchedByExactCode++;
    } else if (exactCodeMatches.length > 1) {
      reason = `Ambiguous exact task code (${exactCodeMatches.length} candidates)`;
    } else {
      const chapterKeys = chapterOrAta
        .split('|')
        .map((value) => normalizeChapter(value))
        .filter(Boolean);

      const chapterMatches = chapterKeys
        .flatMap((chapter) => byChapterToken.get(chapter) ?? [])
        .filter((task, i, arr) => arr.findIndex((candidate) => candidate.id === task.id) === i);

      if (chapterMatches.length === 1) {
        matchedTaskId = chapterMatches[0].id;
        matchedTaskCode = chapterMatches[0].code;
        confidence = 'medium';
        reason = 'Exact chapter/ATA token match (single candidate)';
        matchedByExactChapter++;
      } else if (chapterMatches.length > 1) {
        confidence = 'none';
        reason = `Chapter/ATA match ambiguous (${chapterMatches.length} candidates)`;
      } else {
        const refMatches = byExactReference.get(normalizedTask) ?? [];
        if (refMatches.length === 1) {
          matchedTaskId = refMatches[0].id;
          matchedTaskCode = refMatches[0].code;
          confidence = 'medium';
          reason = 'Exact match by referenceNumber';
          matchedByExactChapter++;
        } else {
          const suggestion = normalizeTextKey(taskOrigen).replace(/\s+/g, '_');
          reason = suggestion
            ? `No exact code/chapter match. Suggested normalized key: ${suggestion}`
            : 'No exact code/chapter match';
        }
      }
    }

    if (!matchedTaskId) unmatched++;

    reportRows.push({
      row: rowNumber,
      registration,
      num_ot: numOt,
      task_origen: taskOrigen,
      chapter_or_ata: chapterOrAta || '-',
      matchedMaintenanceTaskId: matchedTaskId,
      matchedMaintenanceTaskCode: matchedTaskCode,
      confidence,
      reason: `${reason}${performedAt ? '' : ' | Missing performedAt in source row'}`,
    });
  }

  const outputPath = path.join(CSV_DIR, 'ot-maintenance-task-match-report.csv');
  const csvContent = toCsv(
    [
      'row',
      'registration',
      'num_ot',
      'task_origen',
      'chapter_or_ata',
      'matchedMaintenanceTaskId',
      'matchedMaintenanceTaskCode',
      'confidence',
      'reason',
    ],
    reportRows,
  );
  await fs.promises.writeFile(outputPath, csvContent, 'utf-8');

  console.log('OT maintenance task match report generated:');
  console.log(`- Source OT file: ${otFile.fileName}`);
  console.log(`- Source raw OT file: ${rawOtFile.fileName ?? 'not found'}`);
  console.log(`- Source ITEM file: ${itemFile.fileName ?? 'not found'}`);
  console.log(`- Total OT rows analyzed: ${reportRows.length}`);
  console.log(`- Matched by exact code: ${matchedByExactCode}`);
  console.log(`- Matched by chapter/reference exact token: ${matchedByExactChapter}`);
  console.log(`- Unmatched rows: ${unmatched}`);
  console.log(`- Report: ${outputPath}`);
}

main()
  .catch((error) => {
    console.error('OT maintenance task report failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
