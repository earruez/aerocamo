/**
 * check_r66_ad_duplicates.ts
 *
 * Solo lectura. Las AD que importé desde la bitácora usan como código el
 * número de ENMIENDA (39-22681), mientras que las que ya venían del Access
 * usan el número de AD (2024-04-02 / US-2022-19-12). Son la misma directiva
 * con dos identidades distintas — este script cruza ambas por título para
 * ver cuántas quedaron duplicadas y cuál de las dos tiene el historial.
 *
 * Uso:
 *   npx tsx prisma/check_r66_ad_duplicates.ts --org-slug tecnicopters --model R66
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
const MODEL = getArgValue('--model') ?? 'R66';

/** Enmienda → nº de AD, según el Excel "AD Final Rules (R66)" de la FAA. */
const AMENDMENT_TO_AD: Record<string, string> = {
  '39-22866': '2024-20-07',
  '39-22681': '2024-04-02',
  '39-22453': '2023-11-07',
  '39-22181': '2022-19-12',
  '39-21433': '2021-04-12',
  '39-19613': '2019-07-02',
  '39-18762': '2016-26-04',
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const adTasks = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, referenceType: 'AD', applicableModel: MODEL },
    include: {
      _count: { select: { compliances: true } },
      aircraftLinks: { select: { isActive: true, aircraft: { select: { registration: true } } } },
    },
    orderBy: { code: 'asc' },
  });

  console.log(`\n=== AD del modelo "${MODEL}" en "${ORG_SLUG}" (${adTasks.length}) ===`);
  for (const t of adTasks) {
    const acs = t.aircraftLinks.map((l) => `${l.aircraft.registration}${l.isActive ? '' : ' (no aplica)'}`);
    console.log(`  [${t.code}] ref=${t.referenceNumber ?? '—'} · ${t._count.compliances} cumpl. · ${acs.join(', ') || 'sin aeronave'}`);
    console.log(`      ${t.title.slice(0, 70)}`);
  }

  // Cruce: las importadas por enmienda vs las del Access por nº de AD.
  console.log(`\n=== Posibles duplicados (misma directiva, dos códigos) ===`);
  let dupes = 0;
  for (const [amendment, adNumber] of Object.entries(AMENDMENT_TO_AD)) {
    const mine = adTasks.find((t) => t.referenceNumber === amendment);
    const access = adTasks.filter((t) =>
      t.referenceNumber && t.referenceNumber !== amendment
      && (t.referenceNumber === adNumber || t.referenceNumber.endsWith(adNumber)));

    if (!mine && access.length === 0) continue;
    const sameTitle = mine && access.some((a) => norm(a.title) === norm(mine.title));
    if (mine && access.length > 0) {
      dupes += 1;
      console.log(`\n  ⚠️  AD ${adNumber} (enmienda ${amendment})${sameTitle ? ' — mismo título' : ''}`);
      console.log(`      importada por mí : [${mine.code}] ${mine._count.compliances} cumpl. · ${mine.aircraftLinks.length} aeronave(s)`);
      for (const a of access) {
        console.log(`      ya existía       : [${a.code}] ${a._count.compliances} cumpl. · ${a.aircraftLinks.length} aeronave(s)`);
      }
    } else if (mine) {
      console.log(`\n  ✓ AD ${adNumber} (enmienda ${amendment}): solo la importada [${mine.code}] — sin duplicado`);
    }
  }
  console.log(`\n→ ${dupes} directiva(s) duplicada(s).`);
}

main()
  .catch((err) => {
    console.error('check_r66_ad_duplicates failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
