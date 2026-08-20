/**
 * fix_engine_4000h_table_ref.ts
 *
 * La inspección de 4000 h del motor 250-C300/A1 quedó citando la "tabla 606".
 * Griselle Pasmiño envió la página del manual (20-08-2026): es la
 * TABLE 605 - 4000 Hour Inspection, SYSTEM DESCRIPTION SECTION-801, 05-21-00.
 * La bitácora de CC-AKY siempre la citó como 605; la tarea importada del
 * Access era la que estaba mal.
 *
 * Corrige la referencia en el título y la descripción. No toca intervalos,
 * cumplimientos ni enlaces: es una corrección de la cita del manual.
 *
 * La tarea la comparten CC-AVK y CC-AKY (mismo motor), así que la corrección
 * aplica a ambas, que es lo correcto: el manual dice lo mismo para las dos.
 *
 * Uso:
 *   npx tsx prisma/fix_engine_4000h_table_ref.ts --org-slug tecnicopters [--apply]
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
const CODE = getArgValue('--code') ?? 'IN-006-250C300A1';
const APPLY = args.includes('--apply');

/** Solo "tabla 606" / "table 606", para no tocar un 606 que sea otra cosa. */
const PATRON = /\b(tabla|table)\s*606\b/gi;

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const task = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, code: CODE },
    select: {
      id: true, code: true, title: true, description: true,
      aircraftLinks: {
        where: { isActive: true },
        select: { aircraft: { select: { registration: true } } },
      },
    },
  });
  if (!task) throw new Error(`No existe la tarea ${CODE} en ${ORG_SLUG}`);

  const nuevoTitulo = task.title.replace(PATRON, (m) => m.replace('606', '605'));
  const nuevaDesc = task.description?.replace(PATRON, (m) => m.replace('606', '605')) ?? null;

  console.log(`\n=== Corrección de referencia — ${CODE} ===`);
  console.log(`Activa en: ${task.aircraftLinks.map((l) => l.aircraft.registration).join(', ') || '(ninguna)'}\n`);
  console.log(`Título antes:   ${task.title}`);
  console.log(`Título después: ${nuevoTitulo}\n`);
  if (task.description) {
    console.log(`Descripción antes:   ${task.description.slice(0, 200)}`);
    console.log(`Descripción después: ${(nuevaDesc ?? '').slice(0, 200)}\n`);
  }

  if (nuevoTitulo === task.title && nuevaDesc === task.description) {
    console.log('No hay nada que cambiar: no se encontró "tabla 606" en el texto.');
    return;
  }

  if (!APPLY) {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  await prisma.maintenanceTask.update({
    where: { id: task.id },
    data: { title: nuevoTitulo, description: nuevaDesc },
  });
  console.log(`✅ ${CODE} corregida a tabla 605.`);
}

main()
  .catch((err) => {
    console.error('fix_engine_4000h_table_ref failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
