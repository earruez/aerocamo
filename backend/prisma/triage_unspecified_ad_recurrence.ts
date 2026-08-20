/**
 * triage_unspecified_ad_recurrence.ts
 *
 * 88 AD activas en la flota tienen complianceRecurrence = UNSPECIFIED y ningún
 * intervalo: ni el modelo sabe si son de cumplimiento único o repetitivas. Las
 * que resulten repetitivas son puntos ciegos —no vencen nunca por cálculo— igual
 * que las 4 ya detectadas por check_ad_intervals.ts.
 *
 * En vez de revisarlas a criterio, se triarán por evidencia: una AD que consta
 * cumplida DOS O MÁS VECES es repetitiva en la práctica, diga lo que diga el
 * campo. Fue el razonamiento que frenó la carga de AD-2012-0257-E, que aparece
 * en nueve OT de CC-ABU.
 *
 * Se cuentan dos fuentes independientes:
 *   · Access  — apariciones en ot_normalizado.csv, el historial de OT
 *   · Plataforma — cumplimientos firmados (excluida la línea base sintética)
 *
 * Basta que cualquiera de las dos muestre repetición. Access cubre lo anterior
 * a la migración; la plataforma, lo posterior.
 *
 * Solo lectura: no modifica ninguna tarea.
 *
 * Uso:
 *   npx tsx prisma/triage_unspecified_ad_recurrence.ts --org-slug tecnicopters [--csv salida.csv]
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
const OT_CSV = path.resolve(getArgValue('--ot-csv') ?? path.join(__dirname, '..', 'data', 'ot_normalizado.csv'));
const SALIDA = getArgValue('--csv');

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
const norm = (s: string): string => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

interface OtFila { mat: string; ad: string | null; fecha: string; ot: string; }

function leerOt(ruta: string): Promise<OtFila[]> {
  return new Promise((resolve, reject) => {
    const filas: OtFila[] = [];
    fs.createReadStream(ruta)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
      .on('data', (row: Record<string, string>) => {
        filas.push({
          mat: (row.MAT ?? '').trim(),
          ad: extraerAd(row.CODIGO_TAREA ?? ''),
          fecha: (row.FECHA_CUMPLIMIENTO ?? '').trim(),
          ot: (row.NUM_OT ?? '').trim(),
        });
      })
      .on('end', () => resolve(filas))
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const otFilas = fs.existsSync(OT_CSV) ? await leerOt(OT_CSV) : [];
  if (otFilas.length === 0) console.log(`⚠️  No se pudo leer ${OT_CSV}; solo se contará la plataforma.\n`);

  // Access: veces que consta cumplida cada AD, por aeronave.
  const accessPorAd = new Map<string, { veces: number; mats: Set<string>; fechas: string[] }>();
  for (const f of otFilas) {
    if (!f.ad) continue;
    const k = norm(f.ad);
    const e = accessPorAd.get(k) ?? { veces: 0, mats: new Set<string>(), fechas: [] };
    e.veces += 1;
    if (f.mat) e.mats.add(f.mat);
    if (f.fecha) e.fechas.push(f.fecha);
    accessPorAd.set(k, e);
  }

  // Se incluyen las dos poblaciones que necesitan un intervalo: las de
  // recurrencia sin especificar y las ya declaradas repetitivas que tampoco lo
  // tienen. Para quien va a completar la planilla es un solo trabajo, y separarlo
  // en dos listas solo agrega la posibilidad de olvidar una.
  const candidatas = await prisma.maintenanceTask.findMany({
    where: {
      organizationId: org.id,
      referenceType: 'AD',
      complianceRecurrence: { in: ['UNSPECIFIED', 'REPETITIVE'] },
      intervalHours: null, intervalCycles: null,
      intervalCalendarDays: null, intervalCalendarMonths: null,
      aircraftLinks: { some: { isActive: true } },
    },
    select: {
      id: true, code: true, title: true, complianceRecurrence: true,
      aircraftLinks: { where: { isActive: true }, select: { aircraft: { select: { registration: true } } } },
    },
    orderBy: { code: 'asc' },
  });

  console.log(`\n=== Triaje de AD con recurrencia sin especificar — ${ORG_SLUG} ===\n`);
  console.log(`Candidatas (UNSPECIFIED, sin intervalo, activas): ${candidatas.length}\n`);

  interface Resultado {
    code: string; title: string; mats: string; ad: string; recurrencia: string;
    access: number; plataforma: number; veredicto: string; ultima: string;
  }
  const resultados: Resultado[] = [];

  for (const t of candidatas) {
    const ad = extraerAd(t.code) ?? t.code;
    const k = norm(ad);
    const acc = accessPorAd.get(k);

    // Cumplimientos firmados en la plataforma, sin la línea base sintética.
    const comps = await prisma.compliance.findMany({
      where: {
        taskId: t.id,
        NOT: { AND: [{ applicationType: 'baseline' }, { isInitial: true }] },
      },
      select: { performedAt: true },
      orderBy: { performedAt: 'desc' },
    });

    const access = acc?.veces ?? 0;
    const plataforma = comps.length;
    const fechas = [...(acc?.fechas ?? []), ...comps.map((c) => c.performedAt.toISOString().slice(0, 10))].sort();

    // Una declarada REPETITIVE ya no necesita evidencia: el propio modelo dice
    // que se repite, así que le falta el intervalo por definición.
    const veredicto = t.complianceRecurrence === 'REPETITIVE'
      ? 'REPETITIVA (declarada)'
      : (access >= 2 || plataforma >= 2)
        ? 'REPETITIVA (evidencia)'
        : (access + plataforma === 1 ? 'un solo cumplimiento' : 'sin evidencia');

    resultados.push({
      code: t.code, title: t.title, ad, recurrencia: t.complianceRecurrence,
      mats: t.aircraftLinks.map((l) => l.aircraft.registration).join(' '),
      access, plataforma, veredicto, ultima: fechas.at(-1) ?? '—',
    });
  }

  const declaradas = resultados.filter((r) => r.veredicto === 'REPETITIVA (declarada)');
  const repetitivas = resultados.filter((r) => r.veredicto.startsWith('REPETITIVA'));
  const unaVez = resultados.filter((r) => r.veredicto === 'un solo cumplimiento');
  const sinEvidencia = resultados.filter((r) => r.veredicto === 'sin evidencia');

  console.log('Veredicto                 cant.   qué significa');
  console.log('─'.repeat(76));
  console.log(`REPETITIVA (declarada)   ${String(declaradas.length).padStart(6)}   el modelo ya dice que se repite: falta el intervalo`);
  console.log(`REPETITIVA (evidencia)   ${String(repetitivas.length - declaradas.length).padStart(6)}   consta cumplida 2+ veces: necesita intervalo`);
  console.log(`un solo cumplimiento     ${String(unaVez.length).padStart(6)}   compatible con cumplimiento único`);
  console.log(`sin evidencia            ${String(sinEvidencia.length).padStart(6)}   nunca consta cumplida: no se puede inferir`);
  console.log('─'.repeat(76));

  if (repetitivas.length) {
    console.log(`\n⚠️  Estas ${repetitivas.length} son puntos ciegos: repetitivas en la práctica y sin intervalo.`);
    console.log('    Hay que sacarles el intervalo del texto de la directiva.\n');
    console.log('    Código                     Access  Plataf.  Último       Aeronaves');
    for (const r of repetitivas) {
      console.log(`    ${r.code.padEnd(26)} ${String(r.access).padStart(6)} ${String(r.plataforma).padStart(8)}  ${r.ultima.padEnd(12)} ${r.mats}`);
      console.log(`      ${r.title.slice(0, 68)}`);
    }
  }

  if (SALIDA) {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [
      'code,ad,title,aeronaves,recurrencia,veces_access,veces_plataforma,ultimo_cumplimiento,veredicto,intervalo_propuesto',
      ...resultados
        .sort((a, b) => (b.access + b.plataforma) - (a.access + a.plataforma))
        .map((r) => [
          esc(r.code), esc(r.ad), esc(r.title), esc(r.mats), esc(r.recurrencia),
          r.access, r.plataforma, esc(r.ultima), esc(r.veredicto), '',
        ].join(',')),
    ];
    // Se crea el directorio si falta: el análisis ya corrió y sería absurdo
    // perderlo por una ruta inexistente.
    const destino = path.resolve(SALIDA);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${lineas.join('\n')}\n`, 'utf8');
    console.log(`\n📄 CSV para revisar con Griselle: ${destino}`);
    console.log('    La última columna, intervalo_propuesto, queda vacía a propósito:');
    console.log('    es la que ella completa con el intervalo del texto de cada directiva.');
  }

  console.log('\nSolo lectura: no se modificó ninguna tarea.\n');
}

main()
  .catch((err) => {
    console.error('triage_unspecified_ad_recurrence failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
