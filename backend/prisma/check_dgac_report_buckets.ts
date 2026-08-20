/**
 * check_dgac_report_buckets.ts
 *
 * Diagnóstico de solo lectura del "Informe DGAC por Aeronave".
 *
 * El informe filtra por `isMandatory` (frontend/src/shared/dgacReport.ts,
 * mandatoryRowsFor) y luego clasifica con classifyTaskCategory. Este script
 * replica ambos pasos contra la base para responder por qué una categoría
 * aparece en cero.
 *
 * El origen del problema está en import_access_item_normativa.ts:490
 *
 *     const isMandatory = group.domain === 'AD' || group.domain === 'MIM';
 *
 * es decir, de la importación del Access solo las AD y las MIM quedaron
 * obligatorias; las inspecciones (dominio IN) quedaron en false y por eso el
 * informe no las muestra, aunque estén en el plan y con sus vencimientos bien
 * calculados.
 *
 * Uso:
 *   npx tsx prisma/check_dgac_report_buckets.ts --org-slug tecnicopters \
 *     [--registration CC-AKY]
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

type Bucket = 'AD' | 'SB' | 'MIM' | 'INSPECCIONES' | 'COMPONENTES';

/** Copia literal de frontend/src/shared/maintenanceCategory.ts */
function classify(t: { referenceType: string | null; isComponentControl: boolean }): Bucket {
  if (t.referenceType === 'AD') return 'AD';
  if (t.referenceType === 'SB') return 'SB';
  if (t.referenceType === 'INTERNAL') return 'MIM';
  return t.isComponentControl ? 'COMPONENTES' : 'INSPECCIONES';
}

const BUCKETS: Bucket[] = ['AD', 'SB', 'MIM', 'INSPECCIONES', 'COMPONENTES'];

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findMany({
    where: {
      organizationId: org.id,
      ...(REGISTRATION ? { registration: REGISTRATION } : {}),
    },
    select: { id: true, registration: true, model: true },
    orderBy: { registration: 'asc' },
  });
  if (aircraft.length === 0) throw new Error('No se encontraron aeronaves con ese criterio');

  for (const ac of aircraft) {
    const links = await prisma.aircraftTask.findMany({
      where: { aircraftId: ac.id },
      select: {
        isActive: true,
        task: {
          select: {
            code: true, title: true, referenceType: true,
            isComponentControl: true, isMandatory: true, equipmentScope: true,
          },
        },
      },
    });

    console.log(`\n${'='.repeat(72)}`);
    console.log(`${ac.registration} — ${ac.model}   (${links.length} tareas enlazadas)`);
    console.log('='.repeat(72));

    // visible = lo que hoy muestra el informe; oculto = lo que filtra isMandatory
    const visible: Record<Bucket, number> = { AD: 0, SB: 0, MIM: 0, INSPECCIONES: 0, COMPONENTES: 0 };
    const oculto: Record<Bucket, number> = { AD: 0, SB: 0, MIM: 0, INSPECCIONES: 0, COMPONENTES: 0 };
    const noAplica: Record<Bucket, number> = { AD: 0, SB: 0, MIM: 0, INSPECCIONES: 0, COMPONENTES: 0 };

    for (const l of links) {
      const b = classify(l.task);
      if (!l.isActive) { noAplica[b] += 1; continue; }
      if (l.task.isMandatory) visible[b] += 1;
      else oculto[b] += 1;
    }

    console.log('\n  categoría        en informe   oculto (isMandatory=false)   "No aplica"');
    for (const b of BUCKETS) {
      console.log(
        `  ${b.padEnd(14)}   ${String(visible[b]).padStart(6)}   ${String(oculto[b]).padStart(22)}   ${String(noAplica[b]).padStart(11)}`,
      );
    }
    const totVis = BUCKETS.reduce((s, b) => s + visible[b], 0);
    const totOcu = BUCKETS.reduce((s, b) => s + oculto[b], 0);
    const totNA = BUCKETS.reduce((s, b) => s + noAplica[b], 0);
    console.log(`  ${'TOTAL'.padEnd(14)}   ${String(totVis).padStart(6)}   ${String(totOcu).padStart(22)}   ${String(totNA).padStart(11)}`);

    // Detalle de lo oculto: es lo que el informe debería mostrar y no muestra.
    const ocultas = links.filter((l) => l.isActive && !l.task.isMandatory);
    if (ocultas.length) {
      console.log(`\n  Ocultas por isMandatory=false (primeras 25 de ${ocultas.length}):`);
      for (const l of ocultas.slice(0, 25)) {
        console.log(`    [${classify(l.task).padEnd(12)}] ${l.task.equipmentScope === 'ENGINE' ? 'MOT' : 'AER'} ${l.task.code} — ${l.task.title.slice(0, 58)}`);
      }
    }
  }

  console.log('\nSolo lectura: no se modificó nada.\n');
}

main()
  .catch((err) => {
    console.error('check_dgac_report_buckets failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
