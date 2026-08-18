/**
 * rename_platform_org_slug.ts
 *
 * Cambia el slug de la organización interna de plataforma (el valor que se
 * escribe en "Organización" al hacer login) de "aerocamo-platform" a uno
 * nuevo. No toca usuarios ni roles, solo el slug de esa organización.
 *
 * Uso:
 *   npx tsx prisma/rename_platform_org_slug.ts --to superadmin --apply
 *
 * Sin --apply corre en dry-run: valida y muestra qué haría, sin escribir.
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

const FROM_SLUG = 'aerocamo-platform';
const TO_SLUG = getArgValue('--to')?.trim().toLowerCase();
const APPLY = args.includes('--apply');

async function main(): Promise<void> {
  if (!TO_SLUG) {
    console.error('Uso: --to nuevo-slug [--apply]');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(TO_SLUG)) {
    throw new Error('El slug solo puede tener minúsculas, números y guiones');
  }

  const org = await prisma.organization.findUnique({ where: { slug: FROM_SLUG } });
  if (!org) throw new Error(`No existe ninguna organización con slug "${FROM_SLUG}"`);

  const taken = await prisma.organization.findUnique({ where: { slug: TO_SLUG } });
  if (taken && taken.id !== org.id) throw new Error(`Ya existe otra organización con el slug "${TO_SLUG}"`);

  console.log(`=== Renombrar slug de organización (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Organización: ${org.name}`);
  console.log(`Slug actual: ${org.slug}`);
  console.log(`Slug nuevo:  ${TO_SLUG}`);

  if (!APPLY) {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  await prisma.organization.update({ where: { id: org.id }, data: { slug: TO_SLUG } });
  console.log(`\nListo. A partir de ahora, entra con Organización: ${TO_SLUG}`);
}

main()
  .catch((error) => {
    console.error('rename_platform_org_slug failed:', error.message ?? error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
