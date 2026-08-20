/**
 * check_usage_log_coverage.ts
 *
 * El punto IV.1.1 de la lista de la DGAC pide el detalle de horas, ciclos y
 * aterrizajes que cubra TODO el período desde la última renovación, y el
 * IV.1.2 lo mismo por motor. Ese informe se alimenta de AircraftUsageLog y
 * AircraftEngineUsageLog.
 *
 * Antes de construirlo hay que saber si esas tablas tienen con qué: un informe
 * de período sobre un registro con huecos no es presentable, y el problema
 * pasa a ser el hábito de carga, no la falta de pantalla.
 *
 * Mide densidad y huecos. Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/check_usage_log_coverage.ts --org-slug tecnicopters [--months 24]
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
const MONTHS = Number(getArgValue('--months') ?? '24');

const DIA = 86400000;
const fmt = (d: Date): string => d.toISOString().slice(0, 10);

/** Mayor separación en días entre registros consecutivos. */
function mayorHueco(fechas: Date[]): { dias: number; desde: string; hasta: string } | null {
  if (fechas.length < 2) return null;
  let peor = { dias: 0, desde: '', hasta: '' };
  for (let i = 1; i < fechas.length; i += 1) {
    const dias = Math.round((fechas[i].getTime() - fechas[i - 1].getTime()) / DIA);
    if (dias > peor.dias) peor = { dias, desde: fmt(fechas[i - 1]), hasta: fmt(fechas[i]) };
  }
  return peor.dias > 0 ? peor : null;
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const desde = new Date(Date.now() - MONTHS * 30 * DIA);

  const aeronaves = await prisma.aircraft.findMany({
    where: { organizationId: org.id },
    select: { id: true, registration: true, model: true, totalFlightHours: true },
    orderBy: { registration: 'asc' },
  });

  console.log(`\n=== Cobertura del registro de horas — ${ORG_SLUG} ===`);
  console.log(`Ventana analizada: últimos ${MONTHS} meses (desde ${fmt(desde)})\n`);
  console.log('Matrícula   registros  primero      último       mayor hueco   motores');
  console.log('─'.repeat(78));

  let totalRegistros = 0;

  for (const ac of aeronaves) {
    const logs = await prisma.aircraftUsageLog.findMany({
      where: { aircraftId: ac.id, date: { gte: desde } },
      select: { date: true },
      orderBy: { date: 'asc' },
    });
    const fechas = logs.map((l) => l.date);
    const hueco = mayorHueco(fechas);
    totalRegistros += fechas.length;

    const motores = await prisma.aircraftEngine.findMany({
      where: { aircraftId: ac.id, isActive: true },
      select: { position: true, _count: { select: { usageLogs: true } } },
      orderBy: { position: 'asc' },
    });
    const motorTxt = motores.length
      ? motores.map((m) => `${m.position}:${m._count.usageLogs}`).join(' ')
      : '(sin motor)';

    console.log(
      `${ac.registration.padEnd(11)} ${String(fechas.length).padStart(8)}  `
      + `${(fechas[0] ? fmt(fechas[0]) : '—').padEnd(12)} `
      + `${(fechas.at(-1) ? fmt(fechas.at(-1)!) : '—').padEnd(12)} `
      + `${(hueco ? `${hueco.dias} d` : '—').padStart(11)}   ${motorTxt}`,
    );
    if (hueco && hueco.dias > 60) {
      console.log(`${' '.repeat(12)}└─ sin registros entre ${hueco.desde} y ${hueco.hasta}`);
    }
  }

  console.log('─'.repeat(78));
  console.log(`\nTotal de registros de aeronave en la ventana: ${totalRegistros}`);
  console.log(`Promedio por aeronave: ${(totalRegistros / aeronaves.length).toFixed(1)}`);
  console.log(`Para un detalle mensual de ${MONTHS} meses harían falta ~${MONTHS} por aeronave.\n`);
  console.log('Solo lectura: no se modificó nada.\n');
}

main()
  .catch((err) => {
    console.error('check_usage_log_coverage failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
