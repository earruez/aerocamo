/**
 * apply_ad_intervals.ts
 *
 * Aplica a las tareas de AD lo que una persona confirmó en la columna
 * intervalo_confirmado del CSV que produce triage_unspecified_ad_recurrence.ts.
 *
 * Solo lee esa columna. Las columnas estado_directiva e intervalo_directiva son
 * lo que se investigó en el texto de la directiva, y son insumo: si nadie
 * confirmó, no se toca nada. La investigación puede estar equivocada —
 * AD-2022-0128 se marcó repetitiva por evidencia y la directiva dice que es de
 * cumplimiento único— y una AD mal configurada no avisa cuando toca cumplirla.
 *
 * ── Vocabulario de la columna ───────────────────────────────────────────────
 *   165 FH              cada 165 horas de vuelo
 *   500 CY              cada 500 ciclos
 *   12 M                cada 12 meses
 *   7 D                 cada 7 días
 *   600 FH / 24 M       un requisito con dos límites: lo que ocurra primero
 *   UNICA               cumplimiento único: sin intervalo, recurrencia ONE_TIME
 *   NO APLICA           se desactiva del plan de esa aeronave, con motivo
 *
 * "600 FH / 24 M" es UN requisito con dos límites. Dos requisitos distintos
 * —como los 660 FH y 10 FH de la AD 2021-0099— NO caben en una tarea: el
 * modelo guarda un intervalo. El script los detecta y se niega, porque hay que
 * partirlos en dos tareas y eso no lo decide un import.
 *
 * El intervalo se escribe en MaintenanceTask y por lo tanto vale para toda la
 * flota: es propiedad de la directiva, no de la matrícula. En cambio
 * "NO APLICA" se escribe en el enlace de cada aeronave, que es donde vive la
 * aplicabilidad.
 *
 * Uso:
 *   npx tsx prisma/apply_ad_intervals.ts --org-slug tecnicopters \
 *     --csv data/ad-recurrencia-triaje.csv [--apply]
 */
import { PrismaClient, TaskIntervalType } from '@prisma/client';
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
const CSV = path.resolve(getArgValue('--csv') ?? path.join(__dirname, '..', 'data', 'ad-recurrencia-triaje.csv'));
const APPLY = args.includes('--apply');

const MOTIVO_NO_APLICA = 'Directiva superseditada o no aplicable: confirmado en la revisión de intervalos de AD.';

interface Limites {
  horas: number | null; ciclos: number | null;
  meses: number | null; dias: number | null;
}

type Accion =
  | { tipo: 'intervalo'; limites: Limites }
  | { tipo: 'unica' }
  | { tipo: 'no-aplica' }
  | { tipo: 'error'; motivo: string };

/** Interpreta lo escrito en intervalo_confirmado. */
function interpretar(texto: string): Accion {
  const t = texto.trim();
  if (!t) return { tipo: 'error', motivo: 'vacío' };

  const plano = t.toUpperCase().replace(/\s+/g, ' ');
  if (/^(UNICA|ÚNICA|ONE.?TIME|UNA VEZ)$/.test(plano)) return { tipo: 'unica' };
  if (/^(NO APLICA|N\/A|SUPERSEDITADA|SUPERSEDIDA|CANCELADA)$/.test(plano)) return { tipo: 'no-aplica' };

  // Dos requisitos distintos no caben en una tarea.
  if (/\sY\s/.test(plano)) {
    return { tipo: 'error', motivo: 'parecen dos requisitos distintos ("y"): hay que partirlos en dos tareas' };
  }

  const limites: Limites = { horas: null, ciclos: null, meses: null, dias: null };
  let reconocido = false;
  for (const parte of plano.split(/[/|]|\/\//)) {
    const m = parte.trim().match(/^(\d+(?:[.,]\d+)?)\s*(FH|H|HRS?|HORAS?|CY|CIC|CICLOS?|M|MES|MESES|D|DIAS?|DÍAS?)$/);
    if (!m) continue;
    const valor = Number(m[1].replace(',', '.'));
    const unidad = m[2];
    if (/^(FH|H|HRS?|HORAS?)$/.test(unidad)) limites.horas = valor;
    else if (/^(CY|CIC|CICLOS?)$/.test(unidad)) limites.ciclos = Math.round(valor);
    else if (/^(M|MES|MESES)$/.test(unidad)) limites.meses = Math.round(valor);
    else limites.dias = Math.round(valor);
    reconocido = true;
  }
  if (!reconocido) return { tipo: 'error', motivo: `no se entiende "${t}"` };
  return { tipo: 'intervalo', limites };
}

/** Misma convención que resolveIntervalType del importador de Access. */
function tipoDe(l: Limites): TaskIntervalType {
  const calendario = l.meses != null || l.dias != null;
  if (l.horas != null && calendario) return 'FLIGHT_HOURS_OR_CALENDAR';
  if (l.ciclos != null && calendario) return 'CYCLES_OR_CALENDAR';
  if (l.horas != null) return 'FLIGHT_HOURS';
  if (l.ciclos != null) return 'CYCLES';
  return 'CALENDAR_DAYS';
}

const describir = (l: Limites): string => [
  l.horas != null ? `${l.horas} FH` : null,
  l.ciclos != null ? `${l.ciclos} ciclos` : null,
  l.meses != null ? `${l.meses} meses` : null,
  l.dias != null ? `${l.dias} días` : null,
].filter(Boolean).join(' / ');

interface Fila { code: string; aeronaves: string; confirmado: string; title: string; }

function leerCsv(ruta: string): Promise<Fila[]> {
  return new Promise((resolve, reject) => {
    const filas: Fila[] = [];
    fs.createReadStream(ruta)
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
      .on('data', (row: Record<string, string>) => {
        filas.push({
          code: (row.code ?? '').trim(),
          aeronaves: (row.aeronaves ?? '').trim(),
          confirmado: (row.intervalo_confirmado ?? '').trim(),
          title: (row.title ?? '').trim(),
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
  const confirmadas = filas.filter((f) => f.code && f.confirmado);

  console.log(`\n=== Aplicar intervalos de AD confirmados — ${ORG_SLUG} ===`);
  console.log(`Filas en el CSV: ${filas.length}   ·   con intervalo_confirmado: ${confirmadas.length}\n`);

  if (confirmadas.length === 0) {
    console.log('Nada que aplicar: la columna intervalo_confirmado está vacía en todas.');
    console.log('Es la que completa quien revisa; lo investigado en la directiva es insumo.\n');
    return;
  }

  const intervalos: Array<{ f: Fila; id: string; limites: Limites; antes: string }> = [];
  const unicas: Array<{ f: Fila; id: string }> = [];
  const noAplican: Array<{ f: Fila; id: string; regs: string[] }> = [];
  const errores: Array<{ f: Fila; motivo: string }> = [];

  for (const f of confirmadas) {
    const tarea = await prisma.maintenanceTask.findFirst({
      where: { organizationId: org.id, code: f.code, referenceType: 'AD' },
      select: {
        id: true, intervalHours: true, intervalCycles: true,
        intervalCalendarMonths: true, intervalCalendarDays: true,
        aircraftLinks: { where: { isActive: true }, select: { aircraft: { select: { id: true, registration: true } } } },
      },
    });
    if (!tarea) { errores.push({ f, motivo: 'no existe una AD con ese código' }); continue; }

    const accion = interpretar(f.confirmado);
    if (accion.tipo === 'error') { errores.push({ f, motivo: accion.motivo }); continue; }

    if (accion.tipo === 'unica') { unicas.push({ f, id: tarea.id }); continue; }
    if (accion.tipo === 'no-aplica') {
      noAplican.push({ f, id: tarea.id, regs: tarea.aircraftLinks.map((l) => l.aircraft.registration) });
      continue;
    }

    const antes = describir({
      horas: tarea.intervalHours != null ? Number(tarea.intervalHours) : null,
      ciclos: tarea.intervalCycles, meses: tarea.intervalCalendarMonths, dias: tarea.intervalCalendarDays,
    }) || '(ninguno)';
    intervalos.push({ f, id: tarea.id, limites: accion.limites, antes });
  }

  if (intervalos.length) {
    console.log(`Se les fija intervalo (${intervalos.length}) — vale para toda la flota:`);
    for (const i of intervalos) {
      console.log(`  ${i.f.code.padEnd(26)} ${i.antes}  →  ${describir(i.limites)}   [${tipoDe(i.limites)}]`);
    }
    console.log('');
  }
  if (unicas.length) {
    console.log(`Se marcan de cumplimiento único (${unicas.length}):`);
    for (const u of unicas) console.log(`  ${u.f.code.padEnd(26)} recurrencia → ONE_TIME, sin intervalo`);
    console.log('');
  }
  if (noAplican.length) {
    console.log(`Se sacan del plan (${noAplican.length}) — solo de las aeronaves donde están activas:`);
    for (const n of noAplican) console.log(`  ${n.f.code.padEnd(26)} ${n.regs.join(', ') || '(ninguna activa)'}`);
    console.log('');
  }
  if (errores.length) {
    console.log(`⚠️  No se pueden aplicar (${errores.length}):`);
    for (const e of errores) console.log(`  ${e.f.code.padEnd(26)} ${e.motivo}`);
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry-run: no se escribió nada. Ejecuta con --apply para persistir.\n');
    return;
  }

  for (const i of intervalos) {
    await prisma.maintenanceTask.update({
      where: { id: i.id },
      data: {
        intervalType: tipoDe(i.limites),
        intervalHours: i.limites.horas, intervalCycles: i.limites.ciclos,
        intervalCalendarMonths: i.limites.meses, intervalCalendarDays: i.limites.dias,
        // Si tiene intervalo, se repite: dejarla UNSPECIFIED la volvería a
        // esconder en el próximo triaje.
        complianceRecurrence: 'REPETITIVE',
      },
    });
    console.log(`  ✓ ${i.f.code} → ${describir(i.limites)}`);
  }
  for (const u of unicas) {
    await prisma.maintenanceTask.update({
      where: { id: u.id },
      data: { complianceRecurrence: 'ONE_TIME' },
    });
    console.log(`  ✓ ${u.f.code} → cumplimiento único`);
  }
  for (const n of noAplican) {
    const res = await prisma.aircraftTask.updateMany({
      where: { taskId: n.id, isActive: true },
      data: { isActive: false, applicabilityNotes: MOTIVO_NO_APLICA, applicabilityChangedAt: new Date() },
    });
    console.log(`  ✓ ${n.f.code} → fuera del plan de ${res.count} aeronave(s)`);
  }

  console.log(`\n✅ ${intervalos.length + unicas.length + noAplican.length} AD actualizadas.\n`);
}

main()
  .catch((err) => {
    console.error('apply_ad_intervals failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
