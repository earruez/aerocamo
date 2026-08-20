/**
 * check_template_assignments.ts
 *
 * Solo lectura. Muestra a qué plantilla apunta cada aeronave en cada
 * categoría normativa, y marca las que apuntan a una plantilla GENERIC o
 * vacía. Es el requisito previo para que "editar la plantilla" pueda
 * propagar a las aeronaves: si una apunta a GENERIC, editar la plantilla
 * real de su modelo no la alcanzaría.
 *
 * Uso:
 *   npx tsx prisma/check_template_assignments.ts --org-slug tecnicopters
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

const CATEGORY_LABEL: Record<string, string> = {
  manufacturer: 'Fabricante',
  national_dgac: 'DGAC',
  engine_components: 'Motor',
  origin_country: 'País origen',
};

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findMany({
    where: { organizationId: org.id },
    select: {
      id: true, registration: true, manufacturer: true, model: true,
      assignedPlans: {
        select: {
          category: true,
          template: {
            select: {
              manufacturer: true, model: true,
              _count: { select: { tasks: true } },
            },
          },
        },
      },
      _count: { select: { applicableTasks: true } },
    },
    orderBy: { registration: 'asc' },
  });

  console.log(`\n=== Plantillas asignadas por aeronave en "${ORG_SLUG}" ===\n`);
  let problems = 0;
  for (const a of aircraft) {
    console.log(`${a.registration} (${a.manufacturer} ${a.model}) — ${a._count.applicableTasks} tareas en su plan`);
    if (a.assignedPlans.length === 0) {
      console.log('   ⚠️  sin plantillas asignadas');
      problems += 1;
      continue;
    }
    for (const p of a.assignedPlans) {
      const t = p.template;
      const label = `${t.manufacturer} ${t.model}`;
      const isGeneric = t.model.toUpperCase() === 'GENERIC' || t.manufacturer.toUpperCase() === 'GENERIC';
      const isEmpty = t._count.tasks === 0;
      const flag = isGeneric ? '  ⚠️  GENERIC' : isEmpty ? '  ⚠️  vacía' : '';
      if (isGeneric || isEmpty) problems += 1;
      console.log(`   ${(CATEGORY_LABEL[p.category] ?? p.category).padEnd(12)} → ${label} (${t._count.tasks} tareas)${flag}`);
    }
    console.log('');
  }

  console.log(`→ ${problems} asignación(es) apuntan a una plantilla GENERIC o vacía.`);
  console.log('  Esas aeronaves no recibirían nada si se propaga desde la plantilla real de su modelo.');
}

main()
  .catch((err) => {
    console.error('check_template_assignments failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
