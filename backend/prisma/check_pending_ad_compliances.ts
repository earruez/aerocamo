/**
 * check_pending_ad_compliances.ts
 *
 * De las 503 tareas que Access declara ejecutadas y que la importación no pudo
 * emparejar (ot-task-mapping-pending.csv), un grupo cita un número de AD:
 *
 *   AD 2023-0064 MAIN ROTOR - PITCH ROD UPPER LINKS - MARKING / INSPECTION
 *
 * Access es la fuente de verdad: si dice que la AD se cumplió, la plataforma
 * debe reflejarlo. Y el cumplimiento de AD es el punto IV.4.1 del informe DGAC,
 * así que un hueco ahí se ve.
 *
 * Este diagnóstico empareja SOLO por número de AD, que es una cadena exacta:
 * o coincide o no coincide, sin interpretación. Las que citan capítulo del
 * manual necesitan emparejamiento por texto y eso va por otro camino, con
 * revisión humana.
 *
 * La AD se identifica por su número, nunca por la enmienda: dos enmiendas de
 * la misma AD son la misma normativa, y tratarlas como distintas la duplica.
 *
 * Solo lectura: no crea ningún cumplimiento.
 *
 * Uso:
 *   npx tsx prisma/check_pending_ad_compliances.ts --org-slug tecnicopters [--detalle]
 */
import { PrismaClient } from '@prisma/client';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';

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
const CSV = path.resolve(getArgValue('--csv') ?? path.join(__dirname, '..', 'data', 'ot-task-mapping-pending.csv'));
const DETALLE = args.includes('--detalle');

/**
 * Número de AD tal como lo escriben EASA ("2012-0257-E", con sufijo de
 * emergencia) y la FAA ("2022-10-06"). El sufijo es parte del número y no se
 * descarta; lo que no se toma es la enmienda.
 */
/**
 * Número de AD, en los formatos que conviven en esta flota:
 *   EASA        2012-0257-E   el sufijo -E (Emergency) es parte de la identidad
 *   FAA         2022-10-06    año-quincena-ítem, tres grupos
 *   Francesa    F-2005-158    prefijo de país
 *
 * Lo que NO se toma es la enmienda: AD-2014-0076-R2 y AD-2011-0164R3 son
 * revisiones de 2014-0076 y 2011-0164, no directivas distintas. Tratarlas como
 * distintas duplica la normativa.
 *
 * El lookahead evita comerse el modelo: en AD-2021-0099-AS350B3 el "-AS" no es
 * sufijo de la AD sino el comienzo de AS350B3.
 */
function extraerAd(texto: string): string | null {
  const m = (texto ?? '').match(
    /\bAD\s*[- ]?\s*((?:[A-Z]-)?\d{4}[-–]\d{2,4}(?:[-–]\d{2})?(?:[-–][A-Z]{1,2}(?![A-Z0-9]))?)/i,
  );
  return m ? m[1].replace(/–/g, '-').toUpperCase() : null;
}

/** Para comparar: solo dígitos y letras, que las separaciones varían. */
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface Fila { registration: string; numOt: string; origen: string; performedAt: string; }

/**
 * Se usa csv-parser, el mismo que los importadores de Access, y no un parseo a
 * mano: cinco descripciones del archivo traen saltos de línea dentro de las
 * comillas, y partirlas por línea inventa filas que no existen.
 */
function leerCsv(ruta: string): Promise<Fila[]> {
  return new Promise((resolve, reject) => {
    const filas: Fila[] = [];
    fs.createReadStream(ruta)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^\ufeff/, '').trim() }))
      .on('data', (row: Record<string, string>) => {
        const registration = (row.registration ?? '').trim();
        if (!registration) return;
        filas.push({
          registration,
          numOt: (row.num_ot ?? '').trim(),
          origen: (row.taskCode_origen ?? '').trim(),
          performedAt: (row.performedAt ?? '').trim(),
        });
      })
      .on('end', () => resolve(filas))
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);
  if (!fs.existsSync(CSV)) throw new Error(`No se encontró ${CSV}`);

  const filas = await leerCsv(CSV);
  const conAd = filas
    .map((f) => ({ ...f, ad: extraerAd(f.origen) }))
    .filter((f): f is Fila & { ad: string } => f.ad != null);

  console.log(`\n=== AD que Access declara cumplidas y no están en la plataforma ===\n`);
  console.log(`Filas pendientes en el CSV: ${filas.length}`);
  console.log(`  · citan un número de AD:  ${conAd.length}`);
  console.log(`  · citan capítulo u otro:  ${filas.length - conAd.length}  (van por otro camino)\n`);

  // Todas las tareas AD de la organización, indexadas por número normalizado.
  const tareasAd = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, referenceType: 'AD' },
    select: { id: true, code: true, title: true, referenceNumber: true },
  });
  const porNumero = new Map<string, typeof tareasAd>();
  for (const t of tareasAd) {
    for (const candidato of [t.code, t.referenceNumber ?? '']) {
      const ad = extraerAd(candidato) ?? candidato;
      const k = norm(ad);
      if (k.length >= 6) porNumero.set(k, [...(porNumero.get(k) ?? []), t]);
    }
  }

  const aeronaves = await prisma.aircraft.findMany({
    where: { organizationId: org.id },
    select: { id: true, registration: true },
  });
  const porMatricula = new Map(aeronaves.map((a) => [a.registration, a]));

  let sinTarea = 0; let sinEnlace = 0; let yaCubierto = 0; let cargable = 0;
  const detalle: string[] = [];
  const porAeronave = new Map<string, number>();

  // Se agrupa por (aeronave, AD): varias OT de la misma AD son un solo control.
  const grupos = new Map<string, { reg: string; ad: string; fechas: string[]; ots: Set<string> }>();
  for (const f of conAd) {
    const k = `${f.registration}|${norm(f.ad)}`;
    const g = grupos.get(k) ?? { reg: f.registration, ad: f.ad, fechas: [], ots: new Set<string>() };
    if (f.performedAt) g.fechas.push(f.performedAt);
    g.ots.add(f.numOt);
    grupos.set(k, g);
  }

  console.log(`Combinaciones únicas (aeronave × AD): ${grupos.size}\n`);
  console.log('Estado                          cant.   qué significa');
  console.log('─'.repeat(78));

  for (const g of grupos.values()) {
    const ac = porMatricula.get(g.reg);
    const tareas = porNumero.get(norm(g.ad)) ?? [];
    const ultima = g.fechas.sort().at(-1) ?? null;

    if (!ac || tareas.length === 0) {
      sinTarea += 1;
      if (DETALLE) detalle.push(`  [sin tarea ] ${g.reg}  AD ${g.ad}  (${ultima ?? 's/f'})`);
      continue;
    }

    const enlace = await prisma.aircraftTask.findFirst({
      where: { aircraftId: ac.id, taskId: { in: tareas.map((t) => t.id) }, isActive: true },
      select: { taskId: true },
    });
    if (!enlace) {
      sinEnlace += 1;
      if (DETALLE) detalle.push(`  [no en plan] ${g.reg}  AD ${g.ad}  (${ultima ?? 's/f'})`);
      continue;
    }

    // ¿Ya hay un cumplimiento firmado igual o posterior a lo que dice Access?
    const existente = await prisma.compliance.findFirst({
      where: {
        aircraftId: ac.id, taskId: enlace.taskId,
        applicationType: { not: 'baseline' },
        ...(ultima ? { performedAt: { gte: new Date(ultima) } } : {}),
      },
      select: { performedAt: true },
    });
    if (existente) {
      yaCubierto += 1;
      if (DETALLE) detalle.push(`  [ya está  ] ${g.reg}  AD ${g.ad}  plataforma ${existente.performedAt.toISOString().slice(0, 10)} ≥ access ${ultima}`);
      continue;
    }

    cargable += 1;
    porAeronave.set(g.reg, (porAeronave.get(g.reg) ?? 0) + 1);
    detalle.push(`  [CARGABLE ] ${g.reg}  AD ${g.ad}  cumplida ${ultima ?? 's/f'}  OT ${[...g.ots].join(', ')}`);
  }

  const fila = (l: string, n: number, d: string) => console.log(`${l.padEnd(30)} ${String(n).padStart(5)}   ${d}`);
  fila('Cargables', cargable, 'Access la declara cumplida y falta en la plataforma');
  fila('Ya cubiertas', yaCubierto, 'la plataforma ya tiene un cumplimiento igual o posterior');
  fila('AD no está en el plan', sinEnlace, 'la tarea existe pero no aplica a esa aeronave');
  fila('Sin tarea equivalente', sinTarea, 'no hay ninguna AD con ese número en la biblioteca');
  console.log('─'.repeat(78));

  if (porAeronave.size) {
    console.log('\nCargables por aeronave:');
    for (const [reg, n] of [...porAeronave].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reg.padEnd(10)} ${String(n).padStart(3)}`);
    }
  }

  const cargables = detalle.filter((d) => d.includes('[CARGABLE '));
  if (cargables.length) {
    console.log(`\nDetalle de las cargables${DETALLE ? '' : ` (primeras 30 de ${cargables.length})`}:`);
    console.log((DETALLE ? cargables : cargables.slice(0, 30)).join('\n'));
  }
  if (DETALLE) {
    const resto = detalle.filter((d) => !d.includes('[CARGABLE '));
    if (resto.length) console.log(`\nResto:\n${resto.join('\n')}`);
  }

  console.log('\nSolo lectura: no se creó ningún cumplimiento.\n');
}

main()
  .catch((err) => {
    console.error('check_pending_ad_compliances failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
