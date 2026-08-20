/**
 * check_ad_intervals.ts
 *
 * Antes de cargar un cumplimiento hay que saber si la AD es de cumplimiento
 * único o repetitiva. Cargar un cumplimiento en una AD repetitiva que no tiene
 * intervalo configurado la deja "cumplida sin próximo vencimiento": apagada.
 *
 * La señal de alarma es la frecuencia en Access. AD-2012-0257-E aparece en
 * nueve OT distintas de CC-ABU entre 2023 y 2024; eso no es cumplimiento único.
 *
 * Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/check_ad_intervals.ts --org-slug tecnicopters --codes AD-2012-0257-E,AD-2023-0089
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
const CODES = (getArgValue('--codes') ?? '').split(',').map((c) => c.trim()).filter(Boolean);

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const tareas = await prisma.maintenanceTask.findMany({
    where: {
      organizationId: org.id,
      referenceType: 'AD',
      ...(CODES.length ? { code: { in: CODES } } : {}),
    },
    select: {
      code: true, title: true, complianceRecurrence: true, intervalType: true,
      intervalHours: true, intervalCycles: true,
      intervalCalendarDays: true, intervalCalendarMonths: true,
      aircraftLinks: {
        where: { isActive: true },
        select: { aircraft: { select: { registration: true } } },
      },
    },
    orderBy: { code: 'asc' },
  });

  console.log(`\n=== Intervalos de las AD — ${ORG_SLUG} ===\n`);

  const tieneLimite = (t: (typeof tareas)[number]): boolean => (
    t.intervalHours != null || t.intervalCycles != null
    || t.intervalCalendarMonths != null || t.intervalCalendarDays != null
  );

  // Sin --codes se revisa la biblioteca entera: interesa el panorama, no el
  // detalle de cada AD.
  if (CODES.length === 0) {
    const conPlan = tareas.filter((t) => t.aircraftLinks.length > 0);
    const grupos = new Map<string, typeof tareas>();
    for (const t of conPlan) {
      const k = `${t.complianceRecurrence}|${tieneLimite(t) ? 'con intervalo' : 'SIN INTERVALO'}`;
      grupos.set(k, [...(grupos.get(k) ?? []), t]);
    }

    console.log(`AD en la biblioteca: ${tareas.length}   ·   activas en alguna aeronave: ${conPlan.length}\n`);
    console.log('Recurrencia      Intervalo        cant.');
    console.log('─'.repeat(46));
    for (const [k, v] of [...grupos].sort((a, b) => b[1].length - a[1].length)) {
      const [rec, iv] = k.split('|');
      console.log(`${rec.padEnd(16)} ${iv.padEnd(16)} ${String(v.length).padStart(5)}`);
    }
    console.log('─'.repeat(46));

    const rotas = conPlan.filter((t) => t.complianceRecurrence === 'REPETITIVE' && !tieneLimite(t));
    if (rotas.length) {
      console.log(`\n⚠️  ${rotas.length} AD declaradas REPETITIVAS y sin intervalo.`);
      console.log('    El motor no puede calcular su vencimiento: no vencen nunca por cálculo.');
      console.log('    Son un punto ciego del informe DGAC IV.4.1.\n');
      for (const t of rotas.slice(0, 40)) {
        console.log(`    [${t.code.padEnd(24)}] ${t.title.slice(0, 44)}`);
        console.log(`         ${t.aircraftLinks.map((l) => l.aircraft.registration).join(', ')}`);
      }
      if (rotas.length > 40) console.log(`    … y ${rotas.length - 40} más`);
    }
    console.log('\nSolo lectura: no se modificó nada.\n');
    return;
  }

  const sinIntervalo: typeof tareas = [];

  for (const t of tareas) {
    const limites = [
      t.intervalHours != null ? `${Number(t.intervalHours)} h` : null,
      t.intervalCycles != null ? `${t.intervalCycles} ciclos` : null,
      t.intervalCalendarMonths != null ? `${t.intervalCalendarMonths} meses` : null,
      t.intervalCalendarDays != null ? `${t.intervalCalendarDays} días` : null,
    ].filter(Boolean).join(' / ');

    console.log(`[${t.code}] ${t.title.slice(0, 60)}`);
    console.log(`    recurrencia: ${t.complianceRecurrence}   tipo: ${t.intervalType}`);
    console.log(`    intervalo:   ${limites || '⚠️  NINGUNO'}`);
    console.log(`    activa en:   ${t.aircraftLinks.map((l) => l.aircraft.registration).join(', ') || '(ninguna)'}`);

    if (!limites) {
      sinIntervalo.push(t);
      // REPETITIVE sin intervalo es contradictorio: el modelo dice que se
      // repite pero no dice cada cuánto.
      if (t.complianceRecurrence === 'REPETITIVE') {
        console.log('    ⚠️  Declarada REPETITIVA pero sin intervalo: no puede calcular vencimiento.');
      }
    }
    console.log('');
  }

  if (sinIntervalo.length) {
    console.log('─'.repeat(72));
    console.log(`⚠️  ${sinIntervalo.length} AD sin intervalo configurado.`);
    console.log('    Cargarles un cumplimiento las deja "cumplidas sin próximo vencimiento".');
    console.log('    Si son de cumplimiento único, es correcto. Si son repetitivas, las apaga.');
    console.log('    Contrastar con la frecuencia en Access antes de cargar.\n');
  }

  console.log('Solo lectura: no se modificó nada.\n');
}

main()
  .catch((err) => {
    console.error('check_ad_intervals failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
