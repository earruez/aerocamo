/**
 * fix_inspection_mandatory_flag.ts
 *
 * El "Informe DGAC por Aeronave" solo muestra tareas con isMandatory = true
 * (frontend/src/shared/dgacReport.ts, mandatoryRowsFor). La importación del
 * Access marcó como obligatorias únicamente las AD y las MIM:
 *
 *     // import_access_item_normativa.ts:490
 *     const isMandatory = group.domain === 'AD' || group.domain === 'MIM';
 *
 * Por eso el programa de inspecciones —que aeronáuticamente sí es obligatorio—
 * quedó invisible para el informe, aunque está en el plan y con sus
 * vencimientos bien calculados. Esto corrige ese flag.
 *
 * isMandatory NO alimenta el motor de vencimientos ni las alertas: en el
 * backend solo se usa para ordenar listas y para imprimir "Sí/No" en los PDF.
 * Corregirlo hace visible lo que ya existe, sin mover ningún cálculo.
 *
 * Criterio de selección:
 *   1. La tarea cae en la categoría INSPECCIONES del informe.
 *   2. Tiene isMandatory = false.
 *   3. Tiene al menos un límite real (horas, ciclos o calendario).
 *   4. Está activa en al menos una aeronave (con --registration, en esa).
 *   5. Su código NO empieza con ninguno de los prefijos de checklist.
 *
 * El punto 5 es imprescindible y no se puede deducir de los datos. Las
 * R66-FAB-001..231 ("Map Holders", "Carpet", "Yaw String", "Foreign Objects
 * Removed") son los puntos individuales del checklist de la inspección de 100
 * horas, no inspecciones con vencimiento propio — pero heredan el intervalo
 * 100 h / 12 m de la inspección que las engloba, así que el punto 3 no las
 * filtra. Se identifican por prefijo de código, que es el mismo criterio
 * (decidido a mano) que ya usó remove_checklist_tasks_from_plan.ts para
 * sacarlas del plan de CC-AKY.
 *
 * Ojo: en CC-AVK esas R66-FAB siguen activas en el plan. Este script no las
 * toca, pero conviene sacarlas de ahí también con remove_checklist_tasks_from_plan.ts.
 *
 * Uso:
 *   npx tsx prisma/fix_inspection_mandatory_flag.ts --org-slug tecnicopters \
 *     [--registration CC-AKY] [--exclude-prefixes R66-FAB,R66-MOT] [--apply]
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
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase();
const EXCLUDE_PREFIXES = (getArgValue('--exclude-prefixes') ?? 'R66-FAB,R66-MOT')
  .split(',').map((p) => p.trim()).filter(Boolean);
const APPLY = args.includes('--apply');

/** Misma clasificación que frontend/src/shared/maintenanceCategory.ts */
function esInspeccion(t: { referenceType: string | null; isComponentControl: boolean }): boolean {
  if (t.referenceType === 'AD' || t.referenceType === 'SB' || t.referenceType === 'INTERNAL') return false;
  return !t.isComponentControl;
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const candidatas = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, isMandatory: false },
    select: {
      id: true, code: true, title: true, referenceType: true, isComponentControl: true,
      equipmentScope: true, intervalHours: true, intervalCycles: true,
      intervalCalendarDays: true, intervalCalendarMonths: true,
      aircraftLinks: {
        select: { isActive: true, aircraft: { select: { registration: true } } },
      },
    },
    orderBy: { code: 'asc' },
  });

  const inspecciones = candidatas.filter(esInspeccion);

  const conIntervalo = (t: (typeof inspecciones)[number]): boolean =>
    t.intervalHours != null || t.intervalCycles != null
    || t.intervalCalendarDays != null || t.intervalCalendarMonths != null;

  /** Matrículas donde la tarea está activa; con --registration, filtrado a esa. */
  const activasEn = (t: (typeof inspecciones)[number]): string[] =>
    t.aircraftLinks
      .filter((l) => l.isActive)
      .map((l) => l.aircraft.registration)
      .filter((r) => !REGISTRATION || r === REGISTRATION);

  const esChecklist = (t: (typeof inspecciones)[number]): boolean =>
    EXCLUDE_PREFIXES.some((p) => t.code.startsWith(p));

  const aMarcar = inspecciones.filter(
    (t) => conIntervalo(t) && activasEn(t).length > 0 && !esChecklist(t),
  );
  const checklist = inspecciones.filter((t) => esChecklist(t));
  const sinIntervalo = inspecciones.filter((t) => !conIntervalo(t) && !esChecklist(t));
  const soloNoAplica = inspecciones.filter(
    (t) => conIntervalo(t) && !esChecklist(t) && activasEn(t).length === 0,
  );

  console.log(`\n=== isMandatory en inspecciones — ${ORG_SLUG} ===`);
  console.log(REGISTRATION ? `Acotado a ${REGISTRATION}` : 'Toda la flota');
  console.log(`Prefijos de checklist excluidos: ${EXCLUDE_PREFIXES.join(', ')}\n`);
  console.log(`Inspecciones con isMandatory=false: ${inspecciones.length}`);
  console.log(`  · se marcan como obligatorias:             ${aMarcar.length}`);
  console.log(`  · se dejan (punto de checklist):           ${checklist.length}`);
  console.log(`  · se dejan (sin intervalo):                ${sinIntervalo.length}`);
  console.log(`  · se dejan (no activa donde corresponde):  ${soloNoAplica.length}\n`);

  // Cuántas de las excluidas siguen activas en algún plan: son las que
  // conviene sacar con remove_checklist_tasks_from_plan.ts.
  const checklistActivas = new Map<string, number>();
  for (const t of checklist) {
    for (const l of t.aircraftLinks.filter((x) => x.isActive)) {
      checklistActivas.set(l.aircraft.registration, (checklistActivas.get(l.aircraft.registration) ?? 0) + 1);
    }
  }
  if (checklistActivas.size) {
    console.log('⚠️  Puntos de checklist todavía activos en el plan (sacarlos con remove_checklist_tasks_from_plan.ts):');
    for (const [reg, n] of [...checklistActivas].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${reg}: ${n}`);
    }
    console.log('');
  }

  console.log('A marcar como obligatorias:');
  for (const t of aMarcar) {
    const regs = activasEn(t);
    const limites = [
      t.intervalHours != null ? `${Number(t.intervalHours)} h` : null,
      t.intervalCycles != null ? `${t.intervalCycles} cy` : null,
      t.intervalCalendarMonths != null ? `${t.intervalCalendarMonths} m` : null,
      t.intervalCalendarDays != null ? `${t.intervalCalendarDays} d` : null,
    ].filter(Boolean).join(' / ');
    console.log(`  [${t.equipmentScope === 'ENGINE' ? 'MOT' : 'AER'}] ${t.code.padEnd(20)} ${limites.padEnd(18)} ${t.title.slice(0, 46)}`);
    console.log(`        activa en ${regs.length}: ${regs.slice(0, 10).join(', ')}${regs.length > 10 ? '…' : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  const res = await prisma.maintenanceTask.updateMany({
    where: { id: { in: aMarcar.map((t) => t.id) } },
    data: { isMandatory: true },
  });
  console.log(`\n✅ ${res.count} inspecciones marcadas como obligatorias.`);
}

main()
  .catch((err) => {
    console.error('fix_inspection_mandatory_flag failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
