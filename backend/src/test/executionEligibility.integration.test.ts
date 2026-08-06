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
  method: 'GET' | 'POST',
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

async function seedBaseFixture(): Promise<Fixture> {
  const organization = await prisma.organization.create({
    data: {
      name: unique('Org Test'),
      slug: unique('org-test').toLowerCase(),
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
      name: 'Admin Test',
      passwordHash: 'hashed-password',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const aircraft = await prisma.aircraft.create({
    data: {
      organizationId: organization.id,
      registration: unique('XA-T').toUpperCase(),
      model: 'B737-800',
      manufacturer: 'Boeing',
      serialNumber: unique('MSN'),
      engineCount: 2,
      totalFlightHours: 1200,
      totalCycles: 950,
      status: 'OPERATIONAL',
      isActive: true,
    },
  });

  const task = await prisma.maintenanceTask.create({
    data: {
      organizationId: organization.id,
      code: unique('TASK'),
      title: 'Inspection task',
      description: 'Integration-test task',
      intervalType: 'FLIGHT_HOURS',
      intervalHours: 50,
      referenceType: 'AMM',
      isMandatory: false,
      requiresInspection: false,
      isActive: true,
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

async function createSentStItem(input: {
  organizationId: string;
  aircraftId: string;
  userId: string;
  taskId: string;
  executionType?: 'maintenance_application' | 'component_replacement';
  includeComponentItemId?: string;
}): Promise<void> {
  const workRequest = await prisma.workRequest.create({
    data: {
      organizationId: input.organizationId,
      aircraftId: input.aircraftId,
      number: unique('ST-TEST').toUpperCase(),
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
          executionType: input.executionType ?? 'maintenance_application',
          category: 'MAINTENANCE_PLAN',
          itemCode: 'TASK-CODE',
          itemTitle: 'Task item',
          itemDescription: 'Task item for eligibility',
          source: 'AUTO',
        },
      },
    },
  });

  if (input.includeComponentItemId) {
    await prisma.workRequestItem.create({
      data: {
        workRequestId: workRequest.id,
        componentId: input.includeComponentItemId,
        sourceKind: 'component_inspection',
        sourceId: input.includeComponentItemId,
        executionType: 'component_replacement',
        category: 'COMPONENT_INSPECTION',
        itemCode: 'COMP-PN',
        itemTitle: 'Component item',
        itemDescription: 'Component linkage item',
        source: 'AUTO',
      },
    });
  }
}

async function createSignedWorkOrder(input: {
  organizationId: string;
  aircraftId: string;
  userId: string;
  number: string;
}): Promise<void> {
  await prisma.workOrder.create({
    data: {
      organizationId: input.organizationId,
      aircraftId: input.aircraftId,
      number: input.number,
      title: 'Signed WO',
      description: 'Signed work order for integration tests',
      status: 'QUALITY',
      assignmentStatus: 'EVIDENCE_UPLOADED',
      createdById: input.userId,
      evidenceFileUrl: 'https://example.com/evidence.pdf',
      evidenceFileName: 'evidence.pdf',
      evidenceUploadedAt: new Date(),
      evidenceUploadedBy: input.userId,
      evidenceType: 'PDF',
      isActive: true,
    },
  });
}

const describeDbIntegration = RUN_DB_INTEGRATION_TESTS ? describe : describe.skip;

describeDbIntegration('Execution eligibility anti-bypass integration', () => {
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
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await prisma.$disconnect();
  });

  it('allows compliance when ST item and signed OT are valid', async () => {
    const fixture = await seedBaseFixture();
    const workOrderNumber = unique('OT-OK').toUpperCase();

    await createSentStItem({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
      executionType: 'maintenance_application',
    });

    await createSignedWorkOrder({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      number: workOrderNumber,
    });

    const response = await requestJson('POST', '/api/v1/compliances', fixture.token, {
      aircraftId: fixture.aircraftId,
      taskId: fixture.taskId,
      performedAt: new Date().toISOString(),
      applicationType: 'application',
      workOrderNumber,
      aircraftHoursAtCompliance: 1200,
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('success');
    expect(response.body.data?.workOrderNumber).toBe(workOrderNumber);

    const rows = await prisma.compliance.findMany({ where: { organizationId: fixture.organizationId } });
    expect(rows).toHaveLength(1);
  });

  it('blocks compliance when no valid ST item exists', async () => {
    const fixture = await seedBaseFixture();
    const workOrderNumber = unique('OT-NO-ST').toUpperCase();

    await createSignedWorkOrder({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      number: workOrderNumber,
    });

    const response = await requestJson('POST', '/api/v1/compliances', fixture.token, {
      aircraftId: fixture.aircraftId,
      taskId: fixture.taskId,
      performedAt: new Date().toISOString(),
      applicationType: 'application',
      workOrderNumber,
      aircraftHoursAtCompliance: 1200,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain('No existe un WorkRequestItem exacto');

    const rows = await prisma.compliance.findMany({ where: { organizationId: fixture.organizationId } });
    expect(rows).toHaveLength(0);
  });

  it('blocks compliance when no signed OT exists', async () => {
    const fixture = await seedBaseFixture();

    await createSentStItem({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
      executionType: 'maintenance_application',
    });

    const response = await requestJson('POST', '/api/v1/compliances', fixture.token, {
      aircraftId: fixture.aircraftId,
      taskId: fixture.taskId,
      performedAt: new Date().toISOString(),
      applicationType: 'application',
      workOrderNumber: unique('OT-MISSING').toUpperCase(),
      aircraftHoursAtCompliance: 1200,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain('No existe una OT recibida/firmada');

    const rows = await prisma.compliance.findMany({ where: { organizationId: fixture.organizationId } });
    expect(rows).toHaveLength(0);
  });

  it('blocks compliance when OT does not match eligible signed OT', async () => {
    const fixture = await seedBaseFixture();
    const validWorkOrderNumber = unique('OT-VALID').toUpperCase();

    await createSentStItem({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
      executionType: 'maintenance_application',
    });

    await createSignedWorkOrder({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      number: validWorkOrderNumber,
    });

    const response = await requestJson('POST', '/api/v1/compliances', fixture.token, {
      aircraftId: fixture.aircraftId,
      taskId: fixture.taskId,
      performedAt: new Date().toISOString(),
      applicationType: 'application',
      workOrderNumber: unique('OT-FAKE').toUpperCase(),
      aircraftHoursAtCompliance: 1200,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.message).toContain('La OT indicada no corresponde');

    const rows = await prisma.compliance.findMany({ where: { organizationId: fixture.organizationId } });
    expect(rows).toHaveLength(0);
  });

  it('marks eligibility false when required component is not linked in the ST', async () => {
    const fixture = await seedBaseFixture();

    const component = await prisma.component.create({
      data: {
        organizationId: fixture.organizationId,
        aircraftId: fixture.aircraftId,
        partNumber: unique('PN').toUpperCase(),
        serialNumber: unique('SN').toUpperCase(),
        description: 'Component not linked in ST',
        manufacturer: 'Test Manufacturer',
        status: 'INSTALLED',
        isActive: true,
      },
    });

    await createSentStItem({
      organizationId: fixture.organizationId,
      aircraftId: fixture.aircraftId,
      userId: fixture.userId,
      taskId: fixture.taskId,
      executionType: 'maintenance_application',
    });

    const path = `/api/v1/work-requests/aircraft/${fixture.aircraftId}/execution-eligibility`
      + `?sourceKind=maintenance_plan`
      + `&sourceId=${fixture.taskId}`
      + `&executionType=maintenance_application`
      + `&requiredComponentSourceId=${component.id}`;

    const response = await requestJson('GET', path, fixture.token);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data?.eligible).toBe(false);
    expect(response.body.data?.reason).toBe('INVALID_REQUIRED_COMPONENT');
  });
});
