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
      task: { select: { code: true, title: true } },
    },
  });

  const totalActivo = await prisma.aircraftTask.count({ where: { aircraftId: aircraft.id, isActive: true } });

  // Cumplimientos de ESTA aeronave sobre esas tareas. Contarlos a nivel de tarea
  // (task._count.compliances) mezcla los de toda la flota: una tarea compartida
  // por dos aeronaves aparecía con "2 cumpl." aunque ninguno fuera de esta.
  //
  // Y de los propios, solo importan los reales: la línea base es un ancla de
  // cálculo que crea el motor cuando una tarea entra al plan sin cumplimiento
  // previo, no trabajo hecho. Avisar por ellas es gritar sin motivo, y un aviso
  // que siempre salta termina ignorándose el día que importa.
  const comps = await prisma.compliance.findMany({
    where: { aircraftId: aircraft.id, taskId: { in: links.map((l) => l.taskId) } },
    select: { taskId: true, applicationType: true, isInitial: true, performedAt: true, workOrderNumber: true },
  });
  const reales = comps.filter((c) => !(c.applicationType === 'baseline' && c.isInitial));
  const baselines = comps.length - reales.length;

  console.log(`\n=== Sacar del plan de ${REGISTRATION} los puntos de checklist ===`);
  console.log(`Prefijos: ${PREFIXES.join(', ')}`);
  console.log(`\nEl plan tiene hoy ${totalActivo} tareas activas.`);
  console.log(`${links.length} coinciden con esos prefijos y se desactivarían.`);
  console.log(`→ quedarían ${totalActivo - links.length} tareas activas en el plan.\n`);

  console.log(`Cumplimientos de ${REGISTRATION} sobre ellas: ${comps.length}`);
  console.log(`  · líneas base (ancla de cálculo, no es trabajo hecho): ${baselines}`);
  console.log(`  · cumplimientos reales:                               ${reales.length}\n`);

  if (reales.length === 0) {
    console.log('✅ Ninguna tiene trabajo firmado: sacarlas del plan no pierde historial.\n');
  } else {
    const porTarea = new Map<string, typeof reales>();
    for (const c of reales) porTarea.set(c.taskId, [...(porTarea.get(c.taskId) ?? []), c]);
    console.log(`⚠️  ${porTarea.size} tienen trabajo REALMENTE firmado. Revísalas una por una antes`);
    console.log('    de sacarlas: el cumplimiento no se borra, pero deja de verse en el plan.\n');
    for (const [taskId, cs] of porTarea) {
      const t = links.find((l) => l.taskId === taskId)?.task;
      console.log(`     [${t?.code ?? taskId}] ${t?.title.slice(0, 55) ?? ''}`);
      for (const c of cs) {
        console.log(`         ${c.performedAt.toISOString().slice(0, 10)}`
          + `${c.workOrderNumber ? ` — OT ${c.workOrderNumber}` : ' — sin OT'}`);
      }
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
