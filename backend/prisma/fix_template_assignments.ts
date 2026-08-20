/**
 * fix_template_assignments.ts
 *
 * Varias aeronaves apuntan a las plantillas GENERIC (vacías) en vez de a las
 * de su propio modelo. Mientras eso siga así, editar la plantilla real del
 * modelo no las alcanzaría — que es justo lo que queremos habilitar.
 *
 * Este script SOLO corrige el puntero (AircraftAssignedPlan): deja cada
 * aeronave apuntando a las plantillas de su modelo, en la categoría que le
 * corresponde según el fabricante de la plantilla (DGAC → nacional, MOTOR →
 * motor, EASA/FAA → país de origen, el resto → fabricante).
 *
 * NO copia tareas al plan de la aeronave. El plan de cada avión es su
 * realidad operativa, construida a lo largo de años y con cumplimientos
 * asociados; alinearlo con la plantilla es una decisión aparte, tarea por
 * tarea.
 *
 * Uso:
 *   npx tsx prisma/fix_template_assignments.ts --org-slug tecnicopters [--apply]
 */
import { PrismaClient, AssignedPlanCategory } from '@prisma/client';

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
const APPLY = args.includes('--apply');

/** "AS 350 B3" / "AS350B3" / "AS350 B3" son el mismo modelo. */
const normalizeModel = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Misma regla que usa el frontend (templateNativeCategory). */
function categoryOf(manufacturer: string): AssignedPlanCategory {
  const m = manufacturer.toUpperCase();
  if (m === 'DGAC') return 'national_dgac';
  if (m === 'MOTOR') return 'engine_components';
  if (m === 'EASA' || m === 'FAA') return 'origin_country';
  return 'manufacturer';
}

const CATEGORY_LABEL: Record<string, string> = {
  manufacturer: 'Fabricante',
  national_dgac: 'DGAC',
  engine_components: 'Motor',
  origin_country: 'País origen',
};

const isGenericTemplate = (manufacturer: string, model: string): boolean =>
  manufacturer.toUpperCase() === 'GENERIC' || model.toUpperCase() === 'GENERIC';

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const [aircraft, templates] = await Promise.all([
    prisma.aircraft.findMany({
      where: { organizationId: org.id },
      select: {
        id: true, registration: true, model: true,
        assignedPlans: {
          select: { id: true, category: true, templateId: true, template: { select: { manufacturer: true, model: true } } },
        },
      },
      orderBy: { registration: 'asc' },
    }),
    prisma.maintenanceTemplate.findMany({
      where: { organizationId: org.id, isActive: true },
      select: { id: true, manufacturer: true, model: true, _count: { select: { tasks: true } } },
    }),
  ]);

  const realTemplates = templates.filter((t) => !isGenericTemplate(t.manufacturer, t.model));

  console.log(`\n=== Corregir asignación de plantillas en "${ORG_SLUG}" ===`);
  console.log('(solo se corrige el puntero — no se copian tareas al plan)\n');

  const toCreate: Array<{ aircraftId: string; category: AssignedPlanCategory; templateId: string; label: string }> = [];
  const toDelete: Array<{ id: string; label: string }> = [];

  for (const a of aircraft) {
    const key = normalizeModel(a.model);
    // Una plantilla sirve si su modelo empieza igual que el de la aeronave:
    // el R66 tiene "R66 (Cap 4)" y "R66 (Cap 5)" además de "R66".
    const matching = key
      ? realTemplates.filter((t) => normalizeModel(t.model).startsWith(key))
      : [];

    console.log(`${a.registration} (${a.model})`);
    if (matching.length === 0) {
      console.log(`   sin plantilla propia para este modelo — se deja como está\n`);
      continue;
    }

    for (const t of matching) {
      const cat = categoryOf(t.manufacturer);
      const already = a.assignedPlans.some((p) => p.templateId === t.id && p.category === cat);
      if (already) {
        console.log(`   ✓ ya asignada  ${CATEGORY_LABEL[cat].padEnd(12)} → ${t.manufacturer} ${t.model} (${t._count.tasks} tareas)`);
      } else {
        console.log(`   + asignar      ${CATEGORY_LABEL[cat].padEnd(12)} → ${t.manufacturer} ${t.model} (${t._count.tasks} tareas)`);
        toCreate.push({ aircraftId: a.id, category: cat, templateId: t.id, label: `${a.registration}: ${t.manufacturer} ${t.model}` });
      }
    }

    // Las GENERIC quedan obsoletas una vez que la aeronave apunta a las suyas.
    for (const p of a.assignedPlans) {
      if (isGenericTemplate(p.template.manufacturer, p.template.model)) {
        console.log(`   - quitar       ${CATEGORY_LABEL[p.category].padEnd(12)} → ${p.template.manufacturer} ${p.template.model} (GENERIC)`);
        toDelete.push({ id: p.id, label: `${a.registration}: ${p.template.manufacturer} ${p.template.model}` });
      }
      // Una plantilla del modelo correcto pero en la categoría equivocada
      // (p. ej. MOTOR R66 dentro de "Fabricante") se reemplaza por la nueva
      // asignación en su categoría propia.
      const t = realTemplates.find((x) => x.id === p.templateId);
      if (t && categoryOf(t.manufacturer) !== p.category) {
        console.log(`   - quitar       ${CATEGORY_LABEL[p.category].padEnd(12)} → ${t.manufacturer} ${t.model} (categoría equivocada)`);
        toDelete.push({ id: p.id, label: `${a.registration}: ${t.manufacturer} ${t.model} (cat. equivocada)` });
      }
    }
    console.log('');
  }

  console.log(`→ ${toCreate.length} asignación(es) a crear, ${toDelete.length} a quitar.`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const c of toCreate) {
      await tx.aircraftAssignedPlan.upsert({
        where: { aircraftId_category_templateId: { aircraftId: c.aircraftId, category: c.category, templateId: c.templateId } },
        create: { organizationId: org.id, aircraftId: c.aircraftId, category: c.category, templateId: c.templateId },
        update: {},
      });
    }
    if (toDelete.length) {
      await tx.aircraftAssignedPlan.deleteMany({ where: { id: { in: toDelete.map((d) => d.id) } } });
    }
  });

  console.log(`\n✅ ${toCreate.length} creada(s), ${toDelete.length} quitada(s).`);
}

main()
  .catch((err) => {
    console.error('fix_template_assignments failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
