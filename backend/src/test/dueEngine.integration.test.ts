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
  token: string;
  taskIds: {
    ad: string;
    sb: string;
    inspection: string;
  };
  componentInstanceId: string;
};

let server: Server;
let baseUrl = '';
const organizationsToCleanup: string[] = [];
const RUN_DB_INTEGRATION_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === '1';

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

async function requestJson(
  method: 'GET',
  path: string,
  token: string,
): Promise<{ status: number; body: ApiResponse }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiResponse,
  };
}

async function seedFixture(): Promise<Fixture> {
  const organization = await prisma.organization.create({
    data: {
      name: unique('Org Due Engine'),
      slug: unique('org-due-engine').toLowerCase(),
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
      name: 'Admin Due Engine',
      passwordHash: 'hashed-password',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const aircraft = await prisma.aircraft.create({
    data: {
      organizationId: organization.id,
      registration: unique('XA-DE').toUpperCase(),
      model: 'B737-800',
      manufacturer: 'Boeing',
      serialNumber: unique('MSN'),
      engineCount: 2,
      totalFlightHours: 1200,
      totalCycles: 800,
      status: 'OPERATIONAL',
      isActive: true,
    },
  });

  const adTask = await prisma.maintenanceTask.create({
    data: {
      organizationId: organization.id,
      code: unique('AD-TASK').toUpperCase(),
      title: 'AD inspection',
      description: 'AD source row',
      intervalType: 'FLIGHT_HOURS',
      intervalHours: 100,
      referenceType: 'AD',
      referenceNumber: '2026-01-01',
      isMandatory: true,
      requiresInspection: false,
      isActive: true,
    },
  });

  const sbTask = await prisma.maintenanceTask.create({
    data: {
      organizationId: organization.id,
      code: unique('SB-TASK').toUpperCase(),
      title: 'SB calendar check',
      description: 'SB source row',
      intervalType: 'CALENDAR_DAYS',
      intervalCalendarDays: 180,
      referenceType: 'SB',
      referenceNumber: 'SB-2026-01',
      isMandatory: false,
      requiresInspection: false,
      isActive: true,
    },
  });

  const inspectionTask = await prisma.maintenanceTask.create({
    data: {
      organizationId: organization.id,
      code: unique('INSP-TASK').toUpperCase(),
      title: 'Routine inspection',
      description: 'Inspection source row',
      intervalType: 'CYCLES',
      intervalCycles: 300,
      referenceType: 'AMM',
      referenceNumber: 'AMM-27-10',
      isMandatory: false,
      requiresInspection: false,
      isActive: true,
    },
  });

  await prisma.aircraftTask.createMany({
    data: [
      { aircraftId: aircraft.id, taskId: adTask.id, isActive: true },
      { aircraftId: aircraft.id, taskId: sbTask.id, isActive: true },
      { aircraftId: aircraft.id, taskId: inspectionTask.id, isActive: true },
    ],
  });

  await prisma.compliance.createMany({
    data: [
      {
        organizationId: organization.id,
        aircraftId: aircraft.id,
        taskId: adTask.id,
        componentId: null,
        performedById: user.id,
        inspectedById: null,
        performedAt: new Date('2026-04-01T10:00:00.000Z'),
        aircraftHoursAtCompliance: 1100,
        aircraftCyclesAtCompliance: 700,
        nextDueHours: 1190,
        nextDueCycles: null,
        nextDueDate: null,
        workOrderNumber: 'OT-DE-AD',
        applicationType: 'application',
        isInitial: false,
        status: 'COMPLETED',
        notes: 'AD compliance',
      },
      {
        organizationId: organization.id,
        aircraftId: aircraft.id,
        taskId: sbTask.id,
        componentId: null,
        performedById: user.id,
        inspectedById: null,
        performedAt: new Date('2026-04-05T10:00:00.000Z'),
        aircraftHoursAtCompliance: 1150,
        aircraftCyclesAtCompliance: 760,
        nextDueHours: null,
        nextDueCycles: null,
        nextDueDate: new Date(Date.now() + (5 * 24 * 60 * 60 * 1000)),
        workOrderNumber: 'OT-DE-SB',
        applicationType: 'application',
        isInitial: false,
        status: 'COMPLETED',
        notes: 'SB compliance',
      },
      {
        organizationId: organization.id,
        aircraftId: aircraft.id,
        taskId: inspectionTask.id,
        componentId: null,
        performedById: user.id,
        inspectedById: null,
        performedAt: new Date('2026-04-10T10:00:00.000Z'),
        aircraftHoursAtCompliance: 1160,
        aircraftCyclesAtCompliance: 780,
        nextDueHours: null,
        nextDueCycles: 1000,
        nextDueDate: null,
        workOrderNumber: 'OT-DE-INSP',
        applicationType: 'application',
        isInitial: false,
        status: 'COMPLETED',
        notes: 'Inspection compliance',
      },
    ],
  });

  const componentDefinition = await prisma.componentDefinition.create({
    data: {
      organizationId: organization.id,
      ataChapter: '27',
      ataCode: '27-10',
      name: 'Aileron actuator',
      description: 'Component source row',
      executionType: 'maintenance',
      intervalType: 'hours',
      intervalHours: 200,
      intervalCycles: null,
      intervalDays: null,
      requiresComponentTracking: true,
      sourceGroup: 'INTEGRATION_TEST',
      reference: 'COMP-REF-01',
    },
  });

  const componentInstance = await prisma.componentInstance.create({
    data: {
      organizationId: organization.id,
      definitionId: componentDefinition.id,
      aircraftId: aircraft.id,
      partNumber: 'PN-DE-001',
      serialNumber: unique('SN-DE').toUpperCase(),
      position: 'LH-WING',
      status: 'installed',
      installedAt: new Date('2026-01-01T00:00:00.000Z'),
      installedAtHours: 1000,
      installedAtCycles: 700,
      installWorkOrderNumber: 'OT-COMP-INSTALL',
    },
  });

  await prisma.componentApplication.create({
    data: {
      organizationId: organization.id,
      definitionId: componentDefinition.id,
      componentInstanceId: componentInstance.id,
      aircraftId: aircraft.id,
      taskId: null,
      workRequestId: null,
      officeOrderId: null,
      workOrderNumber: 'OT-COMP-001',
      appliedAt: new Date('2026-04-12T10:00:00.000Z'),
      aircraftHoursAtApplication: 1150,
      aircraftCyclesAtApplication: 790,
      nextDueHours: 1210,
      nextDueCycles: null,
      nextDueDate: null,
      applicationType: 'application',
      isInitial: false,
      notes: 'Component real application',
    },
  });

  return {
    organizationId: organization.id,
    userId: user.id,
    userEmail: user.email,
    aircraftId: aircraft.id,
    token: issueToken({ userId: user.id, userEmail: user.email, organizationId: organization.id }),
    taskIds: {
      ad: adTask.id,
      sb: sbTask.id,
      inspection: inspectionTask.id,
    },
    componentInstanceId: componentInstance.id,
  };
}

const describeDbIntegration = RUN_DB_INTEGRATION_TESTS ? describe : describe.skip;

describeDbIntegration('Due Engine API contract integration', () => {
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

  it('due-summary returns row totals, grouped counts and nearest due items', async () => {
    const fixture = await seedFixture();

    const rowsResponse = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/due-rows`,
      fixture.token,
    );

    expect(rowsResponse.status).toBe(200);
    const allRows = rowsResponse.body.data as any[];

    const summaryResponse = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/due-summary`,
      fixture.token,
    );

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.status).toBe('success');

    const summary = summaryResponse.body.data as any;
    expect(summary.totalRows).toBe(allRows.length);
    expect(summary.overdueCount).toBeGreaterThanOrEqual(1);
    expect(summary.dueSoonCount).toBeGreaterThanOrEqual(1);
    expect(summary.groupedByMethod).toBeTruthy();
    expect(summary.groupedBySourceType).toBeTruthy();

    const sumMethods = Object.values(summary.groupedByMethod as Record<string, number>)
      .reduce((acc, value) => acc + value, 0);
    const sumSourceTypes = Object.values(summary.groupedBySourceType as Record<string, number>)
      .reduce((acc, value) => acc + value, 0);

    expect(sumMethods).toBe(summary.totalRows);
    expect(sumSourceTypes).toBe(summary.totalRows);

    expect(Array.isArray(summary.nearestDueItems)).toBe(true);
    expect(summary.nearestDueItems.length).toBeGreaterThan(0);
    expect(summary.nearestDueItems.length).toBeLessThanOrEqual(8);
  });

  it('due-rows without filters returns backend-calculated rows with frontend contract shape', async () => {
    const fixture = await seedFixture();

    const response = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/due-rows`,
      fixture.token,
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');

    const rows = response.body.data as any[];
    expect(rows.length).toBeGreaterThanOrEqual(8);

    const sample = rows[0];
    expect(sample).toMatchObject({
      id: expect.any(String),
      aircraftId: fixture.aircraftId,
      sourceType: expect.any(String),
      description: expect.any(String),
      method: expect.any(String),
      status: expect.any(String),
      activeDimension: expect.any(String),
      primaryDueDimension: expect.any(String),
      dimensions: expect.any(Array),
    });

    const dim = sample.dimensions[0];
    expect(dim).toMatchObject({
      method: expect.any(String),
      intervalUnit: expect.any(String),
      remainingUnit: expect.any(String),
      status: expect.any(String),
    });

    expect(sample.dimensions.some((d: any) => d.method === sample.activeDimension)).toBe(true);

    expect(sample.syntheticField).toBeUndefined();
    expect(sample.frontendComputed).toBeUndefined();
  });

  it.each(['H', 'M', 'C', 'N1', 'N2'] as const)(
    'due-rows by method=%s returns only matching method projection and no inferred values for missing counters',
    async (method) => {
      const fixture = await seedFixture();

      const response = await requestJson(
        'GET',
        `/api/v1/aircraft/${fixture.aircraftId}/due-rows?method=${method}`,
        fixture.token,
      );

      expect(response.status).toBe(200);
      const rows = response.body.data as any[];
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.method).toBe(method);
        expect(row.activeDimension).toBe(method);
        expect(Array.isArray(row.dimensions)).toBe(true);
        expect(row.dimensions.some((d: any) => d.method === method) || row.method === method).toBe(true);
      }

      if (method === 'N1' || method === 'N2') {
        for (const row of rows) {
          expect(row.status).toBe('NO_CONTEXT');
          expect(row.remainingValue).toBeNull();
          expect(row.nextDueValue).toBeNull();
          expect(row.nextDueDate).toBeNull();
        }
      }
    },
  );

  it.each(['AD', 'SB', 'INSPECTION', 'COMPONENT'] as const)(
    'due-rows by sourceType=%s returns only matching rows and count matches summary groups',
    async (sourceType) => {
      const fixture = await seedFixture();

      const summaryResponse = await requestJson(
        'GET',
        `/api/v1/aircraft/${fixture.aircraftId}/due-summary`,
        fixture.token,
      );
      expect(summaryResponse.status).toBe(200);
      const summary = summaryResponse.body.data as any;

      const rowsResponse = await requestJson(
        'GET',
        `/api/v1/aircraft/${fixture.aircraftId}/due-rows?sourceType=${sourceType}`,
        fixture.token,
      );
      expect(rowsResponse.status).toBe(200);

      const rows = rowsResponse.body.data as any[];
      for (const row of rows) {
        expect(row.sourceType).toBe(sourceType);
      }

      const groupedCount = (summary.groupedBySourceType as Record<string, number>)[sourceType] ?? 0;
      expect(rows.length).toBe(groupedCount);
    },
  );

  it('due-report-data includes aircraft identity, master counters and report row fields', async () => {
    const fixture = await seedFixture();

    const response = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/due-report-data`,
      fixture.token,
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');

    const payload = response.body.data as any;
    expect(payload.aircraft).toMatchObject({
      id: fixture.aircraftId,
      registration: expect.any(String),
      model: expect.any(String),
      serialNumber: expect.any(String),
      totalHours: expect.any(Number),
      totalCycles: expect.any(Number),
    });

    expect(payload.summary).toBeTruthy();
    expect(Array.isArray(payload.rows)).toBe(true);
    expect(payload.rows.length).toBeGreaterThan(0);

    const row = payload.rows[0];
    expect(row).toMatchObject({
      description: expect.any(String),
      intervalValue: expect.anything(),
      lastComplianceValue: expect.anything(),
      nextDueValue: expect.anything(),
      remainingValue: expect.anything(),
      status: expect.any(String),
      referenceOt: expect.anything(),
      referenceSt: expect.anything(),
      observations: expect.anything(),
    });
  });

  it('returns NO_CONTEXT rows for explicit missing counter sources without inventing values', async () => {
    const fixture = await seedFixture();

    const responseN1 = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/due-rows?method=N1`,
      fixture.token,
    );

    const responseN2 = await requestJson(
      'GET',
      `/api/v1/aircraft/${fixture.aircraftId}/due-rows?method=N2`,
      fixture.token,
    );

    expect(responseN1.status).toBe(200);
    expect(responseN2.status).toBe(200);

    const rowsN1 = responseN1.body.data as any[];
    const rowsN2 = responseN2.body.data as any[];

    expect(rowsN1.length).toBeGreaterThan(0);
    expect(rowsN2.length).toBeGreaterThan(0);

    for (const row of [...rowsN1, ...rowsN2]) {
      expect(row.status).toBe('NO_CONTEXT');
      expect(row.remainingValue).toBeNull();
      expect(row.nextDueValue).toBeNull();
      expect(row.nextDueDate).toBeNull();
    }
  });

  it('returns clear error for unknown aircraft id', async () => {
    const fixture = await seedFixture();
    const unknownAircraftId = '00000000-0000-0000-0000-000000000000';

    const response = await requestJson(
      'GET',
      `/api/v1/aircraft/${unknownAircraftId}/due-summary`,
      fixture.token,
    );

    expect([404, 422]).toContain(response.status);
    expect(response.body.status).toBe('error');
    expect(response.body.code).toBeTruthy();
    expect(response.body.message).toBeTruthy();
  });
});
