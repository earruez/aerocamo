/**
 * load_pending_ad_compliances.ts
 *
 * Crea en la plataforma los cumplimientos de AD que Access declara ejecutados y
 * que check_pending_ad_compliances.ts identificó como faltantes.
 *
 * ── El problema de las horas ────────────────────────────────────────────────
 * Access registra la FECHA del cumplimiento pero no las horas de aeronave:
 * HORAS_AERONAVE en ot_normalizado.csv y HSTOT en OT.csv vienen vacíos para
 * estas OT. Y esas aeronaves no tienen historial de horas con qué interpolar.
 *
 * Eso obliga a una distinción que NO es cosmética:
 *
 *   · AD que vence solo por calendario → la fecha basta. Se carga completa.
 *   · AD que vence por horas           → sin horas no se puede calcular el
 *                                        próximo vencimiento. Cargarla igual la
 *                                        sacaría de "vencida" sin que nadie
 *                                        sepa si lo está: el motor no puede
 *                                        comparar contra un límite que no tiene.
 *                                        Se OMITE y se reporta para que alguien
 *                                        aporte las horas desde la OT en papel.
 *
 * Dejar una AD visiblemente vencida es preferible a apagarla con un dato que no
 * tenemos. Con --horas se puede suministrar el valor y cargarla completa.
 *
 * ── NO APLICAR TODAVÍA ──────────────────────────────────────────────────────
 * El dry-run sobre producción destapó un problema anterior a esta carga: de las
 * tres AD que quedarían cargables, dos están declaradas REPETITIVE y no tienen
 * intervalo configurado (AD-2012-0257-E y AD-2021-0048-AS350B2). Cargarles un
 * cumplimiento las deja "cumplidas sin próximo vencimiento", o sea apagadas.
 *
 * AD-2012-0257-E aparece en NUEVE OT de CC-ABU entre 2023 y 2024: es repetitiva
 * sin lugar a dudas. Primero hay que configurarle el intervalo desde el texto
 * de la directiva; recién entonces tiene sentido cargar el cumplimiento.
 *
 * Ver check_ad_intervals.ts para el panorama completo.
 *
 * Uso:
 *   npx tsx prisma/load_pending_ad_compliances.ts --org-slug tecnicopters \
 *     --performed-by "Griselle" [--horas CC-ABU:2012-0257-E=4100.5] [--apply]
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
const PERFORMED_BY = getArgValue('--performed-by') ?? 'Griselle';
const CSV = path.resolve(getArgValue('--csv') ?? path.join(__dirname, '..', 'data', 'ot-task-mapping-pending.csv'));
const APPLY = args.includes('--apply');

/** --horas CC-ABU:2012-0257-E=4100.5,CC-DET:2023-0064=2210 */
const HORAS = new Map<string, number>();
for (const par of (getArgValue('--horas') ?? '').split(',').filter(Boolean)) {
  const [clave, valor] = par.split('=');
  if (clave && valor) HORAS.set(clave.trim().toUpperCase(), Number(valor));
}

const MARCA = '[IMPORT ACCESS OT-AD]';

function extraerAd(texto: string): string | null {
  const m = texto.match(/\bAD\s*[- ]?\s*(\d{4}[-–]\d{2,4}(?:[-–][A-Z]{1,2})?)/i);
  return m ? m[1].replace(/–/g, '-').toUpperCase() : null;
}
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

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

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`No existe una organización con slug "${ORG_SLUG}"`);

  const performer = await prisma.user.findFirst({
    where: { organizationId: org.id, name: { contains: PERFORMED_BY, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!performer) throw new Error(`No se encontró ningún usuario cuyo nombre contenga "${PERFORMED_BY}"`);

  const filas = (await leerCsv(CSV))
    .map((f) => ({ ...f, ad: extraerAd(f.origen) }))
    .filter((f): f is Fila & { ad: string } => f.ad != null);

  const tareasAd = await prisma.maintenanceTask.findMany({
    where: { organizationId: org.id, referenceType: 'AD' },
    select: {
      id: true, code: true, title: true, referenceNumber: true,
      intervalHours: true, intervalCycles: true,
      intervalCalendarDays: true, intervalCalendarMonths: true,
    },
  });
  const porNumero = new Map<string, typeof tareasAd>();
  for (const t of tareasAd) {
    for (const cand of [t.code, t.referenceNumber ?? '']) {
      const k = norm(extraerAd(cand) ?? cand);
      if (k.length >= 6) porNumero.set(k, [...(porNumero.get(k) ?? []), t]);
    }
  }

  const aeronaves = await prisma.aircraft.findMany({
    where: { organizationId: org.id },
    select: { id: true, registration: true },
  });
  const porMatricula = new Map(aeronaves.map((a) => [a.registration, a]));

  // Agrupado por aeronave × AD: varias OT de la misma AD son un solo control.
  const grupos = new Map<string, { reg: string; ad: string; fechas: string[]; ots: Set<string> }>();
  for (const f of filas) {
    const k = `${f.registration}|${norm(f.ad)}`;
    const g = grupos.get(k) ?? { reg: f.registration, ad: f.ad, fechas: [], ots: new Set<string>() };
    if (f.performedAt) g.fechas.push(f.performedAt);
    g.ots.add(f.numOt);
    grupos.set(k, g);
  }

  const aCargar: Array<{
    reg: string; ad: string; aircraftId: string; taskId: string; code: string;
    fecha: Date; ots: string; horas: number | null;
    nextDueDate: Date | null; nextDueHours: number | null;
  }> = [];
  const faltanHoras: Array<{ reg: string; ad: string; code: string; fecha: string; limite: string }> = [];
  let omitidas = 0;

  for (const g of grupos.values()) {
    const ac = porMatricula.get(g.reg);
    const tareas = porNumero.get(norm(g.ad)) ?? [];
    const ultima = g.fechas.sort().at(-1);
    if (!ac || tareas.length === 0 || !ultima) { omitidas += 1; continue; }

    const enlace = await prisma.aircraftTask.findFirst({
      where: { aircraftId: ac.id, taskId: { in: tareas.map((t) => t.id) }, isActive: true },
      select: { taskId: true },
    });
    if (!enlace) { omitidas += 1; continue; }

    const fecha = new Date(ultima);
    const existente = await prisma.compliance.findFirst({
      where: {
        aircraftId: ac.id, taskId: enlace.taskId,
        applicationType: { not: 'baseline' }, performedAt: { gte: fecha },
      },
      select: { id: true },
    });
    if (existente) { omitidas += 1; continue; }

    const tarea = tareas.find((t) => t.id === enlace.taskId)!;
    const porHoras = tarea.intervalHours != null || tarea.intervalCycles != null;
    const horasDadas = HORAS.get(`${g.reg}:${g.ad}`.toUpperCase()) ?? null;

    if (porHoras && horasDadas == null) {
      const limite = [
        tarea.intervalHours != null ? `${Number(tarea.intervalHours)} h` : null,
        tarea.intervalCycles != null ? `${tarea.intervalCycles} ciclos` : null,
      ].filter(Boolean).join(' / ');
      faltanHoras.push({ reg: g.reg, ad: g.ad, code: tarea.code, fecha: ultima, limite });
      continue;
    }

    // Calendario: se puede calcular con solo la fecha.
    let nextDueDate: Date | null = null;
    const meses = tarea.intervalCalendarMonths;
    const dias = tarea.intervalCalendarDays;
    if (meses != null) { nextDueDate = new Date(fecha); nextDueDate.setMonth(nextDueDate.getMonth() + meses); }
    else if (dias != null) { nextDueDate = new Date(fecha.getTime() + dias * 86400000); }

    const nextDueHours = horasDadas != null && tarea.intervalHours != null
      ? horasDadas + Number(tarea.intervalHours)
      : null;

    aCargar.push({
      reg: g.reg, ad: g.ad, aircraftId: ac.id, taskId: enlace.taskId, code: tarea.code,
      fecha, ots: [...g.ots].sort().join(', '), horas: horasDadas, nextDueDate, nextDueHours,
    });
  }

  console.log(`\n=== Cargar cumplimientos de AD desde Access — ${ORG_SLUG} ===`);
  console.log(`A nombre de: ${performer.name}\n`);

  console.log(`Se cargan (${aCargar.length}):`);
  for (const c of aCargar) {
    console.log(`  ${c.reg}  AD ${c.ad.padEnd(12)} cumplida ${c.fecha.toISOString().slice(0, 10)}`
      + `${c.horas != null ? ` a ${c.horas} h` : ''}  OT ${c.ots}`);
    console.log(`      tarea ${c.code} → próximo vencimiento `
      + `${c.nextDueDate ? c.nextDueDate.toISOString().slice(0, 10) : '—'}`
      + `${c.nextDueHours != null ? ` / ${c.nextDueHours} h` : ''}`);
  }

  if (faltanHoras.length) {
    console.log(`\n⚠️  Se OMITEN por falta de horas (${faltanHoras.length}):`);
    console.log('    Access no registra las horas de aeronave en estas OT, y sin ellas no se');
    console.log('    puede calcular el vencimiento. Cargarlas igual las sacaría de "vencida"');
    console.log('    sin saber si lo están. Consigue las horas de la OT en papel y pásalas');
    console.log('    con --horas para cargarlas completas.\n');
    for (const f of faltanHoras) {
      console.log(`    ${f.reg}  AD ${f.ad.padEnd(12)} cumplida ${f.fecha}  intervalo ${f.limite}`);
      console.log(`        --horas "${f.reg}:${f.ad}=<horas>"`);
    }
  }
  if (omitidas) console.log(`\n(${omitidas} combinaciones ya cubiertas o fuera de plan, sin cambios)`);

  if (!APPLY) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --apply para persistir.');
    return;
  }

  for (const c of aCargar) {
    await prisma.compliance.create({
      data: {
        organizationId: org.id, aircraftId: c.aircraftId, taskId: c.taskId,
        performedById: performer.id,
        performedAt: c.fecha,
        aircraftHoursAtCompliance: c.horas,
        nextDueHours: c.nextDueHours,
        nextDueDate: c.nextDueDate,
        workOrderNumber: c.ots.split(',')[0].trim(),
        applicationType: 'application',
        status: 'COMPLETED',
        notes: `${MARCA} AD ${c.ad} — cumplida según Access, OT ${c.ots}.`
          + `${c.horas == null ? ' Access no registra horas de aeronave en esta OT.' : ''}`,
      },
    });
    console.log(`  ✓ ${c.reg} AD ${c.ad}`);
  }
  console.log(`\n✅ ${aCargar.length} cumplimientos de AD cargados.`);
}

main()
  .catch((err) => {
    console.error('load_pending_ad_compliances failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
