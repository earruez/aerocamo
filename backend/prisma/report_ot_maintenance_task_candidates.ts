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

type MaintenanceTaskLite = {
  id: string;
  code: string;
  title: string;
  referenceNumber: string | null;
};

type Aggregate = {
  taskCodeOrigen: string;
  frecuencia: number;
  chapterOrAtaDetectado: string;
};

function clean(value: string): string {
  return String(value ?? '').trim();
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

function extractSearchTokens(text: string): string[] {
  return normalizeTextKey(text)
    .split(' ')
    .filter((token) => token.length >= 5)
    .slice(0, 8);
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

function confidenceForGroup(hasChapter: boolean, candidateCount: number): 'high' | 'medium' | 'low' {
  if (!hasChapter) return 'low';
  if (candidateCount === 0) return 'low';
  if (candidateCount <= 5) return 'high';
  return 'medium';
}

function joinList(values: string[], limit = 200): string {
  if (values.length <= limit) return values.join(' | ');
  return `${values.slice(0, limit).join(' | ')} | ...(+${values.length - limit} more)`;
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
  if (!otFile.fileName) {
    throw new Error('OT source not found (expected ot_normalizado.csv or OT.csv)');
  }

  const maintenanceTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, code: true, title: true, referenceNumber: true },
  });

  const byChapterToken = new Map<string, MaintenanceTaskLite[]>();
  for (const task of maintenanceTasks) {
    const taskLite: MaintenanceTaskLite = task;
    const chapterTokens = new Set<string>([
      ...extractChapterOrAtaCandidates(task.code),
      ...extractChapterOrAtaCandidates(task.title),
      ...extractChapterOrAtaCandidates(task.referenceNumber ?? ''),
      normalizeChapter(task.referenceNumber ?? ''),
      normalizeChapter(task.code),
    ].filter(Boolean));

    for (const token of chapterTokens) {
      const list = byChapterToken.get(token) ?? [];
      list.push(taskLite);
      byChapterToken.set(token, list);
    }
  }

  const aggByTask = new Map<string, Aggregate>();
  for (const row of otFile.rows) {
    const taskCodeOrigen = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO').toUpperCase();
    if (!taskCodeOrigen) continue;

    const chapterOrAtaDetectado = extractChapterOrAtaCandidates(taskCodeOrigen).join('|');
    const existing = aggByTask.get(taskCodeOrigen);
    if (!existing) {
      aggByTask.set(taskCodeOrigen, {
        taskCodeOrigen,
        frecuencia: 1,
        chapterOrAtaDetectado,
      });
      continue;
    }

    existing.frecuencia += 1;
    if (!existing.chapterOrAtaDetectado && chapterOrAtaDetectado) {
      existing.chapterOrAtaDetectado = chapterOrAtaDetectado;
    }
  }

  const rows = Array.from(aggByTask.values())
    .sort((a, b) => b.frecuencia - a.frecuencia || a.taskCodeOrigen.localeCompare(b.taskCodeOrigen))
    .map((group) => {
      const chapterTokens = group.chapterOrAtaDetectado
        ? group.chapterOrAtaDetectado.split('|').map((token) => normalizeChapter(token)).filter(Boolean)
        : [];

      let candidates: MaintenanceTaskLite[] = [];
      let notes = '';

      if (chapterTokens.length > 0) {
        const seen = new Set<string>();
        for (const token of chapterTokens) {
          const tokenCandidates = byChapterToken.get(token) ?? [];
          for (const candidate of tokenCandidates) {
            if (seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            candidates.push(candidate);
          }
        }

        notes = `Chapter/ATA detected: ${chapterTokens.join('|')}`;
      } else {
        const tokens = extractSearchTokens(group.taskCodeOrigen);
        if (tokens.length > 0) {
          const normalizedTaskCode = normalizeTextKey(group.taskCodeOrigen);
          candidates = maintenanceTasks
            .filter((task) => {
              const haystack = normalizeTextKey(`${task.code} ${task.title} ${task.referenceNumber ?? ''}`);
              if (!haystack) return false;
              const tokenHits = tokens.filter((token) => haystack.includes(token)).length;
              return tokenHits >= 2 || haystack.includes(normalizedTaskCode);
            })
            .slice(0, 30);
          notes = tokens.length
            ? `No chapter detected; text-only candidate suggestion with tokens: ${tokens.join('|')}`
            : 'No chapter detected; no text tokens available for suggestions';
        } else {
          notes = 'No chapter detected; no text tokens available for suggestions';
        }
      }

      candidates = candidates
        .sort((a, b) => a.code.localeCompare(b.code))
        .filter((candidate, index, list) => list.findIndex((other) => other.id === candidate.id) === index);

      const confidence_group = confidenceForGroup(chapterTokens.length > 0, candidates.length);

      return {
        taskCode_origen: group.taskCodeOrigen,
        frecuencia: group.frecuencia,
        chapter_or_ata_detectado: group.chapterOrAtaDetectado || '-',
        candidateMaintenanceTaskIds: joinList(candidates.map((candidate) => candidate.id), 500),
        candidateMaintenanceTaskCodes: joinList(candidates.map((candidate) => candidate.code), 500),
        candidateTitles: joinList(candidates.map((candidate) => candidate.title), 200),
        confidence_group,
        notes,
      };
    });

  const outputPath = path.join(CSV_DIR, 'ot-maintenance-task-candidates.csv');
  const csvContent = toCsv(
    [
      'taskCode_origen',
      'frecuencia',
      'chapter_or_ata_detectado',
      'candidateMaintenanceTaskIds',
      'candidateMaintenanceTaskCodes',
      'candidateTitles',
      'confidence_group',
      'notes',
    ],
    rows,
  );
  await fs.promises.writeFile(outputPath, csvContent, 'utf-8');

  const high = rows.filter((row) => row.confidence_group === 'high').length;
  const medium = rows.filter((row) => row.confidence_group === 'medium').length;
  const low = rows.filter((row) => row.confidence_group === 'low').length;

  console.log('OT maintenance task candidates report generated:');
  console.log(`- Source OT file: ${otFile.fileName}`);
  console.log(`- Total grouped task codes: ${rows.length}`);
  console.log(`- Confidence groups: high=${high}, medium=${medium}, low=${low}`);
  console.log(`- Report: ${outputPath}`);
}

main()
  .catch((error) => {
    console.error('OT maintenance task candidates report failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
