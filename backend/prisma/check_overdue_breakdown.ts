/**
 * check_overdue_breakdown.ts
 *
 * El dashboard muestra 224 tareas vencidas en la flota. Sacar del plan los
 * puntos de checklist de CC-AVK no movió ese número —estaban contados como
 * "próximas", no como vencidas— así que hay que ver de qué están hechas.
 *
 * Usa el mismo repositorio que alimenta la pantalla del plan, para que el
 * estado sea exactamente el que ve el usuario y no una regla reimplementada.
 *
 * Para cada aeronave separa las vencidas según su respaldo:
 *   · con cumplimiento real   → vencida de verdad, hay que atenderla
 *   · solo con línea base     → nunca se ejecutó desde que entró al plan; el
 *                               motor la ancla y la da por vencida. Puede ser
 *                               real o ser el mismo artefacto que inflaba a
 *                               CC-AKY antes de limpiarla
 *   · sin cumplimiento        → sin ancla de cálculo
 *
 * Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/check_overdue_breakdown.ts --org-slug tecnicopters
 */
import { PrismaClient } from '@prisma/client';
import { PrismaAircraftRepository } from '../src/infrastructure/database/repositories/PrismaAircraftRepository';

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
const DETALLE = args.includes('--detalle');

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const repo = new PrismaAircraftRepository();
  const aeronaves = await prisma.aircraft.findMany({
    where: { organizationId: org.id },
    select: { id: true, registration: true, model: true },
    orderBy: { registration: 'asc' },
  });

  console.log(`\n=== De qué están hechas las vencidas — ${ORG_SLUG} ===\n`);
  console.log('Matrícula     plan  vencidas   reales  solo línea base  sin cumpl.');
  console.log('─'.repeat(70));

  let totVencidas = 0; let totReales = 0; let totBaseline = 0; let totSin = 0;
  const detalle: string[] = [];

  for (const ac of aeronaves) {
    const plan = await repo.getMaintenancePlan(ac.id, org.id);
    const activas = plan.filter((i) => i.isApplicable);
    const vencidas = activas.filter((i) => i.status === 'OVERDUE');

    // hasRealCompliance distingue el cumplimiento firmado de la línea base
    // sintética que crea el motor al entrar la tarea al plan.
    const reales = vencidas.filter((i) => i.hasRealCompliance);
    const soloBase = vencidas.filter((i) => !i.hasRealCompliance && i.controlStartAt != null);
    const sinCumpl = vencidas.filter((i) => !i.hasRealCompliance && i.controlStartAt == null);

    totVencidas += vencidas.length; totReales += reales.length;
    totBaseline += soloBase.length; totSin += sinCumpl.length;

    console.log(
      `${ac.registration.padEnd(12)} ${String(activas.length).padStart(5)} `
      + `${String(vencidas.length).padStart(9)} ${String(reales.length).padStart(8)} `
      + `${String(soloBase.length).padStart(16)} ${String(sinCumpl.length).padStart(11)}`,
    );

    if (DETALLE && vencidas.length) {
      detalle.push(`\n── ${ac.registration} ──`);
      for (const v of vencidas.slice(0, 40)) {
        const origen = v.hasRealCompliance ? 'real' : (v.controlStartAt ? 'línea base' : 'sin cumpl.');
        detalle.push(`  [${origen.padEnd(10)}] ${v.taskCode.padEnd(26)} ${v.taskTitle.slice(0, 52)}`);
      }
      if (vencidas.length > 40) detalle.push(`  … y ${vencidas.length - 40} más`);
    }
  }

  console.log('─'.repeat(70));
  console.log(
    `${'TOTAL'.padEnd(12)} ${''.padStart(5)} ${String(totVencidas).padStart(9)} `
    + `${String(totReales).padStart(8)} ${String(totBaseline).padStart(16)} ${String(totSin).padStart(11)}`,
  );

  console.log(`\nDe las ${totVencidas} vencidas:`);
  console.log(`  · ${totReales} tienen un cumplimiento firmado y volvieron a vencer: son reales.`);
  console.log(`  · ${totBaseline} nunca se ejecutaron desde que entraron al plan.`);
  console.log(`  · ${totSin} no tienen ni línea base.`);
  console.log('\nLas del segundo grupo son las que hay que mirar con Griselle: puede que');
  console.log('la tarea sí se haya hecho y falte cargar el cumplimiento, o que la tarea');
  console.log('no corresponda a esa aeronave.\n');

  if (DETALLE) console.log(detalle.join('\n'), '\n');
  console.log('Solo lectura: no se modificó nada.\n');
}

main()
  .catch((err) => {
    console.error('check_overdue_breakdown failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
