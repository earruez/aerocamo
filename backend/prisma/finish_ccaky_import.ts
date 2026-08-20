/**
 * finish_ccaky_import.ts
 *
 * Cierra los tres pendientes de la carga de CC-AKY:
 *
 *   1. AD 2022-10-06 (enmienda 39-22044) del motor — remoción de la 4ª etapa
 *      de turbina a las 2025 h de motor. Se crea como tarea AD propia para
 *      que aparezca en el listado de directivas, aunque el componente
 *      COMP-...RR30000240 ya controle el mismo límite: en una auditoría la
 *      AD se busca donde están las AD.
 *
 *   2. Los dos ICA (ítems 19 y 20 de "Prog. Cump. Insp. Aer") enlazados a las
 *      tareas IN-020 e IN-022 que ya existen, con sus cumplimientos.
 *
 *   3. Batería del ELT: la bitácora declara vencimiento el 2025-11-30, que no
 *      es instalación + 72 meses — es la fecha impresa en la batería, que es
 *      la que manda. Se corrige el vencimiento calculado.
 *
 * Uso:
 *   npx tsx prisma/finish_ccaky_import.ts --org-slug tecnicopters \
 *     --registration CC-AKY --performed-by "Griselle" [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { ComplianceDueDateService } from '../src/domain/services/ComplianceDueDateService';

const prisma = new PrismaClient();
const dueService = new ComplianceDueDateService();
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

/** Los ICA de la bitácora, contra las tareas que ya existen en la empresa. */
const ICA = [
  {
    code: 'IN-020',
    descripcion: 'ICA Proyecto Técnico AR/AKY-01 (100 h / 12 meses)',
    fecha: '2025-02-06', horas: 956.77, ciclos: 1316,
  },
  {
    code: 'IN-022',
    descripcion: 'ICA Doc. 314-0011-00 Rev. E — Bear Paws BP44 (Helitowcart)',
    fecha: '2024-11-04', horas: 922.14, ciclos: 1269,
    // La bitácora declara 300 h y la tarea existente está en 400 h.
    advertencia: 'La bitácora declara cada 300 h; la tarea IN-022 existente está en 400 h. Se enlaza igual por indicación del operador — conviene revisar cuál intervalo rige.',
  },
];

const AD_MOTOR = {
  code: 'AD-2022-10-06',
  referenceNumber: '2022-10-06',
  title: 'AD 2022-10-06 (enm. 39-22044) — Turbine Section, 4th Stage Turbine Wheel',
  description: 'Acción terminal: remover el 4th Stage Turbine Wheel P/N RR30000240 a las 2025 horas de motor. '
    + 'Efectividad 2022-06-28. El mismo límite lo controla también la tarea de componente del P/N RR30000240 (S/N X609125).',
  limiteHorasMotor: 2025,
  /** La rueda se instaló con el motor nuevo: el conteo parte de ahí. */
  instalacion: { fecha: '2012-04-20', horasMotor: 0 },
};

const ELT_PART_NUMBER = '0141823';
const ELT_VENCIMIENTO_REAL = '2025-11-30';

function toTaskInput(t: {
  id: string; organizationId: string; code: string; title: string; description: string;
  intervalType: string; intervalHours: unknown; intervalCycles: number | null;
  intervalCalendarDays: number | null; intervalCalendarMonths: number | null;
  toleranceHours: unknown; toleranceCycles: number | null; toleranceCalendarDays: number | null;
  referenceNumber: string | null; referenceType: string; isMandatory: boolean;
  estimatedManHours: unknown; requiresInspection: boolean; applicableModel: string | null;
  applicablePartNumber: string | null; isActive: boolean; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: t.id, organizationId: t.organizationId, code: t.code, title: t.title,
    description: t.description, intervalType: t.intervalType as never,
    intervalHours: t.intervalHours != null ? Number(t.intervalHours) : null,
    intervalCycles: t.intervalCycles, intervalCalendarDays: t.intervalCalendarDays,
    intervalCalendarMonths: t.intervalCalendarMonths,
    toleranceHours: t.toleranceHours != null ? Number(t.toleranceHours) : null,
    toleranceCycles: t.toleranceCycles, toleranceCalendarDays: t.toleranceCalendarDays,
    referenceNumber: t.referenceNumber, referenceType: t.referenceType as never,
    isMandatory: t.isMandatory,
    estimatedManHours: t.estimatedManHours != null ? Number(t.estimatedManHours) : null,
    requiresInspection: t.requiresInspection, applicableModel: t.applicableModel,
    applicablePartNumber: t.applicablePartNumber, isActive: t.isActive,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY}"`);

  console.log(`\n=== Cierre de la carga de ${REGISTRATION} ===`);
  console.log(`A nombre de: ${performer.name}\n`);

  // ── 1. AD del motor ────────────────────────────────────────────────────
  const adExistente = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, code: AD_MOTOR.code },
    select: { id: true },
  });
  console.log('1) AD del motor');
  if (adExistente) {
    console.log(`   Ya existe ${AD_MOTOR.code} (misma directiva, mismo motor 250-C300/A1, hoy en CC-AVK).`);
    console.log(`   Se enlaza ${REGISTRATION} a esa misma tarea, sin duplicarla.`);
  } else {
    console.log(`   Se crea ${AD_MOTOR.code}: ${AD_MOTOR.title}`);
    console.log(`   Límite ${AD_MOTOR.limiteHorasMotor} h de motor.`);
  }
  console.log('   Queda SIN cumplimiento: la bitácora la declara pendiente (acción terminal a las');
  console.log(`   ${AD_MOTOR.limiteHorasMotor} h). El límite exigible lo lleva el componente P/N RR30000240.`);

  // ── 2. Los dos ICA ─────────────────────────────────────────────────────
  console.log('\n2) ICA');
  const icaTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, code: { in: ICA.map((i) => i.code) } },
  });
  const icaByCode = new Map(icaTasks.map((t) => [t.code, t]));
  for (const ica of ICA) {
    const t = icaByCode.get(ica.code);
    if (!t) { console.log(`   ⚠️  no existe la tarea ${ica.code} — se omite`); continue; }
    const due = dueService.calculate(toTaskInput(t), ica.horas, ica.ciclos, new Date(ica.fecha));
    console.log(`   [${ica.code}] ${ica.descripcion}`);
    console.log(`       cumplido ${ica.fecha} a ${ica.horas} h → próximo: ${due.nextDueHours ?? '—'} h / ${due.nextDueDate ? due.nextDueDate.toISOString().slice(0, 10) : '—'}`);
    if (ica.advertencia) console.log(`       ⚠️  ${ica.advertencia}`);
  }

  // ── 3. Batería del ELT ─────────────────────────────────────────────────
  console.log('\n3) Batería del ELT');
  const eltTask = await prisma.maintenanceTask.findFirst({
    where: { organizationId: org.id, applicablePartNumber: ELT_PART_NUMBER, aircraftLinks: { some: { aircraftId: aircraft.id } } },
    select: { id: true, code: true, title: true },
  });
  const eltCompliance = eltTask
    ? await prisma.compliance.findFirst({
        where: { aircraftId: aircraft.id, taskId: eltTask.id },
        select: { id: true, nextDueDate: true },
      })
    : null;
  if (!eltTask || !eltCompliance) {
    console.log(`   ⚠️  no se encontró el control de la batería (P/N ${ELT_PART_NUMBER}) en ${REGISTRATION} — se omite`);
  } else {
    console.log(`   [${eltTask.code}] ${eltTask.title}`);
    console.log(`       vencimiento: ${eltCompliance.nextDueDate?.toISOString().slice(0, 10) ?? '—'} → ${ELT_VENCIMIENTO_REAL} (fecha impresa en la batería)`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  // 1. AD del motor
  const adTask = adExistente
    ? await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: adExistente.id } })
    : await prisma.maintenanceTask.create({
        data: {
          organizationId: org.id,
          code: AD_MOTOR.code,
          title: AD_MOTOR.title,
          description: AD_MOTOR.description,
          intervalType: 'FLIGHT_HOURS',
          intervalHours: AD_MOTOR.limiteHorasMotor,
          referenceType: 'AD',
          referenceNumber: AD_MOTOR.referenceNumber,
          complianceRecurrence: 'ONE_TIME',
          equipmentScope: 'ENGINE',
          isMandatory: true,
          applicableModel: 'R66',
          applicablePartNumber: 'RR30000240',
        },
      });

  await prisma.aircraftTask.upsert({
    where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: adTask.id } },
    create: { aircraftId: aircraft.id, taskId: adTask.id, isActive: true },
    update: { isActive: true },
  });

  // Sin cumplimiento a propósito: la bitácora la declara PENDIENTE (acción
  // terminal a las 2025 h de motor, columna CUMPLIMIENTO en "N/A"). Registrar
  // un cumplimiento la daría por hecha. El límite exigible lo lleva la tarea
  // de componente del P/N RR30000240, que sí sabe qué rueda está instalada.
  console.log(`  ✓ ${AD_MOTOR.code} (enlazada, sin cumplimiento: sigue pendiente)`);

  // 2. ICA
  for (const ica of ICA) {
    const t = icaByCode.get(ica.code);
    if (!t) continue;
    await prisma.aircraftTask.upsert({
      where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: t.id } },
      create: { aircraftId: aircraft.id, taskId: t.id, isActive: true },
      update: { isActive: true },
    });
    const ya = await prisma.compliance.findFirst({
      where: { aircraftId: aircraft.id, taskId: t.id, performedAt: new Date(ica.fecha) },
      select: { id: true },
    });
    if (!ya) {
      const due = dueService.calculate(toTaskInput(t), ica.horas, ica.ciclos, new Date(ica.fecha));
      await prisma.compliance.create({
        data: {
          organizationId: org.id, aircraftId: aircraft.id, taskId: t.id,
          performedById: performer.id,
          performedAt: new Date(ica.fecha),
          aircraftHoursAtCompliance: ica.horas,
          aircraftCyclesAtCompliance: ica.ciclos,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
          applicationType: 'application',
          status: 'COMPLETED',
          notes: `Importado de bitácora electrónica (${REGISTRATION}) — ${ica.descripcion}`,
        },
      });
    }
    console.log(`  ✓ ${ica.code}`);
  }

  // 3. ELT
  if (eltTask && eltCompliance) {
    await prisma.compliance.update({
      where: { id: eltCompliance.id },
      data: {
        nextDueDate: new Date(ELT_VENCIMIENTO_REAL),
        notes: `Vencimiento según la fecha impresa en la batería (${ELT_VENCIMIENTO_REAL}), no instalación + 72 meses. Importado de bitácora electrónica (${REGISTRATION})`,
      },
    });
    console.log(`  ✓ batería ELT → ${ELT_VENCIMIENTO_REAL}`);
  }

  console.log('\n✅ Cierre completado.');
}

main()
  .catch((err) => {
    console.error('finish_ccaky_import failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
