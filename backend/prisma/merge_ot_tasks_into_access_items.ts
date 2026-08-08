/**
 * merge_ot_tasks_into_access_items.ts
 *
 * Unifica las tareas creadas desde la tabla OT del Access con su requisito
 * equivalente de la tabla ITEM.
 *
 * Ambas tablas del Access describen los mismos controles desde ángulos distintos:
 * ITEM es el requisito (qué debe cumplirse y cada cuánto) y OT es la ejecución
 * (qué se hizo y cuándo). Al importarse por separado quedaron como tareas
 * paralelas, duplicando el requisito y partiendo el historial en dos.
 *
 * La fusión conserva los cumplimientos —que son el registro respaldado por las
 * órdenes de trabajo y no se pueden reconstruir— y los reancla a la tarea de
 * ITEM, que pasa a ser el requisito único. La tarea de OT se elimina solo cuando
 * ya no le queda ningún cumplimiento ni vínculo propio.
 *
 * El mapeo es curado a mano: son pocas tareas y emparejarlas por texto daba
 * falsos positivos (mismo capítulo ATA, requisitos distintos).
 *
 * Uso:
 *   npx tsx prisma/merge_ot_tasks_into_access_items.ts --org-id <uuid> [--apply]
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

const ORG_ID = getArgValue('--org-id') ?? process.env.DEFAULT_ORG_ID ?? '';
const APPLY = args.includes('--apply');

if (!ORG_ID) {
  console.error('Missing organization id. Use --org-id=<uuid>');
  process.exit(1);
}

/** [código de la tarea OT, matrícula, código de la tarea ITEM destino] */
const MERGES: Array<[string, string, string]> = [
  ['05-20-10-2', 'CC-ABU', 'IN-(10). 05-20-10'],
  ['05-20-10-2', 'CC-DET', 'IN-05-20-10-ARRIEL1D1-12'],
  ['05-20-10-3', 'CC-ABU', 'IN-(11). 05-20-10'],
  ['2013-0281R1', 'CC-DET', 'AD-2013-0281 R1'],
  ['2015-0094-CN', 'CC-DET', 'AD-2015-0094-CN-AS350B2'],
  ['DA 96-01-R1', 'CC-AAA', 'MIM-DA 96-01-R1'],
  ['DA 96-01-R1', 'CC-DET', 'MIM-DA 96-01-R1-AS350B2'],
  ['DAN 21 Ap.1 (4.d)', 'CC-DET', 'MIM-DAN 21 Ap. 1 (4.d.)'],
  ['DAN 43 Ap.D', 'CC-ABU', 'MIM-DAN 43'],
  ['DAN135 Ap 6', 'CC-AAA', 'MIM-DAN 135 VOL ll, 135.407 (b) DAN 137.207 (A)'],
  ['DAN135 Ap 6', 'CC-DET', 'MIM-DAN 135 Ap 6 y 137 Ap.5'],
  ['DAN135/137-4', 'CC-AAA', 'MIM-DAN 135 VOL ll, 135.1113 (e ) DAN 137.313 (d)'],
  ['F-1979-104-006', 'CC-DET', 'AD-F-1979-104-006-AS350B2'],
  ['F-1979-134-008', 'CC-ABU', 'AD-F-1979-134-008'],
];

/**
 * Tareas de OT sin requisito equivalente en ITEM: se conservan tal cual.
 * No son controles recurrentes del programa, por eso ITEM no las tiene.
 */
const KEEP_REASONS: Record<string, string> = {
  '05-20-10-6': 'discrepancia puntual (bomba de aceite), no es un control recurrente',
  '2016-0004R1': 'aplicación de PTAM (alteración), no es un control recurrente',
  'DAN 43 Ap.D': 'CC-DET no tiene compás magnético en ITEM; se conserva para esa aeronave',
};

async function main(): Promise<void> {
  console.log(`=== Fusión OT → ITEM (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  let movedTotal = 0;
  let linksRemoved = 0;
  const touchedOtTasks = new Set<string>();

  for (const [otCode, registration, itemCode] of MERGES) {
    const aircraft = await prisma.aircraft.findFirst({
      where: { organizationId: ORG_ID, registration },
      select: { id: true },
    });
    const otTask = await prisma.maintenanceTask.findFirst({
      where: { organizationId: ORG_ID, code: otCode },
      select: { id: true, title: true },
    });
    const itemTask = await prisma.maintenanceTask.findFirst({
      where: { organizationId: ORG_ID, code: itemCode },
      select: { id: true, title: true },
    });

    if (!aircraft || !otTask || !itemTask) {
      console.log(`✗ ${otCode} · ${registration} → ${itemCode}: no encontrado ` +
        `(aeronave=${!!aircraft} origen=${!!otTask} destino=${!!itemTask})`);
      continue;
    }

    const toMove = await prisma.compliance.count({
      where: { taskId: otTask.id, aircraftId: aircraft.id },
    });

    console.log(`• ${otCode} · ${registration}`);
    console.log(`    ${toMove} cumplimiento(s) → ${itemCode}`);
    console.log(`    "${otTask.title.slice(0, 56)}" → "${itemTask.title.slice(0, 56)}"`);

    if (APPLY) {
      const moved = await prisma.compliance.updateMany({
        where: { taskId: otTask.id, aircraftId: aircraft.id },
        data: { taskId: itemTask.id },
      });
      movedTotal += moved.count;

      // El requisito pasa a ser el de ITEM: el vínculo de la tarea OT sobra.
      const removed = await prisma.aircraftTask.deleteMany({
        where: { taskId: otTask.id, aircraftId: aircraft.id },
      });
      linksRemoved += removed.count;
      touchedOtTasks.add(otTask.id);
    } else {
      movedTotal += toMove;
    }
  }

  // Solo se borra la tarea de OT que quedó sin cumplimientos ni vínculos.
  let deleted = 0;
  const kept: string[] = [];
  if (APPLY) {
    for (const taskId of touchedOtTasks) {
      const [compliances, links, task] = await Promise.all([
        prisma.compliance.count({ where: { taskId } }),
        prisma.aircraftTask.count({ where: { taskId } }),
        prisma.maintenanceTask.findUnique({ where: { id: taskId }, select: { code: true } }),
      ]);
      if (compliances === 0 && links === 0) {
        await prisma.maintenanceTask.delete({ where: { id: taskId } });
        deleted += 1;
      } else {
        kept.push(`${task?.code} (quedan ${compliances} cumpl. / ${links} vínculos)`);
      }
    }
  }

  console.log('\n--- Tareas de OT que se conservan ---');
  for (const [code, reason] of Object.entries(KEEP_REASONS)) {
    console.log(`  ${code}: ${reason}`);
  }

  console.log('\n--- Resumen ---');
  console.log(`Cumplimientos reanclados: ${movedTotal}`);
  if (APPLY) {
    console.log(`Vínculos de la tarea OT eliminados: ${linksRemoved}`);
    console.log(`Tareas OT eliminadas por quedar vacías: ${deleted}`);
    if (kept.length) console.log(`Tareas OT conservadas: ${kept.join(' · ')}`);
  } else {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
  }
}

main()
  .catch((error) => {
    console.error('merge_ot_tasks_into_access_items failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
