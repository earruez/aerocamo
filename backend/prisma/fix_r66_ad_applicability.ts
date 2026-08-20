/**
 * fix_r66_ad_applicability.ts
 *
 * Corrige dónde vive la excepción de aplicabilidad de las AD del R66.
 *
 * Al importarlas (import_r66_ad_dan.ts) marqué inactivas las 6 AD que no
 * aplican a CC-AKY — pero las marqué inactivas en la PLANTILLA, que es
 * genérica del modelo. Son AD perfectamente válidas del R66: lo que no
 * aplica es a esa aeronave en particular (por S/N del altímetro, por
 * modelo, etc.). Dejarlas inactivas en la plantilla se las oculta a
 * cualquier R66 futuro aunque sí le correspondan.
 *
 * Este script:
 *   1. Activa las 10 AD en la plantilla FAA R66 y en la lista de tareas.
 *   2. Marca "No aplica" (AircraftTask.isActive=false + motivo) las 6 que
 *      no corresponden a CC-AKY — igual que si se hubiera hecho desde la UI.
 *
 * Uso:
 *   npx tsx prisma/fix_r66_ad_applicability.ts --org-slug tecnicopters --registration CC-AKY --changed-by "Griselle" [--apply]
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
const CHANGED_BY = getArgValue('--changed-by') ?? 'Griselle';
const APPLY = args.includes('--apply');

const ALL_AD_CODES = [
  'AD-39-22681', 'AD-39-21433', 'AD-39-19613', 'AD-39-18762',
  'AD-39-22866', 'AD-39-22453', 'AD-39-22181',
  'AD-39-18-801', 'AD-39-2028', 'AD-39-5317',
];

/** Las que no aplican a CC-AKY, con el motivo que va al registro de aplicabilidad. */
const NOT_APPLICABLE: Record<string, string> = {
  'AD-39-22866': 'No aplica: la AD alcanza a los Robinson Model R44, no al R66.',
  'AD-39-22453': 'No aplica: la aeronave no tiene instalado equipo Radio Altímetro.',
  'AD-39-22181': 'No aplica por número de serie: alcanza a Tail Rotor Blades P/N F029-1 con S/N distinto al instalado.',
  'AD-39-18-801': 'No aplica por número de serie del altímetro instalado (S/N 5934).',
  'AD-39-2028': 'No aplica por número de serie del altímetro instalado.',
  'AD-39-5317': 'No aplica por número de serie del altímetro instalado.',
};

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const actor = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: CHANGED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!actor) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${CHANGED_BY}"`);

  const faaTemplate = await prisma.maintenanceTemplate.findFirst({
    where: { organizationId: org.id, manufacturer: { equals: 'FAA', mode: 'insensitive' }, model: 'R66' },
  });
  if (!faaTemplate) throw new Error('No existe la plantilla FAA R66');

  const templateTasks = await prisma.maintenanceTemplateTask.findMany({
    where: { templateId: faaTemplate.id, code: { in: ALL_AD_CODES } },
    select: { id: true, code: true, isActive: true },
  });
  const orgTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, code: { in: ALL_AD_CODES } },
    select: { id: true, code: true, isActive: true },
  });
  const links = await prisma.aircraftTask.findMany({
    where: { aircraftId: aircraft.id, task: { code: { in: ALL_AD_CODES } } },
    select: { taskId: true, isActive: true, applicabilityNotes: true, task: { select: { code: true } } },
  });

  console.log(`\n=== Corregir aplicabilidad de las AD del R66 (${REGISTRATION}) ===`);
  console.log(`Actor del cambio: ${actor.name}`);
  console.log(`\nEn la plantilla FAA R66 (${templateTasks.length} encontradas):`);
  const templateToActivate = templateTasks.filter((t) => !t.isActive);
  console.log(`  ${templateToActivate.length} pasan a activas: ${templateToActivate.map((t) => t.code).join(', ') || '(ninguna)'}`);

  const orgToActivate = orgTasks.filter((t) => !t.isActive);
  console.log(`\nEn la lista de tareas (${orgTasks.length} encontradas):`);
  console.log(`  ${orgToActivate.length} pasan a activas: ${orgToActivate.map((t) => t.code).join(', ') || '(ninguna)'}`);

  console.log(`\nEn el plan de ${REGISTRATION} (${links.length} enlaces):`);
  const toMarkNotApplicable = links.filter((l) => NOT_APPLICABLE[l.task.code] && (l.isActive || !l.applicabilityNotes));
  for (const l of links) {
    const reason = NOT_APPLICABLE[l.task.code];
    console.log(`  ${l.task.code}: ${reason ? 'NO APLICA' : 'aplica'}${reason ? ` — ${reason}` : ''}`);
  }
  console.log(`  → ${toMarkNotApplicable.length} enlaces a marcar "No aplica" con su motivo.`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  await prisma.maintenanceTemplateTask.updateMany({
    where: { templateId: faaTemplate.id, code: { in: ALL_AD_CODES } },
    data: { isActive: true },
  });
  await prisma.maintenanceTask.updateMany({
    where: { organizationId: org.id, code: { in: ALL_AD_CODES } },
    data: { isActive: true },
  });

  for (const l of links) {
    const reason = NOT_APPLICABLE[l.task.code];
    await prisma.aircraftTask.update({
      where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: l.taskId } },
      data: reason
        ? {
            isActive: false,
            applicabilityNotes: reason,
            applicabilityChangedAt: new Date(),
            applicabilityChangedById: actor.id,
          }
        : { isActive: true },
    });
  }

  console.log(`\n✅ Plantilla y tareas activadas; ${toMarkNotApplicable.length} marcadas "No aplica" en ${REGISTRATION}.`);
}

main()
  .catch((err) => {
    console.error('fix_r66_ad_applicability failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
