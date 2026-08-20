/**
 * move_r66_ad_to_faa_template.ts
 *
 * Las AD de célula del R66 (cargadas por import_r66_ad_dan.ts) quedaron en
 * la plantilla "ROBINSON R66" (Normativa de fabricante). Una AD la emite la
 * autoridad (FAA), no el fabricante — corresponde a "Normativa país de
 * origen". Este script mueve esas tareas de la plantilla ROBINSON R66 a una
 * plantilla FAA R66 (se crea si no existe).
 *
 * Solo mueve las MaintenanceTemplateTask (la biblioteca reutilizable). Los
 * MaintenanceTask/Compliance ya asignados a una aeronave (CC-AKY) no se
 * tocan — no están vinculados a una plantilla, así que su historial de
 * cumplimiento sigue intacto.
 *
 * Uso:
 *   npx tsx prisma/move_r66_ad_to_faa_template.ts --org-slug tecnicopters [--apply]
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
const APPLY = args.includes('--apply');

const AD_CODES = [
  'AD-39-22681', 'AD-39-21433', 'AD-39-19613', 'AD-39-18762',
  'AD-39-22866', 'AD-39-22453', 'AD-39-22181',
  'AD-39-18-801', 'AD-39-2028', 'AD-39-5317',
];

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const robinsonR66 = await prisma.maintenanceTemplate.findFirst({
    where: { organizationId: org.id, manufacturer: { equals: 'ROBINSON', mode: 'insensitive' }, model: 'R66' },
  });
  if (!robinsonR66) throw new Error('No existe la plantilla ROBINSON R66');

  let faaR66 = await prisma.maintenanceTemplate.findFirst({
    where: { organizationId: org.id, manufacturer: { equals: 'FAA', mode: 'insensitive' }, model: 'R66' },
  });

  const tasksToMove = await prisma.maintenanceTemplateTask.findMany({
    where: { templateId: robinsonR66.id, code: { in: AD_CODES } },
    select: { id: true, code: true, title: true, isActive: true },
  });

  console.log(`\n=== ${ORG_SLUG}: mover AD de "ROBINSON R66" a "FAA R66" ===`);
  console.log(`Encontradas ${tasksToMove.length}/${AD_CODES.length} tareas en ROBINSON R66:`);
  for (const t of tasksToMove) console.log(`  [${t.isActive ? 'activa' : 'inactiva'}] ${t.code}: ${t.title}`);
  const missing = AD_CODES.filter((c) => !tasksToMove.some((t) => t.code === c));
  if (missing.length) console.log(`⚠️  No encontradas (¿ya movidas?): ${missing.join(', ')}`);

  if (!faaR66) console.log('\nNo existe la plantilla FAA R66 — se creará.');

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  if (!faaR66) {
    faaR66 = await prisma.maintenanceTemplate.create({
      data: { organizationId: org.id, manufacturer: 'FAA', model: 'R66', description: 'Normativa país de origen (FAA) para R66 — Airworthiness Directives', version: '1.0' },
    });
    console.log(`Plantilla FAA R66 creada (id ${faaR66.id}).`);
  }

  for (const t of tasksToMove) {
    await prisma.maintenanceTemplateTask.update({
      where: { id: t.id },
      data: { templateId: faaR66.id },
    });
    console.log(`  ✓ movida: ${t.code}`);
  }

  console.log('\n✅ Listo.');
}

main()
  .catch((err) => {
    console.error('move_r66_ad_to_faa_template failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
