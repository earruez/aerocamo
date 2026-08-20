/**
 * fix_ccaky_bearpaws_and_ad.ts
 *
 * Dos correcciones que levantó la revisión técnica de CC-AKY:
 *
 * 1. Bear Paws. Se había enlazado a IN-022, pero son productos distintos:
 *    IN-022 es "Bearpaws P/N D066-1001-013, cada 400 h, ICA-D066-1001",
 *    mientras que el de CC-AKY es "Bear Paws BP44 (Helitowcart), ICA Doc.
 *    314-0011-00 Rev. E, cada 300 h / 12 meses". Distinto fabricante del
 *    complemento, distinto documento y distinto intervalo. Se crea su propia
 *    tarea, se le mueve el cumplimiento y se desenlaza IN-022.
 *
 * 2. AD 2022-10-06 (enm. 39-22044). Debe mostrar cuánto falta para llegar a
 *    las 2025 h de motor, que es el límite. La tarea es compartida con
 *    CC-AVK —que ya la cumplió el 2025-07-17— así que en vez de ponerle un
 *    intervalo a la tarea (lo que afectaría a la otra aeronave), el
 *    vencimiento se fija directo en el cumplimiento de CC-AKY: anclado en
 *    motor nuevo con vencimiento a las 2025 h.
 *
 * Uso:
 *   npx tsx prisma/fix_ccaky_bearpaws_and_ad.ts --org-slug tecnicopters \
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

const BEARPAWS = {
  code: 'IN-BEARPAWS-BP44',
  title: 'Inspección cada 300 Hrs / 12 Meses — Bear Paws BP44 (Helitowcart)',
  description: 'Inspección del complemento Bear Paws modelo BP44, conforme a ICA Doc. 314-0011-00 Rev. E. '
    + 'Intervalo definido por el fabricante del complemento, no por Robinson.',
  intervalHours: 300,
  intervalCalendarMonths: 12,
  reemplazaA: 'IN-022',
};

const AD_MOTOR = {
  referenceNumber: '2022-10-06',
  /** La rueda de turbina se instaló con el motor nuevo. */
  instalacion: { fecha: '2012-04-20', horasMotor: 0 },
  limiteHorasMotor: 2025,
};

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true, totalFlightHours: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY}"`);

  console.log(`\n=== Correcciones de ${REGISTRATION} ===`);
  console.log(`A nombre de: ${performer.name}\n`);

  // ── 1. Bear Paws ───────────────────────────────────────────────────────
  const in022 = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, code: BEARPAWS.reemplazaA },
    select: { id: true, title: true, intervalHours: true },
  });
  const cumplEnIn022 = in022
    ? await prisma.compliance.findFirst({
        where: { aircraftId: aircraft.id, taskId: in022.id },
        select: { id: true, performedAt: true, aircraftHoursAtCompliance: true, aircraftCyclesAtCompliance: true },
      })
    : null;
  const yaExisteBearpaws = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, code: BEARPAWS.code },
    select: { id: true },
  });

  console.log('1) Bear Paws');
  console.log(`   Enlazado hoy a: [${BEARPAWS.reemplazaA}] ${in022?.title.slice(0, 60) ?? '(no encontrada)'} — cada ${in022?.intervalHours ?? '—'} h`);
  console.log(`   Corresponde:    [${BEARPAWS.code}] ${BEARPAWS.title} — cada ${BEARPAWS.intervalHours} h / ${BEARPAWS.intervalCalendarMonths} m`);
  if (yaExisteBearpaws) console.log('   (la tarea nueva ya existe, no se recrea)');
  if (cumplEnIn022) {
    console.log(`   Se mueve el cumplimiento del ${cumplEnIn022.performedAt.toISOString().slice(0, 10)}`
      + ` a ${Number(cumplEnIn022.aircraftHoursAtCompliance)} h, y se desenlaza ${BEARPAWS.reemplazaA} de ${REGISTRATION}.`);
  } else {
    console.log(`   ⚠️  no se encontró cumplimiento en ${BEARPAWS.reemplazaA} para ${REGISTRATION}`);
  }

  // ── 2. AD del motor ────────────────────────────────────────────────────
  const adTask = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, referenceNumber: AD_MOTOR.referenceNumber, referenceType: 'AD' },
    select: { id: true, code: true, title: true },
  });
  const adCumpl = adTask
    ? await prisma.compliance.findFirst({
        where: { aircraftId: aircraft.id, taskId: adTask.id },
        select: { id: true, nextDueHours: true },
      })
    : null;

  console.log('\n2) AD del motor');
  if (!adTask) {
    console.log(`   ⚠️  no se encontró la AD ${AD_MOTOR.referenceNumber} — se omite`);
  } else {
    const restante = AD_MOTOR.limiteHorasMotor - Number(aircraft.totalFlightHours);
    console.log(`   [${adTask.code}] ${adTask.title.slice(0, 60)}`);
    console.log(`   ${adCumpl ? 'Ya tiene cumplimiento; se le fija' : 'Se le crea un cumplimiento con'} vencimiento a ${AD_MOTOR.limiteHorasMotor} h de motor`);
    console.log(`   (anclado en motor nuevo ${AD_MOTOR.instalacion.fecha}) → restante ≈ ${restante.toFixed(2)} h`);
    console.log('   No se toca el intervalo de la tarea: la comparte CC-AVK, que ya la cumplió.');
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  // 1. Bear Paws
  const bearpawsTask = yaExisteBearpaws
    ? await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: yaExisteBearpaws.id } })
    : await prisma.maintenanceTask.create({
        data: {
          organizationId: org.id,
          code: BEARPAWS.code,
          title: BEARPAWS.title,
          description: BEARPAWS.description,
          intervalType: 'FLIGHT_HOURS_OR_CALENDAR',
          intervalHours: BEARPAWS.intervalHours,
          intervalCalendarMonths: BEARPAWS.intervalCalendarMonths,
          referenceType: 'AMM',
          referenceNumber: 'ICA Doc. 314-0011-00 Rev. E',
          isMandatory: true,
          applicableModel: 'R66',
        },
      });

  await prisma.aircraftTask.upsert({
    where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: bearpawsTask.id } },
    create: { aircraftId: aircraft.id, taskId: bearpawsTask.id, isActive: true },
    update: { isActive: true },
  });

  if (cumplEnIn022) {
    // El cumplimiento es el mismo hecho real, solo estaba colgando de la
    // tarea equivocada: se repunta en vez de duplicarlo.
    await prisma.compliance.update({
      where: { id: cumplEnIn022.id },
      data: {
        taskId: bearpawsTask.id,
        nextDueHours: Number(cumplEnIn022.aircraftHoursAtCompliance) + BEARPAWS.intervalHours,
        nextDueDate: (() => {
          const d = new Date(cumplEnIn022.performedAt);
          d.setMonth(d.getMonth() + BEARPAWS.intervalCalendarMonths);
          return d;
        })(),
      },
    });
  }
  if (in022) {
    await prisma.aircraftTask.updateMany({
      where: { aircraftId: aircraft.id, taskId: in022.id },
      data: {
        isActive: false,
        applicabilityNotes: `No corresponde: es el Bearpaws P/N D066-1001-013 (400 h). Esta aeronave lleva el Bear Paws BP44 de Helitowcart, controlado en ${BEARPAWS.code}.`,
        applicabilityChangedAt: new Date(),
      },
    });
  }
  console.log(`  ✓ ${BEARPAWS.code} (y ${BEARPAWS.reemplazaA} marcada como no correspondiente)`);

  // 2. AD del motor
  if (adTask) {
    if (adCumpl) {
      await prisma.compliance.update({
        where: { id: adCumpl.id },
        data: { nextDueHours: AD_MOTOR.limiteHorasMotor },
      });
    } else {
      await prisma.compliance.create({
        data: {
          organizationId: org.id, aircraftId: aircraft.id, taskId: adTask.id,
          performedById: performer.id,
          performedAt: new Date(AD_MOTOR.instalacion.fecha),
          aircraftHoursAtCompliance: AD_MOTOR.instalacion.horasMotor,
          aircraftCyclesAtCompliance: 0,
          // Fijo, no derivado del intervalo de la tarea: la comparte CC-AVK.
          nextDueHours: AD_MOTOR.limiteHorasMotor,
          applicationType: 'application',
          status: 'COMPLETED',
          notes: `Inicio del conteo desde motor nuevo. Acción terminal pendiente: remover el 4th Stage Turbine Wheel `
            + `P/N RR30000240 al alcanzar ${AD_MOTOR.limiteHorasMotor} h de motor. Importado de bitácora electrónica (${REGISTRATION})`,
        },
      });
    }
    console.log(`  ✓ ${adTask.code} → vence a ${AD_MOTOR.limiteHorasMotor} h de motor`);
  }

  console.log('\n✅ Correcciones aplicadas.');
}

main()
  .catch((err) => {
    console.error('fix_ccaky_bearpaws_and_ad failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
