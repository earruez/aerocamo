/**
 * reanchor_baselines.ts
 *
 * "Inicio de control" significa que el control de esa tarea empieza con la
 * aeronave en el estado que tiene hoy — no en cero. Pero la línea base se
 * crea al asignar la plantilla, anclada a las horas de ESE momento: si el
 * historial de horas se importa después, quedan ancladas en 0 y el plan
 * entero aparece vencido. En CC-AKY: 310 líneas base en 0 h con la aeronave
 * en 1051 h, de las cuales 255 figuraban vencidas sin estarlo.
 *
 * Este script re-ancla las líneas base a las horas/ciclos actuales y
 * recalcula su próximo vencimiento con el mismo servicio que usa la app.
 * Solo toca cumplimientos de tipo "Inicio de control": los cumplimientos
 * reales (los de la bitácora) no se tocan.
 *
 * Uso:
 *   npx tsx prisma/reanchor_baselines.ts --org-slug tecnicopters --registration CC-AKY [--apply]
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
const REGISTRATION = getArgValue('--registration')?.trim().toUpperCase();
const APPLY = args.includes('--apply');

async function main(): Promise<void> {
  if (!REGISTRATION) {
    console.error('Uso: --org-slug tecnicopters --registration CC-AKY [--apply]');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true, totalFlightHours: true, totalCycles: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const horas = Number(aircraft.totalFlightHours);
  const ciclos = aircraft.totalCycles;

  const baselines = await prisma.compliance.findMany({
    where: {
      aircraftId: aircraft.id,
      OR: [{ applicationType: 'baseline' }, { notes: BASELINE_NOTE }],
    },
    select: {
      id: true, performedAt: true,
      aircraftHoursAtCompliance: true, aircraftCyclesAtCompliance: true,
      nextDueHours: true, nextDueCycles: true, nextDueDate: true,
      task: true,
    },
  });

  const desfasadas = baselines.filter((b) => Number(b.aircraftHoursAtCompliance) !== horas
    || b.aircraftCyclesAtCompliance !== ciclos);

  console.log(`\n=== Re-anclar líneas base de ${REGISTRATION} ===`);
  console.log(`Estado actual de la aeronave: ${horas} h · ${ciclos} ciclos\n`);
  console.log(`Líneas base encontradas: ${baselines.length}`);
  console.log(`Con ancla distinta a la actual: ${desfasadas.length}`);

  const vencidasAntes = baselines.filter((b) => b.nextDueHours != null && Number(b.nextDueHours) < horas).length;
  console.log(`Con vencimiento por horas ya superado (antes): ${vencidasAntes}`);

  // Se recalcula con el mismo servicio que usa la app, así el resultado es
  // idéntico al que habría salido de asignar la plantilla hoy.
  const recalculadas = desfasadas.map((b) => {
    const t = b.task;
    const due = dueService.calculate(
      {
        id: t.id, organizationId: t.organizationId, code: t.code, title: t.title,
        description: t.description, intervalType: t.intervalType,
        intervalHours: t.intervalHours != null ? Number(t.intervalHours) : null,
        intervalCycles: t.intervalCycles,
        intervalCalendarDays: t.intervalCalendarDays,
        intervalCalendarMonths: t.intervalCalendarMonths,
        toleranceHours: t.toleranceHours != null ? Number(t.toleranceHours) : null,
        toleranceCycles: t.toleranceCycles,
        toleranceCalendarDays: t.toleranceCalendarDays,
        referenceNumber: t.referenceNumber, referenceType: t.referenceType,
        isMandatory: t.isMandatory,
        estimatedManHours: t.estimatedManHours != null ? Number(t.estimatedManHours) : null,
        requiresInspection: t.requiresInspection,
        applicableModel: t.applicableModel, applicablePartNumber: t.applicablePartNumber,
        isActive: t.isActive, createdAt: t.createdAt, updatedAt: t.updatedAt,
      },
      horas,
      ciclos,
      b.performedAt,
    );
    return { id: b.id, code: t.code, antes: b.nextDueHours != null ? Number(b.nextDueHours) : null, due };
  });

  const vencidasDespues = recalculadas.filter((r) => r.due.nextDueHours != null && r.due.nextDueHours < horas).length;
  console.log(`Con vencimiento por horas ya superado (después): ${vencidasDespues}`);

  console.log('\nEjemplo de las primeras 8:');
  for (const r of recalculadas.slice(0, 8)) {
    console.log(`  [${r.code}] vencía a ${r.antes ?? '—'}h → ahora vence a ${r.due.nextDueHours ?? '—'}h`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  let n = 0;
  for (const r of recalculadas) {
    await prisma.compliance.update({
      where: { id: r.id },
      data: {
        aircraftHoursAtCompliance: horas,
        aircraftCyclesAtCompliance: ciclos,
        nextDueHours: r.due.nextDueHours,
        nextDueCycles: r.due.nextDueCycles,
        nextDueDate: r.due.nextDueDate,
      },
    });
    n += 1;
  }

  console.log(`\n✅ ${n} líneas base re-ancladas a ${horas} h / ${ciclos} ciclos.`);
}

main()
  .catch((err) => {
    console.error('reanchor_baselines failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
