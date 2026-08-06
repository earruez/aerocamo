import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

type CsvRow = Record<string, string>;

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

const dataDir = path.resolve(getArgValue('--csv-dir') ?? path.join(__dirname, '..', 'data'));
const inputPath = path.join(dataDir, 'ot-maintenance-task-mapping-manual.csv');
const outputPath = path.join(dataDir, 'ot-maintenance-task-mapping-auto.csv');

function clean(value: string): string {
  return String(value ?? '').trim();
}

function normalize(value: string): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function splitCandidates(raw: string): string[] {
  return clean(raw)
    .split(' | ')
    .map((part) => clean(part))
    .filter(Boolean);
}

function parseSingleChapter(chapterOrAta: string): string | null {
  const value = clean(chapterOrAta);
  if (!value || value === '-' || value.includes('|')) return null;
  return value;
}

function extractIntervals(text: string): number[] {
  const source = normalize(text);
  const matches = source.matchAll(/\b(\d{1,4})\s*(FH|HR|HRS|HORA|HORAS|HC)\b/g);
  const unique = new Set<number>();
  for (const match of matches) {
    const value = Number(match[1]);
    if (!Number.isNaN(value)) unique.add(value);
  }
  return Array.from(unique.values()).sort((a, b) => a - b);
}

function containsChapter(candidateCode: string, chapter: string): boolean {
  const normalizedCode = normalize(candidateCode).replace(/[^A-Z0-9-]/g, '');
  const normalizedChapter = normalize(chapter).replace(/[^A-Z0-9-]/g, '');
  if (!normalizedCode || !normalizedChapter) return false;
  return normalizedCode.includes(normalizedChapter);
}

function containsInterval(candidateCode: string, candidateTitle: string, interval: number): boolean {
  const source = normalize(`${candidateCode} ${candidateTitle}`);
  const intervalRegex = new RegExp(`\\b${interval}\\s*(FH|HR|HRS|HORA|HORAS|HC)\\b`);
  if (intervalRegex.test(source)) return true;

  // Fallback for compact forms like 15FH/7D
  const compactRegex = new RegExp(`\\b${interval}(FH|HR|HRS|HC)\\b`);
  return compactRegex.test(source);
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
  const lines: string[] = [headers.join(',')];
  for (const row of rows) {
    const line = headers.map((header) => csvEscape(row[header] ?? '')).join(',');
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
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

async function main(): Promise<void> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const rows = await readCsv(inputPath);
  if (rows.length === 0) {
    throw new Error('Input CSV has no rows');
  }

  const headers = Object.keys(rows[0]);
  const outputRows: Array<Record<string, string>> = [];

  let autoApproved = 0;

  for (const row of rows) {
    const outputRow: Record<string, string> = { ...row };
    const reviewStatus = clean(row.review_status).toLowerCase();
    const taskCodeOrigen = clean(row.taskCode_origen);
    const chapterOrAta = clean(row.chapter_or_ata_detectado);

    if (reviewStatus !== 'pending') {
      outputRows.push(outputRow);
      continue;
    }

    if (normalize(taskCodeOrigen).startsWith('AD')) {
      outputRows.push(outputRow);
      continue;
    }

    const uniqueChapter = parseSingleChapter(chapterOrAta);
    if (!uniqueChapter) {
      outputRows.push(outputRow);
      continue;
    }

    const intervals = extractIntervals(taskCodeOrigen);
    if (intervals.length !== 1) {
      outputRows.push(outputRow);
      continue;
    }
    const interval = intervals[0];

    const candidateCodes = splitCandidates(row.candidateMaintenanceTaskCodes);
    const candidateTitles = splitCandidates(row.candidateTitles);

    const matches: Array<{ code: string }> = [];

    for (let i = 0; i < candidateCodes.length; i++) {
      const code = candidateCodes[i];
      const title = candidateTitles[i] ?? '';

      if (!containsChapter(code, uniqueChapter)) continue;
      if (!containsInterval(code, title, interval)) continue;

      matches.push({ code });
    }

    if (matches.length !== 1) {
      outputRows.push(outputRow);
      continue;
    }

    const selectedCode = matches[0].code;
    outputRow.selectedMaintenanceTaskCode = selectedCode;
    outputRow.selectedMaintenanceTaskId = '';
    outputRow.review_status = 'approved_auto';
    outputRow.notes = 'auto: chapter+interval match';
    autoApproved++;
    outputRows.push(outputRow);
  }

  const outputCsv = toCsv(headers, outputRows);
  await fs.promises.writeFile(outputPath, outputCsv, 'utf-8');

  const pending = outputRows.filter((row) => clean(row.review_status).toLowerCase() === 'pending').length;

  console.log('OT mapping auto generation completed');
  console.log(`- Input: ${inputPath}`);
  console.log(`- Output: ${outputPath}`);
  console.log(`- Total rows: ${outputRows.length}`);
  console.log(`- Auto approved: ${autoApproved}`);
  console.log(`- Pending: ${pending}`);
}

main().catch((error) => {
  console.error('generate_ot_mapping_auto failed:', error);
  process.exit(1);
});
