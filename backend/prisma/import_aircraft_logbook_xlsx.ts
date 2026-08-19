/**
 * import_aircraft_logbook_xlsx.ts
 *
 * Importa horas y ciclos históricos (célula + motor) de la bitácora
 * electrónica DGAC (.xlsx) de una aeronave ya registrada en la plataforma,
 * hacia el sistema de contadores actual (CounterReading), sincronizando
 * también los campos legado (AircraftUsageLog / AircraftEngineUsageLog /
 * Aircraft.totalFlightHours / totalCycles) exactamente como lo hace
 * AircraftController.createCounterReading — para que el resto de la app
 * (Due Engine, reportes, plan de mantenimiento) vea los mismos números que
 * vería si alguien hubiera cargado cada lectura a mano desde la UI.
 *
 * Lee las hojas "Reg. Horas AC" y "Reg. Horas ENG" (columnas FECHA / Horas
 * Funcionamiento (Efectuadas, Acumuladas) / Ciclos (Efectuados, Acumulados)),
 * filtradas desde --since (por defecto todo). No toca Partidas, Aterrizajes,
 * cumplimientos, AD ni ningún otro dato del archivo.
 *
 * Uso:
 *   npx tsx prisma/import_aircraft_logbook_xlsx.ts \
 *     --file "/ruta/al/archivo.xlsx" \
 *     --registration CC-AKY \
 *     --org-slug tecnicopters \
 *     --since 2023-11-01 \
 *     [--apply]
 *
 * Sin --apply corre en dry-run: valida, resuelve todo, y muestra un resumen
 * de lo que haría (filas, rango de fechas, totales finales, anomalías) sin
 * escribir nada.
 */
import path from 'path';
import ExcelJS from 'exceljs';
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

const FILE = getArgValue('--file');
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase();
const ORG_SLUG = getArgValue('--org-slug');
const SINCE = getArgValue('--since'); // YYYY-MM-DD, opcional
const APPLY = args.includes('--apply');

interface HistoryRow {
  date: Date;
  hoursAccumulated: number;
  cyclesAccumulated: number;
}

const AC_SHEET_CANDIDATES = ['Reg. Horas AC', 'Reg. Horas AC ']; // el archivo trae un espacio final
const ENG_SHEET_CANDIDATES = ['Reg. Horas ENG', 'Reg. Horas ENG '];

function findSheet(workbook: ExcelJS.Workbook, candidates: string[]): ExcelJS.Worksheet {
  for (const name of candidates) {
    const ws = workbook.getWorksheet(name);
    if (ws) return ws;
  }
  const trimmedMatch = workbook.worksheets.find((ws) => candidates.includes(ws.name.trim()));
  if (trimmedMatch) return trimmedMatch;
  throw new Error(`No se encontró ninguna hoja entre: ${candidates.join(', ')}`);
}

function toNumber(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }
  // Celdas con fórmula (p. ej. "=B6+C5"): ExcelJS entrega { formula, result } o
  // { sharedFormula, result } en vez del número — hay que leer el resultado.
  if (typeof value === 'object' && 'result' in value) {
    return toNumber((value as { result: ExcelJS.CellValue }).result);
  }
  return null;
}

function toDate(value: ExcelJS.CellValue): Date | null {
  if (value instanceof Date) return value;
  return null;
}

/** Lee filas de datos desde la fila 5 (después de las 2 filas de encabezado
 * compuesto), columnas: A=FECHA, B=Horas Efectuadas, C=Horas Acumuladas,
 * D=Ciclos Efectuados, E=Ciclos Acumulados. */
function parseHistoryRows(ws: ExcelJS.Worksheet, since: Date | null): HistoryRow[] {
  const rows: HistoryRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 5) return;
    const date = toDate(row.getCell(1).value);
    const hoursAcc = toNumber(row.getCell(3).value);
    const cyclesAcc = toNumber(row.getCell(5).value);
    if (!date || hoursAcc === null || cyclesAcc === null) return;
    if (since && date < since) return;
    rows.push({ date, hoursAccumulated: hoursAcc, cyclesAccumulated: cyclesAcc });
  });
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  // La bitácora a veces trae más de una fila para el mismo día (varios
  // vuelos) — CounterReading es de granularidad diaria, así que se conserva
  // solo la última fila de cada día (el acumulado final de esa jornada).
  const lastByDate = new Map<string, HistoryRow>();
  for (const r of rows) lastByDate.set(r.date.toISOString().slice(0, 10), r);
  return [...lastByDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function findMonotonicityIssues(rows: HistoryRow[]): string[] {
  const issues: string[] = [];
  let prevHours: number | null = null;
  let prevCycles: number | null = null;
  for (const r of rows) {
    const d = r.date.toISOString().slice(0, 10);
    if (prevHours !== null && r.hoursAccumulated < prevHours) {
      issues.push(`${d}: horas acumuladas bajan de ${prevHours} a ${r.hoursAccumulated}`);
    }
    if (prevCycles !== null && r.cyclesAccumulated < prevCycles) {
      issues.push(`${d}: ciclos acumulados bajan de ${prevCycles} a ${r.cyclesAccumulated}`);
    }
    prevHours = r.hoursAccumulated;
    prevCycles = r.cyclesAccumulated;
  }
  return issues;
}

async function main(): Promise<void> {
  if (!FILE || !REGISTRATION || !ORG_SLUG) {
    console.error('Uso: --file <ruta.xlsx> --registration CC-AKY --org-slug tecnicopters [--since 2023-11-01] [--apply]');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    include: { engines: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);
  if (aircraft.engines.length !== 1) {
    throw new Error(
      `${REGISTRATION} tiene ${aircraft.engines.length} motor(es) registrados — este script asume exactamente uno (helicóptero monomotor). Ajusta el script si no es el caso.`,
    );
  }
  const engine = aircraft.engines[0];

  const [acHoursType, acCyclesType, engHoursType, engCyclesType] = await Promise.all([
    prisma.counterType.findFirst({ where: { organizationId: org.id, legacyField: 'aircraftHours' } }),
    prisma.counterType.findFirst({ where: { organizationId: org.id, legacyField: 'aircraftCycles' } }),
    prisma.counterType.findFirst({ where: { organizationId: org.id, legacyField: 'engineHours' } }),
    prisma.counterType.findFirst({ where: { organizationId: org.id, legacyField: 'engineCycles' } }),
  ]);
  for (const [label, ct] of [
    ['aircraftHours', acHoursType], ['aircraftCycles', acCyclesType],
    ['engineHours', engHoursType], ['engineCycles', engCyclesType],
  ] as const) {
    if (!ct) throw new Error(`No hay un CounterType con legacyField="${label}" en ${ORG_SLUG}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(FILE));
  const acSheet = findSheet(workbook, AC_SHEET_CANDIDATES);
  const engSheet = findSheet(workbook, ENG_SHEET_CANDIDATES);

  const since = SINCE ? new Date(SINCE) : null;
  const acRows = parseHistoryRows(acSheet, since);
  const engRows = parseHistoryRows(engSheet, since);

  console.log(`\n=== ${REGISTRATION} (${ORG_SLUG}) ===`);
  console.log(`Célula: ${acRows.length} filas${acRows.length ? ` (${acRows[0].date.toISOString().slice(0, 10)} → ${acRows.at(-1)!.date.toISOString().slice(0, 10)})` : ''}`);
  console.log(`Motor:  ${engRows.length} filas${engRows.length ? ` (${engRows[0].date.toISOString().slice(0, 10)} → ${engRows.at(-1)!.date.toISOString().slice(0, 10)})` : ''}`);

  const acIssues = findMonotonicityIssues(acRows);
  const engIssues = findMonotonicityIssues(engRows);
  if (acIssues.length || engIssues.length) {
    console.log('\n⚠️  Anomalías encontradas (el valor acumulado baja respecto a la lectura anterior).');
    console.log('   Estas filas se OMITEN automáticamente para no romper la validación de la app');
    console.log('   (que exige que cada lectura sea ≥ que la anterior). Revísalas en el archivo original:');
    for (const i of [...acIssues.map((x) => `  célula: ${x}`), ...engIssues.map((x) => `  motor:  ${x}`)]) console.log(i);
  }

  // Se omiten filas que romperían el orden creciente, en vez de fallar todo el import.
  function dropNonMonotonic(rows: HistoryRow[]): HistoryRow[] {
    const kept: HistoryRow[] = [];
    let prevHours = -Infinity;
    let prevCycles = -Infinity;
    for (const r of rows) {
      if (r.hoursAccumulated < prevHours || r.cyclesAccumulated < prevCycles) continue;
      kept.push(r);
      prevHours = r.hoursAccumulated;
      prevCycles = r.cyclesAccumulated;
    }
    return kept;
  }
  const acKept = dropNonMonotonic(acRows);
  const engKept = dropNonMonotonic(engRows);
  if (acKept.length !== acRows.length || engKept.length !== engRows.length) {
    console.log(`\nSe importarán ${acKept.length}/${acRows.length} filas de célula y ${engKept.length}/${engRows.length} de motor (el resto son las anomalías de arriba).`);
  }

  if (acKept.length) {
    const last = acKept.at(-1)!;
    console.log(`\nCélula quedaría en: ${last.hoursAccumulated} hrs / ${last.cyclesAccumulated} ciclos (al ${last.date.toISOString().slice(0, 10)})`);
  }
  if (engKept.length) {
    const last = engKept.at(-1)!;
    console.log(`Motor quedaría en:  ${last.hoursAccumulated} hrs / ${last.cyclesAccumulated} ciclos (al ${last.date.toISOString().slice(0, 10)})`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  const recordedById = (await prisma.user.findFirst({
    where: { organizationId: org.id, role: 'ADMIN', isActive: true },
    select: { id: true },
  }))?.id ?? null;

  const notes = `Importado de bitácora electrónica (${REGISTRATION})`;

  /** Escribe horas + ciclos de una fecha juntos, en una sola transacción: dos
   * CounterReading (uno por contador) más UNA fila de historial legado con
   * ambos campos ya combinados — así nunca queda una fila intermedia con un
   * campo correcto y el otro en cero. */
  async function importDailySnapshot(
    target: { aircraftId: string } | { engineId: string },
    row: HistoryRow,
    hoursCounterTypeId: string,
    cyclesCounterTypeId: string,
    isAircraft: boolean,
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const scopeFilter = 'aircraftId' in target ? { aircraftId: target.aircraftId } : { engineId: target.engineId };

      const already = await tx.counterReading.findFirst({
        where: { counterTypeId: hoursCounterTypeId, ...scopeFilter, readingDate: row.date },
        select: { id: true },
      });
      if (already) return false; // idempotente: re-ejecutar --apply no duplica

      await tx.counterReading.create({
        data: {
          organizationId: org!.id, counterTypeId: hoursCounterTypeId, ...scopeFilter,
          value: row.hoursAccumulated, readingDate: row.date, source: 'import', notes, recordedById,
        },
      });
      await tx.counterReading.create({
        data: {
          organizationId: org!.id, counterTypeId: cyclesCounterTypeId, ...scopeFilter,
          value: row.cyclesAccumulated, readingDate: row.date, source: 'import', notes, recordedById,
        },
      });

      if (isAircraft && 'aircraftId' in target) {
        await tx.aircraftUsageLog.create({
          data: {
            organizationId: org!.id, aircraftId: target.aircraftId, date: row.date,
            totalHours: row.hoursAccumulated, totalCycles: Math.round(row.cyclesAccumulated),
            source: 'manual', notes,
          },
        });
        await tx.aircraft.update({
          where: { id: target.aircraftId },
          data: { totalFlightHours: row.hoursAccumulated, totalCycles: Math.round(row.cyclesAccumulated) },
        });
      } else if (!isAircraft && 'engineId' in target) {
        await tx.aircraftEngineUsageLog.create({
          data: {
            organizationId: org!.id, engineId: target.engineId, date: row.date,
            hours: row.hoursAccumulated, cycles: Math.round(row.cyclesAccumulated),
          },
        });
      }

      return true;
    });
  }

  let acCreated = 0;
  for (const r of acKept) {
    if (await importDailySnapshot({ aircraftId: aircraft.id }, r, acHoursType!.id, acCyclesType!.id, true)) acCreated += 1;
  }
  let engCreated = 0;
  for (const r of engKept) {
    if (await importDailySnapshot({ engineId: engine.id }, r, engHoursType!.id, engCyclesType!.id, false)) engCreated += 1;
  }

  console.log('\n✅ Importado:');
  console.log(`   Célula: ${acCreated} lecturas diarias (horas + ciclos)`);
  console.log(`   Motor:  ${engCreated} lecturas diarias (horas + ciclos)`);
}

main()
  .catch((err) => {
    console.error('import_aircraft_logbook_xlsx failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
