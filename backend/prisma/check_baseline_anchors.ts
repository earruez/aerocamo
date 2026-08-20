/**
 * check_baseline_anchors.ts
 *
 * Solo lectura. Al asignar una plantilla, el sistema crea un cumplimiento
 * "Inicio de control" anclado a las horas/ciclos que la aeronave tenía EN ESE
 * MOMENTO. Si después se importa el historial de horas, esas líneas base
 * quedan ancladas en un valor viejo (típicamente 0) y todo el plan aparece
 * vencido: una tarea de 100 h anclada en 0 vence a las 100, y el avión va
 * en 1051.
 *
 * Este script compara el ancla de cada línea base contra las horas actuales.
 *
 * Uso:
 *   npx tsx prisma/check_baseline_anchors.ts --org-slug tecnicopters --registration CC-AKY
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

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true, totalFlightHours: true, totalCycles: true, createdAt: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION}`);

  const horasActuales = Number(aircraft.totalFlightHours);
  console.log(`\n=== Líneas base de ${REGISTRATION} ===`);
  console.log(`Horas actuales: ${horasActuales} h · ciclos: ${aircraft.totalCycles}`);
  console.log(`Aeronave creada en el sistema: ${aircraft.createdAt.toISOString().slice(0, 10)}\n`);

  const comps = await prisma.compliance.findMany({
    where: { aircraftId: aircraft.id },
    select: {
      id: true, applicationType: true, notes: true, performedAt: true,
      aircraftHoursAtCompliance: true, nextDueHours: true, nextDueDate: true,
      task: { select: { code: true, title: true, intervalHours: true } },
    },
  });

  const baselines = comps.filter((c) => c.applicationType === 'baseline' || (c.notes ?? '').trim() === 'Inicio de control');
  const reales = comps.filter((c) => !baselines.includes(c));

  console.log(`Cumplimientos totales: ${comps.length}`);
  console.log(`  línea base ("Inicio de control"): ${baselines.length}`);
  console.log(`  cumplimientos reales:            ${reales.length}\n`);

  // Agrupamos las líneas base por el valor de horas al que quedaron ancladas.
  const porAncla = new Map<number, number>();
  for (const b of baselines) {
    const h = Number(b.aircraftHoursAtCompliance);
    porAncla.set(h, (porAncla.get(h) ?? 0) + 1);
  }
  console.log('Líneas base agrupadas por las horas a las que quedaron ancladas:');
  for (const [h, n] of [...porAncla.entries()].sort((a, b) => b[1] - a[1])) {
    const desfase = horasActuales - h;
    const marca = desfase > 1 ? `  ⚠️  ${desfase.toFixed(1)} h de desfase` : '';
    console.log(`  ancladas en ${String(h).padStart(9)} h → ${String(n).padStart(4)} tareas${marca}`);
  }

  const vencidasPorAncla = baselines.filter((b) =>
    b.nextDueHours != null && Number(b.nextDueHours) < horasActuales);
  console.log(`\n→ ${vencidasPorAncla.length} líneas base con próximo vencimiento por horas ya superado.`);
  console.log('   Si el ancla es vieja, esas tareas figuran vencidas sin que nadie las haya dejado vencer.');

  console.log('\n  Ejemplo de las primeras 8:');
  for (const b of vencidasPorAncla.slice(0, 8)) {
    console.log(`    [${b.task.code}] cada ${b.task.intervalHours != null ? Number(b.task.intervalHours) + 'h' : '—'}`
      + ` · anclada en ${Number(b.aircraftHoursAtCompliance)}h · vence a ${Number(b.nextDueHours)}h (actual ${horasActuales}h)`);
  }
}

main()
  .catch((err) => {
    console.error('check_baseline_anchors failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
