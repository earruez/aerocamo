/**
 * import_ccaky_engine_inspections.ts
 *
 * Carga el programa de inspecciones del MOTOR desde la hoja "Cump.Insp.Eng."
 * de la bitácora. Es el equivalente para el motor de lo que ya se cargó para
 * la célula: sin esto el motor queda con sus componentes de vida límite pero
 * sin ninguna inspección programada.
 *
 * Las tareas ya existen en la empresa como IN-*-250C300A1 (importadas del
 * Access, las usa CC-AVK, que tiene el mismo motor 250-C300/A1). Se enlaza
 * CC-AKY a esas mismas y se le cargan SUS cumplimientos.
 *
 * Las inspecciones que nunca se han ejecutado se anclan en el estado de
 * motor nuevo (2012-04-20, 0 h), que es lo que hace que venzan en su hora
 * absoluta —la de 2000 h vence a las 2000 h— tal como declara la bitácora.
 *
 * Uso:
 *   npx tsx prisma/import_ccaky_engine_inspections.ts --org-slug tecnicopters \
 *     --registration CC-AKY --performed-by "Griselle" [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { ComplianceDueDateService } from '../src/domain/services/ComplianceDueDateService';
import { BASELINE_NOTE } from '../src/domain/services/BaselineComplianceService';

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

const ORG_SLUG = getArgValue('--org-slug') ?? 'tecnicopters';
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase() ?? 'CC-AKY';
const PERFORMED_BY = getArgValue('--performed-by') ?? 'Griselle';
const APPLY = args.includes('--apply');

/** Motor nuevo: origen del conteo para lo que nunca se ejecutó. */
const MOTOR_NUEVO = { fecha: '2012-04-20', horas: 0 };

interface InspectionItem {
  code: string;
  descripcion: string;
  /** Horas de MOTOR al momento del cumplimiento, según la bitácora. */
  cumplimiento: { fecha: string; horasMotor: number } | null;
  nota?: string;
}

const PROGRAMA: InspectionItem[] = [
  {
    code: 'IN-001-250C300A1',
    descripcion: 'Inspección 200 Hrs / 12 Meses (OMM RR300, tabla 601)',
    cumplimiento: { fecha: '2025-02-06', horasMotor: 956.77 },
  },
  {
    code: 'IN-003-250C300A1',
    descripcion: 'Inspección 400 Hrs (OMM RR300, tabla 602)',
    cumplimiento: { fecha: '2024-01-06', horasMotor: 803.28 },
  },
  {
    code: 'IN-004-250C300A1',
    descripcion: 'Inspección 1000 Hrs (OMM RR300, tabla 603)',
    cumplimiento: { fecha: '2025-03-26', horasMotor: 998.28 },
  },
  {
    code: 'IN-005-250C300A1',
    descripcion: 'Inspección 2000 Hrs (OMM RR300, tabla 604)',
    cumplimiento: null,
  },
  {
    code: 'IN-006-250C300A1',
    descripcion: 'Inspección 4000 Hrs (OMM RR300)',
    cumplimiento: null,
    nota: 'La bitácora la referencia como tabla 605 y la tarea existente dice tabla 606 — mismo intervalo de 4000 h.',
  },
];

/** Las dos PMI de la bitácora no tienen equivalente entre las IN-*: su task
 *  del manual es 05-00-00-800-801, distinta a la 05-21-00 de las anteriores. */
const SIN_EQUIVALENTE = [
  'OMM RR 300, TASK 05-00-00-800-801 (PMI) — cada 2000 h, sin cumplimiento registrado.',
  'OMM RR 300, TASK 05-00-00-800-801 (PMI) — cada 3000 ciclos, sin cumplimiento registrado.',
];

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY}"`);

  const tasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, code: { in: PROGRAMA.map((p) => p.code) } },
  });
  const byCode = new Map(tasks.map((t) => [t.code, t]));

  console.log(`\n=== Programa de inspecciones del MOTOR — ${REGISTRATION} ===`);
  console.log(`A nombre de: ${performer.name}\n`);

  const faltantes = PROGRAMA.filter((p) => !byCode.has(p.code));
  if (faltantes.length) {
    console.log(`⚠️  No existen en la empresa: ${faltantes.map((f) => f.code).join(', ')} — se omiten\n`);
  }

  const plan = PROGRAMA.filter((p) => byCode.has(p.code));
  for (const p of plan) {
    const t = byCode.get(p.code)!;
    const origen = p.cumplimiento ?? { fecha: MOTOR_NUEVO.fecha, horasMotor: MOTOR_NUEVO.horas };
    const due = dueService.calculate(
      {
        id: t.id, organizationId: t.organizationId, code: t.code, title: t.title,
        description: t.description, intervalType: t.intervalType,
        intervalHours: t.intervalHours != null ? Number(t.intervalHours) : null,
        intervalCycles: t.intervalCycles, intervalCalendarDays: t.intervalCalendarDays,
        intervalCalendarMonths: t.intervalCalendarMonths,
        toleranceHours: t.toleranceHours != null ? Number(t.toleranceHours) : null,
        toleranceCycles: t.toleranceCycles, toleranceCalendarDays: t.toleranceCalendarDays,
        referenceNumber: t.referenceNumber, referenceType: t.referenceType,
        isMandatory: t.isMandatory,
        estimatedManHours: t.estimatedManHours != null ? Number(t.estimatedManHours) : null,
        requiresInspection: t.requiresInspection, applicableModel: t.applicableModel,
        applicablePartNumber: t.applicablePartNumber, isActive: t.isActive,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
      },
      origen.horasMotor, 0, new Date(origen.fecha),
    );
    console.log(`  [${p.code}] ${p.descripcion}`);
    if (p.cumplimiento) {
      console.log(`      cumplido ${p.cumplimiento.fecha} a ${p.cumplimiento.horasMotor} h de motor`
        + ` → próximo: ${due.nextDueHours ?? '—'} h / ${due.nextDueDate ? due.nextDueDate.toISOString().slice(0, 10) : '—'}`);
    } else {
      console.log(`      nunca ejecutada — se ancla en motor nuevo (${MOTOR_NUEVO.fecha}, 0 h)`
        + ` → vence a ${due.nextDueHours ?? '—'} h`);
    }
    if (p.nota) console.log(`      ⚠️  ${p.nota}`);
  }

  console.log('\nSin equivalente automático (cargar a mano si corresponde):');
  for (const s of SIN_EQUIVALENTE) console.log(`  · ${s}`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  for (const p of plan) {
    const t = byCode.get(p.code)!;
    const origen = p.cumplimiento ?? { fecha: MOTOR_NUEVO.fecha, horasMotor: MOTOR_NUEVO.horas };
    await prisma.$transaction(async (tx) => {
      await tx.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: t.id } },
        create: { aircraftId: aircraft.id, taskId: t.id, isActive: true },
        update: { isActive: true },
      });

      // Una línea base con fecha de hoy le ganaría al cumplimiento real, que
      // es anterior.
      await tx.compliance.deleteMany({
        where: {
          aircraftId: aircraft.id, taskId: t.id,
          OR: [{ applicationType: 'baseline' }, { notes: BASELINE_NOTE }],
        },
      });

      const ya = await tx.compliance.findFirst({
        where: { aircraftId: aircraft.id, taskId: t.id, performedAt: new Date(origen.fecha) },
        select: { id: true },
      });
      if (ya) return;

      const due = dueService.calculate(
        {
          id: t.id, organizationId: t.organizationId, code: t.code, title: t.title,
          description: t.description, intervalType: t.intervalType,
          intervalHours: t.intervalHours != null ? Number(t.intervalHours) : null,
          intervalCycles: t.intervalCycles, intervalCalendarDays: t.intervalCalendarDays,
          intervalCalendarMonths: t.intervalCalendarMonths,
          toleranceHours: t.toleranceHours != null ? Number(t.toleranceHours) : null,
          toleranceCycles: t.toleranceCycles, toleranceCalendarDays: t.toleranceCalendarDays,
          referenceNumber: t.referenceNumber, referenceType: t.referenceType,
          isMandatory: t.isMandatory,
          estimatedManHours: t.estimatedManHours != null ? Number(t.estimatedManHours) : null,
          requiresInspection: t.requiresInspection, applicableModel: t.applicableModel,
          applicablePartNumber: t.applicablePartNumber, isActive: t.isActive,
          createdAt: t.createdAt, updatedAt: t.updatedAt,
        },
        origen.horasMotor, 0, new Date(origen.fecha),
      );

      await tx.compliance.create({
        data: {
          organizationId: org.id, aircraftId: aircraft.id, taskId: t.id,
          performedById: performer.id,
          performedAt: new Date(origen.fecha),
          aircraftHoursAtCompliance: origen.horasMotor,
          aircraftCyclesAtCompliance: 0,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
          applicationType: p.cumplimiento ? 'application' : 'baseline',
          isInitial: !p.cumplimiento,
          status: 'COMPLETED',
          notes: p.cumplimiento
            ? `Importado de bitácora electrónica (${REGISTRATION}) — Cump.Insp.Eng.`
            : `Inicio de control desde motor nuevo — importado de bitácora electrónica (${REGISTRATION})`,
        },
      });
    });
    console.log(`  ✓ ${p.code}`);
  }

  console.log('\n✅ Programa de inspecciones del motor cargado.');
}

main()
  .catch((err) => {
    console.error('import_ccaky_engine_inspections failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
