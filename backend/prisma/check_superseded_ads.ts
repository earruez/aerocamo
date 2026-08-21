/**
 * check_superseded_ads.ts
 *
 * Busca AD activas en el plan de alguna aeronave cuyo propio texto dice que
 * están superseditadas o canceladas, y verifica si la directiva que las
 * reemplaza está en el plan de esa misma aeronave.
 *
 * Salió de revisar las AD sin recurrencia definida: ninguna traía el intervalo
 * escrito, pero varias traían el aviso de supersesión en el título. Esas no
 * necesitan intervalo, necesitan salir del plan.
 *
 * La verificación del reemplazo es el punto: sacar la vieja sin que esté la
 * nueva deja un hueco peor que el que se arregla. Los tres estados que importan:
 *
 *   reemplazo EN EL PLAN     → sacar la vieja es seguro
 *   reemplazo FUERA DEL PLAN → agregar la nueva primero
 *   cancelada sin reemplazo  → sacar sin más
 *
 * Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/check_superseded_ads.ts --org-slug tecnicopters
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

const OBSOLETA = /SUPERSED|SUPERSEDID|CANCELL?ED|CANCELAD|REEMPLAZAD|REPLACED BY/i;
const REEMPLAZO = /(?:SUPERSEDED BY|SUPERSEDIDO POR|REPLACED BY)\s+(?:EASA|FAA)?\s*AD\s*/i;
const AD_RE = /((?:[A-Z]-)?\d{4}[-–]\d{2,4}(?:[-–]\d{2})?(?:[-–][A-Z]{1,2}(?![A-Z0-9]))?)/i;
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const todas = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, referenceType: 'AD' },
    select: { id: true, code: true, title: true, description: true },
  });
  const activas = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, referenceType: 'AD', aircraftLinks: { some: { isActive: true } } },
    select: {
      id: true, code: true, title: true, description: true,
      aircraftLinks: {
        where: { isActive: true },
        select: { aircraft: { select: { id: true, registration: true } } },
      },
    },
    orderBy: { code: 'asc' },
  });

  const obsoletas = activas.filter((t) => OBSOLETA.test(`${t.title} ${t.description ?? ''}`));

  console.log(`\n=== AD obsoletas todavía en planes de vuelo — ${ORG_SLUG} ===\n`);
  console.log(`AD activas en alguna aeronave: ${activas.length}`);
  console.log(`Con "superseded/cancelled" en su propio texto: ${obsoletas.length}\n`);

  const seguras: string[] = [];
  const huecos: string[] = [];
  const canceladas: string[] = [];
  const dudosas: string[] = [];

  for (const t of obsoletas) {
    const texto = `${t.title} ${t.description ?? ''}`;
    const m = texto.match(REEMPLAZO);
    const nuevo = m ? texto.slice((m.index ?? 0) + m[0].length).match(AD_RE)?.[1] ?? null : null;

    for (const link of t.aircraftLinks) {
      const reg = link.aircraft.registration;
      const etiqueta = `${t.code.padEnd(28)} ${reg.padEnd(9)}`;

      if (!nuevo) { canceladas.push(`${etiqueta} cancelada, sin reemplazo declarado`); continue; }

      // Una supersesión hacia atrás en el tiempo es sospechosa: suele ser el
      // texto invertido al cargarlo.
      const añoViejo = t.code.match(/(\d{4})/)?.[1];
      const añoNuevo = nuevo.match(/(\d{4})/)?.[1];
      if (añoViejo && añoNuevo && Number(añoNuevo) < Number(añoViejo)) {
        dudosas.push(`${etiqueta} dice reemplazada por ${nuevo}, anterior a ella misma: revisar el texto`);
        continue;
      }

      const ids = todas.filter((c) => norm(c.code).includes(norm(nuevo))).map((c) => c.id);
      const enPlan = ids.length
        ? await prisma.aircraftTask.findFirst({
            where: { aircraftId: link.aircraft.id, taskId: { in: ids }, isActive: true },
            select: { task: { select: { code: true } } },
          })
        : null;

      if (enPlan) seguras.push(`${etiqueta} reemplazo ${enPlan.task.code} ya está en el plan`);
      else if (ids.length) huecos.push(`${etiqueta} reemplazo ${nuevo} existe pero NO está en esta aeronave`);
      else huecos.push(`${etiqueta} reemplazo ${nuevo} NO existe en la biblioteca`);
    }
  }

  const bloque = (titulo: string, filas: string[], nota: string) => {
    if (!filas.length) return;
    console.log(`${titulo} (${filas.length})`);
    console.log(`  ${nota}`);
    for (const f of filas) console.log(`    ${f}`);
    console.log('');
  };

  bloque('SEGURAS DE SACAR', seguras, 'la directiva vigente ya está en el plan de esa aeronave.');
  bloque('CANCELADAS', canceladas, 'sin reemplazo: sacarlas no deja hueco.');
  bloque('⚠️  FALTA EL REEMPLAZO', huecos,
    'la aeronave lleva la AD vieja y NO lleva la vigente. Agregar la nueva ANTES de sacar la vieja.');
  bloque('⚠️  TEXTO SOSPECHOSO', dudosas, 'la supersesión apunta hacia atrás en el tiempo: verificar antes de tocar.');

  console.log('Solo lectura: no se modificó ningún plan.\n');
}

main()
  .catch((err) => {
    console.error('check_superseded_ads failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
