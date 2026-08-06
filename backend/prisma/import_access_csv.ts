import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient({ log: ['warn', 'error'] });

const args = process.argv.slice(2);
type ModuleName = 'aeronaves' | 'motores' | 'componentes' | 'ot';
const ALL_MODULES: ModuleName[] = ['aeronaves', 'motores', 'componentes', 'ot'];

function getArgValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.split('=')[1];

  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

const csvDirArg =
  getArgValue('--csv-dir') ??
  path.join(__dirname, '..', 'data');
const orgIdArg =
  getArgValue('--org-id') ??
  process.env.DEFAULT_ORG_ID;
const onlyArg = getArgValue('--only');
const dryRun = args.includes('--dry-run');
const diagnosticMode = args.includes('--diagnostic');

let only: ModuleName | null = null;
if (onlyArg) {
  const normalizedOnly = onlyArg.toLowerCase() as ModuleName;
  if (!ALL_MODULES.includes(normalizedOnly)) {
    console.error(`Invalid --only value '${onlyArg}'. Allowed: ${ALL_MODULES.join(', ')}`);
    process.exit(1);
  }
  only = normalizedOnly;
}

if (!orgIdArg) {
  console.error('Missing organization id. Use --org-id=<uuid> or DEFAULT_ORG_ID in .env');
  process.exit(1);
}

const CSV_DIR = path.resolve(csvDirArg);
const ORG_ID = orgIdArg;
const BATCH_SIZE = 200;

type CsvRow = Record<string, string>;

interface Stats {
  aircraft: { upserted: number; skipped: number; errors: number };
  engines: { created: number; updated: number; skipped: number; errors: number; usageLogsCreated: number };
  components: { upserted: number; skipped: number; errors: number };
  ot: { inserted: number; skipped: number; errors: number };
}

interface AircraftEnrichment {
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  totalFlightHours?: number;
  totalCycles?: number;
}

type OtSkipReason =
  | 'missingRegistration'
  | 'aircraftNotFound'
  | 'missingTaskCode'
  | 'mappingNotApproved'
  | 'maintenanceTaskNotFound'
  | 'invalidPerformedAt'
  | 'componentNotFound';

type OtSkipExample = {
  row: number;
  registration: string;
  taskCode: string;
  performedAt: string;
  componentSn: string;
  detail?: string;
};

interface DiagnosticIssue {
  row: number;
  reason: string;
}

interface DiagnosticRelationIssue {
  row: number;
  relation: string;
  value: string;
  reason: string;
}

interface DiagnosticDuplicateIssue {
  row: number;
  key: string;
  reason: string;
}

interface FileDiagnostic {
  fileName: string | null;
  rows: number;
  detectedColumns: string[];
  invalidRows: DiagnosticIssue[];
  relationIssues: DiagnosticRelationIssue[];
  possibleDuplicates: DiagnosticDuplicateIssue[];
  summary: {
    validRows: number;
    invalidRows: number;
    relationIssues: number;
    duplicates: number;
  };
}

interface ImportDiagnostic {
  generatedAt: string;
  mode: 'DRY_RUN_DIAGNOSTIC';
  csvDir: string;
  organizationId: string;
  files: {
    aeronaves: FileDiagnostic;
    motores: FileDiagnostic;
    componentes: FileDiagnostic;
    ot: FileDiagnostic;
  };
}

const stats: Stats = {
  aircraft: { upserted: 0, skipped: 0, errors: 0 },
  engines: { created: 0, updated: 0, skipped: 0, errors: 0, usageLogsCreated: 0 },
  components: { upserted: 0, skipped: 0, errors: 0 },
  ot: { inserted: 0, skipped: 0, errors: 0 },
};

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function clean(val: string): string {
  return String(val ?? '').trim();
}

function cleanReg(val: string): string {
  return clean(val).toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
}

function normalizeOtTaskKey(val: string): string {
  return clean(val)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
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

function toFloat(value: string): number | null {
  const num = parseFloat(clean(value).replace(',', '.').replace(/\s/g, ''));
  return Number.isNaN(num) ? null : num;
}

function toInt(value: string): number | null {
  const num = parseInt(clean(value).replace(/\s/g, ''), 10);
  return Number.isNaN(num) ? null : num;
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const text = clean(raw);
  if (!text || text === '0' || text.toLowerCase() === 'null') return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? (Number(y) > 50 ? 1900 + Number(y) : 2000 + Number(y)) : Number(y);
    const date = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function mapAircraftStatus(input: string): 'OPERATIONAL' | 'AOG' | 'IN_MAINTENANCE' | 'GROUNDED' | 'DECOMMISSIONED' {
  const key = clean(input).toUpperCase().replace(/\s+/g, '_');
  const map: Record<string, 'OPERATIONAL' | 'AOG' | 'IN_MAINTENANCE' | 'GROUNDED' | 'DECOMMISSIONED'> = {
    OPERACIONAL: 'OPERATIONAL',
    OPERATIONAL: 'OPERATIONAL',
    ACTIVO: 'OPERATIONAL',
    AOG: 'AOG',
    EN_MANTENIMIENTO: 'IN_MAINTENANCE',
    IN_MAINTENANCE: 'IN_MAINTENANCE',
    MANTENIMIENTO: 'IN_MAINTENANCE',
    EN_TIERRA: 'GROUNDED',
    GROUNDED: 'GROUNDED',
    RETIRADO: 'DECOMMISSIONED',
    RETIRADA: 'DECOMMISSIONED',
    BAJA: 'DECOMMISSIONED',
  };
  return map[key] ?? 'OPERATIONAL';
}

function mapComponentStatus(input: string): 'SERVICEABLE' | 'UNSERVICEABLE' | 'IN_SHOP' | 'SCRAPPED' {
  const key = clean(input).toUpperCase().replace(/\s+/g, '_');
  const map: Record<string, 'SERVICEABLE' | 'UNSERVICEABLE' | 'IN_SHOP' | 'SCRAPPED'> = {
    SERVICEABLE: 'SERVICEABLE',
    SERVICIABLE: 'SERVICEABLE',
    OPERATIVO: 'SERVICEABLE',
    UNSERVICEABLE: 'UNSERVICEABLE',
    NO_SERVICIABLE: 'UNSERVICEABLE',
    IN_SHOP: 'IN_SHOP',
    EN_TALLER: 'IN_SHOP',
    SCRAPPED: 'SCRAPPED',
    BAJA: 'SCRAPPED',
  };
  return map[key] ?? 'SERVICEABLE';
}

function mapComplianceStatus(input: string): 'COMPLETED' | 'DEFERRED' | 'OVERDUE' | 'CANCELLED' {
  const key = clean(input).toUpperCase();
  const map: Record<string, 'COMPLETED' | 'DEFERRED' | 'OVERDUE' | 'CANCELLED'> = {
    COMPLETED: 'COMPLETED',
    COMPLETADO: 'COMPLETED',
    COMPLETADA: 'COMPLETED',
    OK: 'COMPLETED',
    DEFERRED: 'DEFERRED',
    DIFERIDO: 'DEFERRED',
    DIFERIDA: 'DEFERRED',
    OVERDUE: 'OVERDUE',
    VENCIDO: 'OVERDUE',
    VENCIDA: 'OVERDUE',
    CANCELLED: 'CANCELLED',
    CANCELADA: 'CANCELLED',
  };
  return map[key] ?? 'COMPLETED';
}

function parseEnginePosition(input: string, ordinal: number): 'N1' | 'N2' | null {
  const key = clean(input).toUpperCase().replace(/\s+/g, '');
  if (['N1', '1', 'E1', 'M1', 'IZQ'].includes(key)) return 'N1';
  if (['N2', '2', 'E2', 'M2', 'DER'].includes(key)) return 'N2';
  if (ordinal === 1) return 'N1';
  if (ordinal === 2) return 'N2';
  return null;
}

function resolveCyclesFromEqRow(row: CsvRow): number | null {
  const pairs: Array<{ token: string; value: string }> = [
    { token: get(row, 'TN1', 'TIPO1', 'COUNTER1'), value: get(row, 'N1', 'VALOR1', 'COUNT1') },
    { token: get(row, 'TN2', 'TIPO2', 'COUNTER2'), value: get(row, 'N2', 'VALOR2', 'COUNT2') },
  ];

  for (const pair of pairs) {
    const key = clean(pair.token).toUpperCase();
    if (!key) continue;
    if (!['CY', 'CYC', 'CICLO', 'CICLOS', 'CNG', 'LND', 'LANDINGS'].includes(key)) continue;
    const numeric = toFloat(pair.value);
    if (numeric == null) continue;
    return Math.max(Math.round(numeric), 0);
  }

  return null;
}

function buildAircraftEnrichmentFromEqRows(rows: CsvRow[]): Map<string, AircraftEnrichment> {
  const byRegistration = new Map<string, AircraftEnrichment>();

  for (const row of rows) {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    if (!registration) continue;

    const tip = clean(get(row, 'TIP', 'TYPE')).toUpperCase();
    const designacion = clean(get(row, 'DESIGNACION', 'DESIGNATION')).toUpperCase();

    // Prefer aircraft identity rows from EQ (AN / AERONAVE) when present.
    if (tip && tip !== 'AN' && !designacion.includes('AERONAVE')) continue;

    const current = byRegistration.get(registration) ?? {};
    const manufacturer = get(row, 'MARCA', 'FABRICANTE', 'MANUFACTURER');
    const model = get(row, 'MODELO', 'MODEL');
    const serialNumber = get(row, 'SERIE', 'SN', 'N_SERIE');
    const totalFlightHours = toFloat(get(row, 'HSTOT', 'HRS', 'HS'));
    const totalCycles = resolveCyclesFromEqRow(row);

    byRegistration.set(registration, {
      manufacturer: manufacturer || current.manufacturer,
      model: model || current.model,
      serialNumber: serialNumber || current.serialNumber,
      totalFlightHours: totalFlightHours ?? current.totalFlightHours,
      totalCycles: totalCycles ?? current.totalCycles,
    });
  }

  return byRegistration;
}

function collectDetectedColumns(rows: CsvRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    Object.keys(row).forEach((key) => set.add(key));
  }
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
}

function findDuplicateRows(rows: CsvRow[], getKey: (row: CsvRow, ordinal: number) => string | null): DiagnosticDuplicateIssue[] {
  const seen = new Map<string, number>();
  const issues: DiagnosticDuplicateIssue[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const key = getKey(row, idx + 1);
    if (!key) return;
    const firstRow = seen.get(key);
    if (firstRow != null) {
      issues.push({
        row: rowNumber,
        key,
        reason: `Duplicate key also appears at row ${firstRow}`,
      });
      return;
    }
    seen.set(key, rowNumber);
  });

  return issues;
}

function analyzeAeronaves(fileName: string | null, rows: CsvRow[]): FileDiagnostic {
  const invalidRows: DiagnosticIssue[] = [];
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    if (!registration) {
      invalidRows.push({ row: rowNumber, reason: 'Missing MAT/MATRICULA/registration' });
    }
  });

  const possibleDuplicates = findDuplicateRows(rows, (row) => {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    return registration ? `registration:${registration}` : null;
  });

  return {
    fileName,
    rows: rows.length,
    detectedColumns: collectDetectedColumns(rows),
    invalidRows,
    relationIssues: [],
    possibleDuplicates,
    summary: {
      validRows: rows.length - invalidRows.length,
      invalidRows: invalidRows.length,
      relationIssues: 0,
      duplicates: possibleDuplicates.length,
    },
  };
}

function analyzeMotores(fileName: string | null, rows: CsvRow[], aircraftRegs: Set<string>): FileDiagnostic {
  const invalidRows: DiagnosticIssue[] = [];
  const relationIssues: DiagnosticRelationIssue[] = [];
  const engineOrdinalPerReg = new Map<string, number>();

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    if (!registration) {
      invalidRows.push({ row: rowNumber, reason: 'Missing MAT/MATRICULA/registration' });
      return;
    }

    const serial = get(row, 'SERIE', 'N_SERIE', 'S/N', 'SN', 'serialNumber');
    if (!serial) {
      invalidRows.push({ row: rowNumber, reason: 'Missing SERIE/SN' });
    }

    const ordinal = (engineOrdinalPerReg.get(registration) ?? 0) + 1;
    engineOrdinalPerReg.set(registration, ordinal);
    const position = parseEnginePosition(get(row, 'POSICION', 'POSITION', 'ORDEN', 'N1N2'), ordinal);
    if (!position) {
      invalidRows.push({ row: rowNumber, reason: 'Cannot resolve engine position N1/N2' });
    }

    if (aircraftRegs.size === 0) {
      relationIssues.push({
        row: rowNumber,
        relation: 'engine -> aircraft',
        value: registration,
        reason: 'Aircraft CSV not available; relation cannot be validated',
      });
    } else if (!aircraftRegs.has(registration)) {
      relationIssues.push({
        row: rowNumber,
        relation: 'engine -> aircraft',
        value: registration,
        reason: 'Aircraft registration not found in aeronaves.csv',
      });
    }

    const hours = toFloat(get(row, 'HRS', 'HORAS', 'HS'));
    const cycles = toInt(get(row, 'CNG', 'CICLOS', 'CYCLES'));
    if (hours == null || cycles == null) {
      invalidRows.push({ row: rowNumber, reason: 'Invalid HRS/CNG (usage log would be skipped)' });
    }

    const dateRaw = get(row, 'FECHA', 'DATE', 'FECHA_LECTURA');
    if (dateRaw && !parseDate(dateRaw)) {
      invalidRows.push({ row: rowNumber, reason: `Invalid date format: ${dateRaw}` });
    }
  });

  const possibleDuplicates = findDuplicateRows(rows, (row, ordinal) => {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    if (!registration) return null;
    const serial = get(row, 'SERIE', 'N_SERIE', 'S/N', 'SN', 'serialNumber').toUpperCase();
    if (!serial) return null;
    const position = parseEnginePosition(get(row, 'POSICION', 'POSITION', 'ORDEN', 'N1N2'), ordinal);
    if (!position) return null;
    return `registration+position+serial:${registration}|${position}|${serial}`;
  });

  return {
    fileName,
    rows: rows.length,
    detectedColumns: collectDetectedColumns(rows),
    invalidRows,
    relationIssues,
    possibleDuplicates,
    summary: {
      validRows: Math.max(rows.length - invalidRows.length, 0),
      invalidRows: invalidRows.length,
      relationIssues: relationIssues.length,
      duplicates: possibleDuplicates.length,
    },
  };
}

function analyzeComponentes(fileName: string | null, rows: CsvRow[], aircraftRegs: Set<string>): FileDiagnostic {
  const invalidRows: DiagnosticIssue[] = [];
  const relationIssues: DiagnosticRelationIssue[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const serial = get(row, 'SN', 'S/N', 'SERIE', 'serialNumber');
    const partNumber = get(row, 'PN', 'P/N', 'PART_NUMBER', 'partNumber');
    if (!serial) invalidRows.push({ row: rowNumber, reason: 'Missing component serial (SN/SERIE)' });
    if (!partNumber) invalidRows.push({ row: rowNumber, reason: 'Missing component part number (PN/PART_NUMBER)' });

    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    if (registration) {
      if (aircraftRegs.size === 0) {
        relationIssues.push({
          row: rowNumber,
          relation: 'component -> aircraft',
          value: registration,
          reason: 'Aircraft CSV not available; relation cannot be validated',
        });
      } else if (!aircraftRegs.has(registration)) {
        relationIssues.push({
          row: rowNumber,
          relation: 'component -> aircraft',
          value: registration,
          reason: 'Aircraft registration not found in aeronaves.csv',
        });
      }
    }
  });

  const possibleDuplicates = findDuplicateRows(rows, (row) => {
    const serial = get(row, 'SN', 'S/N', 'SERIE', 'serialNumber').toUpperCase();
    return serial ? `component-serial:${serial}` : null;
  });

  return {
    fileName,
    rows: rows.length,
    detectedColumns: collectDetectedColumns(rows),
    invalidRows,
    relationIssues,
    possibleDuplicates,
    summary: {
      validRows: Math.max(rows.length - invalidRows.length, 0),
      invalidRows: invalidRows.length,
      relationIssues: relationIssues.length,
      duplicates: possibleDuplicates.length,
    },
  };
}

function analyzeOt(
  fileName: string | null,
  rows: CsvRow[],
  aircraftRegs: Set<string>,
  componentSerials: Set<string>,
): FileDiagnostic {
  const invalidRows: DiagnosticIssue[] = [];
  const relationIssues: DiagnosticRelationIssue[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const taskCode = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO').toUpperCase();
    const performedAtRaw = get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt');
    const performedAt = parseDate(performedAtRaw);

    if (!registration) invalidRows.push({ row: rowNumber, reason: 'Missing MAT/MATRICULA/registration' });
    if (!taskCode) invalidRows.push({ row: rowNumber, reason: 'Missing CODIGO_TAREA/CODIGO' });
    if (!performedAt) invalidRows.push({ row: rowNumber, reason: `Invalid FECHA_CUMPLIMIENTO/FECHA: ${performedAtRaw || '(empty)'}` });

    if (registration) {
      if (aircraftRegs.size === 0) {
        relationIssues.push({
          row: rowNumber,
          relation: 'ot -> aircraft',
          value: registration,
          reason: 'Aircraft CSV not available; relation cannot be validated',
        });
      } else if (!aircraftRegs.has(registration)) {
        relationIssues.push({
          row: rowNumber,
          relation: 'ot -> aircraft',
          value: registration,
          reason: 'Aircraft registration not found in aeronaves.csv',
        });
      }
    }

    const componentSn = get(row, 'COMPONENTE_SN', 'SN_COMPONENTE', 'componentSerialNumber').toUpperCase();
    if (componentSn) {
      if (componentSerials.size === 0) {
        relationIssues.push({
          row: rowNumber,
          relation: 'ot -> component',
          value: componentSn,
          reason: 'Component CSV not available; relation cannot be validated',
        });
      } else if (!componentSerials.has(componentSn)) {
        relationIssues.push({
          row: rowNumber,
          relation: 'ot -> component',
          value: componentSn,
          reason: 'Component serial not found in componentes.csv',
        });
      }
    }
  });

  const possibleDuplicates = findDuplicateRows(rows, (row) => {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const taskCode = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO').toUpperCase();
    const performedAt = parseDate(get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt'));
    const workOrderNumber = get(row, 'NUM_OT', 'NumOT', 'OT', 'workOrderNumber');
    if (!registration || !taskCode || !performedAt || !workOrderNumber) return null;
    return `ot:${registration}|${taskCode}|${performedAt.toISOString().slice(0, 10)}|${workOrderNumber}`;
  });

  return {
    fileName,
    rows: rows.length,
    detectedColumns: collectDetectedColumns(rows),
    invalidRows,
    relationIssues,
    possibleDuplicates,
    summary: {
      validRows: Math.max(rows.length - invalidRows.length, 0),
      invalidRows: invalidRows.length,
      relationIssues: relationIssues.length,
      duplicates: possibleDuplicates.length,
    },
  };
}

async function writeDiagnostic(files: {
  aeronaves: { fileName: string | null; rows: CsvRow[] };
  motores: { fileName: string | null; rows: CsvRow[] };
  componentes: { fileName: string | null; rows: CsvRow[] };
  ot: { fileName: string | null; rows: CsvRow[] };
}): Promise<void> {
  const aircraftRegs = new Set(
    files.aeronaves.rows
      .map((row) => cleanReg(get(row, 'MAT', 'MATRICULA', 'registration')))
      .filter((value) => value.length > 0),
  );
  const componentSerials = new Set(
    files.componentes.rows
      .map((row) => get(row, 'SN', 'S/N', 'SERIE', 'serialNumber').toUpperCase())
      .filter((value) => value.length > 0),
  );

  const diagnostic: ImportDiagnostic = {
    generatedAt: new Date().toISOString(),
    mode: 'DRY_RUN_DIAGNOSTIC',
    csvDir: CSV_DIR,
    organizationId: ORG_ID,
    files: {
      aeronaves: analyzeAeronaves(files.aeronaves.fileName, files.aeronaves.rows),
      motores: analyzeMotores(files.motores.fileName, files.motores.rows, aircraftRegs),
      componentes: analyzeComponentes(files.componentes.fileName, files.componentes.rows, aircraftRegs),
      ot: analyzeOt(files.ot.fileName, files.ot.rows, aircraftRegs, componentSerials),
    },
  };

  const outputPath = path.join(process.cwd(), 'access-import-diagnostic.json');
  await fs.promises.writeFile(outputPath, JSON.stringify(diagnostic, null, 2), 'utf-8');
  console.log(`Diagnostic report written: ${outputPath}`);
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
    const filePath = path.join(CSV_DIR, fileName);
    if (!fs.existsSync(filePath)) continue;
    const rows = await readCsv(filePath);
    return { fileName, rows };
  }
  return { fileName: null, rows: [] };
}

async function loadAircraftMapFromDb(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const dbAircraft = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true },
  });
  dbAircraft.forEach((item) => map.set(item.registration, item.id));
  return map;
}

async function loadComponentMapFromDb(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const dbComponents = await prisma.component.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, serialNumber: true },
  });
  dbComponents.forEach((item) => map.set(item.serialNumber, item.id));
  return map;
}

async function loadMaintenanceTaskCodesFromDb(): Promise<Set<string>> {
  const tasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: ORG_ID },
    select: { code: true },
  });
  return new Set(tasks.map((task) => task.code.toUpperCase()));
}

async function loadApprovedOtTaskCodeMapping(): Promise<{ sourceFile: string | null; map: Map<string, string> }> {
  const mappingFile = await resolveCsv([
    'ot-maintenance-task-mapping-manual.csv',
    'ot-maintenance-task-mapping-auto.csv',
  ]);

  const map = new Map<string, string>();
  if (!mappingFile.fileName) {
    return { sourceFile: null, map };
  }

  for (const row of mappingFile.rows) {
    const reviewStatus = clean(get(row, 'review_status')).toLowerCase();
    if (reviewStatus !== 'approved' && reviewStatus !== 'approved_auto') continue;

    const sourceTaskCode = normalizeOtTaskKey(get(row, 'taskCode_origen'));
    const selectedTaskCode = clean(get(row, 'selectedMaintenanceTaskCode')).toUpperCase();
    if (!sourceTaskCode || !selectedTaskCode) continue;

    map.set(sourceTaskCode, selectedTaskCode);
  }

  return { sourceFile: mappingFile.fileName, map };
}

async function importAircraft(rows: CsvRow[], enrichmentByRegistration: Map<string, AircraftEnrichment>): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const row of rows) {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    if (!registration) {
      stats.aircraft.skipped++;
      continue;
    }

    const enrichment = enrichmentByRegistration.get(registration);
    const manufacturer =
      get(row, 'FABRICANTE', 'Fabricante', 'manufacturer') ||
      enrichment?.manufacturer ||
      'Desconocido';
    const model =
      get(row, 'MODELO', 'Modelo', 'model') ||
      enrichment?.model ||
      'Desconocido';
    const serialNumber =
      get(row, 'N_SERIE', 'N/SERIE', 'SERIE', 'serialNumber', 'SN') ||
      enrichment?.serialNumber ||
      `SN-${registration}`;
    const engineCount = toInt(get(row, 'MOTORES', 'EngineCount', 'NumMotores')) ?? 2;
    const engineModel = get(row, 'MODELO_MOTOR', 'ModeloMotor', 'EngineModel') || null;
    const totalFlightHours =
      toFloat(get(row, 'HORAS', 'HorasTotales', 'totalFlightHours')) ??
      enrichment?.totalFlightHours ??
      0;
    const totalCycles =
      toInt(get(row, 'CICLOS', 'CiclosTotales', 'totalCycles')) ??
      enrichment?.totalCycles ??
      0;
    const status = mapAircraftStatus(get(row, 'ESTADO', 'Estado', 'status'));
    const registrationDate = parseDate(get(row, 'FECHA_MAT', 'FechaMat', 'registrationDate'));
    const manufactureDate = parseDate(get(row, 'FECHA_FAB', 'FechaFab', 'manufactureDate'));

    try {
      if (dryRun) {
        stats.aircraft.upserted++;
        continue;
      }

      const aircraft = await prisma.aircraft.upsert({
        where: { registration_organizationId: { registration, organizationId: ORG_ID } },
        create: {
          organizationId: ORG_ID,
          registration,
          manufacturer,
          model,
          serialNumber,
          engineCount,
          engineModel: engineModel || undefined,
          totalFlightHours: new Prisma.Decimal(totalFlightHours),
          totalCycles,
          status,
          registrationDate: registrationDate ?? undefined,
          manufactureDate: manufactureDate ?? undefined,
        },
        update: {
          manufacturer,
          model,
          serialNumber,
          engineCount,
          engineModel: engineModel || undefined,
          totalFlightHours: new Prisma.Decimal(totalFlightHours),
          totalCycles,
          status,
          registrationDate: registrationDate ?? undefined,
          manufactureDate: manufactureDate ?? undefined,
        },
      });
      map.set(registration, aircraft.id);
      stats.aircraft.upserted++;
    } catch (error) {
      console.error(`Aircraft ${registration} failed: ${(error as Error).message}`);
      stats.aircraft.errors++;
    }
  }

  if (dryRun) {
    return map;
  }

  const dbAircraft = await prisma.aircraft.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, registration: true },
  });
  dbAircraft.forEach((item) => map.set(item.registration, item.id));
  return map;
}

async function importEngines(rows: CsvRow[], aircraftMap: Map<string, string>): Promise<void> {
  const engineByRegCounter = new Map<string, number>();
  const missingAircraftRegsReported = new Set<string>();

  for (const row of rows) {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const aircraftId = aircraftMap.get(registration);
    if (!registration) {
      stats.engines.skipped++;
      continue;
    }
    if (!aircraftId) {
      if (!missingAircraftRegsReported.has(registration)) {
        console.warn(`Engine ${registration} skipped: aircraft registration not found in organization ${ORG_ID}`);
        missingAircraftRegsReported.add(registration);
      }
      stats.engines.skipped++;
      continue;
    }

    const currentOrdinal = (engineByRegCounter.get(registration) ?? 0) + 1;
    engineByRegCounter.set(registration, currentOrdinal);

    const position = parseEnginePosition(get(row, 'POSICION', 'POSITION', 'ORDEN', 'N1N2'), currentOrdinal);
    const serialNumber = get(row, 'SERIE', 'N_SERIE', 'S/N', 'SN', 'serialNumber');
    const manufacturer = get(row, 'FABRICANTE', 'manufacturer', 'MARCA') || 'Desconocido';
    const model = get(row, 'MODELO', 'model') || 'Desconocido';

    if (!position || !serialNumber) {
      stats.engines.skipped++;
      continue;
    }

    const hours = toFloat(get(row, 'HRS', 'HORAS', 'HS'));
    const cycles = toInt(get(row, 'CNG', 'CICLOS', 'CYCLES'));
    const usageDate = parseDate(get(row, 'FECHA', 'DATE', 'FECHA_LECTURA')) ?? new Date();

    try {
      if (dryRun) {
        stats.engines.created++;
        if (hours != null && cycles != null) stats.engines.usageLogsCreated++;
        continue;
      }

      const existingByPosition = await prisma.aircraftEngine.findUnique({
        where: {
          aircraftId_position: { aircraftId, position },
        },
      });

      let engineId: string;
      if (!existingByPosition) {
        const created = await prisma.aircraftEngine.create({
          data: {
            organizationId: ORG_ID,
            aircraftId,
            position,
            manufacturer,
            model,
            serialNumber,
          },
        });
        engineId = created.id;
        stats.engines.created++;
      } else {
        const updated = await prisma.aircraftEngine.update({
          where: { id: existingByPosition.id },
          data: { manufacturer, model, serialNumber },
        });
        engineId = updated.id;
        stats.engines.updated++;
      }

      if (hours != null && cycles != null) {
        await prisma.aircraftEngineUsageLog.createMany({
          data: [
            {
              organizationId: ORG_ID,
              engineId,
              hours: new Prisma.Decimal(hours),
              cycles,
              date: usageDate,
            },
          ],
          skipDuplicates: true,
        });
        stats.engines.usageLogsCreated++;
      }
    } catch (error) {
      console.error(`Engine ${registration}/${position}/${serialNumber} failed: ${(error as Error).message}`);
      stats.engines.errors++;
    }
  }
}

async function importComponents(rows: CsvRow[], aircraftMap: Map<string, string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const row of rows) {
    const serialNumber = get(row, 'SN', 'S/N', 'SERIE', 'serialNumber');
    const partNumber = get(row, 'PN', 'P/N', 'PART_NUMBER', 'partNumber');
    if (!serialNumber || !partNumber) {
      stats.components.skipped++;
      continue;
    }

    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const aircraftId = registration ? aircraftMap.get(registration) : null;
    const description = get(row, 'DESCRIPCION', 'DESCRIPTION', 'description') || `${partNumber}/${serialNumber}`;
    const manufacturer = get(row, 'FABRICANTE', 'MANUFACTURER', 'manufacturer') || 'Desconocido';
    const position = get(row, 'POSICION', 'POSITION', 'position') || null;
    const status = mapComponentStatus(get(row, 'ESTADO', 'STATUS', 'status'));

    const totalHoursSinceNew = toFloat(get(row, 'HSN', 'TOTAL_HOURS', 'HORAS_SN')) ?? 0;
    const totalCyclesSinceNew = toInt(get(row, 'CSN', 'TOTAL_CYCLES', 'CICLOS_SN')) ?? 0;
    const hoursSinceOverhaul = toFloat(get(row, 'HSO', 'HORAS_OVH', 'hoursSinceOverhaul')) ?? 0;
    const cyclesSinceOverhaul = toInt(get(row, 'CSO', 'CICLOS_OVH', 'cyclesSinceOverhaul')) ?? 0;

    try {
      if (dryRun) {
        stats.components.upserted++;
        continue;
      }

      const component = await prisma.component.upsert({
        where: {
          serialNumber_organizationId: { serialNumber, organizationId: ORG_ID },
        },
        create: {
          organizationId: ORG_ID,
          aircraftId: aircraftId ?? undefined,
          partNumber,
          serialNumber,
          description,
          manufacturer,
          position: position ?? undefined,
          status,
          totalHoursSinceNew: new Prisma.Decimal(totalHoursSinceNew),
          totalCyclesSinceNew,
          hoursSinceOverhaul: new Prisma.Decimal(hoursSinceOverhaul),
          cyclesSinceOverhaul,
        },
        update: {
          aircraftId: aircraftId ?? null,
          partNumber,
          description,
          manufacturer,
          position: position ?? null,
          status,
          totalHoursSinceNew: new Prisma.Decimal(totalHoursSinceNew),
          totalCyclesSinceNew,
          hoursSinceOverhaul: new Prisma.Decimal(hoursSinceOverhaul),
          cyclesSinceOverhaul,
        },
      });
      map.set(serialNumber, component.id);
      stats.components.upserted++;
    } catch (error) {
      console.error(`Component ${partNumber}/${serialNumber} failed: ${(error as Error).message}`);
      stats.components.errors++;
    }
  }

  if (dryRun) {
    return map;
  }

  const dbComponents = await prisma.component.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, serialNumber: true },
  });
  dbComponents.forEach((item) => map.set(item.serialNumber, item.id));
  return map;
}

async function importOtAsCompliance(
  rows: CsvRow[],
  aircraftMap: Map<string, string>,
  componentMap: Map<string, string>,
  maintenanceTaskCodes?: Set<string>,
  otTaskCodeMapping?: Map<string, string>,
): Promise<void> {
  const taskMapping = otTaskCodeMapping ?? new Map<string, string>();

  if (dryRun) {
    const reasonCounts: Record<OtSkipReason, number> = {
      missingRegistration: 0,
      aircraftNotFound: 0,
      missingTaskCode: 0,
      mappingNotApproved: 0,
      maintenanceTaskNotFound: 0,
      invalidPerformedAt: 0,
      componentNotFound: 0,
    };
    const reasonExamples: Record<OtSkipReason, OtSkipExample[]> = {
      missingRegistration: [],
      aircraftNotFound: [],
      missingTaskCode: [],
      mappingNotApproved: [],
      maintenanceTaskNotFound: [],
      invalidPerformedAt: [],
      componentNotFound: [],
    };

    const pushExample = (
      reason: OtSkipReason,
      rowNumber: number,
      registration: string,
      taskCode: string,
      performedAt: string,
      componentSn: string,
      detail?: string,
    ) => {
      if (reasonExamples[reason].length >= 3) return;
      reasonExamples[reason].push({
        row: rowNumber,
        registration,
        taskCode,
        performedAt,
        componentSn,
        detail,
      });
    };

    let simulated = 0;
    for (const [idx, row] of rows.entries()) {
      const rowNumber = idx + 2;
      const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
      const aircraftId = aircraftMap.get(registration);
      const sourceTaskCode = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO').toUpperCase();
      const mappedTaskCode = taskMapping.get(normalizeOtTaskKey(sourceTaskCode)) ?? '';
      const performedAtRaw = get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt');
      const performedAt = parseDate(performedAtRaw);
      const componentSn = get(row, 'COMPONENTE_SN', 'SN_COMPONENTE', 'componentSerialNumber');
      const taskExists = maintenanceTaskCodes ? maintenanceTaskCodes.has(mappedTaskCode) : true;

      if (!registration) {
        reasonCounts.missingRegistration++;
        pushExample('missingRegistration', rowNumber, registration, sourceTaskCode, performedAtRaw, componentSn);
        stats.ot.skipped++;
        continue;
      }

      if (!aircraftId) {
        reasonCounts.aircraftNotFound++;
        pushExample(
          'aircraftNotFound',
          rowNumber,
          registration,
          sourceTaskCode,
          performedAtRaw,
          componentSn,
          `No aircraft with registration '${registration}' in organization ${ORG_ID}`,
        );
        stats.ot.skipped++;
        continue;
      }

      if (!sourceTaskCode) {
        reasonCounts.missingTaskCode++;
        pushExample('missingTaskCode', rowNumber, registration, sourceTaskCode, performedAtRaw, componentSn);
        stats.ot.skipped++;
        continue;
      }

      if (!mappedTaskCode) {
        reasonCounts.mappingNotApproved++;
        pushExample(
          'mappingNotApproved',
          rowNumber,
          registration,
          sourceTaskCode,
          performedAtRaw,
          componentSn,
          `Task '${sourceTaskCode}' has no approved mapping in OT mapping CSV`,
        );
        stats.ot.skipped++;
        continue;
      }

      if (!taskExists) {
        reasonCounts.maintenanceTaskNotFound++;
        pushExample(
          'maintenanceTaskNotFound',
          rowNumber,
          registration,
          sourceTaskCode,
          performedAtRaw,
          componentSn,
          `Mapped MaintenanceTask code '${mappedTaskCode}' not found in organization ${ORG_ID}`,
        );
        stats.ot.skipped++;
        continue;
      }

      if (!performedAt) {
        reasonCounts.invalidPerformedAt++;
        pushExample('invalidPerformedAt', rowNumber, registration, sourceTaskCode, performedAtRaw, componentSn);
        stats.ot.skipped++;
        continue;
      }

      if (componentSn && !componentMap.has(componentSn)) {
        reasonCounts.componentNotFound++;
        pushExample(
          'componentNotFound',
          rowNumber,
          registration,
          sourceTaskCode,
          performedAtRaw,
          componentSn,
          `Component serial '${componentSn}' not found in organization ${ORG_ID}`,
        );
        stats.ot.skipped++;
        continue;
      }

      simulated++;
    }
    stats.ot.inserted += simulated;

    console.log('OT dry-run skip breakdown:');
    console.log(`- missingRegistration: ${reasonCounts.missingRegistration}`);
    console.log(`- aircraftNotFound: ${reasonCounts.aircraftNotFound}`);
    console.log(`- missingTaskCode: ${reasonCounts.missingTaskCode}`);
    console.log(`- mappingNotApproved: ${reasonCounts.mappingNotApproved}`);
    console.log(`- maintenanceTaskNotFound: ${reasonCounts.maintenanceTaskNotFound}`);
    console.log(`- invalidPerformedAt: ${reasonCounts.invalidPerformedAt}`);
    console.log(`- componentNotFound: ${reasonCounts.componentNotFound}`);
    console.log('OT dry-run examples (up to 3 per reason):');
    console.log(JSON.stringify(reasonExamples, null, 2));
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  if (!admin) {
    throw new Error('No active ADMIN user found for compliance import');
  }

  const tasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, code: true },
  });
  const taskMap = new Map(tasks.map((task) => [task.code.toUpperCase(), task.id]));

  const batchData: Prisma.ComplianceCreateManyInput[] = [];

  for (const row of rows) {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'registration'));
    const aircraftId = aircraftMap.get(registration);
    const sourceTaskCode = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'task', 'CODIGO').toUpperCase();
    const mappedTaskCode = taskMapping.get(normalizeOtTaskKey(sourceTaskCode));
    const taskId = mappedTaskCode ? taskMap.get(mappedTaskCode) : null;
    const performedAt = parseDate(get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt'));

    if (!aircraftId || !sourceTaskCode || !mappedTaskCode || !taskId || !performedAt) {
      stats.ot.skipped++;
      continue;
    }

    const componentSn = get(row, 'COMPONENTE_SN', 'SN_COMPONENTE', 'componentSerialNumber');
    const componentId = componentSn ? componentMap.get(componentSn) : null;

    const aircraftHours = toFloat(get(row, 'HORAS_AERONAVE', 'HorasAeronave', 'HORAS')) ?? 0;
    const aircraftCycles = toInt(get(row, 'CICLOS_AERONAVE', 'CiclosAeronave', 'CICLOS')) ?? 0;
    const nextDueHours = toFloat(get(row, 'PROX_VTO_HORAS', 'ProxVtoHoras', 'nextDueHours'));
    const nextDueCycles = toInt(get(row, 'PROX_VTO_CICLOS', 'ProxVtoCiclos', 'nextDueCycles'));
    const nextDueDate = parseDate(get(row, 'PROX_VTO_FECHA', 'ProxVtoFecha', 'nextDueDate'));
    const workOrderNumber = get(row, 'NUM_OT', 'NumOT', 'OT', 'workOrderNumber') || undefined;
    const status = mapComplianceStatus(get(row, 'ESTADO', 'Estado', 'status') || 'COMPLETED');

    batchData.push({
      organizationId: ORG_ID,
      aircraftId,
      taskId,
      componentId: componentId ?? undefined,
      performedById: admin.id,
      performedAt,
      aircraftHoursAtCompliance: new Prisma.Decimal(aircraftHours),
      aircraftCyclesAtCompliance: aircraftCycles,
      nextDueHours: nextDueHours == null ? undefined : new Prisma.Decimal(nextDueHours),
      nextDueCycles: nextDueCycles ?? undefined,
      nextDueDate: nextDueDate ?? undefined,
      workOrderNumber,
      status,
    });
  }

  for (const group of chunk(batchData, BATCH_SIZE)) {
    try {
      const result = await prisma.compliance.createMany({
        data: group,
        skipDuplicates: true,
      });
      stats.ot.inserted += result.count;
    } catch (error) {
      console.error(`OT batch failed: ${(error as Error).message}`);
      stats.ot.errors += group.length;
    }
  }
}

function printSummary(files: Record<string, { fileName: string | null; rows: CsvRow[] }>): void {
  console.log('\n=== Import Summary ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`);
  console.log(`Organization: ${ORG_ID}`);
  console.log(`CSV dir: ${CSV_DIR}`);
  console.log('');

  for (const [key, value] of Object.entries(files)) {
    console.log(`${key.padEnd(12)} -> ${value.fileName ?? 'NOT FOUND'} (${value.rows.length} rows)`);
  }

  console.log('');
  console.log(`Aircraft   upserted=${stats.aircraft.upserted} skipped=${stats.aircraft.skipped} errors=${stats.aircraft.errors}`);
  console.log(`Engines    created=${stats.engines.created} updated=${stats.engines.updated} usageLogs=${stats.engines.usageLogsCreated} skipped=${stats.engines.skipped} errors=${stats.engines.errors}`);
  console.log(`Components upserted=${stats.components.upserted} skipped=${stats.components.skipped} errors=${stats.components.errors}`);
  console.log(`OT->Comp   inserted=${stats.ot.inserted} skipped=${stats.ot.skipped} errors=${stats.ot.errors}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(CSV_DIR)) {
    throw new Error(`CSV directory does not exist: ${CSV_DIR}`);
  }

  if (diagnosticMode && !dryRun) {
    throw new Error('--diagnostic requires --dry-run to guarantee no writes');
  }

  if (!dryRun) {
    const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { id: true } });
    if (!org) throw new Error(`Organization not found: ${ORG_ID}`);
  }

  const files = {
    aeronaves: await resolveCsv(['aeronaves.csv', 'AERONAVES.csv']),
    eq: await resolveCsv(['EQ.csv', 'eq.csv']),
    motores: await resolveCsv(['motores.csv', 'MOTORES.csv', 'MOTORES A.p.csv', 'MOTORES_A_P.csv']),
    componentes: await resolveCsv(['componentes.csv', 'COMPONENTES.csv']),
    ot: await resolveCsv(['ot_normalizado.csv', 'OT_NORMALIZADO.csv', 'ot.csv', 'OT.csv']),
  };

  const runningModules: ModuleName[] = only ? [only] : [...ALL_MODULES];
  console.log(`Running modules: [${runningModules.join(', ')}]`);

  if (diagnosticMode) {
    await writeDiagnostic(files);
  }

  const aircraftMap = new Map<string, string>();
  const componentMap = new Map<string, string>();
  let maintenanceTaskCodes: Set<string> | undefined;
  let otTaskCodeMapping: Map<string, string> | undefined;

  if (only === 'motores' || only === 'componentes' || only === 'ot') {
    const dbAircraftMap = await loadAircraftMapFromDb();
    dbAircraftMap.forEach((value, key) => aircraftMap.set(key, value));
  }

  if (!only || only === 'ot') {
    const dbComponentMap = await loadComponentMapFromDb();
    dbComponentMap.forEach((value, key) => componentMap.set(key, value));
    maintenanceTaskCodes = await loadMaintenanceTaskCodesFromDb();
    const mappingInfo = await loadApprovedOtTaskCodeMapping();
    otTaskCodeMapping = mappingInfo.map;
    const mappingSourceLabel = mappingInfo.sourceFile?.includes('manual')
      ? 'manual'
      : mappingInfo.sourceFile?.includes('auto')
        ? 'auto'
        : 'not found';
    console.log(`OT mapping source: ${mappingSourceLabel}`);
    console.log(`OT mapping approved entries: ${mappingInfo.map.size}`);
  }

  if (!only || only === 'aeronaves') {
    const aircraftEnrichmentByRegistration = buildAircraftEnrichmentFromEqRows(files.eq.rows);
    const importedAircraft = await importAircraft(files.aeronaves.rows, aircraftEnrichmentByRegistration);
    importedAircraft.forEach((value, key) => aircraftMap.set(key, value));
  }

  if (!only || only === 'motores') {
    await importEngines(files.motores.rows, aircraftMap);
  }

  if (!only || only === 'componentes') {
    const importedComponents = await importComponents(files.componentes.rows, aircraftMap);
    importedComponents.forEach((value, key) => componentMap.set(key, value));
  }

  if (!only || only === 'ot') {
    await importOtAsCompliance(files.ot.rows, aircraftMap, componentMap, maintenanceTaskCodes, otTaskCodeMapping);
  }

  printSummary(files);
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
