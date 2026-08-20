/**
 * check_checklist_compliances.ts
 *
 * remove_checklist_tasks_from_plan.ts cuenta los cumplimientos de la TAREA en
 * toda la empresa (task._count.compliances), no los de la aeronave que se está
 * revisando. Con eso no se puede saber si alguien firmó realmente esos puntos
 * de checklist o si son las líneas base sintéticas que crea el motor cuando una
 * tarea entra al plan sin cumplimiento previo.
 *
 * La distinción es la que decide si se pueden sacar del plan sin perder
 * historial: una línea base no es trabajo hecho, es un ancla de cálculo.
 *
 * Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/check_checklist_compliances.ts --org-slug tecnicopters \
 *     --registration CC-AVK [--prefixes R66-FAB,R66-MOT]
 */
import { PrismaClient } from '@prisma/client';
import { BASELINE_NOTE } from '../src/domain/services/BaselineComplianceService';

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
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase() ?? 'CC-AVK';
const PREFIXES = (getArgValue('--prefixes') ?? 'R66-FAB,R66-MOT')
  .split(',').map((p) => p.trim()).filter(Boolean);

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
    select: { taskId: true, task: { select: { code: true, title: true } } },
  });
  const taskIds = links.map((l) => l.taskId);

  // Cumplimientos de ESTA aeronave sobre esas tareas.
  const comps = await prisma.compliance.findMany({
    where: { aircraftId: aircraft.id, taskId: { in: taskIds } },
    select: {
      taskId: true, performedAt: true, applicationType: true, isInitial: true,
      notes: true, workOrderNumber: true, aircraftHoursAtCompliance: true,
    },
    orderBy: { performedAt: 'asc' },
  });

  const esBaseline = (c: (typeof comps)[number]): boolean =>
    c.applicationType === 'baseline' || c.isInitial || c.notes === BASELINE_NOTE;

  const baselines = comps.filter(esBaseline);
  const reales = comps.filter((c) => !esBaseline(c));

  console.log(`\n=== Cumplimientos de los puntos de checklist — ${REGISTRATION} ===`);
  console.log(`Prefijos: ${PREFIXES.join(', ')}\n`);
  console.log(`Tareas de checklist activas en el plan: ${links.length}`);
  console.log(`Cumplimientos de esta aeronave sobre ellas: ${comps.length}`);
  console.log(`  · líneas base (ancla de cálculo, no es trabajo hecho): ${baselines.length}`);
  console.log(`  · cumplimientos reales:                               ${reales.length}\n`);

  if (reales.length === 0) {
    console.log('✅ Ninguno tiene trabajo firmado: sacarlos del plan no pierde historial.');
  } else {
    const porTarea = new Map<string, typeof reales>();
    for (const c of reales) {
      const code = links.find((l) => l.taskId === c.taskId)?.task.code ?? c.taskId;
      porTarea.set(code, [...(porTarea.get(code) ?? []), c]);
    }
    console.log(`⚠️  ${porTarea.size} tareas tienen cumplimientos REALES. Estas hay que revisarlas`);
    console.log('    una por una antes de sacarlas del plan:\n');
    for (const [code, cs] of [...porTarea].sort()) {
      const t = links.find((l) => l.task.code === code)?.task;
      console.log(`  [${code}] ${t?.title.slice(0, 55) ?? ''}`);
      for (const c of cs) {
        console.log(`      ${c.performedAt.toISOString().slice(0, 10)}`
          + ` a ${Number(c.aircraftHoursAtCompliance)} h`
          + ` — ${c.applicationType}${c.workOrderNumber ? ` (OT ${c.workOrderNumber})` : ' (sin OT)'}`);
      }
    }
  }

  // Fechas de las líneas base: si todas son del mismo día, se crearon solas.
  if (baselines.length) {
    const dias = new Map<string, number>();
    for (const b of baselines) {
      const d = b.performedAt.toISOString().slice(0, 10);
      dias.set(d, (dias.get(d) ?? 0) + 1);
    }
    console.log('\nLíneas base por fecha:');
    for (const [d, n] of [...dias].sort()) console.log(`  ${d}: ${n}`);
  }

  console.log('\nSolo lectura: no se modificó nada.\n');
}

main()
  .catch((err) => {
    console.error('check_checklist_compliances failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
