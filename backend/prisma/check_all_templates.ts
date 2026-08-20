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
const MODEL_BREAKDOWN = getArgValue('--model-breakdown');

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

  if (MODEL_BREAKDOWN) {
    console.log(`\n=== "${MODEL_BREAKDOWN}" por referenceType (para saber cuántas serían "fabricante") ===`);
    const byRef = await prisma.maintenanceTask.groupBy({
      by: ['referenceType'],
      where: { organizationId: org.id, applicableModel: MODEL_BREAKDOWN },
      _count: { _all: true },
    });
    for (const g of byRef) console.log(`  ${g.referenceType}: ${g._count._all} tareas`);

    // Separar por equipmentScope (célula vs motor) entre las AMM/SB, que son
    // las candidatas a "fabricante" — las AD/INTERNAL ya están cubiertas por
    // EASA/DGAC.
    const candidates = await prisma.maintenanceTask.findMany({
      where: { organizationId: org.id, applicableModel: MODEL_BREAKDOWN, referenceType: { in: ['AMM', 'SB'] } },
      select: { code: true, title: true, equipmentScope: true, referenceType: true },
    });
    const byScope = { AIRCRAFT: 0, ENGINE: 0 };
    for (const c of candidates) byScope[c.equipmentScope] += 1;
    console.log(`\n  De las AMM+SB (${candidates.length} tareas): ${byScope.AIRCRAFT} son de célula (candidatas a "fabricante"), ${byScope.ENGINE} son de motor.`);

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

    const motorTemplate = await prisma.maintenanceTemplate.findFirst({
      where: { organizationId: org.id, manufacturer: 'MOTOR', model: MODEL_BREAKDOWN },
      include: { tasks: { select: { title: true } } },
    });
    if (motorTemplate) {
      const motorTitles = new Set(motorTemplate.tasks.map((t) => norm(t.title)));
      const engineCandidates = candidates.filter((c) => c.equipmentScope === 'ENGINE');
      const overlap = engineCandidates.filter((c) => motorTitles.has(norm(c.title)));
      console.log(`\n  MOTOR ${MODEL_BREAKDOWN} ya tiene ${motorTemplate.tasks.length} tareas. De las ${engineCandidates.length} candidatas de motor sueltas, ${overlap.length} tienen el mismo título (posible duplicado) y ${engineCandidates.length - overlap.length} son nuevas.`);
    } else {
      console.log(`\n  No existe plantilla MOTOR ${MODEL_BREAKDOWN} para comparar.`);
    }

    const fabricanteTemplate = await prisma.maintenanceTemplate.findFirst({
      where: { organizationId: org.id, manufacturer: { notIn: ['DGAC', 'MOTOR', 'EASA', 'FAA'] }, model: MODEL_BREAKDOWN },
      include: { tasks: { select: { title: true } } },
    });
    const aircraftCandidates = candidates.filter((c) => c.equipmentScope === 'AIRCRAFT');
    if (fabricanteTemplate) {
      const fabTitles = new Set(fabricanteTemplate.tasks.map((t) => norm(t.title)));
      const overlap = aircraftCandidates.filter((c) => fabTitles.has(norm(c.title)));
      console.log(`  "${fabricanteTemplate.manufacturer} ${MODEL_BREAKDOWN}" (fabricante) ya tiene ${fabricanteTemplate.tasks.length} tareas. De las ${aircraftCandidates.length} candidatas de célula sueltas, ${overlap.length} se solapan por título y ${aircraftCandidates.length - overlap.length} son nuevas.`);
    }

    console.log(`\n  Ejemplo de candidatas de célula (fabricante):`);
    for (const s of aircraftCandidates.slice(0, 8)) console.log(`    [${s.code}] ${s.title}`);
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
