/**
 * remove_checklist_tasks_from_plan.ts
 *
 * Al asignarle a una aeronave la plantilla del manual, se le copiaron al plan
 * los PUNTOS DE INSPECCIÓN individuales del manual ("Tail Rotor Pedal Bearing
 * Blocks", "Fasteners & Torque Stripes", ...). Esos no son tareas programables
 * con vencimiento propio: son el checklist de qué mirar dentro de la
 * inspección de 100 horas. Como ninguno tiene cumplimiento, el motor les
 * calcula una línea base sintética y los da por vencidos — CC-AKY llegó a
 * mostrar 260 vencidas cuando su bitácora declara ~8.
 *
 * Este script los saca del plan igual que lo haría el botón "quitar" de la UI:
 * desactiva el enlace (AircraftTask.isActive = false) con el motivo escrito,
 * sin borrar nada. Es reversible y no toca los cumplimientos existentes.
 *
 * Uso:
 *   npx tsx prisma/remove_checklist_tasks_from_plan.ts \
 *     --org-slug tecnicopters --registration CC-AKY --prefixes R66-FAB,R66-MOT [--apply]
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
const PREFIXES = (getArgValue('--prefixes') ?? 'R66-FAB').split(',').map((p) => p.trim()).filter(Boolean);
const APPLY = args.includes('--apply');

const REASON = 'Punto de inspección del manual, no una tarea programable: se controla dentro de la inspección que lo engloba, no por separado.';

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const links = await prisma.aircraftTask.findMany({
    where: {
      aircraftId: aircraft.id,
      isActive: true,
      OR: PREFIXES.map((p) => ({ task: { code: { startsWith: p } } })),
    },
    select: {
      taskId: true,
      task: { select: { code: true, title: true, _count: { select: { compliances: true } } } },
    },
  });

  const totalActivo = await prisma.aircraftTask.count({ where: { aircraftId: aircraft.id, isActive: true } });

  console.log(`\n=== Sacar del plan de ${REGISTRATION} los puntos de checklist ===`);
  console.log(`Prefijos: ${PREFIXES.join(', ')}`);
  console.log(`\nEl plan tiene hoy ${totalActivo} tareas activas.`);
  console.log(`${links.length} coinciden con esos prefijos y se desactivarían.`);
  console.log(`→ quedarían ${totalActivo - links.length} tareas activas en el plan.\n`);

  const conCumplimiento = links.filter((l) => l.task._count.compliances > 0);
  if (conCumplimiento.length) {
    console.log(`⚠️  ${conCumplimiento.length} de ellas tienen cumplimientos registrados (no se borran, solo se sacan del plan):`);
    for (const l of conCumplimiento.slice(0, 10)) {
      console.log(`     [${l.task.code}] ${l.task.title.slice(0, 55)} — ${l.task._count.compliances} cumpl.`);
    }
    console.log('');
  }

  console.log('Ejemplo de las primeras 10 a sacar:');
  for (const l of links.slice(0, 10)) {
    console.log(`  [${l.task.code}] ${l.task.title.slice(0, 60)}`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  const result = await prisma.aircraftTask.updateMany({
    where: { aircraftId: aircraft.id, taskId: { in: links.map((l) => l.taskId) } },
    data: { isActive: false, applicabilityNotes: REASON, applicabilityChangedAt: new Date() },
  });

  console.log(`\n✅ ${result.count} tareas sacadas del plan de ${REGISTRATION} (reversible: siguen enlazadas, solo inactivas).`);
}

main()
  .catch((err) => {
    console.error('remove_checklist_tasks_from_plan failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
