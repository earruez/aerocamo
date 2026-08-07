import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

type CsvRow = Record<string, string>;

type Domain = 'COMP' | 'AD' | 'IN' | 'SB' | 'MIM' | 'OTHER';

interface DomainSummary {
  domain: Domain;
  count: number;
}

interface ComponentOmission {
  row: number;
  ide: string;
  pn: string;
  sn: string;
  reason: string;
  objeto: string;
}

interface SerialInference {
  row: number;
  ide: string;
  pn: string;
  originalSn: string;
  inferredSn: string;
  sourceText: string;
  rule: string;
}

interface MotorOmission {
  row: number;
  ide: string;
  mat: string;
  serie: string;
  pos: string;
  n1: string;
  n2: string;
  hs: string;
  hstot: string;
  reason: string;
}

interface MappingReportV2 {
  generatedAt: string;
  csvDir: string;
  sources: {
    itemFile: string | null;
    itemRows: number;
    itemColumns: string[];
    eqFile: string | null;
    eqRows: number;
  };
  outputs: {
    motores: {
      generated: number;
      omitted: number;
    };
    componentes: {
      generated: number;
      omitted: number;
      manualReview: number;
    };
    tasksDetectedFromItem: number;
  };
  domainCounts: DomainSummary[];
  serialInference: {
    count: number;
    rows: SerialInference[];
  };
  rejectedSerials: Array<{
    row: number;
    serial: string;
    reason: string;
  }>;
  omittedMotors: MotorOmission[];
  omittedComponents: ComponentOmission[];
  unresolvedRelations: {
    motoresFromEq: Array<{
      row: number;
      ide: string;
      reason: string;
    }>;
    itemToEqByIde: Array<{
      row: number;
      ide: string;
      reason: string;
    }>;
  };
  comparisonV1V2: {
    v1Generated: number;
    v1Omitted: number;
    v2Generated: number;
    v2Omitted: number;
    deltaGenerated: number;
    deltaOmitted: number;
    tasksDetectedFromItem: number;
    manualReviewRows: number;
  };
}

interface ItemDomainReport {
  generatedAt: string;
  csvDir: string;
  domainCounts: DomainSummary[];
  taskLikeDomains: {
    total: number;
    byDomain: Array<{ domain: 'AD' | 'IN' | 'SB' | 'MIM'; count: number }>;
  };
  componentDomain: {
    totalCompRows: number;
    generatedComponents: number;
    omittedComponents: number;
  };
  manualReview: {
    totalRows: number;
    reasons: Array<{ reason: string; count: number }>;
  };
}

const args = process.argv.slice(2);
const csvDirArg =
  args.find((arg) => arg.startsWith('--csv-dir='))?.split('=')[1] ??
  args[args.indexOf('--csv-dir') + 1] ??
  path.join(__dirname, '..', 'data');

const CSV_DIR = path.resolve(csvDirArg);

function clean(value: string): string {
  return String(value ?? '').trim();
}

function get(row: CsvRow, ...keys: string[]): string {
  const sourceKeys = Object.keys(row);
  for (const key of keys) {
    if (row[key] != null) return clean(row[key]);
    const found = sourceKeys.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found) return clean(row[found]);
  }
  return '';
}

function normalizeSerial(value: string): string {
  return clean(value).toUpperCase().replace(/\s+/g, ' ').trim();
}

function toNumber(value: string): number | null {
  const s = clean(value).replace(',', '.').replace(/\s+/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isPlaceholderSerial(value: string): boolean {
  const serial = normalizeSerial(value).replace(/\s+/g, '');
  const placeholders = new Set([
    '',
    'N/A',
    'NA',
    'S/S',
    'SS',
    'SS/N',
    'SSN',
    'S/SN',
    'S S/N'.replace(/\s+/g, ''),
    'SIN SERIE'.replace(/\s+/g, ''),
    'SIN-SERIE'.replace(/\s+/g, ''),
    'NONE',
    'NOAPLICA',
  ]);
  return placeholders.has(serial);
}

function parseDomain(rawTipo: string): Domain {
  const tipo = clean(rawTipo).toUpperCase();
  if (tipo === 'COMP') return 'COMP';
  if (tipo === 'AD') return 'AD';
  if (tipo === 'IN') return 'IN';
  if (tipo === 'SB') return 'SB';
  if (tipo === 'MIM') return 'MIM';
  return 'OTHER';
}

function inferSerialFromObjeto(objeto: string): string | null {
  const text = clean(objeto);
  if (!text) return null;

  // Strict patterns: S/N, SN, SERIE followed by a valid token.
  const regex = /\b(?:S\/?N|SN|SERIE)\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-\/.]{1,})/i;
  const match = text.match(regex);
  if (!match) return null;

  const candidate = normalizeSerial(match[1]);
  if (!candidate || isPlaceholderSerial(candidate)) return null;
  return candidate;
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
  if (!fs.existsSync(filePath)) return [];

  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    fs.createReadStream(filePath, { encoding: 'utf-8' })
      .pipe(csv({ separator: ',', mapHeaders: ({ header }) => clean(header).replace(/^\uFEFF/, '') }))
      .on('data', (row) => {
        const cleanRow: CsvRow = {};
        for (const [k, v] of Object.entries(row)) {
          cleanRow[clean(k)] = clean(String(v ?? ''));
        }
        rows.push(cleanRow);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function toCsv(rows: CsvRow[], headers: string[]): string {
  const escapeCsv = (value: string): string => {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const out: string[] = [headers.join(',')];
  for (const row of rows) {
    out.push(headers.map((header) => escapeCsv(row[header] ?? '')).join(','));
  }
  return `${out.join('\n')}\n`;
}

function countByReason(rows: ComponentOmission[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function resolveCsvFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const full = path.join(CSV_DIR, candidate);
    if (fs.existsSync(full)) return candidate;
  }
  return null;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CSV_DIR)) {
    throw new Error(`CSV directory does not exist: ${CSV_DIR}`);
  }

  const itemFile = resolveCsvFile(['ITEM.csv', 'item.csv']);
  const eqFile = resolveCsvFile(['EQ.csv', 'eq.csv']);

  if (!itemFile) {
    throw new Error('ITEM.csv not found in csv-dir');
  }

  const itemPath = path.join(CSV_DIR, itemFile);
  const eqPath = eqFile ? path.join(CSV_DIR, eqFile) : null;

  const itemRows = await readCsv(itemPath);
  const eqRows = eqPath ? await readCsv(eqPath) : [];

  const eqByIde = new Map<string, string>();
  for (const row of eqRows) {
    const ide = get(row, 'IDE', 'ide');
    const mat = get(row, 'MAT', 'Mat', 'mat');
    if (ide) eqByIde.set(ide, mat);
  }

  const motoresRows: CsvRow[] = [];
  const omittedMotors: MotorOmission[] = [];
  const unresolvedMotoresFromEq: Array<{ row: number; ide: string; reason: string }> = [];

  for (let idx = 0; idx < eqRows.length; idx++) {
    const row = eqRows[idx];
    const rowNum = idx + 2;

    const ide = get(row, 'IDE', 'ide');
    const mat = get(row, 'MAT', 'mat');
    const serie = get(row, 'SERIE', 'serie');
    const fabricante = get(row, 'MARCA', 'FABRICANTE', 'manufacturer');
    const modelo = get(row, 'MODELO', 'model');
    const posRaw = get(row, 'POS', 'Pos', 'pos');
    const n1Raw = get(row, 'N1', 'n1');
    const n2Raw = get(row, 'N2', 'n2');
    const hsRaw = get(row, 'HS', 'hs');
    const hsTotRaw = get(row, 'HSTOT', 'hstot');

    if (!mat || !serie) {
      omittedMotors.push({
        row: rowNum,
        ide,
        mat,
        serie,
        pos: posRaw,
        n1: n1Raw,
        n2: n2Raw,
        hs: hsRaw,
        hstot: hsTotRaw,
        reason: 'Missing MAT or SERIE',
      });
      continue;
    }

    let posicion = '';
    if (posRaw === '1') posicion = 'N1';
    if (posRaw === '2') posicion = 'N2';

    if (!posicion) {
      omittedMotors.push({
        row: rowNum,
        ide,
        mat,
        serie,
        pos: posRaw,
        n1: n1Raw,
        n2: n2Raw,
        hs: hsRaw,
        hstot: hsTotRaw,
        reason: 'POS missing or unsupported (only 1/2 accepted)',
      });
      unresolvedMotoresFromEq.push({ row: rowNum, ide, reason: 'POS does not map to N1/N2' });
      continue;
    }

    const hrs = toNumber(hsRaw) ?? toNumber(hsTotRaw);
    if (hrs == null) {
      omittedMotors.push({
        row: rowNum,
        ide,
        mat,
        serie,
        pos: posRaw,
        n1: n1Raw,
        n2: n2Raw,
        hs: hsRaw,
        hstot: hsTotRaw,
        reason: 'HRS unavailable (HS and HSTOT invalid)',
      });
      continue;
    }

    const cng = posicion === 'N1' ? toNumber(n1Raw) : toNumber(n2Raw);
    if (cng == null) {
      omittedMotors.push({
        row: rowNum,
        ide,
        mat,
        serie,
        pos: posRaw,
        n1: n1Raw,
        n2: n2Raw,
        hs: hsRaw,
        hstot: hsTotRaw,
        reason: `CNG unavailable for ${posicion}`,
      });
      continue;
    }

    motoresRows.push({
      MAT: mat,
      POSICION: posicion,
      SERIE: serie,
      FABRICANTE: fabricante,
      MODELO: modelo,
      HRS: String(hrs),
      CNG: String(cng),
    });
  }

  const domainCounter = new Map<Domain, number>();
  const unresolvedIde: Array<{ row: number; ide: string; reason: string }> = [];
  const omissions: ComponentOmission[] = [];
  const inferredSerials: SerialInference[] = [];
  const rejectedSerials: Array<{ row: number; serial: string; reason: string }> = [];

  const componentesRows: CsvRow[] = [];

  for (let idx = 0; idx < itemRows.length; idx++) {
    const row = itemRows[idx];
    const rowNum = idx + 2;

    const domain = parseDomain(get(row, 'TIPO', 'tipo'));
    domainCounter.set(domain, (domainCounter.get(domain) ?? 0) + 1);

    if (domain !== 'COMP') {
      continue;
    }

    const ide = get(row, 'IDE', 'ide');
    const mat = ide ? (eqByIde.get(ide) ?? '') : '';
    if (ide && !mat) {
      unresolvedIde.push({ row: rowNum, ide, reason: 'IDE not found in EQ.csv for MAT lookup' });
    }

    const pn = get(row, 'PN', 'pn');
    const rawSn = get(row, 'SN', 'S/N', 'sn', 'SERIE', 'serie');
    const objeto = get(row, 'OBJETO', 'objeto');

    if (!pn) {
      omissions.push({
        row: rowNum,
        ide,
        pn,
        sn: rawSn,
        reason: 'Missing PN',
        objeto,
      });
      continue;
    }

    let finalSn = normalizeSerial(rawSn);
    if (!finalSn || isPlaceholderSerial(finalSn)) {
      const inferred = inferSerialFromObjeto(objeto);
      if (inferred) {
        inferredSerials.push({
          row: rowNum,
          ide,
          pn,
          originalSn: finalSn,
          inferredSn: inferred,
          sourceText: objeto,
          rule: 'Strict SN inference from OBJETO using S/N|SN|SERIE token',
        });
        finalSn = inferred;
      }
    }

    if (!finalSn || isPlaceholderSerial(finalSn)) {
      rejectedSerials.push({
        row: rowNum,
        serial: finalSn,
        reason: 'Invalid serial after placeholder filter and inference',
      });
      omissions.push({
        row: rowNum,
        ide,
        pn,
        sn: rawSn,
        reason: 'Invalid or placeholder SN',
        objeto,
      });
      continue;
    }

    componentesRows.push({
      MAT: mat,
      PN: pn,
      SN: finalSn,
      DESCRIPCION: objeto,
      IDE_ORIGEN: ide,
      DOMINIO_ORIGEN: domain,
      _FULT: get(row, 'FULT', 'fult'),
      _OBS: get(row, 'OBS', 'obs'),
    });
  }

  // El mismo S/N puede aparecer en varias aeronaves (historial de rotación en Access)
  // y la base impone S/N único por organización: gana la fila con actividad más
  // reciente. La actividad se estima con la fecha FULT y con el año de la referencia
  // de OT en la observación ("OT DET/05-2026" > FULT 2023 de la aeronave anterior),
  // porque las filas controladas solo por horas no traen fecha.
  const parseFult = (value: string | undefined): number => {
    const raw = (value ?? '').trim().split(' ')[0];
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return 0;
    let year = Number(m[3]);
    if (year < 100) year += year <= 68 ? 2000 : 1900;
    return Date.UTC(year, Number(m[1]) - 1, Number(m[2]));
  };
  const parseOtYear = (obs: string | undefined): number => {
    const match = (obs ?? '').match(/\bOT[\s.:]+([A-ZÑ0-9][A-ZÑ0-9/.\- ]{0,20})/i);
    if (!match) return 0;
    const tokens = match[1].match(/\d{2,4}/g) ?? [];
    const fourDigit = tokens.find((t) => /^20\d{2}$/.test(t));
    if (fourDigit) return Date.UTC(Number(fourDigit), 0, 1);
    const twoDigit = tokens.map(Number).find((n) => n >= 0 && n <= 49);
    if (twoDigit != null) return Date.UTC(2000 + twoDigit, 0, 1);
    return 0;
  };
  const activityScore = (row: CsvRow): number => Math.max(parseFult(row._FULT), parseOtYear(row._OBS));
  const duplicatedSerials: Array<{ sn: string; kept: string; discarded: string[] }> = [];
  const bySerial = new Map<string, CsvRow>();
  for (const row of componentesRows) {
    const key = row.SN;
    const current = bySerial.get(key);
    if (!current) {
      bySerial.set(key, row);
      continue;
    }
    const currentScore = activityScore(current);
    const candidateScore = activityScore(row);
    const winner = candidateScore > currentScore ? row : current;
    const loser = winner === row ? current : row;
    bySerial.set(key, winner);
    const existing = duplicatedSerials.find((d) => d.sn === key);
    if (existing) {
      existing.kept = `${winner.MAT}|${winner.PN}`;
      existing.discarded.push(`${loser.MAT}|${loser.PN}`);
    } else {
      duplicatedSerials.push({ sn: key, kept: `${winner.MAT}|${winner.PN}`, discarded: [`${loser.MAT}|${loser.PN}`] });
    }
  }
  const dedupedComponentesRows = Array.from(bySerial.values()).map((row) => {
    const { _FULT, _OBS, ...rest } = row;
    return rest;
  });
  componentesRows.length = 0;
  componentesRows.push(...dedupedComponentesRows);
  if (duplicatedSerials.length > 0) {
    fs.writeFileSync(
      path.join(CSV_DIR, 'componentes-duplicados-por-sn.json'),
      JSON.stringify(duplicatedSerials, null, 2),
      'utf-8',
    );
    console.log(`Seriales duplicados entre aeronaves resueltos por FULT: ${duplicatedSerials.length} (ver componentes-duplicados-por-sn.json)`);
  }

  const domainCounts: DomainSummary[] = Array.from(domainCounter.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  const v1ReportPath = path.join(CSV_DIR, 'mapping-report.json');
  let v1Generated = 0;
  let v1Omitted = 0;
  if (fs.existsSync(v1ReportPath)) {
    const v1 = JSON.parse(fs.readFileSync(v1ReportPath, 'utf-8'));
    v1Generated = Number(v1?.outputs?.componentes?.generated ?? 0);
    v1Omitted = Number(v1?.outputs?.componentes?.omitted ?? 0);
  }

  const taskLikeTotal = ['AD', 'IN', 'SB', 'MIM']
    .map((key) => domainCounter.get(key as Domain) ?? 0)
    .reduce((acc, value) => acc + value, 0);

  const mappingReportV2: MappingReportV2 = {
    generatedAt: new Date().toISOString(),
    csvDir: CSV_DIR,
    sources: {
      itemFile,
      itemRows: itemRows.length,
      itemColumns: Object.keys(itemRows[0] ?? {}),
      eqFile,
      eqRows: eqRows.length,
    },
    outputs: {
      motores: {
        generated: motoresRows.length,
        omitted: omittedMotors.length,
      },
      componentes: {
        generated: componentesRows.length,
        omitted: omissions.length,
        manualReview: omissions.length + unresolvedIde.length,
      },
      tasksDetectedFromItem: taskLikeTotal,
    },
    domainCounts,
    serialInference: {
      count: inferredSerials.length,
      rows: inferredSerials,
    },
    rejectedSerials,
    omittedMotors,
    omittedComponents: omissions,
    unresolvedRelations: {
      motoresFromEq: unresolvedMotoresFromEq,
      itemToEqByIde: unresolvedIde,
    },
    comparisonV1V2: {
      v1Generated,
      v1Omitted,
      v2Generated: componentesRows.length,
      v2Omitted: omissions.length,
      deltaGenerated: componentesRows.length - v1Generated,
      deltaOmitted: omissions.length - v1Omitted,
      tasksDetectedFromItem: taskLikeTotal,
      manualReviewRows: omissions.length + unresolvedIde.length,
    },
  };

  const itemDomainReport: ItemDomainReport = {
    generatedAt: new Date().toISOString(),
    csvDir: CSV_DIR,
    domainCounts,
    taskLikeDomains: {
      total: taskLikeTotal,
      byDomain: (['AD', 'IN', 'SB', 'MIM'] as const)
        .map((domain) => ({ domain, count: domainCounter.get(domain) ?? 0 }))
        .sort((a, b) => b.count - a.count),
    },
    componentDomain: {
      totalCompRows: domainCounter.get('COMP') ?? 0,
      generatedComponents: componentesRows.length,
      omittedComponents: omissions.length,
    },
    manualReview: {
      totalRows: omissions.length + unresolvedIde.length,
      reasons: countByReason(omissions),
    },
  };

  const motoresCsv = toCsv(motoresRows, ['MAT', 'POSICION', 'SERIE', 'FABRICANTE', 'MODELO', 'HRS', 'CNG']);
  const componentesCsv = toCsv(componentesRows, ['MAT', 'PN', 'SN', 'DESCRIPCION', 'IDE_ORIGEN', 'DOMINIO_ORIGEN']);
  fs.writeFileSync(path.join(CSV_DIR, 'motores.csv'), motoresCsv, 'utf-8');
  fs.writeFileSync(path.join(CSV_DIR, 'componentes.csv'), componentesCsv, 'utf-8');
  fs.writeFileSync(path.join(CSV_DIR, 'mapping-report-v2.json'), JSON.stringify(mappingReportV2, null, 2), 'utf-8');
  fs.writeFileSync(path.join(CSV_DIR, 'item-domain-report.json'), JSON.stringify(itemDomainReport, null, 2), 'utf-8');

  console.log('Transform v2 completed');
  console.log(`motores.csv rows: ${motoresRows.length}`);
  console.log(`componentes.csv rows: ${componentesRows.length}`);
  console.log(`mapping-report-v2.json generated`);
  console.log(`item-domain-report.json generated`);
}

main().catch((error) => {
  console.error('transform_access_csv_v2 failed:', error);
  process.exit(1);
});
