import { AddressInfo, Server } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { prisma } from '../infrastructure/database/prisma.client';

type ApiResponse = {
  status?: string;
  code?: string;
  message?: string;
  data?: any;
};

type Fixture = {
  organizationId: string;
  userId: string;
  userEmail: string;
  aircraftId: string;
  taskId: string;
  token: string;
};

let server: Server;
let baseUrl = '';
const organizationsToCleanup: string[] = [];
const RUN_DB_INTEGRATION_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === '1';

async function requestJson(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: ApiResponse }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiResponse,
  };
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function issueToken(input: { userId: string; userEmail: string; organizationId: string }): string {
  return jwt.sign(
    {
      sub: input.userId,
      email: input.userEmail,
      role: 'ADMIN',
      organizationId: input.organizationId,
    },
    process.env.JWT_SECRET as string,
  );
}

async function seedFixture(input?: {
  totalHours?: number;
  totalCycles?: number;
}): Promise<Fixture> {
  const organization = await prisma.organization.create({
    data: {
      name: unique('Org Phase7'),
      slug: unique('org-phase7').toLowerCase(),
      country: 'MX',
      subscriptionPlan: 'FREE',
      subscriptionStatus: 'TRIALING',
      isActive: true,
    },
  });

  organizationsToCleanup.push(organization.id);

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: `${unique('admin')}@example.com`.toLowerCase(),
      name: 'Admin Phase7',
      passwordHash: 'hashed-password',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const totalHours = input?.totalHours ?? 1200;
  const totalCycles = input?.totalCycles ?? 800;

  const aircraft = await prisma.aircraft.create({
    data: {
      organizationId: organization.id,
      registration: unique('XA-P7').toUpperCase(),
      model: 'B737-800',
      manufacturer: 'Boeing',
      serialNumber: unique('MSN'),
      engineCount: 2,
      totalFlightHours: totalHours,
      totalCycles,
      status: 'OPERATIONAL',
      isActive: true,
    },
  });

  const task = await prisma.maintenanceTask.create({
    data: {
      organizationId: organization.id,
      code: unique('TASK-P7'),
      title: 'Phase 7 close-and-comply task',
      description: 'Integration test task for master counter authority',
      intervalType: 'FLIGHT_HOURS',
      intervalHours: 50,
      referenceType: 'AMM',
      referenceNumber: 'AMM-P7-001',
      isMandatory: false,
      requiresInspection: false,
      isActive: true,
    },
  });

  await prisma.aircraftUsageLog.create({
    data: {
      organizationId: organization.id,
      aircraftId: aircraft.id,
      date: new Date('2026-01-01'),
      totalHours,
      totalCycles,
      source: 'baseline',
      notes: 'Registro inicial de aeronave',
    },
  });

  return {
    organizationId: organization.id,
    userId: user.id,
    userEmail: user.email,
    aircraftId: aircraft.id,
    taskId: task.id,
    token: issueToken({ userId: user.id, userEmail: user.email, organizationId: organization.id }),
  };
}

async function createSentWorkRequest(input: {
  organizationId: string;
  aircraftId: string;
  userId: string;
  taskId: string;
}) {
  return prisma.workRequest.create({
    data: {
      organizationId: input.organizationId,
      aircraftId: input.aircraftId,
      number: unique('ST-P7').toUpperCase(),
      status: 'SENT',
      createdById: input.userId,
      responsibleId: input.userId,
      sentById: input.userId,
      sentAt: new Date(),
      items: {
        create: {
          taskId: input.taskId,
          sourceKind: 'maintenance_plan',
          sourceId: input.taskId,
          executionType: 'maintenance_application',
          category: 'MAINTENANCE_PLAN',
          itemCode: 'TASK-P7',
          itemTitle: 'Task for close-and-comply',
          itemDescription: 'Task item for close-and-comply integration',
          source: 'AUTO',
        },
      },
    },
  });
}

async function closeAndComply(
  input: {
    token: string;
    workRequestId: string;
    evidenceFileName?: string;
    snapshots?: {
      aircraftHoursAtClose?: number;
      aircraftCyclesN1AtClose?: number;
      aircraftCyclesN2AtClose?: number;
    };
    notes?: string;
  },
): Promise<{ status: number; body: ApiResponse }> {
  const body: Record<string, unknown> = {
    evidenceUrl: 'https://example.com/phase7-signed-ot.pdf',
    evidenceFileName: input.evidenceFileName ?? 'phase7-signed-ot.pdf',
    notes: input.notes ?? 'Phase 7 integration close',
    ...(input.snapshots ?? {}),
  };

  return requestJson(
    'POST',
    `/api/v1/work-requests/${input.workRequestId}/close-and-comply`,
    input.token,
    body,
  );
}

const describeDbIntegration = RUN_DB_INTEGRATION_TESTS ? describe : describe.skip;

describeDbIntegration('Phase 7 master aircraft counter enforcement', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (organizationsToCleanup.length === 0) return;
    await prisma.organization.deleteMany({ where: { id: { in: organizationsToCleanup.splice(0) } } });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    await prisma.$disconnect();
  });

  it('should close and comply using aircraft master counters (happy path)', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const response = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 1200,
        aircraftCyclesN1AtClose: 800,
        aircraftCyclesN2AtClose: 800,
      },
      notes: 'Happy path close',
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');

    const compliance = await prisma.compliance.findFirst({
      where: {
        organizationId: fixture.organizationId,
        aircraftId: fixture.aircraftId,
        workOrderNumber: wr.number,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(compliance).toBeTruthy();
    expect(Number(compliance!.aircraftHoursAtCompliance)).toBe(1200);
    expect(compliance!.aircraftCyclesAtCompliance).toBe(800);
    expect(compliance!.notes ?? '').toContain('Master FH 1200');
    expect(compliance!.notes ?? '').toContain('Snapshot cliente FH 1200');

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: fixture.organizationId,
        entityType: 'WorkRequest',
        entityId: wr.id,
        action: 'CLOSE_AND_COMPLY',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(audit).toBeTruthy();
    const metadata = audit!.metadata as { aircraftUsageMaster?: { totalHours?: number; totalCycles?: number } } | null;
    expect(metadata?.aircraftUsageMaster?.totalHours).toBe(1200);
    expect(metadata?.aircraftUsageMaster?.totalCycles).toBe(800);
  });

  it('should ignore higher fake client snapshots and persist master counters', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const response = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 999999,
        aircraftCyclesN1AtClose: 999999,
        aircraftCyclesN2AtClose: 999999,
      },
      notes: 'High fake snapshots',
    });

    expect(response.status).toBe(200);

    const compliance = await prisma.compliance.findFirst({
      where: { organizationId: fixture.organizationId, aircraftId: fixture.aircraftId, workOrderNumber: wr.number },
    });

    expect(compliance).toBeTruthy();
    expect(Number(compliance!.aircraftHoursAtCompliance)).toBe(1200);
    expect(compliance!.aircraftCyclesAtCompliance).toBe(800);
    expect(compliance!.notes ?? '').toContain('Snapshot cliente FH 999999');
    expect(compliance!.notes ?? '').toContain('Snapshot cliente CYC N1 999999');

    const aircraft = await prisma.aircraft.findUnique({ where: { id: fixture.aircraftId } });
    expect(Number(aircraft!.totalFlightHours)).toBe(1200);
    expect(aircraft!.totalCycles).toBe(800);
  });

  it('should ignore lower fake client snapshots and persist master counters', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const response = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 10,
        aircraftCyclesN1AtClose: 5,
        aircraftCyclesN2AtClose: 5,
      },
      notes: 'Low fake snapshots',
    });

    expect(response.status).toBe(200);

    const compliance = await prisma.compliance.findFirst({
      where: { organizationId: fixture.organizationId, aircraftId: fixture.aircraftId, workOrderNumber: wr.number },
    });

    expect(compliance).toBeTruthy();
    expect(Number(compliance!.aircraftHoursAtCompliance)).toBe(1200);
    expect(compliance!.aircraftCyclesAtCompliance).toBe(800);
    expect(compliance!.notes ?? '').toContain('Snapshot cliente FH 10');
  });

  it('should succeed when client omits snapshots and still use master counters', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const response = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      notes: 'No snapshots',
    });

    expect(response.status).toBe(200);

    const compliance = await prisma.compliance.findFirst({
      where: { organizationId: fixture.organizationId, aircraftId: fixture.aircraftId, workOrderNumber: wr.number },
    });

    expect(compliance).toBeTruthy();
    expect(Number(compliance!.aircraftHoursAtCompliance)).toBe(1200);
    expect(compliance!.aircraftCyclesAtCompliance).toBe(800);
    expect(compliance!.notes ?? '').not.toContain('Snapshot cliente FH');
  });

  it('should return authoritative values in usage summary and agree with closeAndComply', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });

    await prisma.aircraftUsageLog.create({
      data: {
        organizationId: fixture.organizationId,
        aircraftId: fixture.aircraftId,
        date: new Date('2026-02-01'),
        totalHours: 1190,
        totalCycles: 790,
        source: 'manual',
        notes: 'Older manual log',
      },
    });

    await prisma.aircraft.update({
      where: { id: fixture.aircraftId },
      data: { totalFlightHours: 1234, totalCycles: 845 },
    });

    await prisma.aircraftUsageLog.create({
      data: {
        organizationId: fixture.organizationId,
        aircraftId: fixture.aircraftId,
        date: new Date('2026-03-01'),
        totalHours: 1234,
        totalCycles: 845,
        source: 'manual',
        notes: 'Current authoritative state',
      },
    });

    const summaryBeforeClose = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/usage-history`,
      fixture.token,
    );

    expect(summaryBeforeClose.status).toBe(200);
    expect(summaryBeforeClose.body.data?.aircraft?.totalHours).toBe(1234);
    expect(summaryBeforeClose.body.data?.aircraft?.totalCycles).toBe(845);

    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const closeResponse = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 10,
        aircraftCyclesN1AtClose: 5,
      },
      notes: 'Summary agreement test',
    });

    expect(closeResponse.status).toBe(200);

    const compliance = await prisma.compliance.findFirst({
      where: { organizationId: fixture.organizationId, aircraftId: fixture.aircraftId, workOrderNumber: wr.number },
    });

    expect(compliance).toBeTruthy();
    expect(Number(compliance!.aircraftHoursAtCompliance)).toBe(1234);
    expect(compliance!.aircraftCyclesAtCompliance).toBe(845);

    const summaryAfterClose = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/usage-history`,
      fixture.token,
    );

    expect(summaryAfterClose.status).toBe(200);
    expect(summaryAfterClose.body.data?.aircraft?.totalHours).toBe(Number(compliance!.aircraftHoursAtCompliance));
    expect(summaryAfterClose.body.data?.aircraft?.totalCycles).toBe(compliance!.aircraftCyclesAtCompliance);

    const otCloseLog = await prisma.aircraftUsageLog.findFirst({
      where: {
        organizationId: fixture.organizationId,
        aircraftId: fixture.aircraftId,
        source: 'ot_close',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(otCloseLog).toBeTruthy();
    expect(Number(otCloseLog!.totalHours)).toBe(1234);
    expect(otCloseLog!.totalCycles).toBe(845);
  });

  it('should keep client snapshot only as traceability while canonical values come from master', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const response = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 4321,
        aircraftCyclesN1AtClose: 8765,
        aircraftCyclesN2AtClose: 9999,
      },
      notes: 'Traceability-only snapshot fields',
    });

    expect(response.status).toBe(200);

    const compliance = await prisma.compliance.findFirst({
      where: { organizationId: fixture.organizationId, aircraftId: fixture.aircraftId, workOrderNumber: wr.number },
    });

    expect(compliance).toBeTruthy();
    expect(Number(compliance!.aircraftHoursAtCompliance)).toBe(1200);
    expect(compliance!.aircraftCyclesAtCompliance).toBe(800);
    expect(compliance!.notes ?? '').toContain('Master FH 1200');
    expect(compliance!.notes ?? '').toContain('Master CYC 800');
    expect(compliance!.notes ?? '').toContain('Snapshot cliente FH 4321');
    expect(compliance!.notes ?? '').toContain('Snapshot cliente CYC N1 8765');
    expect(compliance!.notes ?? '').toContain('Snapshot cliente CYC N2 9999');

    const wrAfter = await prisma.workRequest.findUnique({ where: { id: wr.id } });
    expect(wrAfter?.notes ?? '').toContain('MASTER_FH 1200');
    expect(wrAfter?.notes ?? '').toContain('SNAPSHOT_FH 4321');
  });

  it('should fail clearly when master counter cannot be resolved in current organization context', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const otherOrg = await prisma.organization.create({
      data: {
        name: unique('Org Other'),
        slug: unique('org-other').toLowerCase(),
        country: 'MX',
        subscriptionPlan: 'FREE',
        subscriptionStatus: 'TRIALING',
        isActive: true,
      },
    });
    organizationsToCleanup.push(otherOrg.id);

    await prisma.aircraft.update({
      where: { id: fixture.aircraftId },
      data: { organizationId: otherOrg.id },
    });

    const response = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 999999,
        aircraftCyclesN1AtClose: 999999,
      },
      notes: 'Should fail if authoritative aircraft usage cannot resolve',
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.message ?? '').toContain('Aircraft');

    const count = await prisma.compliance.count({
      where: {
        organizationId: fixture.organizationId,
        workOrderNumber: wr.number,
      },
    });
    expect(count).toBe(0);
  });

  it('should be deterministic on repeated close attempts regardless of snapshot differences', async () => {
    const fixture = await seedFixture({ totalHours: 1200, totalCycles: 800 });
    const wr = await createSentWorkRequest({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
    });

    const first = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 10,
        aircraftCyclesN1AtClose: 5,
      },
      notes: 'First attempt',
    });

    expect(first.status).toBe(200);

    const second = await closeAndComply({
      token: fixture.token,
      workRequestId: wr.id,
      snapshots: {
        aircraftHoursAtClose: 999999,
        aircraftCyclesN1AtClose: 999999,
      },
      notes: 'Second attempt with different fake snapshot',
    });

    expect(second.status).toBe(400);
    expect(second.body.message ?? '').toContain('ya fue cerrada');

    const compliances = await prisma.compliance.findMany({
      where: {
        organizationId: fixture.organizationId,
        aircraftId: fixture.aircraftId,
        workOrderNumber: wr.number,
      },
    });

    expect(compliances).toHaveLength(1);
    expect(Number(compliances[0].aircraftHoursAtCompliance)).toBe(1200);
    expect(compliances[0].aircraftCyclesAtCompliance).toBe(800);
  });
});
