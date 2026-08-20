/**
 * merge_r66_duplicate_ads.ts
 *
 * Fusiona las AD del R66 que quedaron duplicadas: las que importé desde la
 * bitácora usan como identidad el número de ENMIENDA (39-22681) y las que ya
 * venían del Access usan el número de AD (2024-04-02 / US-2022-19-12). Es la
 * misma directiva con dos registros distintos, lo que además impide que la
 * propagación a la flota (que cruza por referenceNumber) las vincule.
 *
 * Deja UN registro por directiva, el del Access (canónico), compartido por
 * toda la flota. Para cada duplicado:
 *   1. Traslada al canónico los cumplimientos que cargué de la bitácora.
 *   2. Enlaza la aeronave al canónico, conservando su aplicabilidad y motivo.
 *   3. Borra mi registro duplicado y su enlace.
 *   4. Reapunta la tarea de la plantilla FAA R66 al código canónico, para que
 *      asignarla a un R66 nuevo no vuelva a crear el duplicado.
 *
 * Las AD sin equivalente en el Access (las de instrumentos/altímetro) se
 * dejan intactas.
 *
 * Uso:
 *   npx tsx prisma/merge_r66_duplicate_ads.ts --org-slug tecnicopters --registration CC-AKY [--apply]
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
const APPLY = args.includes('--apply');

/** Mi enmienda → nº de AD real, según el Excel "AD Final Rules (R66)". */
const AMENDMENT_TO_AD: Record<string, string> = {
  '39-22866': '2024-20-07',
  '39-22681': '2024-04-02',
  '39-22453': '2023-11-07',
  '39-22181': '2022-19-12',
  '39-21433': '2021-04-12',
  '39-19613': '2019-07-02',
  '39-18762': '2016-26-04',
};

/** Motivo de no aplicabilidad para CC-AKY, según la bitácora. */
const NOT_APPLICABLE: Record<string, string> = {
  '39-22866': 'No aplica: la AD alcanza a los Robinson Model R44, no al R66.',
  '39-22453': 'No aplica: la aeronave no tiene instalado equipo Radio Altímetro.',
  '39-22181': 'No aplica por número de serie: alcanza a Tail Rotor Blades P/N F029-1 con S/N distinto al instalado.',
};

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const aircraft = await prisma.aircraft.findFirst({
    where: { organizationId: org.id, registration: REGISTRATION },
    select: { id: true },
  });
  if (!aircraft) throw new Error(`No existe la aeronave ${REGISTRATION} en ${ORG_SLUG}`);

  const adTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, referenceType: 'AD' },
    include: { _count: { select: { compliances: true } } },
  });

  const plan: Array<{
    amendment: string; adNumber: string;
    mineId: string; mineCode: string;
    canonicalId: string; canonicalCode: string;
    compliancesToMove: number;
    applies: boolean; reason: string | null;
  }> = [];
  const noCanonical: string[] = [];

  for (const [amendment, adNumber] of Object.entries(AMENDMENT_TO_AD)) {
    const mine = adTasks.find((t) => t.referenceNumber === amendment);
    if (!mine) continue; // ya fusionada en una corrida anterior

    // El Access la identifica como "2024-04-02" o "US-2022-19-12". La misma AD
    // puede existir para otros modelos (AD-US-2024-20-07-AS350B3-2): la
    // candidata tiene que ser del mismo modelo, o fusionaríamos la directiva
    // de un R66 contra la de un AS350.
    const canonical = adTasks.find((t) =>
      t.id !== mine.id && t.referenceNumber != null
      && t.applicableModel === mine.applicableModel
      && (t.referenceNumber === adNumber || t.referenceNumber === `US-${adNumber}`));

    if (!canonical) { noCanonical.push(`${amendment} (AD ${adNumber})`); continue; }

    const compliancesToMove = await prisma.compliance.count({
      where: { taskId: mine.id, aircraftId: aircraft.id },
    });

    plan.push({
      amendment, adNumber,
      mineId: mine.id, mineCode: mine.code,
      canonicalId: canonical.id, canonicalCode: canonical.code,
      compliancesToMove,
      applies: !NOT_APPLICABLE[amendment],
      reason: NOT_APPLICABLE[amendment] ?? null,
    });
  }

  console.log(`\n=== Fusionar AD duplicadas del R66 en "${ORG_SLUG}" (${REGISTRATION}) ===`);
  if (plan.length === 0) {
    console.log('No hay duplicados pendientes — nada que hacer.');
  }
  for (const p of plan) {
    console.log(`\n  AD ${p.adNumber} (enmienda ${p.amendment})`);
    console.log(`    se conserva : [${p.canonicalCode}]`);
    console.log(`    se elimina  : [${p.mineCode}]`);
    console.log(`    cumplimientos a trasladar: ${p.compliancesToMove}`);
    console.log(`    ${REGISTRATION}: ${p.applies ? 'aplica' : `NO APLICA — ${p.reason}`}`);
  }
  if (noCanonical.length) {
    console.log(`\n  Sin equivalente en el Access (se dejan como están): ${noCanonical.join(', ')}`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  const faaTemplate = await prisma.maintenanceTemplate.findFirst({
    where: { organizationId: org.id, manufacturer: { equals: 'FAA', mode: 'insensitive' }, model: 'R66' },
    select: { id: true },
  });

  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      // 1. Los cumplimientos de la bitácora pasan al registro canónico. Si el
      //    canónico ya tiene uno para esa aeronave y fecha, se descarta el mío
      //    en vez de duplicar historial.
      const mineCompliances = await tx.compliance.findMany({
        where: { taskId: p.mineId, aircraftId: aircraft.id },
        select: { id: true, performedAt: true },
      });
      for (const c of mineCompliances) {
        const clash = await tx.compliance.findFirst({
          where: { taskId: p.canonicalId, aircraftId: aircraft.id, performedAt: c.performedAt },
          select: { id: true },
        });
        if (clash) await tx.compliance.delete({ where: { id: c.id } });
        else await tx.compliance.update({ where: { id: c.id }, data: { taskId: p.canonicalId } });
      }

      // 2. La aeronave queda enlazada al canónico con su aplicabilidad real.
      await tx.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId: aircraft.id, taskId: p.canonicalId } },
        create: {
          aircraftId: aircraft.id, taskId: p.canonicalId,
          isActive: p.applies,
          applicabilityNotes: p.reason,
          applicabilityChangedAt: p.reason ? new Date() : null,
        },
        update: p.reason
          ? { isActive: false, applicabilityNotes: p.reason, applicabilityChangedAt: new Date() }
          : { isActive: true },
      });

      // 3. Fuera el duplicado y su enlace.
      await tx.aircraftTask.deleteMany({ where: { taskId: p.mineId } });
      await tx.maintenanceTask.delete({ where: { id: p.mineId } });

      // 4. La plantilla apunta al código canónico: si mañana se asigna a otro
      //    R66, reutiliza la tarea existente en vez de recrear el duplicado.
      if (faaTemplate) {
        await tx.maintenanceTemplateTask.updateMany({
          where: { templateId: faaTemplate.id, code: p.mineCode },
          data: { code: p.canonicalCode, referenceNumber: p.adNumber },
        });
      }
    });
    console.log(`  ✓ fusionada AD ${p.adNumber}`);
  }

  console.log(`\n✅ ${plan.length} directiva(s) fusionada(s).`);
}

main()
  .catch((err) => {
    console.error('merge_r66_duplicate_ads failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
