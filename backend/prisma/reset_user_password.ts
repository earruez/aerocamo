/**
 * reset_user_password.ts
 *
 * Resetea la contraseña de un usuario existente (útil para recuperar acceso
 * a una cuenta SUPER_ADMIN cuya contraseña se perdió). No crea usuarios
 * nuevos ni toca el rol/organización — solo el hash de contraseña.
 *
 * Uso:
 *   npx tsx prisma/reset_user_password.ts --email correo@dominio --password "clave-nueva" --apply
 *
 * Sin --apply corre en dry-run: valida y muestra a quién afectaría, sin escribir.
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

const EMAIL = getArgValue('--email')?.trim().toLowerCase();
const PASSWORD = getArgValue('--password');
const APPLY = args.includes('--apply');

async function main(): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    console.error('Uso: --email correo@dominio --password "clave-nueva" [--apply]');
    process.exit(1);
  }
  if (PASSWORD.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const user = await prisma.user.findFirst({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, role: true, organization: { select: { slug: true, name: true } } },
  });
  if (!user) throw new Error(`No existe ningún usuario con el correo ${EMAIL}`);

  console.log(`=== Resetear contraseña (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Usuario: ${user.name} <${user.email}>`);
  console.log(`Rol: ${user.role}`);
  console.log(`Organización: ${user.organization.name} (slug: ${user.organization.slug})`);

  if (!APPLY) {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  console.log(`\nListo. Para entrar:`);
  console.log(`  Organización: ${user.organization.slug}`);
  console.log(`  Correo: ${user.email}`);
  console.log(`  (la contraseña es la que indicaste)`);
}

main()
  .catch((error) => {
    console.error('reset_user_password failed:', error.message ?? error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
