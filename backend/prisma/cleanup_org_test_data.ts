import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';

dotenv.config();

const DEFAULT_ORG_ID = '62dac606-0611-4ac1-9cc5-17744be7d16e';

const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.split('=')[1];

  const index = args.indexOf(name);
  if (index === -1) return undefined;

  const next = args[index + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

const orgId = getArgValue('--organization-id') ?? DEFAULT_ORG_ID;
const dryRun = args.includes('--dry-run');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

type FkBlocker = {
  referencing_table: string;
  constraint_name: string;
  referencing_column: string;
  delete_rule: string;
};

const DELETE_SCOPE_TABLES = [
  'compliance',
  'aircraft_engine_usage_logs',
  'aircraft_engines',
  'work_request_items (via cascade from work_requests)',
  'work_requests',
  'discrepancies',
  'work_order_tasks',
  'work_orders',
  'aircraft_usage_logs',
  'aircraft_tasks',
  'aircraft_assigned_plans',
  'component_applications',
  'component_movements',
  'components',
  'aircraft',
];

const PRESERVE_TABLES = [
  'organizations',
  'users',
  'maintenance_tasks',
  'maintenance_templates',
  'maintenance_template_tasks',
  'maintenance library / base reusable tasks',
  'regulatory base tables',
  'master data tables',
];

type CleanupOperation = {
  key: string;
  tableName: string;
  count: () => Promise<number>;
  deleteInTx: (tx: Prisma.TransactionClient) => Promise<number>;
};

async function getExistingTables(tableNames: string[]): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${tableNames})
  `;
  return new Set(rows.map((row) => row.table_name));
}

async function main(): Promise<void> {
  if (!orgId) {
    throw new Error('Missing organization id. Use --organization-id=<uuid>.');
  }

  console.log('');
  console.log('=== Cleanup Test Data By Organization ===');
  console.log(`Organization: ${orgId}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no delete)' : 'DELETE'}`);
  console.log('');

  console.log('Tables to DELETE (operational scope only):');
  for (const table of DELETE_SCOPE_TABLES) {
    console.log(`- ${table}`);
  }
  console.log('');

  console.log('Tables to PRESERVE:');
  for (const table of PRESERVE_TABLES) {
    console.log(`- ${table}`);
  }
  console.log('');

  const operations: CleanupOperation[] = [
    {
      key: 'compliance',
      tableName: 'compliances',
      count: () => prisma.compliance.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.compliance.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'aircraftEngineUsageLog',
      tableName: 'aircraft_engine_usage_logs',
      count: () => prisma.aircraftEngineUsageLog.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.aircraftEngineUsageLog.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'aircraftEngine',
      tableName: 'aircraft_engines',
      count: () => prisma.aircraftEngine.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.aircraftEngine.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'workRequestItem',
      tableName: 'work_request_items',
      count: () => prisma.workRequestItem.count({ where: { workRequest: { organizationId: orgId } } }),
      deleteInTx: (tx) => tx.workRequestItem.deleteMany({ where: { workRequest: { organizationId: orgId } } }).then((r) => r.count),
    },
    {
      key: 'workRequest',
      tableName: 'work_requests',
      count: () => prisma.workRequest.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.workRequest.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'discrepancy',
      tableName: 'discrepancies',
      count: () => prisma.discrepancy.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.discrepancy.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'workOrderTask',
      tableName: 'work_order_tasks',
      count: () => prisma.workOrderTask.count({ where: { workOrder: { organizationId: orgId } } }),
      deleteInTx: (tx) => tx.workOrderTask.deleteMany({ where: { workOrder: { organizationId: orgId } } }).then((r) => r.count),
    },
    {
      key: 'workOrder',
      tableName: 'work_orders',
      count: () => prisma.workOrder.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.workOrder.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'aircraftUsageLog',
      tableName: 'aircraft_usage_logs',
      count: () => prisma.aircraftUsageLog.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.aircraftUsageLog.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'aircraftTask',
      tableName: 'aircraft_tasks',
      count: () => prisma.aircraftTask.count({ where: { aircraft: { organizationId: orgId } } }),
      deleteInTx: (tx) => tx.aircraftTask.deleteMany({ where: { aircraft: { organizationId: orgId } } }).then((r) => r.count),
    },
    {
      key: 'aircraftAssignedPlan',
      tableName: 'aircraft_assigned_plans',
      count: () => prisma.aircraftAssignedPlan.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.aircraftAssignedPlan.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'componentApplication',
      tableName: 'component_applications',
      count: () => prisma.componentApplication.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.componentApplication.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'componentMovement',
      tableName: 'component_movements',
      count: () => prisma.componentMovement.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.componentMovement.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'component',
      tableName: 'components',
      count: () => prisma.component.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.component.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
    {
      key: 'aircraft',
      tableName: 'aircraft',
      count: () => prisma.aircraft.count({ where: { organizationId: orgId } }),
      deleteInTx: (tx) => tx.aircraft.deleteMany({ where: { organizationId: orgId } }).then((r) => r.count),
    },
  ];

  const existingTables = await getExistingTables(operations.map((op) => op.tableName));
  const unavailableTables = new Set<string>(
    operations
      .filter((op) => !existingTables.has(op.tableName))
      .map((op) => op.tableName),
  );

  const orgExists = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });

  if (!orgExists) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  const fkBlockers = await prisma.$queryRaw<FkBlocker[]>`
    SELECT
      tc.table_name::text AS referencing_table,
      tc.constraint_name::text AS constraint_name,
      kcu.column_name::text AS referencing_column,
      rc.delete_rule::text AS delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = rc.unique_constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'aircraft'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name
  `;

  console.log('FK constraints referencing aircraft (inspection):');
  for (const blocker of fkBlockers) {
    console.log(
      `- ${blocker.referencing_table}.${blocker.referencing_column} (${blocker.constraint_name}) delete_rule=${blocker.delete_rule}`,
    );
  }
  console.log('');

  const counts = Object.fromEntries(
    await Promise.all(
      operations.map(async (op) => [
        op.key,
        existingTables.has(op.tableName) ? await op.count() : null,
      ] as const),
    ),
  ) as Record<string, number | null>;

  if (unavailableTables.size > 0) {
    console.log('Operational tables not found in current DB (skipped as N/A):');
    for (const table of unavailableTables) {
      console.log(`- ${table}`);
    }
    console.log('');
  }

  console.log('Rows matching filter:');
  console.log(`- Compliance: ${counts.compliance ?? 'N/A'}`);
  console.log(`- AircraftEngineUsageLog: ${counts.aircraftEngineUsageLog ?? 'N/A'}`);
  console.log(`- AircraftEngine: ${counts.aircraftEngine ?? 'N/A'}`);
  console.log(`- WorkRequestItem: ${counts.workRequestItem ?? 'N/A'}`);
  console.log(`- WorkRequest: ${counts.workRequest ?? 'N/A'}`);
  console.log(`- Discrepancy: ${counts.discrepancy ?? 'N/A'}`);
  console.log(`- WorkOrderTask: ${counts.workOrderTask ?? 'N/A'}`);
  console.log(`- WorkOrder: ${counts.workOrder ?? 'N/A'}`);
  console.log(`- AircraftUsageLog: ${counts.aircraftUsageLog ?? 'N/A'}`);
  console.log(`- AircraftTask: ${counts.aircraftTask ?? 'N/A'}`);
  console.log(`- AircraftAssignedPlan: ${counts.aircraftAssignedPlan ?? 'N/A'}`);
  console.log(`- ComponentApplication: ${counts.componentApplication ?? 'N/A'}`);
  console.log(`- ComponentMovement: ${counts.componentMovement ?? 'N/A'}`);
  console.log(`- Component: ${counts.component ?? 'N/A'}`);
  console.log(`- Aircraft: ${counts.aircraft ?? 'N/A'}`);
  console.log('');

  if (dryRun) {
    console.log('Dry-run finished. No rows were deleted.');
    return;
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const totals: Record<string, number> = {};
    for (const op of operations) {
      if (!existingTables.has(op.tableName)) {
        totals[op.key] = 0;
        continue;
      }
      totals[op.key] = await op.deleteInTx(tx);
    }
    return totals;
  });

  console.log('Deleted rows:');
  console.log(`- Compliance: ${deleted.compliance}`);
  console.log(`- AircraftEngineUsageLog: ${deleted.aircraftEngineUsageLog}`);
  console.log(`- AircraftEngine: ${deleted.aircraftEngine}`);
  console.log(`- WorkRequestItem: ${deleted.workRequestItem}`);
  console.log(`- WorkRequest: ${deleted.workRequest}`);
  console.log(`- Discrepancy: ${deleted.discrepancy}`);
  console.log(`- WorkOrderTask: ${deleted.workOrderTask}`);
  console.log(`- WorkOrder: ${deleted.workOrder}`);
  console.log(`- AircraftUsageLog: ${deleted.aircraftUsageLog}`);
  console.log(`- AircraftTask: ${deleted.aircraftTask}`);
  console.log(`- AircraftAssignedPlan: ${deleted.aircraftAssignedPlan}`);
  console.log(`- ComponentApplication: ${deleted.componentApplication}`);
  console.log(`- ComponentMovement: ${deleted.componentMovement}`);
  console.log(`- Component: ${deleted.component}`);
  console.log(`- Aircraft: ${deleted.aircraft}`);
  console.log('');
  console.log('Cleanup completed.');
}

main()
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
