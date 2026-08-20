/**
 * populate_template_from_loose_tasks.ts
 *
 * Algunas plantillas de fabricante (ej. "BELL 505") quedaron vacías aunque
 * la empresa sí tiene tareas sueltas (MaintenanceTask) para ese modelo,
 * cargadas hace tiempo desde Access — nadie las convirtió en el contenido
 * de la plantilla. Este script toma las tareas sueltas AMM/SB de un modelo
 * con equipmentScope=AIRCRAFT (célula, no motor) y las agrega como
 * MaintenanceTemplateTask a la plantilla de fabricante correspondiente.
 *
 * Solo agrega — no borra ni modifica las tareas sueltas originales, y usa
 * upsert por código así que re-ejecutar con --apply no duplica.
 *
 * Uso:
 *   npx tsx prisma/populate_template_from_loose_tasks.ts \
 *     --org-slug tecnicopters --manufacturer BELL --model 505 [--apply]
 */
import { PrismaClient, ReferenceType } from '@prisma/client';

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
const MANUFACTURER = getArgValue('--manufacturer');
const MODEL = getArgValue('--model');
const APPLY = args.includes('--apply');

async function main(): Promise<void> {
  if (!MANUFACTURER || !MODEL) {
    console.error('Uso: --org-slug tecnicopters --manufacturer BELL --model 505 [--apply]');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const template = await prisma.maintenanceTemplate.findFirst({
    where: { organizationId: org.id, manufacturer: { equals: MANUFACTURER, mode: 'insensitive' }, model: MODEL },
  });
  if (!template) throw new Error(`No existe la plantilla ${MANUFACTURER} ${MODEL}`);

  const existingCodes = new Set(
    (await prisma.maintenanceTemplateTask.findMany({ where: { templateId: template.id }, select: { code: true } }))
      .map((t) => t.code),
  );

  const looseTasks = await prisma.maintenanceTask.findMany({
    where: {
      organizationId: org.id,
      applicableModel: MODEL,
      referenceType: { in: ['AMM', 'SB'] as ReferenceType[] },
      equipmentScope: 'AIRCRAFT',
    },
  });

  const toAdd = looseTasks.filter((t) => !existingCodes.has(t.code));
  const alreadyThere = looseTasks.length - toAdd.length;

  console.log(`\n=== Poblar "${MANUFACTURER} ${MODEL}" desde la biblioteca suelta ===`);
  console.log(`Encontradas ${looseTasks.length} tareas sueltas (AMM/SB, célula) para el modelo "${MODEL}".`);
  console.log(`${alreadyThere} ya existen en la plantilla (por código) — se omiten. ${toAdd.length} son nuevas.`);
  console.log(`\nEjemplo de las primeras 5 a agregar:`);
  for (const t of toAdd.slice(0, 5)) console.log(`  [${t.code}] ${t.title}`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  let created = 0;
  for (const t of toAdd) {
    await prisma.maintenanceTemplateTask.create({
      data: {
        templateId: template.id,
        code: t.code,
        title: t.title,
        description: t.description,
        intervalType: t.intervalType,
        intervalHours: t.intervalHours,
        intervalCycles: t.intervalCycles,
        intervalCalendarDays: t.intervalCalendarDays,
        intervalCalendarMonths: t.intervalCalendarMonths,
        referenceNumber: t.referenceNumber,
        referenceType: t.referenceType,
        isMandatory: t.isMandatory,
        estimatedManHours: t.estimatedManHours,
        requiresInspection: t.requiresInspection,
        applicableModel: t.applicableModel,
        applicablePartNumber: t.applicablePartNumber,
        isActive: t.isActive,
      },
    });
    created += 1;
  }

  console.log(`\n✅ ${created} tareas agregadas a "${MANUFACTURER} ${MODEL}".`);
}

main()
  .catch((err) => {
    console.error('populate_template_from_loose_tasks failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
