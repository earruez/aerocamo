/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Griselle — Script de Migración desde Access/CSV
 *  Archivo: prisma/migrate_data.ts
 *
 *  Uso:
 *    npx tsx prisma/migrate_data.ts [--csv-dir ./data] [--dry-run]
 *
 *  Archivos CSV esperados (en --csv-dir, por defecto ./data/):
 *    AERONAVES.csv  —  Matrícula, Fabricante, Modelo, N_Serie, Horas, Ciclos,
 *                      Estado, VtoCDN, VtoSeguro, FechaMat, FechaFab
 *    TAREAS.csv     —  Codigo, Titulo, Descripcion, Tipo, IntHoras, IntCiclos,
 *                      IntDias, TolHoras, RefNumero, RefTipo, Obligatoria,
 *                      ManHoras, RequiereInsp, ModeloAplica
 *    OT.csv         —  MAT, CodigoTarea, FechaCumplimiento, HorasAeronave,
 *                      CiclosAeronave, ProxVtoHoras, ProxVtoCiclos,
 *                      ProxVtoFecha, NumOT, Estado, Diferimiento, VtoDiferimiento
 *    MOTORES*.csv   —  MAT, (Posicion|Orden), Fabricante, Modelo, Serie,
 *                      HRS, CNG, Fecha, CTL, RIN
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const csvDirArg = args.find(a => a.startsWith('--csv-dir='))?.split('=')[1]
               ?? args[args.indexOf('--csv-dir') + 1]
               ?? path.join(__dirname, '..', 'data');
const DRY_RUN = args.includes('--dry-run');
const CSV_DIR = path.resolve(csvDirArg);

const ORG_ID = process.env.DEFAULT_ORG_ID ?? '62dac606-0611-4ac1-9cc5-17744be7d16e';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

// ─── Tipos de los registros CSV ───────────────────────────────────────────────
interface CsvAeronave  { [key: string]: string }
interface CsvTarea     { [key: string]: string }
interface CsvOT        { [key: string]: string }
interface CsvMotor     { [key: string]: string }

// ─── Contadores de resultado ──────────────────────────────────────────────────
interface MigStats {
  aircraft:    { ok: number; skip: number; error: number };
  engines:     { ok: number; skip: number; error: number; warn: number };
  tasks:       { ok: number; skip: number; error: number };
  compliance:  { ok: number; skip: number; error: number };
}

interface MigrationWarning {
  section: 'ENGINES';
  row: number;
  registration?: string;
  message: string;
}

interface DryRunFileSpec {
  key: string;
  display: string;
  variants: string[];
  requiredColumns: string[];
  knownColumns: string[];
  supported: boolean;
}

interface DryRunCsvInspection {
  key: string;
  display: string;
  supported: boolean;
  found: boolean;
  fileName?: string;
  rows: number;
  headers: string[];
  missingRequiredColumns: string[];
  unmappedColumns: string[];
}

interface DryRunEntityProjection {
  aircraftWouldUpsert: number;
  tasksWouldUpsert: number;
  complianceWouldInsert: number;
  enginesWouldCreate: number;
  enginesWouldUpdate: number;
  engineUsageLogsWouldCreate: number;
}

interface DryRunReport {
  filesDetected: string[];
  filesMissing: string[];
  rowsPerFile: Array<{ file: string; rows: number }>;
  warnings: string[];
  errors: string[];
  unmappedColumns: Array<{ file: string; columns: string[] }>;
  missingRequiredColumns: Array<{ file: string; columns: string[] }>;
  entities: DryRunEntityProjection;
  safeToAttemptRealImport: boolean;
}

const DRY_RUN_FILE_SPECS: DryRunFileSpec[] = [
  {
    key: 'AERONAVES',
    display: 'AERONAVES',
    variants: ['AERONAVES.csv'],
    requiredColumns: ['MATRICULA'],
    knownColumns: [
      'MAT','MATRICULA','Fabricante','FABRICANTE','MODELO','Modelo','N_SERIE','N/SERIE','NSerie','SN','S_N',
      'MOTORES','EngineCount','NumMotores','MODELO_MOTOR','ModeloMotor','EngineModel','HORAS','HorasTotales',
      'TotalHoras','totalFlightHours','CICLOS','CiclosTotales','TotalCiclos','totalCycles','ESTADO','Estado','status',
      'VTO_CDN','VtoCDN','VtoCertificado','coaExpiryDate','VTO_SEGURO','VtoSeguro','insuranceExpiryDate','FECHA_MAT',
      'FechaMat','FechaMatricula','registrationDate','FECHA_FAB','FechaFab','FechaFabricacion','manufactureDate',
    ],
    supported: true,
  },
  {
    key: 'TAREAS',
    display: 'TAREAS',
    variants: ['TAREAS.csv'],
    requiredColumns: ['CODIGO'],
    knownColumns: [
      'CODIGO','Codigo','CODE','code','TITULO','Titulo','TITLE','title','DESCRIPCION','Descripcion','description',
      'TIPO','Tipo','intervalType','INTERVALO','LIMIT_1','LIMIT 1','Limit 1','Limit1','LIM1','LIMIT_2','LIMIT 2',
      'Limit 2','Limit2','LIM2','INT_HORAS','IntHoras','intervalHours','INTHORAS','INT_CICLOS','IntCiclos',
      'intervalCycles','INTCICLOS','INT_DIAS','IntDias','intervalCalendarDays','INTDIAS','INT_MESES','IntMeses',
      'intervalCalendarMonths','INTMESES','intervaloMeses','TOL_HORAS','TolHoras','toleranceHours','REF_NUMERO',
      'RefNumero','referenceNumber','REFNUMERO','REF_TIPO','RefTipo','referenceType','REFTIPO','OBLIGATORIA',
      'obligatoria','isMandatory','MAN_HORAS','ManHoras','estimatedManHours','REQUIERE_INSP','RequiereInsp',
      'requiresInspection','MODELO_APLICA','ModeloAplica','applicableModel',
    ],
    supported: true,
  },
  {
    key: 'OT',
    display: 'OT',
    variants: ['OT.csv'],
    requiredColumns: ['MAT', 'CODIGO_TAREA', 'FECHA_CUMPLIMIENTO'],
    knownColumns: [
      'MAT','MATRICULA','Matricula','CODIGO_TAREA','CodigoTarea','TAREA','Tarea','task','CODIGO','FECHA_CUMPLIMIENTO',
      'FechaCumplimiento','FECHA','performedAt','HORAS_AERONAVE','HorasAeronave','HORAS','aircraftHoursAtCompliance',
      'CICLOS_AERONAVE','CiclosAeronave','CICLOS','aircraftCyclesAtCompliance','PROX_VTO_HORAS','ProxVtoHoras',
      'nextDueHours','PROX_VTO_CICLOS','ProxVtoCiclos','nextDueCycles','PROX_VTO_FECHA','ProxVtoFecha','nextDueDate',
      'NUM_OT','NumOT','OT','workOrderNumber','ESTADO','Estado','status','DIFERIMIENTO','deferralReference',
      'VTO_DIFERIMIENTO','VtoDiferimiento','deferralExpiresAt',
    ],
    supported: true,
  },
  {
    key: 'MOTORES',
    display: 'MOTORES / MOTORES A.p',
    variants: ['MOTORES_A_P.csv', 'MOTORES_AP.csv', 'MOTORES A.P.csv', 'MOTORES A.p.csv', 'MOTORES.csv'],
    requiredColumns: ['MAT', 'SERIE'],
    knownColumns: [
      'MAT','MATRICULA','Matricula','REG','registration','POSICION','POSITION','POS','MOTOR','N1N2','ORDEN',
      'FABRICANTE','MARCA','MANUFACTURER','MAKE','MODELO','MODEL','TIPO','SERIE','N_SERIE','N/SERIE','S/N','SN',
      'serialNumber','HRS','HORAS','HS','HOURS','CNG','CICLOS','CYCLES','FECHA','DATE','FECHA_LECTURA','F_LECTURA',
      'CTL','RIN',
    ],
    supported: true,
  },
  {
    key: 'COMPONENTES',
    display: 'COMPONENTES',
    variants: ['COMPONENTES.csv'],
    requiredColumns: [],
    knownColumns: [],
    supported: false,
  },
  {
    key: 'CUMPLIMIENTOS',
    display: 'CUMPLIMIENTOS',
    variants: ['CUMPLIMIENTOS.csv'],
    requiredColumns: [],
    knownColumns: [],
    supported: false,
  },
  {
    key: 'HISTORIAL_COMPONENTES',
    display: 'HISTORIAL_COMPONENTES',
    variants: ['HISTORIAL_COMPONENTES.csv'],
    requiredColumns: [],
    knownColumns: [],
    supported: false,
  },
  {
    key: 'SB_AD_MIM_MOD',
    display: 'SB / AD / MIM / MOD',
    variants: ['SB.csv', 'AD.csv', 'MIM.csv', 'MOD.csv'],
    requiredColumns: [],
    knownColumns: [],
    supported: false,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lee un archivo CSV completo y devuelve array de objetos. */
function readCsv(filePath: string): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      resolve([]); // archivo opcional → vacío
      return;
    }
    const rows: Record<string, string>[] = [];
    fs.createReadStream(filePath, { encoding: 'utf-8' })
      .pipe(csv({ separator: ',', mapHeaders: ({ header }) => header.trim() }))
      .on('data', (row) => {
        // Limpiar todos los valores: quitar espacios y BOM
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          clean[k.replace(/^\uFEFF/, '').trim()] = String(v ?? '').trim();
        }
        rows.push(clean);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

/** Primer campo presente en el objeto, case-insensitive. */
function get(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    // exact match first
    if (key in row) return row[key];
    // case-insensitive fallback
    const found = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
    if (found) return row[found];
  }
  return '';
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, '')
    .toUpperCase()
    .replace(/[\s.\-_/]+/g, '')
    .replace(/[ÁÀÄÂ]/g, 'A')
    .replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U')
    .replace(/Ñ/g, 'N');
}

function hasColumn(headers: string[], ...candidates: string[]): boolean {
  const set = new Set(headers.map(normalizeHeader));
  return candidates.some((candidate) => set.has(normalizeHeader(candidate)));
}

async function listFilesInDir(dirPath: string): Promise<string[]> {
  if (!fs.existsSync(dirPath)) return [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function inspectDryRunCsv(
  csvDir: string,
  spec: DryRunFileSpec,
): Promise<{ inspection: DryRunCsvInspection; rows: Record<string, string>[] }> {
  const foundVariant = spec.variants.find((variant) => fs.existsSync(path.join(csvDir, variant)));
  if (!foundVariant) {
    return {
      inspection: {
        key: spec.key,
        display: spec.display,
        supported: spec.supported,
        found: false,
        rows: 0,
        headers: [],
        missingRequiredColumns: spec.supported ? spec.requiredColumns.slice() : [],
        unmappedColumns: [],
      },
      rows: [],
    };
  }

  const rows = await readCsv(path.join(csvDir, foundVariant));
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const missingRequiredColumns = spec.requiredColumns.filter((required) => {
    if (required === 'MATRICULA') return !hasColumn(headers, 'MAT', 'MATRICULA', 'Matricula', 'registration');
    if (required === 'CODIGO') return !hasColumn(headers, 'CODIGO', 'Codigo', 'CODE', 'code');
    if (required === 'CODIGO_TAREA') return !hasColumn(headers, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'Tarea', 'task', 'CODIGO');
    if (required === 'FECHA_CUMPLIMIENTO') return !hasColumn(headers, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt');
    if (required === 'SERIE') return !hasColumn(headers, 'SERIE', 'N_SERIE', 'N/SERIE', 'S/N', 'SN', 'serialNumber');
    return !hasColumn(headers, required);
  });
  const known = new Set(spec.knownColumns.map(normalizeHeader));
  const unmappedColumns = headers.filter((header) => !known.has(normalizeHeader(header)));

  return {
    inspection: {
      key: spec.key,
      display: spec.display,
      supported: spec.supported,
      found: true,
      fileName: foundVariant,
      rows: rows.length,
      headers,
      missingRequiredColumns,
      unmappedColumns,
    },
    rows,
  };
}

function projectDryRunEngineMapping(
  rowsMotores: CsvMotor[],
  rowsAeronaves: CsvAeronave[],
): {
  wouldCreate: number;
  wouldUpdate: number;
  usageLogsWouldCreate: number;
  skipped: number;
  warnings: string[];
  errors: string[];
} {
  let wouldCreate = 0;
  let wouldUpdate = 0;
  let usageLogsWouldCreate = 0;
  let skipped = 0;
  let warnedNoAircraftLinkage = false;
  const warnings: string[] = [];
  const errors: string[] = [];

  const aircraftSet = new Set(
    rowsAeronaves
      .map((row) => cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula', 'registration')))
      .filter((value) => value.length > 0),
  );

  const perAircraftKnown = new Map<string, Set<string>>();
  const inferredOrderByReg = new Map<string, number>();

  for (const [index, row] of rowsMotores.entries()) {
    const rowNum = index + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula', 'REG', 'registration'));
    if (!registration) {
      skipped++;
      warnings.push(`MOTORES fila ${rowNum}: matrícula vacía (fila omitida).`);
      continue;
    }

    if (aircraftSet.size === 0) {
      if (!warnedNoAircraftLinkage) {
        warnings.push('MOTORES: no existe AERONAVES.csv; no se puede validar linkage por matrícula.');
        warnedNoAircraftLinkage = true;
      }
    } else if (!aircraftSet.has(registration)) {
      warnings.push(`MOTORES fila ${rowNum} [${registration}]: matrícula no encontrada en AERONAVES.`);
    }

    const serial = get(row, 'SERIE', 'N_SERIE', 'N/SERIE', 'S/N', 'SN', 'serialNumber').trim();
    if (!serial) {
      skipped++;
      warnings.push(`MOTORES fila ${rowNum} [${registration}]: serial faltante (fila omitida).`);
      continue;
    }

    const explicitPosition = parseEnginePosition(get(row, 'POSICION', 'POSITION', 'POS', 'MOTOR', 'N1N2', 'ORDEN'));
    const order = (inferredOrderByReg.get(registration) ?? 0) + 1;
    inferredOrderByReg.set(registration, order);
    const inferredPosition: 'N1' | 'N2' | null = order === 1 ? 'N1' : order === 2 ? 'N2' : null;
    const position = explicitPosition ?? inferredPosition;
    if (!position) {
      skipped++;
      warnings.push(`MOTORES fila ${rowNum} [${registration}]: no se puede asignar N1/N2 (orden > 2 sin posición explícita).`);
      continue;
    }

    const manufacturer = get(row, 'FABRICANTE', 'MARCA', 'MANUFACTURER', 'MAKE').trim();
    const model = get(row, 'MODELO', 'MODEL', 'TIPO').trim();
    if (!manufacturer) warnings.push(`MOTORES fila ${rowNum} [${registration}/${position}]: fabricante vacío.`);
    if (!model) warnings.push(`MOTORES fila ${rowNum} [${registration}/${position}]: modelo vacío.`);

    const hoursRaw = get(row, 'HRS', 'HORAS', 'HS', 'HOURS');
    const cyclesRaw = get(row, 'CNG', 'CICLOS', 'CYCLES');
    const hours = toFloat(hoursRaw);
    const cycles = toInt(cyclesRaw);
    if (hours == null || cycles == null) {
      warnings.push(`MOTORES fila ${rowNum} [${registration}/${position}]: HRS/CNG incompletos; usage log no se creará (NO_CONTEXT esperado).`);
    } else {
      usageLogsWouldCreate++;
    }

    const dateRaw = get(row, 'FECHA', 'DATE', 'FECHA_LECTURA', 'F_LECTURA');
    if (dateRaw && !parseDate(dateRaw)) {
      warnings.push(`MOTORES fila ${rowNum} [${registration}/${position}]: fecha inválida (${dateRaw}); se usaría fecha actual.`);
    }

    const ctlRaw = get(row, 'CTL');
    const rinRaw = get(row, 'RIN');
    if (hasAnyValue(ctlRaw, rinRaw)) {
      warnings.push(`MOTORES fila ${rowNum} [${registration}/${position}]: CTL/RIN pendiente de mapeo persistente.`);
    }

    const key = `${registration}|${position}|${serial.toUpperCase()}`;
    const regSet = perAircraftKnown.get(registration) ?? new Set<string>();
    if (regSet.has(key)) {
      wouldUpdate++;
      warnings.push(`MOTORES fila ${rowNum} [${registration}/${position}/${serial}]: duplicado detectado en CSV (en rerun sería update, no create).`);
    } else {
      wouldCreate++;
      regSet.add(key);
      perAircraftKnown.set(registration, regSet);
    }
  }

  return { wouldCreate, wouldUpdate, usageLogsWouldCreate, skipped, warnings, errors };
}

/** Convierte un string a número flotante; devuelve null si no es parseable. */
function toFloat(val: string): number | null {
  const n = parseFloat(val.replace(',', '.').replace(/\s/g, ''));
  return isNaN(n) ? null : n;
}

/** Convierte un string a entero; devuelve null si no es parseable. */
function toInt(val: string): number | null {
  const n = parseInt(val.replace(/\s/g, ''), 10);
  return isNaN(n) ? null : n;
}

function parseCalendarLimit(raw: string): { months: number | null; days: number | null } {
  if (!raw) return { months: null, days: null };
  const value = raw.trim().toUpperCase();
  const num = toFloat(value.replace(/[^0-9.,-]/g, ''));
  if (num == null) return { months: null, days: null };

  if (/\bM\b|MONTH|MESE|MES/.test(value)) {
    return { months: Math.round(num), days: null };
  }
  if (/\bD\b|DAY|DIA|DIAS/.test(value)) {
    return { months: null, days: Math.round(num) };
  }

  // If unit is not explicit, keep it as days to avoid aggressive month assumptions.
  return { months: null, days: Math.round(num) };
}

/**
 * Parsea fechas en múltiples formatos comunes de Access/Excel:
 *   DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, D/M/YY
 * Devuelve un objeto Date válido o null.
 */
function parseDate(val: string): Date | null {
  if (!val || val === '' || val === '0' || val.toLowerCase() === 'null') return null;

  const s = val.trim();

  // ISO 8601: 2024-12-31
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY o DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? (parseInt(y) > 50 ? 1900 + parseInt(y) : 2000 + parseInt(y)) : parseInt(y);
    const date = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return isNaN(date.getTime()) ? null : date;
  }

  // Fallback al parser nativo
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function hasAnyValue(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => String(value ?? '').trim() !== '');
}

function parseEnginePosition(raw: string): 'N1' | 'N2' | null {
  const normalized = raw.toUpperCase().trim().replace(/\s+/g, '');
  if (!normalized) return null;
  if (normalized === '1' || normalized === 'N1' || normalized === 'M1' || normalized === 'E1' || normalized === 'IZQ') {
    return 'N1';
  }
  if (normalized === '2' || normalized === 'N2' || normalized === 'M2' || normalized === 'E2' || normalized === 'DER') {
    return 'N2';
  }
  return null;
}

/** Normaliza matrícula: mayúsculas, sin espacios dobles, guiones limpios. */
function cleanReg(val: string): string {
  return val.toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-').slice(0, 20);
}

/**
 * Mapea strings de estado del CSV al enum AircraftStatus de Prisma.
 * Acepta variantes en español e inglés.
 */
function mapAircraftStatus(val: string): 'OPERATIONAL' | 'AOG' | 'IN_MAINTENANCE' | 'GROUNDED' | 'DECOMMISSIONED' {
  const v = val.toUpperCase().trim().replace(/\s+/g, '_');
  const map: Record<string, 'OPERATIONAL' | 'AOG' | 'IN_MAINTENANCE' | 'GROUNDED' | 'DECOMMISSIONED'> = {
    OPERACIONAL:    'OPERATIONAL',
    OPERATIONAL:    'OPERATIONAL',
    ACTIVO:         'OPERATIONAL',
    ACTIVA:         'OPERATIONAL',
    AOG:            'AOG',
    EN_MANTENIMIENTO: 'IN_MAINTENANCE',
    IN_MAINTENANCE: 'IN_MAINTENANCE',
    MANTENIMIENTO:  'IN_MAINTENANCE',
    EN_TIERRA:      'GROUNDED',
    GROUNDED:       'GROUNDED',
    TIERRA:         'GROUNDED',
    RETIRADA:       'DECOMMISSIONED',
    RETIRADO:       'DECOMMISSIONED',
    DECOMMISSIONED: 'DECOMMISSIONED',
    BAJA:           'DECOMMISSIONED',
  };
  return map[v] ?? 'OPERATIONAL';
}

/**
 * Mapea el tipo de intervalo de tarea al enum TaskIntervalType.
 */
function mapIntervalType(val: string): 'FLIGHT_HOURS' | 'CYCLES' | 'CALENDAR_DAYS' | 'FLIGHT_HOURS_OR_CALENDAR' | 'CYCLES_OR_CALENDAR' | 'ON_CONDITION' {
  const v = val.toUpperCase().trim().replace(/\s+/g, '_');
  const map: Record<string, 'FLIGHT_HOURS' | 'CYCLES' | 'CALENDAR_DAYS' | 'FLIGHT_HOURS_OR_CALENDAR' | 'CYCLES_OR_CALENDAR' | 'ON_CONDITION'> = {
    HORAS:                  'FLIGHT_HOURS',
    FLIGHT_HOURS:           'FLIGHT_HOURS',
    HRS:                    'FLIGHT_HOURS',
    H:                      'FLIGHT_HOURS',
    CICLOS:                 'CYCLES',
    CYCLES:                 'CYCLES',
    CYC:                    'CYCLES',
    CALENDARIO:             'CALENDAR_DAYS',
    CALENDAR_DAYS:          'CALENDAR_DAYS',
    DIAS:                   'CALENDAR_DAYS',
    HORAS_O_CALENDARIO:     'FLIGHT_HOURS_OR_CALENDAR',
    FLIGHT_HOURS_OR_CALENDAR: 'FLIGHT_HOURS_OR_CALENDAR',
    CICLOS_O_CALENDARIO:    'CYCLES_OR_CALENDAR',
    CYCLES_OR_CALENDAR:     'CYCLES_OR_CALENDAR',
    CONDICION:              'ON_CONDITION',
    ON_CONDITION:           'ON_CONDITION',
    OC:                     'ON_CONDITION',
  };
  return map[v] ?? 'FLIGHT_HOURS';
}

/**
 * Mapea el tipo de referencia al enum ReferenceType.
 */
function mapRefType(val: string): 'AMM' | 'AD' | 'SB' | 'CMR' | 'CDCCL' | 'MPD' | 'ETOPS' | 'INTERNAL' {
  const v = val.toUpperCase().trim();
  const known = ['AMM','AD','SB','CMR','CDCCL','MPD','ETOPS','INTERNAL'] as const;
  return known.includes(v as typeof known[number]) ? (v as typeof known[number]) : 'AMM';
}

/**
 * Mapea el estado de cumplimiento al enum ComplianceStatus.
 */
function mapComplianceStatus(val: string): 'COMPLETED' | 'DEFERRED' | 'OVERDUE' | 'CANCELLED' {
  const v = val.toUpperCase().trim();
  const map: Record<string, 'COMPLETED' | 'DEFERRED' | 'OVERDUE' | 'CANCELLED'> = {
    COMPLETADA: 'COMPLETED',
    COMPLETADO: 'COMPLETED',
    COMPLETED:  'COMPLETED',
    OK:         'COMPLETED',
    DIFERIDA:   'DEFERRED',
    DIFERIDO:   'DEFERRED',
    DEFERRED:   'DEFERRED',
    VENCIDA:    'OVERDUE',
    VENCIDO:    'OVERDUE',
    OVERDUE:    'OVERDUE',
    CANCELADA:  'CANCELLED',
    CANCELLED:  'CANCELLED',
  };
  return map[v] ?? 'COMPLETED';
}

// ─── Migración de AERONAVES ───────────────────────────────────────────────────
async function migrateAircraft(rows: CsvAeronave[]): Promise<{
  ok: number; skip: number; error: number;
  idMap: Map<string, string>; // registration → aircraft.id
}> {
  let ok = 0, skip = 0, error = 0;
  const idMap = new Map<string, string>();

  for (const row of rows) {
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula', 'registration'));
    if (!registration) { skip++; continue; }

    // Campos con sus aliases del CSV
    const manufacturer = get(row, 'FABRICANTE', 'Fabricante', 'manufacturer') || 'Desconocido';
    const model        = get(row, 'MODELO', 'Modelo', 'model') || 'Desconocido';
    const serialNumber = get(row, 'N_SERIE', 'N/SERIE', 'NSerie', 'serialNumber', 'SN', 'S_N') || `SN-${registration}`;
    const engineCount  = toInt(get(row, 'MOTORES', 'EngineCount', 'NumMotores')) ?? 2;
    const engineModel  = get(row, 'MODELO_MOTOR', 'ModeloMotor', 'EngineModel') || null;
    const totalFlightHours = toFloat(get(row, 'HORAS', 'HorasTotales', 'TotalHoras', 'totalFlightHours')) ?? 0;
    const totalCycles  = toInt(get(row, 'CICLOS', 'CiclosTotales', 'TotalCiclos', 'totalCycles')) ?? 0;
    const status       = mapAircraftStatus(get(row, 'ESTADO', 'Estado', 'status') || 'OPERACIONAL');
    const coaExpiryDate        = parseDate(get(row, 'VTO_CDN', 'VtoCDN', 'VtoCertificado', 'coaExpiryDate'));
    const insuranceExpiryDate  = parseDate(get(row, 'VTO_SEGURO', 'VtoSeguro', 'insuranceExpiryDate'));
    const registrationDate     = parseDate(get(row, 'FECHA_MAT', 'FechaMat', 'FechaMatricula', 'registrationDate'));
    const manufactureDate      = parseDate(get(row, 'FECHA_FAB', 'FechaFab', 'FechaFabricacion', 'manufactureDate'));

    try {
      const ac = await prisma.aircraft.upsert({
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
          coaExpiryDate: coaExpiryDate ?? undefined,
          insuranceExpiryDate: insuranceExpiryDate ?? undefined,
          registrationDate: registrationDate ?? undefined,
          manufactureDate: manufactureDate ?? undefined,
        },
        update: {
          manufacturer,
          model,
          serialNumber,
          totalFlightHours: new Prisma.Decimal(totalFlightHours),
          totalCycles,
          status,
          coaExpiryDate: coaExpiryDate ?? undefined,
          insuranceExpiryDate: insuranceExpiryDate ?? undefined,
        },
      });
      idMap.set(registration, ac.id);
      ok++;
    } catch (err) {
      console.error(`  ✗ AERONAVE [${registration}]: ${(err as Error).message}`);
      error++;
    }
  }

  return { ok, skip, error, idMap };
}

// ─── Migración de MOTORES ────────────────────────────────────────────────────
async function migrateEngines(
  rows: CsvMotor[],
  aircraftMap: Map<string, string>,
): Promise<{ ok: number; skip: number; error: number; warn: number; warnings: MigrationWarning[] }> {
  let ok = 0;
  let skip = 0;
  let error = 0;
  const warnings: MigrationWarning[] = [];
  const inferredOrderByReg = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    const rowNum = index + 2;
    const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula', 'REG', 'registration'));
    if (!registration) {
      skip++;
      continue;
    }

    const aircraftId = aircraftMap.get(registration);
    if (!aircraftId) {
      warnings.push({ section: 'ENGINES', row: rowNum, registration, message: 'Aeronave no encontrada para motor.' });
      skip++;
      continue;
    }

    const serialNumber = get(row, 'SERIE', 'N_SERIE', 'N/SERIE', 'S/N', 'SN', 'serialNumber').trim();
    if (!serialNumber) {
      warnings.push({ section: 'ENGINES', row: rowNum, registration, message: 'Motor sin número de serie (fila omitida).' });
      skip++;
      continue;
    }

    const explicitPosition = parseEnginePosition(get(row, 'POSICION', 'POSITION', 'POS', 'MOTOR', 'N1N2', 'ORDEN'));
    const nextOrder = (inferredOrderByReg.get(registration) ?? 0) + 1;
    inferredOrderByReg.set(registration, nextOrder);
    const inferredPosition: 'N1' | 'N2' | null = nextOrder === 1 ? 'N1' : nextOrder === 2 ? 'N2' : null;
    const position = explicitPosition ?? inferredPosition;

    if (!position) {
      warnings.push({
        section: 'ENGINES',
        row: rowNum,
        registration,
        message: 'No se pudo asignar posición N1/N2 por orden o valor explícito (fila omitida).',
      });
      skip++;
      continue;
    }

    const manufacturer = get(row, 'FABRICANTE', 'MARCA', 'MANUFACTURER', 'MAKE') || 'Desconocido';
    const model = get(row, 'MODELO', 'MODEL', 'TIPO') || 'Desconocido';
    const hoursRaw = get(row, 'HRS', 'HORAS', 'HS', 'HOURS');
    const cyclesRaw = get(row, 'CNG', 'CICLOS', 'CYCLES');
    const dateRaw = get(row, 'FECHA', 'DATE', 'FECHA_LECTURA', 'F_LECTURA');
    const ctlRaw = get(row, 'CTL');
    const rinRaw = get(row, 'RIN');

    const hours = toFloat(hoursRaw);
    const cycles = toInt(cyclesRaw);
    const usageDate = parseDate(dateRaw) ?? new Date();

    if (hasAnyValue(ctlRaw, rinRaw)) {
      warnings.push({
        section: 'ENGINES',
        row: rowNum,
        registration,
        message: `Campos sin mapeo persistente en modelo actual (CTL="${ctlRaw || ''}", RIN="${rinRaw || ''}").`,
      });
    }

    try {
      const engineByTriple = await prisma.aircraftEngine.findFirst({
        where: {
          organizationId: ORG_ID,
          aircraftId,
          position,
          serialNumber,
        },
      });

      const engineByPosition = engineByTriple
        ? null
        : await prisma.aircraftEngine.findFirst({
            where: {
              organizationId: ORG_ID,
              aircraftId,
              position,
            },
          });

      const engine = engineByTriple
        ? await prisma.aircraftEngine.update({
            where: { id: engineByTriple.id },
            data: { manufacturer, model },
          })
        : engineByPosition
          ? await prisma.aircraftEngine.update({
              where: { id: engineByPosition.id },
              data: { manufacturer, model, serialNumber },
            })
          : await prisma.aircraftEngine.create({
              data: {
                organizationId: ORG_ID,
                aircraftId,
                position,
                manufacturer,
                model,
                serialNumber,
              },
            });

      if (hours == null || cycles == null) {
        warnings.push({
          section: 'ENGINES',
          row: rowNum,
          registration,
          message: 'Motor creado/actualizado sin HRS/CNG completos; se omite usage log inicial (N1/N2 quedará NO_CONTEXT).',
        });
        ok++;
        continue;
      }

      if (!parseDate(dateRaw)) {
        warnings.push({
          section: 'ENGINES',
          row: rowNum,
          registration,
          message: 'Fecha de lectura no válida; se usa fecha actual para usage log inicial.',
        });
      }

      const existingUsageLog = await prisma.aircraftEngineUsageLog.findFirst({
        where: {
          organizationId: ORG_ID,
          engineId: engine.id,
          date: usageDate,
          hours: new Prisma.Decimal(hours),
          cycles,
        },
      });

      if (!existingUsageLog) {
        await prisma.aircraftEngineUsageLog.create({
          data: {
            organizationId: ORG_ID,
            engineId: engine.id,
            date: usageDate,
            hours: new Prisma.Decimal(hours),
            cycles,
          },
        });
      }

      ok++;
    } catch (err) {
      console.error(`  ✗ MOTOR [${registration}/${position}/${serialNumber}]: ${(err as Error).message}`);
      error++;
    }
  }

  return { ok, skip, error, warn: warnings.length, warnings };
}

// ─── Migración de TAREAS ──────────────────────────────────────────────────────
async function migrateTasks(rows: CsvTarea[]): Promise<{
  ok: number; skip: number; error: number;
  idMap: Map<string, string>; // code → task.id
}> {
  let ok = 0, skip = 0, error = 0;
  const idMap = new Map<string, string>();

  for (const row of rows) {
    const code = get(row, 'CODIGO', 'Codigo', 'CODE', 'code').trim().toUpperCase();
    if (!code) { skip++; continue; }

    const title       = get(row, 'TITULO', 'Titulo', 'TITLE', 'title') || code;
    const description = get(row, 'DESCRIPCION', 'Descripcion', 'description') || title;
    const mappedIntervalType = mapIntervalType(get(row, 'TIPO', 'Tipo', 'intervalType', 'INTERVALO') || 'HORAS');
    const csvLimit1 = toFloat(get(row, 'LIMIT_1', 'LIMIT 1', 'Limit 1', 'Limit1', 'LIM1'));
    const csvLimit2 = parseCalendarLimit(get(row, 'LIMIT_2', 'LIMIT 2', 'Limit 2', 'Limit2', 'LIM2'));

    const intervalHours   = toFloat(get(row, 'INT_HORAS', 'IntHoras', 'intervalHours', 'INTHORAS')) ?? csvLimit1;
    const intervalCycles  = toInt(get(row, 'INT_CICLOS', 'IntCiclos', 'intervalCycles', 'INTCICLOS'));
    const intervalDays    = toInt(get(row, 'INT_DIAS', 'IntDias', 'intervalCalendarDays', 'INTDIAS')) ?? csvLimit2.days;
    const intervalMonths  = toInt(get(row, 'INT_MESES', 'IntMeses', 'intervalCalendarMonths', 'INTMESES', 'intervaloMeses')) ?? csvLimit2.months;

    const hasLimit1 = intervalHours != null;
    const hasLimit2 = intervalDays != null || intervalMonths != null;
    const intervalType = hasLimit1 && hasLimit2
      ? 'FLIGHT_HOURS_OR_CALENDAR'
      : hasLimit1
        ? 'FLIGHT_HOURS'
        : hasLimit2
          ? 'CALENDAR_DAYS'
          : mappedIntervalType;
    const toleranceHours  = toFloat(get(row, 'TOL_HORAS', 'TolHoras', 'toleranceHours'));
    const refNumber       = get(row, 'REF_NUMERO', 'RefNumero', 'referenceNumber', 'REFNUMERO') || undefined;
    const refType         = mapRefType(get(row, 'REF_TIPO', 'RefTipo', 'referenceType', 'REFTIPO') || 'AMM');
    const isMandatory     = ['SI','YES','TRUE','1','S'].includes(
      get(row, 'OBLIGATORIA', 'obligatoria', 'isMandatory').toUpperCase()
    );
    const estManHours     = toFloat(get(row, 'MAN_HORAS', 'ManHoras', 'estimatedManHours'));
    const requiresInsp    = ['SI','YES','TRUE','1','S'].includes(
      get(row, 'REQUIERE_INSP', 'RequiereInsp', 'requiresInspection').toUpperCase()
    );
    const applicableModel = get(row, 'MODELO_APLICA', 'ModeloAplica', 'applicableModel') || undefined;

    try {
      const task = await prisma.maintenanceTask.upsert({
        where: { code_organizationId: { code, organizationId: ORG_ID } },
        create: {
          organizationId: ORG_ID,
          code,
          title,
          description,
          intervalType,
          intervalHours:       intervalHours   ? new Prisma.Decimal(intervalHours)  : undefined,
          intervalCycles:      intervalCycles  ?? undefined,
          intervalCalendarDays: intervalDays   ?? undefined,
          intervalCalendarMonths: intervalMonths ?? undefined,
          toleranceHours:      toleranceHours  ? new Prisma.Decimal(toleranceHours) : undefined,
          referenceNumber:     refNumber,
          referenceType:       refType,
          isMandatory,
          estimatedManHours:   estManHours ? new Prisma.Decimal(estManHours) : undefined,
          requiresInspection:  requiresInsp,
          applicableModel:     applicableModel,
        },
        update: {
          title,
          description,
          intervalType,
          intervalHours:       intervalHours   ? new Prisma.Decimal(intervalHours)  : undefined,
          intervalCycles:      intervalCycles  ?? undefined,
          intervalCalendarDays: intervalDays   ?? undefined,
          intervalCalendarMonths: intervalMonths ?? undefined,
          referenceNumber:     refNumber,
          isMandatory,
        },
      });
      idMap.set(code, task.id);
      ok++;
    } catch (err) {
      console.error(`  ✗ TAREA [${code}]: ${(err as Error).message}`);
      error++;
    }
  }

  return { ok, skip, error, idMap };
}

// ─── Migración de OT (Cumplimientos) ─────────────────────────────────────────
async function migrateOT(
  rows: CsvOT[],
  aircraftMap: Map<string, string>,
  taskMap: Map<string, string>,
  adminUserId: string,
): Promise<{ ok: number; skip: number; error: number }> {

  let ok = 0, skip = 0, error = 0;
  const batchErrors: Array<{ row: number; msg: string }> = [];

  // Procesar en lotes de 50 dentro de una transacción por lote
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    // Pre-validar el lote: filtrar filas problemáticas antes de la transacción
    const validOps: Prisma.ComplianceCreateManyInput[] = [];

    for (const [j, row] of batch.entries()) {
      const rowNum = i + j + 2; // +2 para números de línea CSV (header = 1)

      const registration = cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula'));
      const taskCode     = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'Tarea', 'task', 'CODIGO').trim().toUpperCase();

      if (!registration || !taskCode) {
        skip++;
        continue;
      }

      const aircraftId = aircraftMap.get(registration);
      const taskId     = taskMap.get(taskCode);

      if (!aircraftId) {
        batchErrors.push({ row: rowNum, msg: `Aeronave no encontrada: "${registration}"` });
        skip++;
        continue;
      }
      if (!taskId) {
        batchErrors.push({ row: rowNum, msg: `Tarea no encontrada: "${taskCode}"` });
        skip++;
        continue;
      }

      const performedAt = parseDate(get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt'));
      if (!performedAt) {
        batchErrors.push({ row: rowNum, msg: `Fecha inválida en MAT=${registration}` });
        skip++;
        continue;
      }

      const aircraftHours = toFloat(get(row, 'HORAS_AERONAVE', 'HorasAeronave', 'HORAS', 'aircraftHoursAtCompliance')) ?? 0;
      const aircraftCycles = toInt(get(row, 'CICLOS_AERONAVE', 'CiclosAeronave', 'CICLOS', 'aircraftCyclesAtCompliance')) ?? 0;
      const nextDueHours  = toFloat(get(row, 'PROX_VTO_HORAS', 'ProxVtoHoras', 'nextDueHours'));
      const nextDueCycles = toInt(get(row, 'PROX_VTO_CICLOS', 'ProxVtoCiclos', 'nextDueCycles'));
      const nextDueDate   = parseDate(get(row, 'PROX_VTO_FECHA', 'ProxVtoFecha', 'nextDueDate'));
      const workOrderNumber = get(row, 'NUM_OT', 'NumOT', 'OT', 'workOrderNumber') || undefined;
      const statusRaw     = get(row, 'ESTADO', 'Estado', 'status') || 'COMPLETADA';
      const status        = mapComplianceStatus(statusRaw);
      const deferralRef   = get(row, 'DIFERIMIENTO', 'deferralReference') || undefined;
      const deferralExp   = parseDate(get(row, 'VTO_DIFERIMIENTO', 'VtoDiferimiento', 'deferralExpiresAt'));

      validOps.push({
        organizationId:            ORG_ID,
        aircraftId,
        taskId,
        performedById:             adminUserId,
        performedAt,
        aircraftHoursAtCompliance: new Prisma.Decimal(aircraftHours),
        aircraftCyclesAtCompliance: aircraftCycles,
        nextDueHours:              nextDueHours  ? new Prisma.Decimal(nextDueHours)  : undefined,
        nextDueCycles:             nextDueCycles ?? undefined,
        nextDueDate:               nextDueDate   ?? undefined,
        workOrderNumber:           workOrderNumber ?? undefined,
        status,
        deferralReference:         deferralRef   ?? undefined,
        deferralExpiresAt:         deferralExp   ?? undefined,
      });
    }

    if (validOps.length === 0) continue;

    try {
      // Usar $transaction para que el lote sea atómico
      const result = await prisma.$transaction(async (tx) => {
        return tx.compliance.createMany({
          data: validOps,
          skipDuplicates: true,
        });
      });
      ok += result.count;
    } catch (err) {
      console.error(`  ✗ Lote filas ${i + 2}–${i + batch.length + 1}: ${(err as Error).message}`);
      error += validOps.length;
    }
  }

  // Imprimir advertencias de filas saltadas
  if (batchErrors.length > 0) {
    console.warn(`\n  ⚠  Filas con datos faltantes o inválidos:`);
    batchErrors.slice(0, 20).forEach(e => console.warn(`     Fila ${e.row}: ${e.msg}`));
    if (batchErrors.length > 20) console.warn(`     … y ${batchErrors.length - 20} más.`);
  }

  return { ok, skip, error };
}

async function runDryRunInspection(csvDir: string): Promise<void> {
  console.warn('⚠  Dry-run: organization not found; using simulated organization context');

  const directoryFiles = await listFilesInDir(csvDir);
  const csvInspections: DryRunCsvInspection[] = [];
  const rowsByKey = new Map<string, Record<string, string>[]>();

  for (const spec of DRY_RUN_FILE_SPECS) {
    const { inspection, rows } = await inspectDryRunCsv(csvDir, spec);
    csvInspections.push(inspection);
    rowsByKey.set(spec.key, rows);
  }

  const nonCsvFiles = directoryFiles.filter((name) => !name.toLowerCase().endsWith('.csv'));
  const xlsxPdfFiles = nonCsvFiles.filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.pdf');
  });

  const rowsAeronaves = (rowsByKey.get('AERONAVES') ?? []) as CsvAeronave[];
  const rowsTareas = (rowsByKey.get('TAREAS') ?? []) as CsvTarea[];
  const rowsOT = (rowsByKey.get('OT') ?? []) as CsvOT[];
  const rowsMotores = (rowsByKey.get('MOTORES') ?? []) as CsvMotor[];
  const engineProjection = projectDryRunEngineMapping(rowsMotores, rowsAeronaves);

  const warnings: string[] = [];
  const errors: string[] = [];
  const unmappedColumns: Array<{ file: string; columns: string[] }> = [];
  const missingRequiredColumns: Array<{ file: string; columns: string[] }> = [];

  for (const inspection of csvInspections) {
    if (!inspection.supported && inspection.found) {
      warnings.push(`${inspection.display}: archivo detectado pero aún no soportado por este importador.`);
    }
    if (inspection.found && inspection.unmappedColumns.length > 0) {
      unmappedColumns.push({ file: inspection.fileName ?? inspection.display, columns: inspection.unmappedColumns });
    }
    if (inspection.found && inspection.missingRequiredColumns.length > 0) {
      missingRequiredColumns.push({ file: inspection.fileName ?? inspection.display, columns: inspection.missingRequiredColumns });
      errors.push(`${inspection.display}: faltan columnas requeridas (${inspection.missingRequiredColumns.join(', ')}).`);
    }
  }

  if (xlsxPdfFiles.length > 0 && csvInspections.every((inspection) => !inspection.found)) {
    warnings.push('Se detectaron archivos XLSX/PDF, pero el importador actual espera CSV para validar/migrar.');
  }

  warnings.push(...engineProjection.warnings);
  errors.push(...engineProjection.errors);

  const filesDetected = csvInspections
    .filter((inspection) => inspection.found)
    .map((inspection) => inspection.fileName ?? inspection.display);
  const filesMissing = csvInspections
    .filter((inspection) => !inspection.found)
    .map((inspection) => inspection.display);
  const rowsPerFile = csvInspections
    .filter((inspection) => inspection.found)
    .map((inspection) => ({ file: inspection.fileName ?? inspection.display, rows: inspection.rows }));

  const report: DryRunReport = {
    filesDetected,
    filesMissing,
    rowsPerFile,
    warnings,
    errors,
    unmappedColumns,
    missingRequiredColumns,
    entities: {
      aircraftWouldUpsert: rowsAeronaves.filter((row) => cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula', 'registration'))).length,
      tasksWouldUpsert: rowsTareas.filter((row) => get(row, 'CODIGO', 'Codigo', 'CODE', 'code').trim()).length,
      complianceWouldInsert: rowsOT.filter((row) => {
        const reg = cleanReg(get(row, 'MAT', 'MATRICULA', 'Matricula'));
        const task = get(row, 'CODIGO_TAREA', 'CodigoTarea', 'TAREA', 'Tarea', 'task', 'CODIGO').trim().toUpperCase();
        const performedAt = parseDate(get(row, 'FECHA_CUMPLIMIENTO', 'FechaCumplimiento', 'FECHA', 'performedAt'));
        return Boolean(reg && task && performedAt);
      }).length,
      enginesWouldCreate: engineProjection.wouldCreate,
      enginesWouldUpdate: engineProjection.wouldUpdate,
      engineUsageLogsWouldCreate: engineProjection.usageLogsWouldCreate,
    },
    safeToAttemptRealImport: errors.length === 0
      && missingRequiredColumns.length === 0
      && csvInspections.some((inspection) => inspection.key === 'AERONAVES' && inspection.found),
  };

  console.log('📂 Archivos esperados (found/missing):');
  for (const inspection of csvInspections) {
    const state = inspection.found ? 'FOUND' : 'MISSING';
    const fileTag = inspection.fileName ? ` (${inspection.fileName})` : '';
    const supportedTag = inspection.supported ? '' : ' [unsupported]';
    console.log(`   - ${inspection.display}: ${state}${fileTag}${supportedTag}`);
  }

  if (xlsxPdfFiles.length > 0) {
    console.log('📎 Archivos XLSX/PDF detectados:');
    xlsxPdfFiles.forEach((name) => console.log(`   - ${name}`));
  }

  console.log('');
  console.log('📊 Filas leídas por archivo:');
  rowsPerFile.forEach((entry) => console.log(`   - ${entry.file}: ${entry.rows}`));

  console.log('');
  console.log('🧪 Simulación de entidades:');
  console.log(`   - Aeronaves upsert: ${report.entities.aircraftWouldUpsert}`);
  console.log(`   - Tareas upsert: ${report.entities.tasksWouldUpsert}`);
  console.log(`   - Cumplimientos insert: ${report.entities.complianceWouldInsert}`);
  console.log(`   - Motores create: ${report.entities.enginesWouldCreate}`);
  console.log(`   - Motores update: ${report.entities.enginesWouldUpdate}`);
  console.log(`   - Engine usage logs create: ${report.entities.engineUsageLogsWouldCreate}`);
  console.log(`   - Motores skipped: ${engineProjection.skipped}`);

  if (missingRequiredColumns.length > 0) {
    console.log('');
    console.log('❗ Columnas requeridas faltantes:');
    missingRequiredColumns.forEach((entry) => {
      console.log(`   - ${entry.file}: ${entry.columns.join(', ')}`);
    });
  }

  if (unmappedColumns.length > 0) {
    console.log('');
    console.log('🧩 Columnas no mapeadas:');
    unmappedColumns.forEach((entry) => {
      console.log(`   - ${entry.file}: ${entry.columns.join(', ')}`);
    });
  }

  if (warnings.length > 0) {
    console.log('');
    console.log(`⚠  Warnings (${warnings.length}):`);
    warnings.slice(0, 50).forEach((warning) => console.log(`   - ${warning}`));
    if (warnings.length > 50) {
      console.log(`   - ... y ${warnings.length - 50} más.`);
    }
  }

  if (errors.length > 0) {
    console.log('');
    console.log(`❌ Errores (${errors.length}):`);
    errors.forEach((error) => console.log(`   - ${error}`));
  }

  console.log('');
  console.log(`✅ Import seguro para modo real: ${report.safeToAttemptRealImport ? 'SI' : 'NO'}`);
}

// ─── Punto de entrada principal ───────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║      Griselle — Migración de datos desde Access/CSV   ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`  Directorio CSV : ${CSV_DIR}`);
  console.log(`  Organización   : ${ORG_ID}`);
  console.log(`  Modo           : ${DRY_RUN ? '🔍 DRY-RUN (sin escritura)' : '✍  ESCRITURA EN BASE DE DATOS'}`);
  console.log('');

  // Verificar que el directorio existe
  if (!fs.existsSync(CSV_DIR)) {
    console.error(`❌ Directorio CSV no encontrado: ${CSV_DIR}`);
    console.error(`   Crea la carpeta 'data/' en la raíz del backend y coloca los archivos CSV.`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('🔍 DRY-RUN activo: los datos NO se escribirán.');
    console.log('');
    await runDryRunInspection(CSV_DIR);
    return;
  }

  // Verificar organización
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID } });
  if (!org) {
    console.error(`❌ Organización con ID ${ORG_ID} no encontrada en la BD.`);
    process.exit(1);
  }
  console.log(`✅ Organización: ${org.name} (${org.slug})`);

  // Obtener usuario admin para createdBy (usamos el primero que exista)
  const adminUser = await prisma.user.findFirst({
    where: { organizationId: ORG_ID, role: 'ADMIN', isActive: true },
  });
  if (!adminUser) {
    console.error('❌ No hay usuario ADMIN activo para la organización. Ejecuta el seed primero.');
    process.exit(1);
  }
  console.log(`✅ Usuario admin: ${adminUser.email}`);
  console.log('');

  // ── Leer CSVs ──────────────────────────────────────────────────────────────
  const [rowsAeronaves, rowsTareas, rowsOT] = await Promise.all([
    readCsv(path.join(CSV_DIR, 'AERONAVES.csv')),
    readCsv(path.join(CSV_DIR, 'TAREAS.csv')),
    readCsv(path.join(CSV_DIR, 'OT.csv')),
  ]);

  const engineCandidates = [
    'MOTORES_A_P.csv',
    'MOTORES_AP.csv',
    'MOTORES A.P.csv',
    'MOTORES A.p.csv',
    'MOTORES.csv',
  ];
  let rowsMotores: CsvMotor[] = [];
  let motoresFileName = 'MOTORES*.csv';
  for (const candidate of engineCandidates) {
    const fullPath = path.join(CSV_DIR, candidate);
    if (!fs.existsSync(fullPath)) continue;
    rowsMotores = await readCsv(fullPath);
    motoresFileName = candidate;
    break;
  }

  console.log(`📂 Archivos leídos:`);
  console.log(`   AERONAVES.csv : ${rowsAeronaves.length} filas`);
  console.log(`   TAREAS.csv    : ${rowsTareas.length} filas`);
  console.log(`   OT.csv        : ${rowsOT.length} filas`);
  console.log(`   ${motoresFileName} : ${rowsMotores.length} filas`);
  console.log('');

  const stats: MigStats = {
    aircraft:   { ok: 0, skip: 0, error: 0 },
    engines:    { ok: 0, skip: 0, error: 0, warn: 0 },
    tasks:      { ok: 0, skip: 0, error: 0 },
    compliance: { ok: 0, skip: 0, error: 0 },
  };

  // ── 1. Aeronaves ────────────────────────────────────────────────────────────
  if (rowsAeronaves.length > 0) {
    console.log('▶  Migrando AERONAVES…');
    const result = await migrateAircraft(rowsAeronaves);
    stats.aircraft = { ok: result.ok, skip: result.skip, error: result.error };
    console.log(`   ✅ ${result.ok} creadas/actualizadas  ⏭  ${result.skip} saltadas  ✗ ${result.error} errores\n`);

    // ── 1.b Motores ─────────────────────────────────────────────────────────
    if (rowsMotores.length > 0) {
      console.log(`▶  Migrando MOTORES (${motoresFileName})…`);
      const dbAircraft = await prisma.aircraft.findMany({
        where: { organizationId: ORG_ID },
        select: { id: true, registration: true },
      });
      const acMap = new Map(dbAircraft.map((a) => [a.registration, a.id]));
      const engineResult = await migrateEngines(rowsMotores, acMap);
      stats.engines = {
        ok: engineResult.ok,
        skip: engineResult.skip,
        error: engineResult.error,
        warn: engineResult.warn,
      };
      console.log(
        `   ✅ ${engineResult.ok} creados/actualizados  ⏭  ${engineResult.skip} saltados  ⚠ ${engineResult.warn} warnings  ✗ ${engineResult.error} errores\n`,
      );
      if (engineResult.warnings.length > 0) {
        console.warn('  ⚠  Advertencias de motores (primeras 20):');
        engineResult.warnings.slice(0, 20).forEach((warning) => {
          const regTag = warning.registration ? `[${warning.registration}] ` : '';
          console.warn(`     Fila ${warning.row}: ${regTag}${warning.message}`);
        });
        if (engineResult.warnings.length > 20) {
          console.warn(`     … y ${engineResult.warnings.length - 20} más.`);
        }
        console.warn('');
      }
    }

    // ── 2. Tareas ─────────────────────────────────────────────────────────────
    if (rowsTareas.length > 0) {
      console.log('▶  Migrando TAREAS DE MANTENIMIENTO…');
      const taskResult = await migrateTasks(rowsTareas);
      stats.tasks = { ok: taskResult.ok, skip: taskResult.skip, error: taskResult.error };
      console.log(`   ✅ ${taskResult.ok} creadas/actualizadas  ⏭  ${taskResult.skip} saltadas  ✗ ${taskResult.error} errores\n`);

      // ── 3. OT / Cumplimientos ──────────────────────────────────────────────
      if (rowsOT.length > 0) {
        console.log('▶  Migrando ÓRDENES DE TRABAJO / CUMPLIMIENTOS…');
        // Recargar mapas frescos desde la BD por si ya existían registros previos
        const dbAircraft = await prisma.aircraft.findMany({
          where: { organizationId: ORG_ID },
          select: { id: true, registration: true },
        });
        const dbTasks = await prisma.maintenanceTask.findMany({
          where: { organizationId: ORG_ID },
          select: { id: true, code: true },
        });
        const acMap   = new Map(dbAircraft.map(a => [a.registration, a.id]));
        const taskMap = new Map(dbTasks.map(t => [t.code, t.id]));

        const otResult = await migrateOT(rowsOT, acMap, taskMap, adminUser.id);
        stats.compliance = otResult;
        console.log(`   ✅ ${otResult.ok} creados  ⏭  ${otResult.skip} saltados  ✗ ${otResult.error} errores\n`);
      }
    }

    // ── Resumen final ──────────────────────────────────────────────────────────
    console.log('══════════════════════════════════════════════════════════');
    console.log('  RESUMEN DE MIGRACIÓN');
    console.log('══════════════════════════════════════════════════════════');
    const pad = (n: number) => String(n).padStart(4);
    console.log(`  Aeronaves    : ${pad(stats.aircraft.ok)} ok  ${pad(stats.aircraft.skip)} skip  ${pad(stats.aircraft.error)} err`);
    console.log(`  Motores      : ${pad(stats.engines.ok)} ok  ${pad(stats.engines.skip)} skip  ${pad(stats.engines.warn)} warn ${pad(stats.engines.error)} err`);
    console.log(`  Tareas       : ${pad(stats.tasks.ok)} ok  ${pad(stats.tasks.skip)} skip  ${pad(stats.tasks.error)} err`);
    console.log(`  Cumplimientos: ${pad(stats.compliance.ok)} ok  ${pad(stats.compliance.skip)} skip  ${pad(stats.compliance.error)} err`);
    console.log('══════════════════════════════════════════════════════════');

    const hasErrors = stats.aircraft.error + stats.engines.error + stats.tasks.error + stats.compliance.error > 0;
    if (hasErrors) {
      console.log('\n⚠  La migración terminó con algunos errores. Revisa los mensajes anteriores.');
    } else {
      console.log('\n🎉  Migración completada exitosamente.');
    }
  } else {
    console.log('ℹ  No se encontraron archivos CSV con datos. Verifica el directorio:', CSV_DIR);
  }
}

main()
  .catch((e) => {
    console.error('\n❌ Error fatal durante la migración:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
