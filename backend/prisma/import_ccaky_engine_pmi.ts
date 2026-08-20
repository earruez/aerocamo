/**
 * import_ccaky_engine_pmi.ts
 *
 * Las dos PMI del motor que quedaron fuera de import_ccaky_engine_inspections.ts
 * porque no tenían equivalente entre las IN-*-250C300A1.
 *
 * Confirmado por Griselle Pasmiño (20-08-2026): son tareas distintas, no
 * duplicados de las IN-*. La TASK 05-00-00-800-801 viene del manual del MOTOR,
 * mientras que la 05-21-00 con la que se cargaron las otras inspecciones viene
 * del lado de la aeronave — de ahí la diferencia. Son dos PMI separadas: una
 * por horas y otra por ciclos.
 *
 * Ninguna tiene cumplimiento registrado en la bitácora, así que ambas se
 * anclan en motor nuevo (2012-04-20, 0 h, 0 ciclos), que es lo que hace que
 * venzan en su límite absoluto: 2000 h y 3000 ciclos respectivamente.
 *
 * Se crean con isMandatory = true para que aparezcan en el Informe DGAC (ver
 * fix_inspection_mandatory_flag.ts sobre por qué el resto quedó en false).
 *
 * Uso:
 *   npx tsx prisma/import_ccaky_engine_pmi.ts --org-slug tecnicopters \
 *     --registration CC-AKY --performed-by "Griselle" [--apply]
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
const PERFORMED_BY = getArgValue('--performed-by') ?? 'Griselle';
const APPLY = args.includes('--apply');

/** Motor nuevo: origen del conteo, igual que en import_ccaky_engine_inspections.ts */
const MOTOR_NUEVO = { fecha: '2012-04-20', horas: 0, ciclos: 0 };

const REFERENCIA = 'OMM RR 300, TASK 05-00-00-800-801';

interface PmiItem {
  code: string;
  title: string;
  intervalType: 'FLIGHT_HOURS' | 'CYCLES';
  intervalHours: number | null;
  intervalCycles: number | null;
}

const PMI: PmiItem[] = [
  {
    code: 'IN-PMI-2000H-250C300A1',
    title: 'PMI cada 2000 Hrs Motor — OMM RR 300, TASK 05-00-00-800-801',
    intervalType: 'FLIGHT_HOURS',
    intervalHours: 2000,
    intervalCycles: null,
  },
  {
    code: 'IN-PMI-3000CY-250C300A1',
    title: 'PMI cada 3000 Ciclos Motor — OMM RR 300, TASK 05-00-00-800-801',
    intervalType: 'CYCLES',
    intervalHours: null,
    intervalCycles: 3000,
  },
];

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true, totalFlightHours: true, totalCycles: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY}"`);

  const horasActuales = Number(aircraft.totalFlightHours);
  const ciclosActuales = Number(aircraft.totalCycles ?? 0);

  console.log(`\n=== PMI del motor — ${REGISTRATION} ===`);
  console.log(`A nombre de: ${performer.name}`);
  console.log(`Estado actual: ${horasActuales.toFixed(2)} h / ${ciclosActuales} ciclos\n`);

  for (const p of PMI) {
    const existente = await prisma.maintenanceTask.findFirst({
      where: { organizationId: org.id, code: p.code },
      select: { id: true },
    });
    const restante = p.intervalHours != null
      ? `${(p.intervalHours - horasActuales).toFixed(2)} h`
      : `${(p.intervalCycles! - ciclosActuales)} ciclos`;

    console.log(`  [${p.code}] ${p.title}`);
    console.log(`      cada ${p.intervalHours != null ? `${p.intervalHours} h` : `${p.intervalCycles} ciclos`}`
      + ` — anclada en motor nuevo (${MOTOR_NUEVO.fecha})`);
    console.log(`      vence a ${p.intervalHours ?? p.intervalCycles} ${p.intervalHours != null ? 'h' : 'ciclos'}`
      + ` → restante ≈ ${restante}`);
    if (existente) console.log('      (la tarea ya existe, no se recrea)');
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  for (const p of PMI) {
    await prisma.$transaction(async (tx) => {
      let task = await tx.maintenanceTask.findFirst({
        where: { organizationId: org.id, code: p.code },
      });
      if (!task) {
        task = await tx.maintenanceTask.create({
          data: {
            organizationId: org.id,
            code: p.code,
            title: p.title,
            description: `Periodic Maintenance Inspection del motor conforme a ${REFERENCIA}. `
              + 'Del manual del motor, distinta de las inspecciones 05-21-00.',
            intervalType: p.intervalType,
            intervalHours: p.intervalHours,
            intervalCycles: p.intervalCycles,
            referenceType: 'AMM',
            referenceNumber: REFERENCIA,
            equipmentScope: 'ENGINE',
            isMandatory: true,
            requiresInspection: true,
            applicableModel: '250-C300/A1',
          },
        });
      }

      await tx.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: task.id } },
        create: { aircraftId: aircraft.id, taskId: task.id, isActive: true },
        update: { isActive: true },
      });

      const ya = await tx.compliance.findFirst({
        where: { aircraftId: aircraft.id, taskId: task.id },
        select: { id: true },
      });
      if (ya) return;

      await tx.compliance.create({
        data: {
          organizationId: org.id, aircraftId: aircraft.id, taskId: task.id,
          performedById: performer.id,
          performedAt: new Date(MOTOR_NUEVO.fecha),
          aircraftHoursAtCompliance: MOTOR_NUEVO.horas,
          aircraftCyclesAtCompliance: MOTOR_NUEVO.ciclos,
          nextDueHours: p.intervalHours,
          nextDueCycles: p.intervalCycles,
          nextDueDate: null,
          applicationType: 'baseline',
          isInitial: true,
          status: 'COMPLETED',
          notes: `Inicio de control desde motor nuevo — importado de bitácora electrónica (${REGISTRATION}) — Cump.Insp.Eng.`,
        },
      });
    }, { timeout: 15000 });
    console.log(`  ✓ ${p.code}`);
  }

  console.log('\n✅ PMI del motor cargadas.');
}

main()
  .catch((err) => {
    console.error('import_ccaky_engine_pmi failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
