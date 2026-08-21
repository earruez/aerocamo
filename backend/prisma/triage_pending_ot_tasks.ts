/**
 * triage_pending_ot_tasks.ts
 *
 * De las 503 filas que la importación de OT de Access no pudo emparejar
 * (ot-task-mapping-pending.csv), 53 citaban un número de AD y ya se trabajaron.
 * Quedan ~452 que citan capítulo del manual. Cada una es un trabajo que Access
 * declara ejecutado y que la plataforma no registra como cumplido.
 *
 * El importador falló porque en Access el CODIGO_TAREA no es un código sino la
 * descripción completa:
 *
 *   CHECK INTERVALO ESPECIFICO DE 30 FH, CAP. 04-20-00 Y 05-25-00
 *
 * Pero ahí dentro está lo necesario para emparejar: el capítulo y el intervalo.
 * Este diagnóstico mide cuántas se pueden emparejar con confianza y cuántas no,
 * ANTES de escribir ningún cargador.
 *
 * Clasifica en:
 *   ALTA         un solo candidato que coincide en capítulo y en intervalo
 *   MEDIA        varios candidatos, o coincide el capítulo pero no el intervalo
 *   SIN CANDIDATO  ninguna tarea de esa aeronave tiene ese capítulo
 *   CORRECTIVO   el texto no cita capítulo: trabajo no programado, que
 *                probablemente no corresponde cargar como cumplimiento
 *
 * Solo lectura.
 *
 * Uso:
 *   npx tsx prisma/triage_pending_ot_tasks.ts --org-slug tecnicopters [--csv salida.csv]
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
const CSV = path.resolve(getArgValue('--csv-in') ?? path.join(__dirname, '..', 'data', 'ot-task-mapping-pending.csv'));
const SALIDA = getArgValue('--csv');

/** Capítulos ATA citados en el texto: 04-20-00, 05-25-00, 05-20-10-201-810-A01… */
function capitulos(texto: string): string[] {
  return [...new Set((texto.match(/\b\d{2}-\d{2}-\d{2}\b/g) ?? []))];
}

interface Intervalo { horas: number | null; meses: number | null; dias: number | null; ciclos: number | null; }

/** Intervalo citado: "30 FH", "15 HR./7D", "1 M", "100 HORAS/1 AÑO". */
function intervalo(texto: string): Intervalo {
  const t = texto.toUpperCase();
  const num = (re: RegExp): number | null => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    horas: num(/(\d+)\s*(?:FH|HR\.?S?|HORAS?)\b/),
    meses: num(/(\d+)\s*(?:M|MES|MESES|AÑOS?)\b/),
    dias: num(/(\d+)\s*D\b/),
    ciclos: num(/(\d+)\s*(?:TC|SC|HC|CICLOS?)\b/),
  };
}

const mismoIntervalo = (a: Intervalo, b: Intervalo): boolean => {
  // Basta que coincida el límite dominante; el Access no siempre escribe todos.
  if (a.horas != null && b.horas != null) return a.horas === b.horas;
  if (a.meses != null && b.meses != null) return a.meses === b.meses;
  if (a.dias != null && b.dias != null) return a.dias === b.dias;
  if (a.ciclos != null && b.ciclos != null) return a.ciclos === b.ciclos;
  return false;
};

interface Fila { registration: string; numOt: string; origen: string; performedAt: string; }

function leerCsv(ruta: string): Promise<Fila[]> {
  return new Promise((resolve, reject) => {
    const filas: Fila[] = [];
    fs.createReadStream(ruta)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
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

const tieneAd = (t: string): boolean => /\bAD\s*[- ]?\s*(?:[A-Z]-)?\d{4}[-–]\d{2,4}/i.test(t);

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);
  if (!fs.existsSync(CSV)) throw new Error(`No se encontró ${CSV}`);

  // Las que citan AD se trabajaron aparte; acá quedan las de capítulo.
  const filas = (await leerCsv(CSV)).filter((f) => !tieneAd(f.origen));

  const matriculas = [...new Set(filas.map((f) => f.registration))];
  const tareasPorMatricula = new Map<string, Array<{
    code: string; title: string; ata: string | null; iv: Intervalo;
  }>>();

  for (const reg of matriculas) {
    const ac = await prisma.aircraft.findFirst({
      where: { organizationId: org.id, registration: reg }, select: { id: true },
    });
    if (!ac) { tareasPorMatricula.set(reg, []); continue; }
    const links = await prisma.aircraftTask.findMany({
      where: { aircraftId: ac.id, isActive: true },
      select: {
        task: {
          select: {
            code: true, title: true, ata: true, referenceNumber: true,
            intervalHours: true, intervalCycles: true,
            intervalCalendarDays: true, intervalCalendarMonths: true,
          },
        },
      },
    });
    tareasPorMatricula.set(reg, links.map((l) => ({
      code: l.task.code, title: l.task.title,
      ata: l.task.ata ?? l.task.referenceNumber ?? null,
      iv: {
        horas: l.task.intervalHours != null ? Number(l.task.intervalHours) : null,
        meses: l.task.intervalCalendarMonths, dias: l.task.intervalCalendarDays,
        ciclos: l.task.intervalCycles,
      },
    })));
  }

  interface Res extends Fila { caps: string; iv: string; nivel: string; candidatos: string[]; }
  const resultados: Res[] = [];

  for (const f of filas) {
    const caps = capitulos(f.origen);
    const iv = intervalo(f.origen);
    const tareas = tareasPorMatricula.get(f.registration) ?? [];

    if (caps.length === 0) {
      resultados.push({ ...f, caps: '', iv: '', nivel: 'CORRECTIVO', candidatos: [] });
      continue;
    }

    // Candidato = comparte capítulo con el texto de Access.
    const porCapitulo = tareas.filter((t) => {
      const donde = `${t.ata ?? ''} ${t.title} ${t.code}`;
      return caps.some((c) => donde.includes(c));
    });
    const conIntervalo = porCapitulo.filter((t) => mismoIntervalo(iv, t.iv));

    const nivel = conIntervalo.length === 1 ? 'ALTA'
      : (porCapitulo.length > 0 ? 'MEDIA' : 'SIN CANDIDATO');
    const elegidos = (conIntervalo.length ? conIntervalo : porCapitulo).slice(0, 4);

    resultados.push({
      ...f, caps: caps.join(' '), nivel,
      iv: [iv.horas != null ? `${iv.horas}FH` : null, iv.meses != null ? `${iv.meses}M` : null,
           iv.dias != null ? `${iv.dias}D` : null, iv.ciclos != null ? `${iv.ciclos}CY` : null]
        .filter(Boolean).join('/'),
      candidatos: elegidos.map((t) => t.code),
    });
  }

  const cuenta = (n: string) => resultados.filter((r) => r.nivel === n).length;

  console.log(`\n=== Triaje de las OT de Access sin emparejar — ${ORG_SLUG} ===\n`);
  console.log(`Filas que citan capítulo del manual (se excluyen las de AD): ${filas.length}\n`);
  console.log('Nivel            cant.   qué significa');
  console.log('─'.repeat(76));
  console.log(`ALTA          ${String(cuenta('ALTA')).padStart(8)}   un solo candidato, coincide capítulo e intervalo`);
  console.log(`MEDIA         ${String(cuenta('MEDIA')).padStart(8)}   varios candidatos, o el intervalo no calza`);
  console.log(`SIN CANDIDATO ${String(cuenta('SIN CANDIDATO')).padStart(8)}   ninguna tarea de esa aeronave tiene ese capítulo`);
  console.log(`CORRECTIVO    ${String(cuenta('CORRECTIVO')).padStart(8)}   sin capítulo: trabajo no programado`);
  console.log('─'.repeat(76));

  console.log('\nPor aeronave:');
  for (const reg of matriculas.sort()) {
    const suyas = resultados.filter((r) => r.registration === reg);
    const c = (n: string) => suyas.filter((r) => r.nivel === n).length;
    console.log(`  ${reg.padEnd(9)} total ${String(suyas.length).padStart(4)}`
      + `   alta ${String(c('ALTA')).padStart(3)}`
      + `   media ${String(c('MEDIA')).padStart(3)}`
      + `   sin candidato ${String(c('SIN CANDIDATO')).padStart(3)}`
      + `   correctivo ${String(c('CORRECTIVO')).padStart(3)}`);
  }

  const altas = resultados.filter((r) => r.nivel === 'ALTA');
  if (altas.length) {
    console.log(`\nEjemplos de nivel ALTA (primeros 10 de ${altas.length}):`);
    for (const r of altas.slice(0, 10)) {
      console.log(`  ${r.registration}  ${r.performedAt}  ${r.candidatos[0]}`);
      console.log(`      ${r.origen.slice(0, 72)}`);
    }
  }

  if (SALIDA) {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const orden = { ALTA: 0, MEDIA: 1, 'SIN CANDIDATO': 2, CORRECTIVO: 3 } as Record<string, number>;
    const lineas = [
      'aeronave,num_ot,fecha,texto_access,capitulos,intervalo,nivel,candidatos,tarea_confirmada',
      ...resultados
        .sort((a, b) => (orden[a.nivel] - orden[b.nivel]) || a.registration.localeCompare(b.registration))
        .map((r) => [
          esc(r.registration), esc(r.numOt), esc(r.performedAt), esc(r.origen),
          esc(r.caps), esc(r.iv), esc(r.nivel), esc(r.candidatos.join(' | ')), '',
        ].join(',')),
    ];
    const destino = path.resolve(SALIDA);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${lineas.join('\n')}\n`, 'utf8');
    console.log(`\n📄 CSV: ${destino}`);
    console.log('    La columna tarea_confirmada va vacía: es la que decide una persona.');
  }

  console.log('\nSolo lectura: no se creó ningún cumplimiento.\n');
}

main()
  .catch((err) => {
    console.error('triage_pending_ot_tasks failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
