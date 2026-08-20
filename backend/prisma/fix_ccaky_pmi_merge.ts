/**
 * fix_ccaky_pmi_merge.ts
 *
 * Corrige un error propio: import_ccaky_engine_pmi.ts creó DOS tareas PMI
 * (una cada 2000 h y otra cada 3000 ciclos). El manual del RR300 dice:
 *
 *   "The RR300 Series is designed as an engine with a fixed preventative
 *    maintenance interval (PMI), 2000 hours or 3000 cycles, whichever comes
 *    first."
 *
 * Es UN control con dos límites, no dos controles. Se reemplazan por una sola
 * tarea con intervalHours = 2000 e intervalCycles = 3000, que es como el
 * sistema ya representa este caso: ComplianceDueDateService calcula
 * nextDueHours y nextDueCycles por separado e isOverdue compara cada límite
 * en su propia unidad, así que "lo que ocurra primero" es el comportamiento
 * natural. Mismo patrón que las tareas de "3000 h / 60000 cy" del Access.
 *
 * Las dos tareas equivocadas se crearon hoy y su único cumplimiento es la
 * línea base sintética que creó ese mismo script, así que se borran. El script
 * NO borra nada que tenga trabajo real: si encuentra un cumplimiento que no
 * sea esa línea base, o una orden de trabajo que la referencie, deja la tarea
 * en pie y lo reporta para revisarlo a mano.
 *
 * Uso:
 *   npx tsx prisma/fix_ccaky_pmi_merge.ts --org-slug tecnicopters \
 *     --registration CC-AKY --performed-by "Griselle" [--apply]
 */
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

const ORG_SLUG = getArgValue('--org-slug') ?? 'tecnicopters';
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase() ?? 'CC-AKY';
const PERFORMED_BY = getArgValue('--performed-by') ?? 'Griselle';
const APPLY = args.includes('--apply');

const MOTOR_NUEVO = { fecha: '2012-04-20', horas: 0, ciclos: 0 };
const REFERENCIA = 'OMM RR 300, TASK 05-00-00-800-801';

/** Las dos que creó por error import_ccaky_engine_pmi.ts */
const OBSOLETAS = ['IN-PMI-2000H-250C300A1', 'IN-PMI-3000CY-250C300A1'];

const CANONICA = {
  code: 'IN-PMI-250C300A1',
  title: 'PMI cada 2000 Hrs o 3000 Ciclos (lo que ocurra primero) — OMM RR 300, TASK 05-00-00-800-801',
  description: 'Preventative Maintenance Inspection del motor RR300. El manual define un intervalo fijo '
    + 'de 2000 horas o 3000 ciclos, lo que ocurra primero. Consiste en el reemplazo de las ruedas de '
    + 'turbina (gas producer y power turbine) e inspección de los componentes ensamblados, según '
    + `documentos publicados por Rolls-Royce. Referencia: ${REFERENCIA}.`,
  intervalHours: 2000,
  intervalCycles: 3000,
};

async function main(): Promise<void> {
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

  const horas = Number(aircraft.totalFlightHours);
  const ciclos = Number(aircraft.totalCycles ?? 0);

  console.log(`\n=== Unificar las PMI del motor — ${REGISTRATION} ===`);
  console.log(`Estado actual: ${horas.toFixed(2)} h / ${ciclos} ciclos\n`);

  // ── Estado de las obsoletas ────────────────────────────────────────────
  const obsoletas = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, code: { in: OBSOLETAS } },
    select: {
      id: true, code: true, title: true,
      compliances: {
        select: {
          id: true, applicationType: true, isInitial: true, performedAt: true,
          aircraft: { select: { registration: true } },
        },
      },
      aircraftLinks: { select: { aircraftId: true, aircraft: { select: { registration: true } } } },
      _count: { select: { workOrderTasks: true } },
    },
  });

  const esNuestraLineaBase = (c: { applicationType: string; isInitial: boolean }): boolean =>
    c.applicationType === 'baseline' && c.isInitial;

  const borrables: typeof obsoletas = [];
  const conservar: typeof obsoletas = [];

  console.log('1) Tareas a reemplazar');
  if (obsoletas.length === 0) {
    console.log('   Ninguna de las dos existe (no se llegó a aplicar import_ccaky_engine_pmi.ts).');
  }
  for (const t of obsoletas) {
    const reales = t.compliances.filter((c) => !esNuestraLineaBase(c));
    const seguro = reales.length === 0 && t._count.workOrderTasks === 0;
    console.log(`   [${t.code}]`);
    console.log(`       ${t.compliances.length} cumplimiento(s), ${reales.length} real(es), ${t._count.workOrderTasks} OT`);
    console.log(`       enlazada a: ${t.aircraftLinks.map((l) => l.aircraft.registration).join(', ') || '(ninguna)'}`);
    console.log(seguro ? '       → se borra (solo tiene la línea base que creamos hoy)'
      : '       → ⚠️  NO se borra: tiene trabajo real. Revisar a mano.');
    (seguro ? borrables : conservar).push(t);
  }

  // ── La canónica ────────────────────────────────────────────────────────
  const yaExiste = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, code: CANONICA.code },
    select: { id: true },
  });

  console.log('\n2) Tarea única que queda');
  console.log(`   [${CANONICA.code}] ${CANONICA.title}`);
  console.log(`       cada ${CANONICA.intervalHours} h o ${CANONICA.intervalCycles} ciclos, lo que ocurra primero`);
  console.log(`       anclada en motor nuevo (${MOTOR_NUEVO.fecha}) → vence a ${CANONICA.intervalHours} h / ${CANONICA.intervalCycles} ciclos`);
  console.log(`       restante ≈ ${(CANONICA.intervalHours - horas).toFixed(2)} h  ó  ${CANONICA.intervalCycles - ciclos} ciclos`);
  if (yaExiste) console.log('       (ya existe, no se recrea)');

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  // 1. Crear/asegurar la canónica y su línea base
  const task = yaExiste
    ? await prisma.maintenanceTask.update({
        where: { id: yaExiste.id },
        data: {
          title: CANONICA.title, description: CANONICA.description,
          intervalType: 'FLIGHT_HOURS',
          intervalHours: CANONICA.intervalHours, intervalCycles: CANONICA.intervalCycles,
          isMandatory: true,
        },
      })
    : await prisma.maintenanceTask.create({
        data: {
          organizationId: org.id,
          code: CANONICA.code, title: CANONICA.title, description: CANONICA.description,
          intervalType: 'FLIGHT_HOURS',
          intervalHours: CANONICA.intervalHours, intervalCycles: CANONICA.intervalCycles,
          referenceType: 'AMM', referenceNumber: REFERENCIA,
          equipmentScope: 'ENGINE', isMandatory: true, requiresInspection: true,
          applicableModel: '250-C300/A1',
        },
      });

  await prisma.aircraftTask.upsert({
    where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: task.id } },
    create: { aircraftId: aircraft.id, taskId: task.id, isActive: true },
    update: { isActive: true },
  });

  const yaCumpl = await prisma.compliance.findFirst({
    where: { aircraftId: aircraft.id, taskId: task.id },
    select: { id: true },
  });
  if (!yaCumpl) {
    await prisma.compliance.create({
      data: {
        organizationId: org.id, aircraftId: aircraft.id, taskId: task.id,
        performedById: performer.id,
        performedAt: new Date(MOTOR_NUEVO.fecha),
        aircraftHoursAtCompliance: MOTOR_NUEVO.horas,
        aircraftCyclesAtCompliance: MOTOR_NUEVO.ciclos,
        nextDueHours: CANONICA.intervalHours,
        nextDueCycles: CANONICA.intervalCycles,
        applicationType: 'baseline', isInitial: true, status: 'COMPLETED',
        notes: `Inicio de control desde motor nuevo — importado de bitácora electrónica (${REGISTRATION}) — Cump.Insp.Eng.`,
      },
    });
  }
  console.log(`\n  ✓ ${CANONICA.code}`);

  // 2. Borrar las obsoletas que no tienen trabajo real
  for (const t of borrables) {
    await prisma.$transaction(async (tx) => {
      await tx.compliance.deleteMany({ where: { taskId: t.id } });
      await tx.aircraftTask.deleteMany({ where: { taskId: t.id } });
      await tx.maintenanceTask.delete({ where: { id: t.id } });
    }, { timeout: 15000 });
    console.log(`  ✓ ${t.code} eliminada`);
  }
  for (const t of conservar) {
    console.log(`  ⚠️  ${t.code} conservada: tiene trabajo real, revisar a mano`);
  }

  console.log('\n✅ PMI unificada.');
}

main()
  .catch((err) => {
    console.error('fix_ccaky_pmi_merge failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
