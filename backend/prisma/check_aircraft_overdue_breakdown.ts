/**
 * check_aircraft_overdue_breakdown.ts
 *
 * Solo lectura. Desglosa el plan de una aeronave para entender de dónde
 * salen las tareas vencidas: por prefijo de código (que delata el origen:
 * plantilla del manual, importación del Access, bitácora), por tipo de
 * intervalo, y cuántas tienen cumplimiento registrado.
 *
 * El caso que motivó esto: CC-AKY mostraba 260 vencidas cuando su bitácora
 * declara ~8 sobre un programa de 20 ítems.
 *
 * Uso:
 *   npx tsx prisma/check_aircraft_overdue_breakdown.ts --org-slug tecnicopters --registration CC-AKY
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

/** Agrupa por el prefijo del código, que delata de dónde salió la tarea. */
const originOf = (code: string): string => {
  if (/^R66-FAB/i.test(code)) return 'R66-FAB (plantilla manual Cap.5)';
  if (/^R66-MOT/i.test(code)) return 'R66-MOT (plantilla motor)';
  if (/^R66-ORI/i.test(code)) return 'R66-ORI (plantilla vida límite Cap.4)';
  if (/^AD-/i.test(code)) return 'AD (directivas)';
  if (/^DAN-/i.test(code)) return 'DAN (normativa nacional)';
  if (/^COMP-/i.test(code)) return 'COMP (control de componentes)';
  if (/^IN-/i.test(code)) return 'IN (inspecciones Access)';
  if (/^SB-/i.test(code)) return 'SB (boletines)';
  if (/^MIM-/i.test(code)) return 'MIM';
  return 'otro';
};

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true, registration: true, totalFlightHours: true, totalCycles: true, createdAt: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION}`);

  const links = await prisma.aircraftTask.findMany({
    where: { aircraftId: aircraft.id },
    select: {
      isActive: true,
      task: {
        select: {
          id: true, code: true, title: true, intervalType: true,
          intervalHours: true, intervalCycles: true, intervalCalendarDays: true, intervalCalendarMonths: true,
          _count: { select: { compliances: true } },
        },
      },
    },
  });

  console.log(`\n=== Plan de ${aircraft.registration} — ${Number(aircraft.totalFlightHours)} h / ${aircraft.totalCycles} ciclos ===`);
  console.log(`Total de tareas enlazadas: ${links.length} (${links.filter((l) => l.isActive).length} aplican, ${links.filter((l) => !l.isActive).length} marcadas "no aplica")\n`);

  const byOrigin = new Map<string, { total: number; activas: number; sinCumpl: number; conIntervalo: number }>();
  for (const l of links) {
    const key = originOf(l.task.code);
    const g = byOrigin.get(key) ?? { total: 0, activas: 0, sinCumpl: 0, conIntervalo: 0 };
    g.total += 1;
    if (l.isActive) g.activas += 1;
    // Sin cumplimiento y con intervalo = el motor le inventa una línea base y
    // puede darla por vencida sin que nadie la haya programado nunca.
    const hasInterval = l.task.intervalHours != null || l.task.intervalCycles != null
      || l.task.intervalCalendarDays != null || l.task.intervalCalendarMonths != null;
    if (l.task._count.compliances === 0) g.sinCumpl += 1;
    if (hasInterval) g.conIntervalo += 1;
    byOrigin.set(key, g);
  }

  console.log('Origen de las tareas (por prefijo de código):');
  console.log('  ' + 'origen'.padEnd(38) + 'total  aplican  sin-cumpl  con-intervalo');
  for (const [k, g] of [...byOrigin.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${k.padEnd(38)}${String(g.total).padStart(5)}${String(g.activas).padStart(9)}${String(g.sinCumpl).padStart(11)}${String(g.conIntervalo).padStart(15)}`);
  }

  const activasSinCumplConIntervalo = links.filter((l) => {
    const t = l.task;
    const hasInterval = t.intervalHours != null || t.intervalCycles != null
      || t.intervalCalendarDays != null || t.intervalCalendarMonths != null;
    return l.isActive && t._count.compliances === 0 && hasInterval;
  });
  console.log(`\n→ ${activasSinCumplConIntervalo.length} tareas activas con intervalo pero SIN ningún cumplimiento registrado.`);
  console.log('  Son las candidatas a aparecer vencidas sin serlo: el plan les calcula un vencimiento');
  console.log('  a partir de una línea base sintética, no de un cumplimiento real.');
  console.log('\n  Ejemplo de las primeras 10:');
  for (const l of activasSinCumplConIntervalo.slice(0, 10)) {
    const iv = [
      l.task.intervalHours != null ? `${Number(l.task.intervalHours)}h` : null,
      l.task.intervalCycles != null ? `${l.task.intervalCycles}c` : null,
      l.task.intervalCalendarMonths != null ? `${l.task.intervalCalendarMonths}m` : null,
      l.task.intervalCalendarDays != null ? `${l.task.intervalCalendarDays}d` : null,
    ].filter(Boolean).join('/');
    console.log(`    [${l.task.code}] ${l.task.title.slice(0, 50)} — cada ${iv}`);
  }
}

main()
  .catch((err) => {
    console.error('check_aircraft_overdue_breakdown failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
