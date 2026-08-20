/**
 * check_all_templates.ts
 *
 * Solo lectura: lista todas las plantillas de una empresa con su conteo de
 * tareas, y por separado el conteo de tareas sueltas (MaintenanceTask, la
 * lista plana) agrupadas por applicableModel — para diagnosticar por qué
 * una plantilla como "BELL 505" aparece con 0 tareas aunque la empresa sí
 * tenga tareas de esa aeronave en la biblioteca general.
 *
 * Uso:
 *   npx tsx prisma/check_all_templates.ts --org-slug tecnicopters
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

  console.log(`\n=== Plantillas (MaintenanceTemplate) en "${ORG_SLUG}" ===`);
  const templates = await prisma.maintenanceTemplate.findMany({
    where: { organizationId: org.id },
    include: { _count: { select: { tasks: true } } },
    orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
  });
  for (const t of templates) {
    console.log(`  ${t.manufacturer} ${t.model} — ${t._count.tasks} tareas — ${t.isActive ? 'activa' : 'inactiva'} (id ${t.id})`);
  }

  console.log(`\n=== Tareas sueltas (MaintenanceTask) agrupadas por applicableModel ===`);
  const grouped = await prisma.maintenanceTask.groupBy({
    by: ['applicableModel'],
    where: { organizationId: org.id },
    _count: { _all: true },
    orderBy: { _count: { applicableModel: 'desc' } },
  });
  for (const g of grouped) {
    console.log(`  "${g.applicableModel ?? '(sin modelo)'}": ${g._count._all} tareas`);
  }
}

main()
  .catch((err) => {
    console.error('check_all_templates failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
