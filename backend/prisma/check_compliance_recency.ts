/**
 * check_compliance_recency.ts
 *
 * 212 de las 224 vencidas de la flota tienen un cumplimiento firmado y
 * volvieron a vencer. Eso descarta que sean un artefacto del motor, pero deja
 * abierta una pregunta peor: ¿están vencidas porque no se hizo el trabajo, o
 * porque el trabajo se hizo y no se cargó?
 *
 * La señal es la antigüedad del último cumplimiento. Si la aeronave voló todo
 * el año pero su cumplimiento más reciente es de hace doce meses, lo que falta
 * es el registro, no el mantenimiento. CC-AKY ya mostró ese patrón en el
 * registro de horas: 358 días sin una sola lectura.
 *
 * Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/check_compliance_recency.ts --org-slug tecnicopters
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
const DIA = 86400000;
const fmt = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '—');

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aeronaves = await prisma.aircraft.findMany({
    where: { organizationId: org.id },
    select: { id: true, registration: true, totalFlightHours: true },
    orderBy: { registration: 'asc' },
  });

  console.log(`\n=== Antigüedad del registro de cumplimientos — ${ORG_SLUG} ===\n`);
  console.log('Matrícula     cumpl.  último real   antigüedad   últimos 12m');
  console.log('─'.repeat(66));

  const hace12m = new Date(Date.now() - 365 * DIA);

  for (const ac of aeronaves) {
    // Solo cumplimientos firmados: la línea base es un ancla, no trabajo hecho.
    const reales = {
      aircraftId: ac.id,
      OR: [{ applicationType: { not: 'baseline' } }, { isInitial: false }],
    };

    const total = await prisma.compliance.count({ where: reales });
    const ultimo = await prisma.compliance.findFirst({
      where: reales,
      select: { performedAt: true },
      orderBy: { performedAt: 'desc' },
    });
    const recientes = await prisma.compliance.count({
      where: { ...reales, performedAt: { gte: hace12m } },
    });

    const dias = ultimo?.performedAt
      ? Math.floor((Date.now() - ultimo.performedAt.getTime()) / DIA)
      : null;

    console.log(
      `${ac.registration.padEnd(12)} ${String(total).padStart(6)}  `
      + `${fmt(ultimo?.performedAt ?? null).padEnd(12)} `
      + `${(dias != null ? `${dias} d` : '—').padStart(10)}   ${String(recientes).padStart(11)}`,
    );
  }

  console.log('─'.repeat(66));
  console.log('\nUna aeronave que vuela y cuyo último cumplimiento firmado es de hace');
  console.log('meses no está sin mantención: está sin registrar. Las vencidas de esa');
  console.log('aeronave miden el atraso del registro, no el de la máquina.\n');
  console.log('Solo lectura: no se modificó nada.\n');
}

main()
  .catch((err) => {
    console.error('check_compliance_recency failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
