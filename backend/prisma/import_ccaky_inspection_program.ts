/**
 * import_ccaky_inspection_program.ts
 *
 * Carga el programa de inspecciones real de CC-AKY desde la hoja
 * "Prog. Cump. Insp. Aer" de su bitácora electrónica.
 *
 * Las 20 tareas de ese programa YA existen en la organización como IN-* —
 * se importaron del Access y las usa CC-AVK, el otro R66. Así que esto NO
 * crea tareas nuevas: enlaza CC-AKY a las mismas y le carga SUS
 * cumplimientos (fecha + horas + ciclos que declara su propia bitácora).
 * Un registro por directiva/inspección para toda la flota, cada aeronave
 * con su propio historial.
 *
 * Las 6 que la bitácora marca "N/A sistema no instalado" se enlazan igual
 * pero como "No aplica", con el motivo — la excepción queda auditable en vez
 * de simplemente ausente.
 *
 * Uso:
 *   npx tsx prisma/import_ccaky_inspection_program.ts \
 *     --org-slug tecnicopters --registration CC-AKY --performed-by "Griselle" [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { ComplianceDueDateService } from '../src/domain/services/ComplianceDueDateService';
import { BASELINE_NOTE } from '../src/domain/services/BaselineComplianceService';

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

interface ProgramItem {
  code: string;
  descripcion: string;
  /** Cumplimiento real declarado en la bitácora. */
  cumplimiento?: { fecha: string; horas: number; ciclos: number };
  /** Si no aplica a esta aeronave, el motivo textual de la bitácora. */
  noAplica?: string;
}

/** Hoja "Prog. Cump. Insp. Aer" — 20 ítems, con las horas verificadas contra
 *  el registro de horas de la misma bitácora. */
const PROGRAM: ProgramItem[] = [
  { code: 'IN-006-R66', descripcion: 'Replace main gearbox oil filter (§12-12)', cumplimiento: { fecha: '2020-12-04', horas: 541.4, ciclos: 816 } },
  { code: 'IN-002-R66', descripcion: 'Inspección 100 horas / anual (§5-45)', cumplimiento: { fecha: '2025-02-06', horas: 956.77, ciclos: 1316 } },
  { code: 'IN-003-R66', descripcion: 'Main rotor blade tip maintenance (§62-60)', cumplimiento: { fecha: '2025-02-06', horas: 956.77, ciclos: 1316 } },
  { code: 'IN-004-R66', descripcion: 'Service inlet barrier filter (§71-21)', noAplica: 'Sistema no instalado en esta aeronave (inlet barrier filter).' },
  { code: 'IN-005-R66', descripcion: 'Replace 9v back-up batteries', noAplica: 'No posee batería de litio: la tarea aplica solo a helicópteros con batería principal de litio.' },
  { code: 'IN-007-R66', descripcion: 'Replace main gearbox oil (§12-11)', cumplimiento: { fecha: '2020-12-04', horas: 541.4, ciclos: 816 } },
  { code: 'IN-008-R66', descripcion: 'Drain and flush tail rotor gearbox (§12-23)', cumplimiento: { fecha: '2020-12-04', horas: 541.4, ciclos: 816 } },
  { code: 'IN-009-R66', descripcion: 'Replace hydraulic filter (§12-32)', cumplimiento: { fecha: '2020-12-04', horas: 541.4, ciclos: 816 } },
  { code: 'IN-010', descripcion: 'Clean gearbox chip detectors (§12-13 y 12-22)', cumplimiento: { fecha: '2024-11-04', horas: 922.14, ciclos: 1269 } },
  { code: 'IN-011', descripcion: 'Lubricate swashplate bearings (§12-90)', cumplimiento: { fecha: '2020-12-04', horas: 541.4, ciclos: 816 } },
  { code: 'IN-012', descripcion: 'Inspección 2000 horas / 12 años (§5-50)', cumplimiento: { fecha: '2013-09-04', horas: 0, ciclos: 0 } },
  { code: 'IN-013', descripcion: 'Main gearbox internal visual inspection (§5-74)', cumplimiento: { fecha: '2024-11-04', horas: 922.14, ciclos: 1269 } },
  { code: 'IN-014', descripcion: 'Pop-out float leak check (§32-64 A)', noAplica: 'Sistema no instalado en esta aeronave (pop-out floats).' },
  { code: 'IN-015', descripcion: 'Replace cockpit camera battery (§96-120 C)', noAplica: 'Sistema no instalado en esta aeronave (cámara de cabina).' },
  { code: 'IN-016', descripcion: 'Test and inspect transponder (14 CFR §91.413)', cumplimiento: { fecha: '2023-10-23', horas: 753.24, ciclos: 1087 } },
  { code: 'IN-017', descripcion: 'Pop-out float inflation check (§32-64 B)', noAplica: 'Sistema no instalado en esta aeronave (pop-out floats).' },
  { code: 'IN-018', descripcion: 'Pop-out float pressure cylinder hydrostatic test', noAplica: 'Sistema no instalado en esta aeronave (pop-out floats).' },
  { code: 'IN-019', descripcion: 'Pop-out float pressure cylinder — vida límite 15 años', noAplica: 'Sistema no instalado en esta aeronave (pop-out floats).' },
];

/** Los dos ICA de la bitácora no tienen equivalente claro entre las IN-*:
 *  se informan para cargarlos a mano, no se inventa el cruce. */
const SIN_EQUIVALENTE = [
  'Ítem 19 — ICA Proyecto Técnico AR/AKY-01 (100 h / 12 m), cumplido 2025-02-06 a 956.77 h. Candidato: IN-020 (Cargo Hook Suspension System, 100h/12m), sin confirmar.',
  'Ítem 20 — ICA Doc. 314-0011-00 Rev. E, Bear Paws BP44 (300 h / 12 m), cumplido 2024-11-04 a 922.14 h. Candidato: IN-022 (Bearpaws, 400 h), intervalo distinto.',
];

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

  const tasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, code: { in: PROGRAM.map((p) => p.code) } },
  });
  const byCode = new Map(tasks.map((t) => [t.code, t]));

  console.log(`\n=== Programa de inspecciones de ${REGISTRATION} ===`);
  console.log(`Cumplimientos a nombre de: ${performer.name}\n`);

  const faltantes = PROGRAM.filter((p) => !byCode.has(p.code));
  if (faltantes.length) {
    console.log(`⚠️  No existen en la organización: ${faltantes.map((f) => f.code).join(', ')}`);
    console.log('   (se omiten — habría que revisarlas aparte)\n');
  }

  const plan = PROGRAM.filter((p) => byCode.has(p.code));
  for (const p of plan) {
    const t = byCode.get(p.code)!;
    if (p.noAplica) {
      console.log(`  [${p.code}] NO APLICA — ${p.descripcion}`);
      console.log(`      ${p.noAplica}`);
    } else {
      const c = p.cumplimiento!;
      const due = dueService.calculate(
        {
          id: t.id, organizationId: t.organizationId, code: t.code, title: t.title,
          description: t.description, intervalType: t.intervalType,
          intervalHours: t.intervalHours != null ? Number(t.intervalHours) : null,
          intervalCycles: t.intervalCycles, intervalCalendarDays: t.intervalCalendarDays,
          intervalCalendarMonths: t.intervalCalendarMonths,
          toleranceHours: t.toleranceHours != null ? Number(t.toleranceHours) : null,
          toleranceCycles: t.toleranceCycles, toleranceCalendarDays: t.toleranceCalendarDays,
          referenceNumber: t.referenceNumber, referenceType: t.referenceType,
          isMandatory: t.isMandatory,
          estimatedManHours: t.estimatedManHours != null ? Number(t.estimatedManHours) : null,
          requiresInspection: t.requiresInspection, applicableModel: t.applicableModel,
          applicablePartNumber: t.applicablePartNumber, isActive: t.isActive,
          createdAt: t.createdAt, updatedAt: t.updatedAt,
        },
        c.horas, c.ciclos, new Date(c.fecha),
      );
      console.log(`  [${p.code}] ${p.descripcion}`);
      console.log(`      cumplido ${c.fecha} a ${c.horas} h / ${c.ciclos} cy → próximo: ${due.nextDueHours ?? '—'} h / ${due.nextDueDate ? due.nextDueDate.toISOString().slice(0, 10) : '—'}`);
    }
  }

  console.log(`\n→ ${plan.filter((p) => p.cumplimiento).length} con cumplimiento real, ${plan.filter((p) => p.noAplica).length} marcadas "No aplica".`);
  console.log('\nSin equivalente automático (cargar a mano):');
  for (const s of SIN_EQUIVALENTE) console.log(`  · ${s}`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  for (const p of plan) {
    const t = byCode.get(p.code)!;
    await prisma.$transaction(async (tx) => {
      await tx.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: t.id } },
        create: {
          aircraftId: aircraft.id, taskId: t.id,
          isActive: !p.noAplica,
          applicabilityNotes: p.noAplica ?? null,
          applicabilityChangedAt: p.noAplica ? new Date() : null,
        },
        update: p.noAplica
          ? { isActive: false, applicabilityNotes: p.noAplica, applicabilityChangedAt: new Date() }
          : { isActive: true },
      });

      if (!p.cumplimiento) return;

      // Una línea base creada al asignar la plantilla tendría fecha de hoy y
      // le ganaría al cumplimiento real de la bitácora, que es anterior.
      await tx.compliance.deleteMany({
        where: {
          aircraftId: aircraft.id, taskId: t.id,
          OR: [{ applicationType: 'baseline' }, { notes: BASELINE_NOTE }],
        },
      });

      const c = p.cumplimiento;
      const yaEsta = await tx.compliance.findFirst({
        where: { aircraftId: aircraft.id, taskId: t.id, performedAt: new Date(c.fecha) },
        select: { id: true },
      });
      if (yaEsta) return;

      const due = dueService.calculate(
        {
          id: t.id, organizationId: t.organizationId, code: t.code, title: t.title,
          description: t.description, intervalType: t.intervalType,
          intervalHours: t.intervalHours != null ? Number(t.intervalHours) : null,
          intervalCycles: t.intervalCycles, intervalCalendarDays: t.intervalCalendarDays,
          intervalCalendarMonths: t.intervalCalendarMonths,
          toleranceHours: t.toleranceHours != null ? Number(t.toleranceHours) : null,
          toleranceCycles: t.toleranceCycles, toleranceCalendarDays: t.toleranceCalendarDays,
          referenceNumber: t.referenceNumber, referenceType: t.referenceType,
          isMandatory: t.isMandatory,
          estimatedManHours: t.estimatedManHours != null ? Number(t.estimatedManHours) : null,
          requiresInspection: t.requiresInspection, applicableModel: t.applicableModel,
          applicablePartNumber: t.applicablePartNumber, isActive: t.isActive,
          createdAt: t.createdAt, updatedAt: t.updatedAt,
        },
        c.horas, c.ciclos, new Date(c.fecha),
      );

      await tx.compliance.create({
        data: {
          organizationId: org.id, aircraftId: aircraft.id, taskId: t.id,
          performedById: performer.id,
          performedAt: new Date(c.fecha),
          aircraftHoursAtCompliance: c.horas,
          aircraftCyclesAtCompliance: c.ciclos,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
          applicationType: 'application',
          status: 'COMPLETED',
          notes: `Importado de bitácora electrónica (${REGISTRATION}) — Prog. Cump. Insp. Aer`,
        },
      });
    });
    console.log(`  ✓ ${p.code}`);
  }

  console.log('\n✅ Programa de inspecciones cargado.');
}

main()
  .catch((err) => {
    console.error('import_ccaky_inspection_program failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
