/**
 * apply_all_migrations.ts
 *
 * Aplica todas las migraciones manuales de prisma/manual_migrations en orden
 * cronológico (el nombre del archivo empieza con la fecha). Pensado para una
 * base nueva en producción: correrlo una vez deja el esquema al día sin tener
 * que ejecutar los 23 scripts prisma:apply:* uno por uno.
 *
 * Cada archivo ya es idempotente (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT
 * EXISTS, etc.), así que volver a correrlo sobre una base ya migrada no rompe
 * nada — se detiene en el primer error real.
 *
 * Uso:
 *   npx tsx prisma/apply_all_migrations.ts
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const DIR = path.join(__dirname, 'manual_migrations');
const SCHEMA = path.join(__dirname, 'schema.prisma');

function main(): void {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('No hay migraciones en prisma/manual_migrations.');
    return;
  }

  console.log(`Aplicando ${files.length} migraciones en orden:\n`);

  for (const [i, file] of files.entries()) {
    const filePath = path.join(DIR, file);
    process.stdout.write(`  [${i + 1}/${files.length}] ${file} ... `);
    try {
      execFileSync(
        'npx',
        ['prisma', 'db', 'execute', '--schema', SCHEMA, '--file', filePath],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      console.log('ok');
    } catch (error) {
      console.log('FALLÓ');
      const err = error as { stdout?: Buffer; stderr?: Buffer };
      if (err.stdout) process.stdout.write(err.stdout.toString());
      if (err.stderr) process.stderr.write(err.stderr.toString());
      console.error(`\nSe detuvo en ${file}. Corrige el error antes de continuar; las anteriores ya quedaron aplicadas.`);
      process.exit(1);
    }
  }

  console.log('\nTodas las migraciones se aplicaron correctamente.');
}

main();
