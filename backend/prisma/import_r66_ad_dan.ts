/**
 * import_r66_ad_dan.ts
 *
 * Carga las AD (Directivas de Aeronavegabilidad) de célula y las DAN
 * (normativa nacional DGAC) del Robinson R66, extraídas a mano de la
 * bitácora electrónica de CC-AKY, en dos lugares:
 *
 *   1. Como MaintenanceTemplateTask en la plantilla correspondiente
 *      (ROBINSON R66 para las AD de célula; DGAC R66 — se crea si no
 *      existe — para las DAN), para que quede reutilizable en otras
 *      aeronaves R66 de la empresa.
 *   2. Como MaintenanceTask + AircraftTask + Compliance reales para
 *      CC-AKY, con la fecha/horas/ciclos de cumplimiento exactos que trae
 *      el Excel — no una línea base sintética.
 *
 * Las AD marcadas "N/A" para esta aeronave (no aplican por modelo/S-N)
 * se cargan igual, pero inactivas (isActive=false, sin Compliance) —
 * quedan documentadas sin generar vencimientos.
 *
 * NOTA: la AD de motor 39-22044 (Turbine Section) queda deliberadamente
 * fuera — su periodicidad en el Excel es un umbral absoluto de horas
 * ("pendiente a las 2025 hrs"), no un intervalo, y requiere una decisión
 * aparte antes de modelarla.
 *
 * Uso:
 *   npx tsx prisma/import_r66_ad_dan.ts --org-slug tecnicopters --registration CC-AKY --performed-by "Griselle Pasmiño" [--apply]
 */
import { PrismaClient, ReferenceType, TaskIntervalType, ComplianceRecurrence } from '@prisma/client';

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
const PERFORMED_BY_NAME = getArgValue('--performed-by');
const APPLY = args.includes('--apply');

interface ItemDef {
  code: string;
  title: string;
  description: string;
  referenceNumber: string;
  intervalType: TaskIntervalType;
  intervalCalendarMonths?: number;
  complianceRecurrence: ComplianceRecurrence;
  isActive: boolean;
  /** Si tiene cumplimiento real, se crea el Compliance con estos datos. */
  compliance?: { performedAt: string; hours: number; cycles: number };
}

// ── AD de célula (célula) → plantilla ROBINSON R66, referenceType AD ───────
const CELULA_AD: ItemDef[] = [
  {
    code: 'AD-39-22681', title: 'AD 39-22681 — Tail Rotor Blades',
    description: 'Acción terminal. Reemplazo de Tail Rotor Blades. Aplica a CC-AKY.',
    referenceNumber: '39-22681', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: true,
    compliance: { performedAt: '2025-06-25', hours: 1033.6, cycles: 1394 },
  },
  {
    code: 'AD-39-21433', title: 'AD 39-21433 — Tail Rotor Drive Shaft',
    description: 'Aplica a los R66 con Tail Rotor Drive Shaft afectado.',
    referenceNumber: '39-21433', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: true,
    compliance: { performedAt: '2021-10-29', hours: 618.6, cycles: 920 },
  },
  {
    code: 'AD-39-19613', title: 'AD 39-19613 — Engine Oil Storage (Airframe Furnished)',
    description: 'Aplica a los R66 S/N 0003 hasta 0789, y otros según AD.',
    referenceNumber: '39-19613', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: true,
    compliance: { performedAt: '2019-11-22', hours: 483.3, cycles: 754 },
  },
  {
    code: 'AD-39-18762', title: 'AD 39-18762 — Main Rotor Blades',
    description: 'Aplica a Main Rotor Blade F016-2 Rev. A y anteriores.',
    referenceNumber: '39-18762', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: true,
    compliance: { performedAt: '2017-11-17', hours: 324, cycles: 532 },
  },
  // No aplican a esta aeronave — se cargan inactivas, sin Compliance.
  {
    code: 'AD-39-22866', title: 'AD 39-22866 — Emergency Equipment (Emergency Flotation)',
    description: 'No aplica a CC-AKY — aplica a los Robinson Model R44 helicopters.',
    referenceNumber: '39-22866', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: false,
  },
  {
    code: 'AD-39-22453', title: 'AD 39-22453 — Ground Proximity System',
    description: 'No aplica a CC-AKY — no tiene instalado el equipo Radio Altímetro.',
    referenceNumber: '39-22453', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: false,
  },
  {
    code: 'AD-39-22181', title: 'AD 39-22181 — Tail Rotor Blades',
    description: 'No aplica a CC-AKY — aplica a Tail Rotor Blades P/N F029-1 con S/N distinto al instalado.',
    referenceNumber: '39-22181', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: false,
  },
  {
    code: 'AD-39-18-801', title: 'AD 2017-04-06 — United Instruments Inc. (Altímetro)',
    description: 'No aplica a CC-AKY — no aplica por número de serie del altímetro instalado (S/N 5934).',
    referenceNumber: '39-18-801', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: false,
  },
  {
    code: 'AD-39-2028', title: 'AD 74-24-13 — United Instruments Inc. (Altímetro)',
    description: 'No aplica a CC-AKY — no aplica por número de serie del altímetro instalado.',
    referenceNumber: '39-2028', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: false,
  },
  {
    code: 'AD-39-5317', title: 'AD 86-05-02 — United Instruments Inc. (Altímetro)',
    description: 'No aplica a CC-AKY — no aplica por número de serie del altímetro instalado.',
    referenceNumber: '39-5317', intervalType: 'ON_CONDITION', complianceRecurrence: 'ONE_TIME', isActive: false,
  },
];

// ── DAN nacionales → plantilla DGAC R66 (se crea si no existe), referenceType INTERNAL ──
const DAN_ITEMS: ItemDef[] = [
  {
    code: 'DAN-96-01', title: 'DA 96-01 R1 — Marca de Identificación de Fluidos',
    description: 'Marca de identificación de fluidos. Periodicidad 12 meses.',
    referenceNumber: 'DA 96-01 R1', intervalType: 'CALENDAR_DAYS', intervalCalendarMonths: 12, complianceRecurrence: 'REPETITIVE', isActive: true,
    compliance: { performedAt: '2024-11-04', hours: 922.14, cycles: 1269 },
  },
  {
    code: 'DAN-135-1113F4II', title: 'DAN 135 Vol.II 135.1113(f)(4)(ii) — Peso y Balance',
    description: 'Peso y balance. Periodicidad: cuando se requiera.',
    referenceNumber: '135.1113(f)(4)(ii)', intervalType: 'ON_CONDITION', complianceRecurrence: 'ON_CONDITION', isActive: true,
    compliance: { performedAt: '2024-01-30', hours: 806.03, cycles: 1132 },
  },
  {
    code: 'DAN-135-1113B', title: 'DAN 135 Vol.II 135.1113(b) — ATC Transponder',
    description: 'Inspección de transponder ATC. Periodicidad 24 meses.',
    referenceNumber: '135.1113(b)', intervalType: 'CALENDAR_DAYS', intervalCalendarMonths: 24, complianceRecurrence: 'REPETITIVE', isActive: true,
    compliance: { performedAt: '2023-10-23', hours: 753.24, cycles: 1087 },
  },
  {
    code: 'DAN-135-1113E', title: 'DAN 135 Vol.II 135.1113(e) — Inspección ELT',
    description: 'Inspección de ELT (localizador de emergencia). Periodicidad 12 meses.',
    referenceNumber: '135.1113(e)', intervalType: 'CALENDAR_DAYS', intervalCalendarMonths: 12, complianceRecurrence: 'REPETITIVE', isActive: true,
    compliance: { performedAt: '2024-11-04', hours: 922.14, cycles: 1269 },
  },
  {
    code: 'DAN-135-1113A', title: 'DAN 135 Vol.II 135.1113(a) — Altímetro-Pitot',
    description: 'Inspección de sistema altímetro-pitot. Periodicidad: cuando se requiera. '
      + 'Cumplimiento original (2013-12-16) es anterior al historial de horas disponible en la bitácora — se usa 0/0 como aproximación.',
    referenceNumber: '135.1113(a)', intervalType: 'ON_CONDITION', complianceRecurrence: 'ON_CONDITION', isActive: true,
    compliance: { performedAt: '2013-12-16', hours: 0, cycles: 0 },
  },
  {
    code: 'DAN-135-407B1I', title: 'DAN 135 Vol.II 135.407(b)(1)(i) — Botiquín de Primeros Auxilios',
    description: 'Botiquín de primeros auxilios. Periodicidad 12 meses.',
    referenceNumber: '135.407(b)(1)(i)', intervalType: 'CALENDAR_DAYS', intervalCalendarMonths: 12, complianceRecurrence: 'REPETITIVE', isActive: true,
    compliance: { performedAt: '2024-11-04', hours: 922.14, cycles: 1269 },
  },
  {
    code: 'DAN-135-407B1II', title: 'DAN 135 Vol.II 135.407(b)(1)(ii) — Extintor',
    description: 'Extintor. Periodicidad 12 meses.',
    referenceNumber: '135.407(b)(1)(ii)', intervalType: 'CALENDAR_DAYS', intervalCalendarMonths: 12, complianceRecurrence: 'REPETITIVE', isActive: true,
    compliance: { performedAt: '2024-11-04', hours: 922.14, cycles: 1269 },
  },
  {
    code: 'DAN-43-D-B', title: 'DAN 43 Apéndice D Párr.(b) — Compás Magnético',
    description: 'Compás magnético. Periodicidad: cuando se requiera.',
    referenceNumber: 'DAN 43 Ap. D (b)', intervalType: 'ON_CONDITION', complianceRecurrence: 'ON_CONDITION', isActive: true,
    compliance: { performedAt: '2022-07-18', hours: 662.4, cycles: 978 },
  },
];

function addMonths(dateStr: string, months: number): Date {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function main(): Promise<void> {
  if (!PERFORMED_BY_NAME) {
    console.error('Uso: --org-slug tecnicopters --registration CC-AKY --performed-by "Nombre Apellido" [--apply]');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({ where: { organizationId: org.id, registration: REGISTRATION } });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY_NAME, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY_NAME}" en ${ORG_SLUG}`);
  console.log(`Cumplimientos se atribuirán a: ${performer.name} (${performer.id})`);

  const robinsonR66 = await prisma.maintenanceTemplate.findFirst({ where: { organizationId: org.id, manufacturer: 'ROBINSON', model: 'R66' } });
  if (!robinsonR66) throw new Error('No existe la plantilla ROBINSON R66');

  let dgacR66 = await prisma.maintenanceTemplate.findFirst({ where: { organizationId: org.id, manufacturer: 'DGAC', model: 'R66' } });
  if (!dgacR66) {
    console.log('No existe la plantilla DGAC R66 — se creará.');
  }

  const plan: Array<{ item: ItemDef; templateName: string; templateId: string | null }> = [
    ...CELULA_AD.map((item) => ({ item, templateName: 'ROBINSON R66', templateId: robinsonR66!.id as string | null })),
    ...DAN_ITEMS.map((item) => ({ item, templateName: 'DGAC R66', templateId: dgacR66?.id ?? null })),
  ];

  console.log(`\n=== Plan: ${plan.length} tareas (${plan.filter((p) => p.item.isActive).length} activas, ${plan.filter((p) => !p.item.isActive).length} inactivas/N-A) ===`);
  for (const { item, templateName } of plan) {
    const complianceStr = item.compliance ? `— cumplida ${item.compliance.performedAt} (${item.compliance.hours}h/${item.compliance.cycles}c)` : '— sin cumplimiento (pendiente)';
    console.log(`  [${item.isActive ? 'ACTIVA' : 'inactiva'}] ${templateName} / ${item.code}: ${item.title} ${item.isActive ? complianceStr : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (!dgacR66) {
      dgacR66 = await tx.maintenanceTemplate.create({
        data: { organizationId: org.id, manufacturer: 'DGAC', model: 'R66', description: 'Normativa nacional (DGAC) para R66', version: '1.0' },
      });
      console.log(`Plantilla DGAC R66 creada (id ${dgacR66.id}).`);
    }

    for (const { item, templateId: tId } of plan) {
      const templateId = tId ?? dgacR66!.id;
      const referenceType: ReferenceType = item.code.startsWith('DAN-') ? 'INTERNAL' : 'AD';

      // 1) MaintenanceTemplateTask (biblioteca reutilizable)
      await tx.maintenanceTemplateTask.upsert({
        where: { templateId_code: { templateId, code: item.code } },
        create: {
          templateId, code: item.code, title: item.title, description: item.description,
          intervalType: item.intervalType, intervalCalendarMonths: item.intervalCalendarMonths,
          referenceNumber: item.referenceNumber, referenceType, isMandatory: true, isActive: item.isActive,
        },
        update: {},
      });

      // 2) MaintenanceTask real para la aeronave
      const task = await tx.maintenanceTask.upsert({
        where: { code_organizationId: { code: item.code, organizationId: org.id } },
        create: {
          organizationId: org.id, code: item.code, title: item.title, description: item.description,
          intervalType: item.intervalType, intervalCalendarMonths: item.intervalCalendarMonths,
          referenceNumber: item.referenceNumber, referenceType, isMandatory: true, isActive: item.isActive,
          complianceRecurrence: item.complianceRecurrence, applicableModel: 'R66',
        },
        update: {},
      });

      await tx.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: task.id } },
        create: { aircraftId: aircraft.id, taskId: task.id, isActive: item.isActive },
        update: {},
      });

      // 3) Compliance real, si corresponde (no para las inactivas/N-A ni la pendiente de motor)
      if (item.compliance) {
        const existing = await tx.compliance.findFirst({ where: { aircraftId: aircraft.id, taskId: task.id } });
        if (!existing) {
          const nextDueDate = item.intervalCalendarMonths
            ? addMonths(item.compliance.performedAt, item.intervalCalendarMonths)
            : null;
          await tx.compliance.create({
            data: {
              organizationId: org.id, aircraftId: aircraft.id, taskId: task.id,
              performedById: performer.id,
              performedAt: new Date(item.compliance.performedAt),
              aircraftHoursAtCompliance: item.compliance.hours,
              aircraftCyclesAtCompliance: item.compliance.cycles,
              nextDueDate,
              applicationType: 'application',
              status: 'COMPLETED',
              notes: `Importado de bitácora electrónica (${REGISTRATION})`,
            },
          });
        }
      }
    }
  });

  console.log('\n✅ Importado.');
}

main()
  .catch((err) => {
    console.error('import_r66_ad_dan failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
