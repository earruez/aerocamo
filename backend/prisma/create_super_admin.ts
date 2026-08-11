/**
 * create_super_admin.ts
 *
 * Bootstrap: no hay registro público, así que la primera cuenta SUPER_ADMIN
 * hay que crearla a mano. Vive en una organización interna de plataforma
 * ("aerocamo-platform"), nunca en la de un cliente — se crea si no existe.
 *
 * Uso:
 *   npx tsx prisma/create_super_admin.ts --name "Erik" --email erik@aerocamo.cl --password "..." --apply
 *
 * Sin --apply corre en dry-run: valida y muestra qué haría, sin escribir.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return undefined;
}

const NAME = getArgValue('--name');
const EMAIL = getArgValue('--email')?.trim().toLowerCase();
const PASSWORD = getArgValue('--password');
const APPLY = args.includes('--apply');
const PLATFORM_ORG_SLUG = 'aerocamo-platform';

async function main(): Promise<void> {
  if (!NAME || !EMAIL || !PASSWORD) {
    console.error('Uso: --name "Nombre" --email correo@dominio --password "clave" [--apply]');
    process.exit(1);
  }
  if (PASSWORD.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const existing = await prisma.user.findFirst({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: { id: true, role: true },
  });
  if (existing) throw new Error(`Ya existe un usuario con ese correo (rol actual: ${existing.role})`);

  let org = await prisma.organization.findUnique({ where: { slug: PLATFORM_ORG_SLUG } });

  console.log(`=== Crear SUPER_ADMIN (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Organización de plataforma: ${org ? 'ya existe' : 'se crea'} (slug: ${PLATFORM_ORG_SLUG})`);
  console.log(`Usuario: ${NAME} <${EMAIL}>`);

  if (!APPLY) {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Aerocamo — Plataforma',
        slug: PLATFORM_ORG_SLUG,
        country: 'CL',
        subscriptionPlan: 'ENTERPRISE',
        subscriptionStatus: 'ACTIVE',
      },
    });
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: NAME, email: EMAIL, passwordHash, role: 'SUPER_ADMIN' },
  });

  console.log(`\nListo. Para entrar:`);
  console.log(`  Organización: ${PLATFORM_ORG_SLUG}`);
  console.log(`  Correo: ${user.email}`);
  console.log(`  (la contraseña es la que indicaste)`);
}

main()
  .catch((error) => {
    console.error('create_super_admin failed:', error.message ?? error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
