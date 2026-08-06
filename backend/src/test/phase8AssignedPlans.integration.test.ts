import { AddressInfo, Server } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { prisma } from '../infrastructure/database/prisma.client';

type ApiResponse = {
  status?: string;
  code?: string;
  message?: string;
  data?: any;
  assignments?: any[];
};

type SeededTemplate = {
  id: string;
  code: string;
};

type Fixture = {
  organizationId: string;
  userId: string;
  userEmail: string;
  token: string;
  templates: {
    manufacturer: SeededTemplate;
    national_dgac: SeededTemplate;
    engine_components: SeededTemplate;
    origin_country: SeededTemplate;
    alternateManufacturer: SeededTemplate;
  };
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

async function seedTemplate(input: {
  organizationId: string;
  manufacturer: string;
  model: string;
  suffix: string;
}): Promise<SeededTemplate> {
  const template = await prisma.maintenanceTemplate.create({
    data: {
      organizationId: input.organizationId,
      manufacturer: input.manufacturer,
      model: `${input.model}-${input.suffix}`,
      description: `Template ${input.suffix}`,
      version: '1.0',
      isActive: true,
    },
  });

  const code = unique(`TASK-${input.suffix}`).toUpperCase().slice(0, 90);
  await prisma.maintenanceTemplateTask.create({
    data: {
      templateId: template.id,
      code,
      title: `Task ${input.suffix}`,
      description: `Task for ${input.suffix}`,
      intervalType: 'FLIGHT_HOURS',
      intervalHours: 100,
      referenceType: 'AMM',
      isMandatory: false,
      requiresInspection: false,
      isActive: true,
    },
  });

  return { id: template.id, code };
}

async function seedFixture(): Promise<Fixture> {
  const organization = await prisma.organization.create({
    data: {
      name: unique('Org Phase8'),
      slug: unique('org-phase8').toLowerCase(),
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
      name: 'Admin Phase8',
      passwordHash: 'hashed-password',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const manufacturerTemplate = await seedTemplate({
    organizationId: organization.id,
    manufacturer: 'Boeing',
    model: '737',
    suffix: 'manufacturer',
  });
  const dgacTemplate = await seedTemplate({
    organizationId: organization.id,
    manufacturer: 'DGAC',
    model: 'MX',
    suffix: 'national-dgac',
  });
  const engineTemplate = await seedTemplate({
    organizationId: organization.id,
    manufacturer: 'CFM',
    model: '56',
    suffix: 'engine-components',
  });
  const originTemplate = await seedTemplate({
    organizationId: organization.id,
    manufacturer: 'FAA',
    model: 'US',
    suffix: 'origin-country',
  });
  const alternateManufacturer = await seedTemplate({
    organizationId: organization.id,
    manufacturer: 'Airbus',
    model: 'A320',
    suffix: 'manufacturer-alt',
  });

  return {
    organizationId: organization.id,
    userId: user.id,
    userEmail: user.email,
    token: issueToken({ userId: user.id, userEmail: user.email, organizationId: organization.id }),
    templates: {
      manufacturer: manufacturerTemplate,
      national_dgac: dgacTemplate,
      engine_components: engineTemplate,
      origin_country: originTemplate,
      alternateManufacturer,
    },
  };
}

async function createAircraftWithPlans(input: {
  token: string;
  registration: string;
  assignedPlans: Array<{ category: 'manufacturer' | 'national_dgac' | 'engine_components' | 'origin_country'; templateId: string }>;
}): Promise<{ status: number; body: ApiResponse }> {
  return requestJson('POST', '/api/v1/aircraft', input.token, {
    registration: input.registration,
    model: 'B737-800',
    manufacturer: 'Boeing',
    serialNumber: unique('MSN'),
    engineCount: 2,
    totalFlightHours: 1200,
    totalCycles: 800,
    assignedPlans: input.assignedPlans,
  });
}

async function getAssignedPlans(input: {
  token: string;
  aircraftId: string;
}): Promise<{ status: number; body: ApiResponse }> {
  return requestJson(
    'GET',
    `/api/v1/library/templates/aircraft/${input.aircraftId}/assigned-plans`,
    input.token,
  );
}

const describeDbIntegration = RUN_DB_INTEGRATION_TESTS ? describe : describe.skip;

describeDbIntegration('Phase 8 assigned plan persistence hardening', () => {
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

  it('persists exactly one assigned plan per category on aircraft creation (full bundle)', async () => {
    const fixture = await seedFixture();
    const registration = unique('XA-P8').toUpperCase();

    const response = await createAircraftWithPlans({
      token: fixture.token,
      registration,
      assignedPlans: [
        { category: 'manufacturer', templateId: fixture.templates.manufacturer.id },
        { category: 'national_dgac', templateId: fixture.templates.national_dgac.id },
        { category: 'engine_components', templateId: fixture.templates.engine_components.id },
        { category: 'origin_country', templateId: fixture.templates.origin_country.id },
      ],
    });

    expect(response.status).toBe(201);
    const aircraftId = response.body.data.id as string;

    const stored = await prisma.aircraftAssignedPlan.findMany({
      where: { organizationId: fixture.organizationId, aircraftId },
    });

    expect(stored).toHaveLength(4);
    expect(new Set(stored.map((row) => row.category)).size).toBe(4);

    const readResponse = await getAssignedPlans({ token: fixture.token, aircraftId });
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.assignments).toHaveLength(4);
  });

  it('persists only provided categories on aircraft creation (partial bundle)', async () => {
    const fixture = await seedFixture();
    const response = await createAircraftWithPlans({
      token: fixture.token,
      registration: unique('XA-P8-P').toUpperCase(),
      assignedPlans: [
        { category: 'manufacturer', templateId: fixture.templates.manufacturer.id },
        { category: 'national_dgac', templateId: fixture.templates.national_dgac.id },
      ],
    });

    expect(response.status).toBe(201);
    const aircraftId = response.body.data.id as string;

    const stored = await prisma.aircraftAssignedPlan.findMany({
      where: { organizationId: fixture.organizationId, aircraftId },
      orderBy: { category: 'asc' },
    });

    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.category)).toEqual(['manufacturer', 'national_dgac']);
  });

  it('rejects duplicate category payload and rolls back aircraft creation', async () => {
    const fixture = await seedFixture();
    const registration = unique('XA-P8-D').toUpperCase();

    const response = await createAircraftWithPlans({
      token: fixture.token,
      registration,
      assignedPlans: [
        { category: 'manufacturer', templateId: fixture.templates.manufacturer.id },
        { category: 'manufacturer', templateId: fixture.templates.alternateManufacturer.id },
      ],
    });

    expect(response.status).toBe(400);

    const persistedAircraft = await prisma.aircraft.findFirst({
      where: {
        organizationId: fixture.organizationId,
        registration,
      },
    });

    expect(persistedAircraft).toBeNull();
  });

  it('reassigns category deterministically (single row updated by unique key)', async () => {
    const fixture = await seedFixture();
    const created = await createAircraftWithPlans({
      token: fixture.token,
      registration: unique('XA-P8-R').toUpperCase(),
      assignedPlans: [
        { category: 'manufacturer', templateId: fixture.templates.manufacturer.id },
      ],
    });

    expect(created.status).toBe(201);
    const aircraftId = created.body.data.id as string;

    const reassignment = await requestJson(
      'POST',
      '/api/v1/library/templates/assign-bundle-to-aircraft',
      fixture.token,
      {
        aircraftId,
        assignments: [
          { category: 'manufacturer', templateId: fixture.templates.alternateManufacturer.id },
        ],
      },
    );

    expect(reassignment.status).toBe(200);

    const rows = await prisma.aircraftAssignedPlan.findMany({
      where: {
        organizationId: fixture.organizationId,
        aircraftId,
        category: 'manufacturer',
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].templateId).toBe(fixture.templates.alternateManufacturer.id);
  });

  it('reads assignments from explicit table even when audit logs are absent', async () => {
    const fixture = await seedFixture();
    const created = await createAircraftWithPlans({
      token: fixture.token,
      registration: unique('XA-P8-A').toUpperCase(),
      assignedPlans: [
        { category: 'manufacturer', templateId: fixture.templates.manufacturer.id },
        { category: 'engine_components', templateId: fixture.templates.engine_components.id },
      ],
    });

    expect(created.status).toBe(201);
    const aircraftId = created.body.data.id as string;

    await prisma.auditLog.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        entityType: 'Aircraft',
        entityId: aircraftId,
        action: 'MAINTENANCE_PLAN_CATEGORY_ASSIGNED',
      },
    });

    const readResponse = await getAssignedPlans({ token: fixture.token, aircraftId });

    expect(readResponse.status).toBe(200);
    expect(readResponse.body.assignments).toHaveLength(2);
    const categories = (readResponse.body.assignments ?? []).map((item: any) => item.category).sort();
    expect(categories).toEqual(['engine_components', 'manufacturer']);
  });
});
