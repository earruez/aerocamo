import { prisma } from '../infrastructure/database/prisma.client';
import { ComponentTrackingBackfillService } from '../domain/services/ComponentTrackingBackfillService';

async function main() {
  const startedAt = Date.now();
  const service = new ComponentTrackingBackfillService();

  const report = await service.run();

  const durationMs = Date.now() - startedAt;
  const payload = {
    status: 'ok',
    durationMs,
    report,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((err) => {
    console.error('[component-tracking-backfill] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
