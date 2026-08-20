/**
 * import_component_life_limits.ts
 *
 * Carga el plan de reemplazo de componentes con vida límite desde la hoja
 * "Plan. Reemp. AC Air Limit" de la bitácora electrónica.
 *
 * Estos controles son POR NÚMERO DE SERIE: el tailcone de CC-AKY (C023-21
 * S/N 0560) es una pieza distinta a la de CC-AVK (C023-35 S/N 11737), con su
 * propia vida consumida. Por eso cada aeronave tiene sus propias tareas
 * COMP-*, a diferencia de las AD, que son la misma directiva para toda la
 * flota. Se sigue el mismo formato que dejó la importación del Access:
 * referenceType AMM, isComponentControl, código COMP-<n>-<P/N>-<S/N>.
 *
 * Las filas que la bitácora marca como no instaladas ("P/N NO INSTALADO",
 * "N/A POR REV. INST.", "REMOVIDO") no se cargan: no hay pieza que controlar.
 * Se informan al final para que quede constancia de qué se omitió.
 *
 * Uso:
 *   npx tsx prisma/import_component_life_limits.ts \
 *     --file "/ruta/bitacora.xlsx" --org-slug tecnicopters \
 *     --registration CC-AKY --performed-by "Griselle" [--apply]
 */
import path from 'path';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { ComplianceDueDateService } from '../src/domain/services/ComplianceDueDateService';

const prisma = new PrismaClient();
const dueService = new ComplianceDueDateService();
const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}

const FILE = getArgValue('--file');
const ORG_SLUG = getArgValue('--org-slug') ?? 'tecnicopters';
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase() ?? 'CC-AKY';
const PERFORMED_BY = getArgValue('--performed-by') ?? 'Griselle';
const SHEET = getArgValue('--sheet') ?? 'Plan. Reemp. AC Air Limit';
const APPLY = args.includes('--apply');

function cellValue(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object' && 'result' in v) return cellValue((v as { result: ExcelJS.CellValue }).result);
  return null;
}

const asText = (v: ExcelJS.CellValue): string => {
  const c = cellValue(v);
  return c == null ? '' : String(c).replace(/\s+/g, ' ').trim();
};

const asNumber = (v: ExcelJS.CellValue): number | null => {
  const c = cellValue(v);
  if (typeof c === 'number') return c;
  if (typeof c === 'string') {
    const n = Number(c.replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asDate = (v: ExcelJS.CellValue): Date | null => {
  const c = cellValue(v);
  return c instanceof Date ? c : null;
};

/** Marcas de la columna OBSERVACIONES que indican que la pieza no está puesta. */
const NO_INSTALADO = /NO INSTALADO|N\/A POR REV|REMOVIDO|NO POSEE/i;

interface ComponentRow {
  fila: number;
  componente: string;
  partNumber: string;
  serialNumber: string;
  limiteHoras: number | null;
  limiteMeses: number | null;
  horasAeronaveAlInstalar: number | null;
  fechaUltimoCumplimiento: Date | null;
  observaciones: string;
}

function parseSheet(ws: ExcelJS.Worksheet): { instalados: ComponentRow[]; omitidos: ComponentRow[] } {
  const instalados: ComponentRow[] = [];
  const omitidos: ComponentRow[] = [];

  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const componente = asText(row.getCell(1).value);
    if (!componente) return;
    // Encabezados y cortes de página se repiten en cada hoja impresa.
    if (/^PAG\. N/i.test(componente) || componente.toUpperCase() === 'COMPONENTE') return;

    const item: ComponentRow = {
      fila: n,
      componente,
      partNumber: asText(row.getCell(3).value),
      serialNumber: asText(row.getCell(4).value),
      limiteHoras: asNumber(row.getCell(5).value),
      limiteMeses: asNumber(row.getCell(6).value),
      horasAeronaveAlInstalar: asNumber(row.getCell(9).value),
      fechaUltimoCumplimiento: asDate(row.getCell(10).value),
      observaciones: asText(row.getCell(16).value),
    };

    // Sin fecha de instalación no hay desde cuándo contar la vida de la pieza.
    const noInstalado = NO_INSTALADO.test(item.observaciones) || !item.fechaUltimoCumplimiento;
    if (noInstalado) omitidos.push(item);
    else instalados.push(item);
  });

  return { instalados, omitidos };
}

/** Mismo formato que dejó la importación del Access: COMP-<n>-<P/N>-<S/N>. */
function buildCode(item: ComponentRow, seq: number): string {
  const pn = item.partNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20) || 'SINPN';
  const sn = item.serialNumber && !/^S\/S$/i.test(item.serialNumber)
    ? item.serialNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16)
    : 'SINSN';
  return `COMP-${String(seq).padStart(3, '0')}-${pn}-${sn}`;
}

async function main(): Promise<void> {
  if (!FILE) {
    console.error('Uso: --file <bitacora.xlsx> --org-slug tecnicopters --registration CC-AKY --performed-by "Griselle" [--apply]');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true, totalFlightHours: true, totalCycles: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY}"`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(FILE));
  const ws = workbook.getWorksheet(SHEET) ?? workbook.worksheets.find((w) => w.name.trim() === SHEET.trim());
  if (!ws) throw new Error(`No se encontró la hoja "${SHEET}"`);

  const { instalados, omitidos } = parseSheet(ws);

  console.log(`\n=== Plan de reemplazo de componentes — ${REGISTRATION} ===`);
  console.log(`Hoja: "${ws.name}" · cumplimientos a nombre de ${performer.name}\n`);
  console.log(`Componentes instalados a cargar: ${instalados.length}`);
  console.log(`Filas omitidas (pieza no instalada / sin fecha): ${omitidos.length}\n`);

  const existentes = new Set(
    (await prisma.maintenanceTask.findMany({
      where: { organizationId: org.id, code: { startsWith: 'COMP-' } },
      select: { code: true },
    })).map((t) => t.code),
  );

  const plan = instalados.map((item, i) => {
    const code = buildCode(item, i + 1);
    const horasInst = item.horasAeronaveAlInstalar ?? 0;
    const proximoHoras = item.limiteHoras != null ? horasInst + item.limiteHoras : null;
    return { item, code, horasInst, proximoHoras, yaExiste: existentes.has(code) };
  });

  console.log('Ejemplo de los primeros 12:');
  for (const p of plan.slice(0, 12)) {
    const lim = [
      p.item.limiteHoras != null ? `${p.item.limiteHoras}h` : null,
      p.item.limiteMeses != null ? `${p.item.limiteMeses}m` : null,
    ].filter(Boolean).join(' / ') || 'sin límite';
    console.log(`  [${p.code}]`);
    console.log(`      ${p.item.componente.slice(0, 48)} · P/N ${p.item.partNumber} · S/N ${p.item.serialNumber || '—'}`);
    console.log(`      límite ${lim} · instalado ${p.item.fechaUltimoCumplimiento!.toISOString().slice(0, 10)} a ${p.horasInst} h`
      + `${p.proximoHoras != null ? ` → vence a ${proximoRedondo(p.proximoHoras)} h` : ''}${p.yaExiste ? '  (ya existe, se omite)' : ''}`);
  }

  if (omitidos.length) {
    console.log('\nOmitidos (no hay pieza instalada que controlar):');
    for (const o of omitidos.slice(0, 12)) {
      console.log(`  · fila ${o.fila}: ${o.componente.slice(0, 44)} — ${o.observaciones || 'sin fecha de instalación'}`);
    }
    if (omitidos.length > 12) console.log(`  …y ${omitidos.length - 12} más`);
  }

  const aCrear = plan.filter((p) => !p.yaExiste);
  console.log(`\n→ ${aCrear.length} componentes a cargar (${plan.length - aCrear.length} ya existían).`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  let n = 0;
  for (const p of aCrear) {
    const { item, code, horasInst } = p;
    await prisma.$transaction(async (tx) => {
      const task = await tx.maintenanceTask.create({
        data: {
          organizationId: org.id,
          code,
          title: `${item.componente}${item.serialNumber && !/^S\/S$/i.test(item.serialNumber) ? ` (S/N ${item.serialNumber})` : ''}`,
          description: `Control de vida límite. P/N ${item.partNumber}`
            + `${item.serialNumber ? ` · S/N ${item.serialNumber}` : ''}`
            + ` · instalado el ${item.fechaUltimoCumplimiento!.toISOString().slice(0, 10)} con la aeronave en ${horasInst} h.`
            + ` Importado de la bitácora electrónica de ${REGISTRATION}.`,
          intervalType: item.limiteHoras != null && item.limiteMeses != null
            ? 'FLIGHT_HOURS_OR_CALENDAR'
            : item.limiteHoras != null ? 'FLIGHT_HOURS' : 'CALENDAR_DAYS',
          intervalHours: item.limiteHoras,
          intervalCalendarMonths: item.limiteMeses,
          referenceType: 'AMM',
          isComponentControl: true,
          isMandatory: true,
          applicableModel: 'R66',
          applicablePartNumber: item.partNumber || null,
        },
      });

      await tx.aircraftTask.create({
        data: { aircraftId: aircraft.id, taskId: task.id, isActive: true },
      });

      const due = dueService.calculate(
        {
          id: task.id, organizationId: task.organizationId, code: task.code, title: task.title,
          description: task.description, intervalType: task.intervalType,
          intervalHours: task.intervalHours != null ? Number(task.intervalHours) : null,
          intervalCycles: task.intervalCycles, intervalCalendarDays: task.intervalCalendarDays,
          intervalCalendarMonths: task.intervalCalendarMonths,
          toleranceHours: null, toleranceCycles: null, toleranceCalendarDays: null,
          referenceNumber: task.referenceNumber, referenceType: task.referenceType,
          isMandatory: task.isMandatory, estimatedManHours: null,
          requiresInspection: task.requiresInspection, applicableModel: task.applicableModel,
          applicablePartNumber: task.applicablePartNumber, isActive: task.isActive,
          createdAt: task.createdAt, updatedAt: task.updatedAt,
        },
        horasInst,
        0,
        item.fechaUltimoCumplimiento!,
      );

      await tx.compliance.create({
        data: {
          organizationId: org.id, aircraftId: aircraft.id, taskId: task.id,
          performedById: performer.id,
          performedAt: item.fechaUltimoCumplimiento!,
          aircraftHoursAtCompliance: horasInst,
          aircraftCyclesAtCompliance: 0,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
          applicationType: 'replacement_start',
          isInitial: true,
          status: 'COMPLETED',
          notes: `Instalación del componente — importado de bitácora electrónica (${REGISTRATION})`,
        },
      });
    });
    n += 1;
  }

  console.log(`\n✅ ${n} componentes con vida límite cargados en el plan de ${REGISTRATION}.`);
}

const proximoRedondo = (n: number): string => (Math.round(n * 100) / 100).toString();

main()
  .catch((err) => {
    console.error('import_component_life_limits failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
