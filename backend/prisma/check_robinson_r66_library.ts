/**
 * check_robinson_r66_library.ts
 *
 * Solo lectura: revisa si ya existe biblioteca cargada para Robinson R66 en
 * una empresa — tanto en el sistema de plantillas por modelo
 * (MaintenanceTemplate, la pantalla "Biblioteca de Mantenimiento") como en
 * la lista plana de tareas (MaintenanceTask, filtrada por applicableModel).
 *
 * Uso:
 *   npx tsx prisma/check_robinson_r66_library.ts --org-slug tecnicopters
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

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  console.log(`\n=== Bibliotecas para Robinson / R66 en "${ORG_SLUG}" ===\n`);

  const templates = await prisma.maintenanceTemplate.findMany({
    where: {
      organizationId: org.id,
      OR: [
        { manufacturer: { contains: 'ROBINSON', mode: 'insensitive' } },
        { model: { contains: 'R66', mode: 'insensitive' } },
      ],
    },
    include: { _count: { select: { tasks: true } } },
  });

  console.log('-- Plantillas (MaintenanceTemplate / "Biblioteca de Mantenimiento") --');
  if (templates.length === 0) {
    console.log('  Ninguna. No hay plantilla de Robinson/R66 — habría que crearla.');
  } else {
    for (const t of templates) {
      console.log(`  ${t.manufacturer} ${t.model} — v${t.version} — ${t._count.tasks} tareas — ${t.isActive ? 'activa' : 'inactiva'} (id ${t.id})`);
    }
  }

  const tasksByModel = await prisma.maintenanceTask.groupBy({
    by: ['applicableModel'],
    where: {
      organizationId: org.id,
      applicableModel: { contains: 'R66', mode: 'insensitive' },
    },
    _count: { _all: true },
  });

  console.log('\n-- Tareas sueltas con applicableModel ~ "R66" (MaintenanceTask, lista plana) --');
  if (tasksByModel.length === 0) {
    console.log('  Ninguna.');
  } else {
    for (const g of tasksByModel) {
      console.log(`  "${g.applicableModel}": ${g._count._all} tareas`);
    }
  }

  console.log('\n-- Todas las plantillas existentes en esta empresa (para comparar) --');
  const all = await prisma.maintenanceTemplate.findMany({
    where: { organizationId: org.id },
    orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
    select: { manufacturer: true, model: true, isActive: true },
  });
  for (const t of all) console.log(`  ${t.manufacturer} ${t.model}${t.isActive ? '' : ' (inactiva)'}`);

  // Detalle de tareas de las plantillas R66 + DGAC GENERIC (para comparar
  // contra las AD/DAN del Excel a mano).
  const detailNames = ['ROBINSON R66', 'MOTOR R66', 'EASA R66', 'DGAC GENERIC', 'DGAC R66'];
  for (const name of detailNames) {
    const [manufacturer, ...modelParts] = name.split(' ');
    const model = modelParts.join(' ');
    const tpl = await prisma.maintenanceTemplate.findFirst({
      where: { organizationId: org.id, manufacturer, model },
      include: { tasks: { orderBy: [{ chapter: 'asc' }, { code: 'asc' }] } },
    });
    console.log(`\n-- Tareas de "${name}" --`);
    if (!tpl) { console.log('  (no existe esta plantilla)'); continue; }
    if (tpl.tasks.length === 0) { console.log('  (sin tareas)'); continue; }
    for (const t of tpl.tasks) {
      console.log(`  [${t.code}] ${t.title} — ref: ${t.referenceType} ${t.referenceNumber ?? ''} — cap: ${t.chapter ?? ''}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('check_robinson_r66_library failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
