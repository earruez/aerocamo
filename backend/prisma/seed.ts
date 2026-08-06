import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────
const rnd = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const rndDec = (min: number, max: number) => parseFloat((min + Math.random() * (max - min)).toFixed(1));

async function main() {
  console.log('🌱  Seeding database...');

  // ── Organization ──────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-airlines' },
    create: { name: 'Demo Airlines', slug: 'demo-airlines', country: 'MX', subscriptionPlan: 'PROFESSIONAL', subscriptionStatus: 'ACTIVE' },
    update: {},
  });
  console.log(`✅  Organization: ${org.name} (${org.id})`);

  // ── Users ─────────────────────────────────────────────────────────────────
  const adminHash     = await bcrypt.hash('Admin1234!', 12);
  const inspectorHash = await bcrypt.hash('Inspector1234!', 12);
  const techHash      = await bcrypt.hash('Tech1234!', 12);

  const admin = await prisma.user.upsert({
    where: { email_organizationId: { email: 'admin@demo-airlines.com', organizationId: org.id } },
    create: { organizationId: org.id, email: 'admin@demo-airlines.com', name: 'Carlos Mendoza', passwordHash: adminHash, role: 'ADMIN' },
    update: {},
  });
  const inspector = await prisma.user.upsert({
    where: { email_organizationId: { email: 'inspector@demo-airlines.com', organizationId: org.id } },
    create: { organizationId: org.id, email: 'inspector@demo-airlines.com', name: 'Roberto Herrera', passwordHash: inspectorHash, role: 'INSPECTOR', licenseNumber: 'PART-66-B1-00123' },
    update: {},
  });
  const tech = await prisma.user.upsert({
    where: { email_organizationId: { email: 'tech@demo-airlines.com', organizationId: org.id } },
    create: { organizationId: org.id, email: 'tech@demo-airlines.com', name: 'Miguel Torres', passwordHash: techHash, role: 'TECHNICIAN', licenseNumber: 'FAA-A&P-44821' },
    update: {},
  });
  console.log(`✅  Users: admin, inspector, technician`);

  // ── Maintenance Tasks ─────────────────────────────────────────────────────
  const tasks = await Promise.all([
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: '100H-INSP', organizationId: org.id } },
      create: { organizationId: org.id, code: '100H-INSP', title: 'Inspección periódica 100 horas', description: 'Inspección completa de célula conforme AMM Capítulo 05-20.', intervalType: 'FLIGHT_HOURS', intervalHours: 100, toleranceHours: 10, referenceNumber: 'AMM 05-20-00', referenceType: 'AMM', isMandatory: true, estimatedManHours: 8, requiresInspection: true, applicableModel: 'Boeing 737-800' },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: '500H-INSP', organizationId: org.id } },
      create: { organizationId: org.id, code: '500H-INSP', title: 'Inspección periódica 500 horas', description: 'Revisión de sistemas hidráulicos, eléctricos y de control de vuelo.', intervalType: 'FLIGHT_HOURS', intervalHours: 500, toleranceHours: 25, referenceNumber: 'AMM 05-21-00', referenceType: 'AMM', isMandatory: true, estimatedManHours: 24, requiresInspection: true },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'A-CHECK', organizationId: org.id } },
      create: { organizationId: org.id, code: 'A-CHECK', title: 'A-Check (600h)', description: 'Verificación general de la aeronave, sistemas y estructura.', intervalType: 'FLIGHT_HOURS', intervalHours: 600, toleranceHours: 30, referenceNumber: 'MPD 05-01-00', referenceType: 'MPD', isMandatory: true, estimatedManHours: 40, requiresInspection: true },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'C-CHECK', organizationId: org.id } },
      create: { organizationId: org.id, code: 'C-CHECK', title: 'C-Check (18 meses)', description: 'Revisión mayor programada. Inspección estructural profunda.', intervalType: 'CALENDAR_DAYS', intervalCalendarDays: 547, toleranceCalendarDays: 14, referenceNumber: 'MPD 05-03-00', referenceType: 'MPD', isMandatory: true, estimatedManHours: 320, requiresInspection: true },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'AD-2024-15-01', organizationId: org.id } },
      create: { organizationId: org.id, code: 'AD-2024-15-01', title: 'AD: Reemplazo de paletas de turbina CFM56', description: 'Reemplazo repetitivo de set de paletas por directiva de aeronavegabilidad.', intervalType: 'CYCLES', intervalCycles: 500, toleranceCycles: 25, referenceNumber: '2024-15-01', referenceType: 'AD', isMandatory: true, estimatedManHours: 4, requiresInspection: true, applicablePartNumber: 'CFM56-BLADE-SET' },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'AD-2023-08-02', organizationId: org.id } },
      create: { organizationId: org.id, code: 'AD-2023-08-02', title: 'AD: Revisión cablerío ala izquierda', description: 'Inspección de arneses eléctricos zona ala izquierda sección 11.', intervalType: 'CALENDAR_DAYS', intervalCalendarDays: 365, toleranceCalendarDays: 10, referenceNumber: '2023-08-02', referenceType: 'AD', isMandatory: true, estimatedManHours: 6, requiresInspection: true },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'SB-737-28-1155', organizationId: org.id } },
      create: { organizationId: org.id, code: 'SB-737-28-1155', title: 'SB: Modificación sistema combustible', description: 'Incorporación de válvula de retención mejorada en línea de suministro.', intervalType: 'ON_CONDITION', referenceNumber: '737-28-1155', referenceType: 'SB', isMandatory: false, estimatedManHours: 12, requiresInspection: false },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'ANNUAL-INSP', organizationId: org.id } },
      create: { organizationId: org.id, code: 'ANNUAL-INSP', title: 'Inspección Anual', description: 'Inspección anual completa conforme DGAC. Renovación CdN.', intervalType: 'CALENDAR_DAYS', intervalCalendarDays: 365, toleranceCalendarDays: 7, referenceNumber: 'RAC 145.001', referenceType: 'INTERNAL', isMandatory: true, estimatedManHours: 80, requiresInspection: true },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'PITOT-CAL', organizationId: org.id } },
      create: { organizationId: org.id, code: 'PITOT-CAL', title: 'Calibración sistema pitot-estático', description: 'Prueba y calibración del sistema de presiones totales/estáticas y altímetros.', intervalType: 'CALENDAR_DAYS', intervalCalendarDays: 730, toleranceCalendarDays: 30, referenceNumber: 'AMM 34-10-00', referenceType: 'AMM', isMandatory: true, estimatedManHours: 10, requiresInspection: true },
      update: {},
    }),
    prisma.maintenanceTask.upsert({
      where: { code_organizationId: { code: 'ELT-INSP', organizationId: org.id } },
      create: { organizationId: org.id, code: 'ELT-INSP', title: 'Inspección ELT', description: 'Prueba funcional del localizador de emergencia y verificación de batería.', intervalType: 'CALENDAR_DAYS', intervalCalendarDays: 365, toleranceCalendarDays: 15, referenceNumber: 'AMM 25-62-00', referenceType: 'AMM', isMandatory: true, estimatedManHours: 2, requiresInspection: false },
      update: {},
    }),
  ]);
  console.log(`✅  ${tasks.length} maintenance tasks created`);

  // ── 15 Aircraft ───────────────────────────────────────────────────────────
  const aircraftData = [
    { registration: 'XA-GRI', model: 'Boeing 737-800',  manufacturer: 'Boeing',  serialNumber: 'MSN-40123', engineCount: 2, engineModel: 'CFM56-7B24', totalFlightHours: 12450.5, totalCycles: 8320,  status: 'OPERATIONAL',    coaExpiryDate: new Date('2026-12-31'), insuranceExpiryDate: new Date('2026-11-30') },
    { registration: 'XA-DAL', model: 'Boeing 737-700',  manufacturer: 'Boeing',  serialNumber: 'MSN-38892', engineCount: 2, engineModel: 'CFM56-7B22', totalFlightHours: 9870.0,  totalCycles: 7210,  status: 'OPERATIONAL',    coaExpiryDate: new Date('2026-09-15'), insuranceExpiryDate: new Date('2026-10-01') },
    { registration: 'XA-MTO', model: 'Airbus A320-214', manufacturer: 'Airbus', serialNumber: 'MSN-5412',  engineCount: 2, engineModel: 'CFM56-5B4',  totalFlightHours: 18240.0, totalCycles: 14500, status: 'IN_MAINTENANCE', coaExpiryDate: new Date('2026-08-20'), insuranceExpiryDate: new Date('2026-09-01') },
    { registration: 'XA-SOL', model: 'Airbus A320-232', manufacturer: 'Airbus', serialNumber: 'MSN-6120',  engineCount: 2, engineModel: 'IAE V2527',  totalFlightHours: 21300.5, totalCycles: 16800, status: 'OPERATIONAL',    coaExpiryDate: new Date('2027-01-10'), insuranceExpiryDate: new Date('2027-02-28') },
    { registration: 'XA-VEN', model: 'Boeing 737-MAX8', manufacturer: 'Boeing',  serialNumber: 'MSN-43001', engineCount: 2, engineModel: 'LEAP-1B27',  totalFlightHours: 4120.0,  totalCycles: 3050,  status: 'OPERATIONAL',    coaExpiryDate: new Date('2028-06-30'), insuranceExpiryDate: new Date('2028-07-15') },
    { registration: 'XA-TRN', model: 'ATR 72-600',     manufacturer: 'ATR',     serialNumber: 'MSN-1252',  engineCount: 2, engineModel: 'PW127M',     totalFlightHours: 7650.0,  totalCycles: 11200, status: 'GROUNDED',       coaExpiryDate: new Date('2026-04-01'), insuranceExpiryDate: new Date('2026-05-01') },
    { registration: 'XA-AGU', model: 'ATR 72-500',     manufacturer: 'ATR',     serialNumber: 'MSN-0982',  engineCount: 2, engineModel: 'PW127F',     totalFlightHours: 15400.0, totalCycles: 22100, status: 'OPERATIONAL',    coaExpiryDate: new Date('2026-11-30'), insuranceExpiryDate: new Date('2026-12-15') },
    { registration: 'XA-CUL', model: 'Embraer E190',   manufacturer: 'Embraer', serialNumber: 'MSN-19000340', engineCount: 2, engineModel: 'GE CF34-10E', totalFlightHours: 8900.0, totalCycles: 6700, status: 'AOG',           coaExpiryDate: new Date('2026-10-20'), insuranceExpiryDate: new Date('2026-11-01') },
    { registration: 'XA-PBC', model: 'Embraer E175',   manufacturer: 'Embraer', serialNumber: 'MSN-17000299', engineCount: 2, engineModel: 'GE CF34-8E5', totalFlightHours: 11200.0, totalCycles: 9800, status: 'OPERATIONAL',   coaExpiryDate: new Date('2027-03-15'), insuranceExpiryDate: new Date('2027-04-01') },
    { registration: 'XA-HMO', model: 'Boeing 737-800',  manufacturer: 'Boeing',  serialNumber: 'MSN-41890', engineCount: 2, engineModel: 'CFM56-7B27', totalFlightHours: 14600.0, totalCycles: 9900,  status: 'OPERATIONAL',    coaExpiryDate: new Date('2026-07-31'), insuranceExpiryDate: new Date('2026-08-15') },
    { registration: 'XA-OAX', model: 'Airbus A321-211', manufacturer: 'Airbus', serialNumber: 'MSN-7234',  engineCount: 2, engineModel: 'CFM56-5B3',  totalFlightHours: 19500.0, totalCycles: 13200, status: 'IN_MAINTENANCE', coaExpiryDate: new Date('2026-12-01'), insuranceExpiryDate: new Date('2027-01-10') },
    { registration: 'XA-LZC', model: 'Airbus A319-112', manufacturer: 'Airbus', serialNumber: 'MSN-3901',  engineCount: 2, engineModel: 'CFM56-5A5',  totalFlightHours: 28100.0, totalCycles: 23400, status: 'OPERATIONAL',    coaExpiryDate: new Date('2026-05-31'), insuranceExpiryDate: new Date('2026-06-30') },
    { registration: 'XA-IRC', model: 'Boeing 737-700',  manufacturer: 'Boeing',  serialNumber: 'MSN-32489', engineCount: 2, engineModel: 'CFM56-7B22', totalFlightHours: 6200.0,  totalCycles: 5100,  status: 'OPERATIONAL',    coaExpiryDate: new Date('2027-08-30'), insuranceExpiryDate: new Date('2027-09-15') },
    { registration: 'XA-TAO', model: 'Embraer E190-E2', manufacturer: 'Embraer', serialNumber: 'MSN-19020021', engineCount: 2, engineModel: 'GTF PW1900G', totalFlightHours: 1850.0, totalCycles: 1420, status: 'OPERATIONAL',   coaExpiryDate: new Date('2029-01-01'), insuranceExpiryDate: new Date('2029-02-01') },
    { registration: 'XA-MTY', model: 'Boeing 737-MAX9', manufacturer: 'Boeing',  serialNumber: 'MSN-45200', engineCount: 2, engineModel: 'LEAP-1B28',  totalFlightHours: 3100.0,  totalCycles: 2300,  status: 'DECOMMISSIONED', coaExpiryDate: new Date('2024-12-31'), insuranceExpiryDate: new Date('2024-12-31') },
  ] as const;

  const aircraftRecords: Record<string, string> = {}; // registration → id

  for (const a of aircraftData) {
    const rec = await prisma.aircraft.upsert({
      where: { registration_organizationId: { registration: a.registration, organizationId: org.id } },
      create: { organizationId: org.id, ...a },
      update: {},
    });
    aircraftRecords[a.registration] = rec.id;
    console.log(`  ✈  ${a.registration} — ${a.model} (${a.status})`);
  }
  console.log(`✅  ${Object.keys(aircraftRecords).length} aircraft seeded`);

  // ── Assign tasks to each aircraft ─────────────────────────────────────────
  // Core tasks that apply to every aircraft
  const coreTasks    = [tasks[0], tasks[1], tasks[2], tasks[5], tasks[7], tasks[8], tasks[9]]; // 100H, 500H, A-CHECK, AD-2023, ANNUAL, PITOT, ELT
  const boeing737    = ['XA-GRI','XA-DAL','XA-VEN','XA-HMO','XA-IRC','XA-MTY'];
  const airbus320fam = ['XA-MTO','XA-SOL','XA-OAX','XA-LZC'];

  for (const reg of Object.keys(aircraftRecords)) {
    const aircraftId = aircraftRecords[reg];
    for (const task of coreTasks) {
      await prisma.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId, taskId: task.id } },
        create: { aircraftId, taskId: task.id },
        update: {},
      });
    }
    // C-Check for wide-body twins
    await prisma.aircraftTask.upsert({
      where: { aircraftId_taskId: { aircraftId, taskId: tasks[3].id } },
      create: { aircraftId, taskId: tasks[3].id },
      update: {},
    });
    // AD-2024 fan blade only for Boeing 737 (CFM56-7B)
    if (boeing737.includes(reg)) {
      await prisma.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId, taskId: tasks[4].id } },
        create: { aircraftId, taskId: tasks[4].id },
        update: {},
      });
    }
    // SB mod for Airbus A320 family
    if (airbus320fam.includes(reg)) {
      await prisma.aircraftTask.upsert({
        where: { aircraftId_taskId: { aircraftId, taskId: tasks[6].id } },
        create: { aircraftId, taskId: tasks[6].id },
        update: {},
      });
    }
  }
  console.log(`✅  Task assignments created`);

  // ── Compliance records — realistic mix of status ──────────────────────────
  // For each aircraft, create compliance entries for some tasks so we get
  // a realistic spread: some OK, some DUE_SOON, some OVERDUE, some never done.

  const complianceScenarios: Array<{
    reg: string; taskCode: string; performedAt: Date;
    hoursAt: number; cyclesAt: number;
    nextDueHours: number | null; nextDueCycles: number | null; nextDueDate: Date | null;
    status: 'COMPLETED'; workOrder: string;
  }> = [
    // XA-GRI — mostly OK, one due soon
    { reg:'XA-GRI', taskCode:'100H-INSP', performedAt: new Date('2026-03-10'), hoursAt:12400, cyclesAt:8290, nextDueHours:12500, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00102' },
    { reg:'XA-GRI', taskCode:'500H-INSP', performedAt: new Date('2026-01-15'), hoursAt:12200, cyclesAt:8100, nextDueHours:12700, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00028' },
    { reg:'XA-GRI', taskCode:'A-CHECK',   performedAt: new Date('2025-11-01'), hoursAt:12000, cyclesAt:7950, nextDueHours:12600, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-00891' },
    { reg:'XA-GRI', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-10-01'), hoursAt:11800, cyclesAt:7800, nextDueHours:null,    nextDueCycles:null, nextDueDate:new Date('2026-10-01'), status:'COMPLETED', workOrder:'WO-2025-00750' },
    { reg:'XA-GRI', taskCode:'AD-2024-15-01', performedAt: new Date('2026-02-20'), hoursAt:12350, cyclesAt:8200, nextDueHours:null, nextDueCycles:8700, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00075' },

    // XA-DAL — one overdue (100H past 9870h), one due soon
    { reg:'XA-DAL', taskCode:'100H-INSP', performedAt: new Date('2025-12-01'), hoursAt:9720,  cyclesAt:7100, nextDueHours:9820,  nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-01100' },
    { reg:'XA-DAL', taskCode:'A-CHECK',   performedAt: new Date('2025-10-15'), hoursAt:9500,  cyclesAt:6900, nextDueHours:10100, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-00900' },
    { reg:'XA-DAL', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-08-01'), hoursAt:9200,  cyclesAt:6600, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-08-01'), status:'COMPLETED', workOrder:'WO-2025-00601' },

    // XA-MTO — in maintenance, overdue AD
    { reg:'XA-MTO', taskCode:'500H-INSP', performedAt: new Date('2026-01-10'), hoursAt:18000, cyclesAt:14200, nextDueHours:18500, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00015' },
    { reg:'XA-MTO', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-06-20'), hoursAt:17100, cyclesAt:13100, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-06-20'), status:'COMPLETED', workOrder:'WO-2025-00520' },
    { reg:'XA-MTO', taskCode:'AD-2023-08-02', performedAt: new Date('2025-02-01'), hoursAt:16000, cyclesAt:12200, nextDueHours:null, nextDueCycles:null, nextDueDate:new Date('2026-02-01'), status:'COMPLETED', workOrder:'WO-2025-00090' },

    // XA-SOL — mostly OK
    { reg:'XA-SOL', taskCode:'100H-INSP', performedAt: new Date('2026-03-28'), hoursAt:21250, cyclesAt:16750, nextDueHours:21350, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00135' },
    { reg:'XA-SOL', taskCode:'A-CHECK',   performedAt: new Date('2026-02-01'), hoursAt:21000, cyclesAt:16500, nextDueHours:21600, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00048' },
    { reg:'XA-SOL', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-11-15'), hoursAt:20500, cyclesAt:16100, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-11-15'), status:'COMPLETED', workOrder:'WO-2025-01050' },

    // XA-VEN — newer aircraft, few records
    { reg:'XA-VEN', taskCode:'100H-INSP', performedAt: new Date('2026-04-01'), hoursAt:4100, cyclesAt:3040, nextDueHours:4200, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00160' },
    { reg:'XA-VEN', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-09-01'), hoursAt:3800, cyclesAt:2800, nextDueHours:null,  nextDueCycles:null, nextDueDate:new Date('2026-09-01'), status:'COMPLETED', workOrder:'WO-2025-00700' },

    // XA-TRN — grounded, overdue annual
    { reg:'XA-TRN', taskCode:'100H-INSP', performedAt: new Date('2025-11-10'), hoursAt:7580, cyclesAt:11050, nextDueHours:7680, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-01020' },
    { reg:'XA-TRN', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-03-01'), hoursAt:7100, cyclesAt:10200, nextDueHours:null,  nextDueCycles:null, nextDueDate:new Date('2026-03-01'), status:'COMPLETED', workOrder:'WO-2025-00210' },

    // XA-AGU
    { reg:'XA-AGU', taskCode:'100H-INSP', performedAt: new Date('2026-03-05'), hoursAt:15350, cyclesAt:22000, nextDueHours:15450, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00098' },
    { reg:'XA-AGU', taskCode:'500H-INSP', performedAt: new Date('2025-12-10'), hoursAt:15000, cyclesAt:21600, nextDueHours:15500, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-01180' },
    { reg:'XA-AGU', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-07-15'), hoursAt:14500, cyclesAt:20800, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-07-15'), status:'COMPLETED', workOrder:'WO-2025-00580' },

    // XA-CUL — AOG, multiple overdue
    { reg:'XA-CUL', taskCode:'100H-INSP', performedAt: new Date('2025-10-20'), hoursAt:8750,  cyclesAt:6580, nextDueHours:8850, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-00940' },
    { reg:'XA-CUL', taskCode:'AD-2023-08-02', performedAt: new Date('2025-01-15'), hoursAt:7900, cyclesAt:5800, nextDueHours:null, nextDueCycles:null, nextDueDate:new Date('2026-01-15'), status:'COMPLETED', workOrder:'WO-2025-00040' },

    // XA-PBC
    { reg:'XA-PBC', taskCode:'100H-INSP', performedAt: new Date('2026-03-25'), hoursAt:11150, cyclesAt:9740, nextDueHours:11250, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00128' },
    { reg:'XA-PBC', taskCode:'A-CHECK',   performedAt: new Date('2026-01-05'), hoursAt:10900, cyclesAt:9500, nextDueHours:11500, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00009' },
    { reg:'XA-PBC', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-10-10'), hoursAt:10600, cyclesAt:9200, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-10-10'), status:'COMPLETED', workOrder:'WO-2025-00912' },

    // XA-HMO — due soon on 100H
    { reg:'XA-HMO', taskCode:'100H-INSP', performedAt: new Date('2026-03-15'), hoursAt:14560, cyclesAt:9860, nextDueHours:14660, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00110' },
    { reg:'XA-HMO', taskCode:'500H-INSP', performedAt: new Date('2025-12-20'), hoursAt:14300, cyclesAt:9600, nextDueHours:14800, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2025-01200' },
    { reg:'XA-HMO', taskCode:'AD-2024-15-01', performedAt: new Date('2026-02-01'), hoursAt:14450, cyclesAt:9750, nextDueHours:null, nextDueCycles:10250, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00052' },

    // XA-OAX
    { reg:'XA-OAX', taskCode:'100H-INSP', performedAt: new Date('2026-02-28'), hoursAt:19420, cyclesAt:13100, nextDueHours:19520, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00088' },
    { reg:'XA-OAX', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-09-20'), hoursAt:18900, cyclesAt:12700, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-09-20'), status:'COMPLETED', workOrder:'WO-2025-00801' },

    // XA-LZC — older aircraft, approaching overdue
    { reg:'XA-LZC', taskCode:'100H-INSP', performedAt: new Date('2026-04-01'), hoursAt:28050, cyclesAt:23350, nextDueHours:28150, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00158' },
    { reg:'XA-LZC', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-05-20'), hoursAt:27200, cyclesAt:22800, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-05-20'), status:'COMPLETED', workOrder:'WO-2025-00430' },
    { reg:'XA-LZC', taskCode:'C-CHECK',   performedAt: new Date('2024-08-01'), hoursAt:25000, cyclesAt:21000, nextDueHours:null,   nextDueCycles:null, nextDueDate:new Date('2026-02-28'), status:'COMPLETED', workOrder:'WO-2024-00620' },

    // XA-IRC
    { reg:'XA-IRC', taskCode:'100H-INSP', performedAt: new Date('2026-03-20'), hoursAt:6150, cyclesAt:5050, nextDueHours:6250, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00120' },
    { reg:'XA-IRC', taskCode:'ANNUAL-INSP',performedAt:new Date('2025-11-01'), hoursAt:5900, cyclesAt:4800, nextDueHours:null,  nextDueCycles:null, nextDueDate:new Date('2026-11-01'), status:'COMPLETED', workOrder:'WO-2025-01001' },

    // XA-TAO — brand new, only one entry
    { reg:'XA-TAO', taskCode:'100H-INSP', performedAt: new Date('2026-03-01'), hoursAt:1800, cyclesAt:1400, nextDueHours:1900, nextDueCycles:null, nextDueDate:null, status:'COMPLETED', workOrder:'WO-2026-00092' },
  ];

  // Delete old compliances to allow re-seeding cleanly
  await prisma.compliance.deleteMany({ where: { organizationId: org.id } });

  const taskByCode = new Map(tasks.map(t => [t.code, t]));

  let compCount = 0;
  for (const s of complianceScenarios) {
    const aircraftId = aircraftRecords[s.reg];
    const task = taskByCode.get(s.taskCode);
    if (!aircraftId || !task) continue;
    await prisma.compliance.create({
      data: {
        organizationId: org.id,
        aircraftId,
        taskId: task.id,
        performedById:  admin.id,
        inspectedById:  inspector.id,
        performedAt:    s.performedAt,
        aircraftHoursAtCompliance: s.hoursAt,
        aircraftCyclesAtCompliance: s.cyclesAt,
        nextDueHours:   s.nextDueHours,
        nextDueCycles:  s.nextDueCycles,
        nextDueDate:    s.nextDueDate,
        workOrderNumber:s.workOrder,
        status:         s.status,
        notes:          'Registro de cumplimiento de prueba.',
      },
    });
    compCount++;
  }
  console.log(`✅  ${compCount} compliance records created`);

  // ── Work Orders ───────────────────────────────────────────────────────────
  await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });

  const woScenarios: Array<{
    number: string; reg: string; title: string; description: string;
    status: 'DRAFT' | 'OPEN' | 'IN_PROGRESS' | 'QUALITY' | 'CLOSED';
    plannedStart: Date; plannedEnd: Date;
    hoursAtOpen: number; cyclesAtOpen: number;
    taskCodes: string[];
  }> = [
    { number: 'WO-2026-00162', reg: 'XA-GRI', title: 'Inspección 100h — XA-GRI', description: 'Inspección periódica de 100 horas conforme AMM 05-20.', status: 'IN_PROGRESS', plannedStart: new Date('2026-04-08'), plannedEnd: new Date('2026-04-10'), hoursAtOpen: 12500, cyclesAtOpen: 8320, taskCodes: ['100H-INSP'] },
    { number: 'WO-2026-00155', reg: 'XA-MTO', title: 'A-Check — XA-MTO', description: 'Verificación general A-Check. Aeronave IN_MAINTENANCE.', status: 'OPEN', plannedStart: new Date('2026-04-05'), plannedEnd: new Date('2026-04-12'), hoursAtOpen: 18520, cyclesAtOpen: 14500, taskCodes: ['A-CHECK', '500H-INSP'] },
    { number: 'WO-2026-00148', reg: 'XA-SOL', title: 'Inspección AD — XA-SOL', description: 'Cumplimiento de Directiva de Aeronavegabilidad AD-2024-15-01.', status: 'QUALITY', plannedStart: new Date('2026-04-01'), plannedEnd: new Date('2026-04-07'), hoursAtOpen: 21350, cyclesAtOpen: 16800, taskCodes: ['AD-2024-15-01'] },
    { number: 'WO-2026-00140', reg: 'XA-VEN', title: 'Inspección 100h — XA-VEN', description: 'Inspección periódica programada.', status: 'CLOSED', plannedStart: new Date('2026-03-28'), plannedEnd: new Date('2026-03-30'), hoursAtOpen: 4200, cyclesAtOpen: 3070, taskCodes: ['100H-INSP'] },
    { number: 'WO-2026-00135', reg: 'XA-DAL', title: 'Inspección anual — XA-DAL', description: 'Inspección anual reglamentaria.', status: 'DRAFT', plannedStart: new Date('2026-04-15'), plannedEnd: new Date('2026-04-18'), hoursAtOpen: 9850, cyclesAtOpen: 7200, taskCodes: ['ANNUAL-INSP'] },
    { number: 'WO-2026-00128', reg: 'XA-AGU', title: 'Inspección 500h — XA-AGU', description: 'Revisión de sistemas conforme AMM 05-21.', status: 'CLOSED', plannedStart: new Date('2026-03-15'), plannedEnd: new Date('2026-03-18'), hoursAtOpen: 15450, cyclesAtOpen: 22100, taskCodes: ['500H-INSP'] },
    { number: 'WO-2026-00120', reg: 'XA-HMO', title: 'Inspección 100h — XA-HMO', description: 'Inspección periódica 100 horas.', status: 'OPEN', plannedStart: new Date('2026-04-10'), plannedEnd: new Date('2026-04-11'), hoursAtOpen: 9100, cyclesAtOpen: 6500, taskCodes: ['100H-INSP'] },
    { number: 'WO-2026-00115', reg: 'XA-OAX', title: 'Mantenimiento mayor — XA-OAX', description: 'A-Check e inspección de AD. Aeronave IN_MAINTENANCE.', status: 'IN_PROGRESS', plannedStart: new Date('2026-04-02'), plannedEnd: new Date('2026-04-14'), hoursAtOpen: 6800, cyclesAtOpen: 5200, taskCodes: ['A-CHECK', 'AD-2023-08-02'] },
    { number: 'WO-2026-00108', reg: 'XA-IRC', title: 'Inspección 100h — XA-IRC', description: 'Inspección periódica programada.', status: 'CLOSED', plannedStart: new Date('2026-03-20'), plannedEnd: new Date('2026-03-21'), hoursAtOpen: 11200, cyclesAtOpen: 8100, taskCodes: ['100H-INSP'] },
    { number: 'WO-2025-00891', reg: 'XA-TAO', title: 'Inspección anual — XA-TAO', description: 'Inspección anual reglamentaria E190-E2.', status: 'CLOSED', plannedStart: new Date('2025-11-01'), plannedEnd: new Date('2025-11-03'), hoursAtOpen: 1800, cyclesAtOpen: 1400, taskCodes: ['ANNUAL-INSP'] },
  ];

  let woCount = 0;
  for (const w of woScenarios) {
    const aircraftId = aircraftRecords[w.reg];
    if (!aircraftId) continue;
    const wo = await prisma.workOrder.create({
      data: {
        organizationId:        org.id,
        number:                w.number,
        aircraftId,
        title:                 w.title,
        description:           w.description,
        status:                w.status,
        createdById:           admin.id,
        assignedTechnicianId:  tech.id,
        inspectorId:           inspector.id,
        plannedStartDate:      w.plannedStart,
        plannedEndDate:        w.plannedEnd,
        aircraftHoursAtOpen:   w.hoursAtOpen,
        aircraftCyclesAtOpen:  w.cyclesAtOpen,
        actualStartDate:       ['IN_PROGRESS', 'QUALITY', 'CLOSED'].includes(w.status) ? w.plannedStart : null,
        actualEndDate:         w.status === 'CLOSED' ? w.plannedEnd : null,
      },
    });
    // Assign tasks to WO
    const taskEntries = tasks.filter(t => w.taskCodes.includes(t.code));
    for (const task of taskEntries) {
      await prisma.workOrderTask.create({
        data: {
          workOrderId:   wo.id,
          taskId:        task.id,
          isCompleted:   w.status === 'CLOSED',
          completedAt:   w.status === 'CLOSED' ? w.plannedEnd : null,
          completedById: w.status === 'CLOSED' ? tech.id : null,
        },
      });
    }
    woCount++;
  }
  console.log(`✅  ${woCount} work orders created`);

  // ── Components ────────────────────────────────────────────────────────────
  const componentData = [
    // ── XA-GRI (Boeing 737-800 / CFM56-7B24) ────────────────────────────
    { aircraftReg: 'XA-GRI', partNumber: 'CFM56-7B24',    serialNumber: 'ENG-GRI-1A',   description: 'Motor turbofan CFM56-7B24 — Posición #1',          manufacturer: 'CFM International',  position: 'Motor 1',          totalHoursSinceNew: 12450, totalCyclesSinceNew: 8320,  hoursSinceOverhaul: 4200,  cyclesSinceOverhaul: 2800, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2022-06-01'), installationAircraftHours: 8250 },
    { aircraftReg: 'XA-GRI', partNumber: 'CFM56-7B24',    serialNumber: 'ENG-GRI-2A',   description: 'Motor turbofan CFM56-7B24 — Posición #2',          manufacturer: 'CFM International',  position: 'Motor 2',          totalHoursSinceNew: 12450, totalCyclesSinceNew: 8320,  hoursSinceOverhaul: 4200,  cyclesSinceOverhaul: 2800, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2022-06-01'), installationAircraftHours: 8250 },
    { aircraftReg: 'XA-GRI', partNumber: '131-9A',        serialNumber: 'APU-GRI-001',  description: 'APU Honeywell 131-9A',                             manufacturer: 'Honeywell',          position: 'APU bay',          totalHoursSinceNew: 12450, totalCyclesSinceNew: 6100,  hoursSinceOverhaul: 3800,  cyclesSinceOverhaul: 1900, tboHours: 12000, tboCycles: null,  tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: null, status: 'INSTALLED', installationDate: new Date('2020-01-15'), installationAircraftHours: 5900 },
    { aircraftReg: 'XA-GRI', partNumber: 'XPDR-S-B737',  serialNumber: 'XPDR-GRI-01',  description: 'Transpondedor ATC Modo S',                          manufacturer: 'Garmin',             position: 'Avionics bay E3',  totalHoursSinceNew: 8200,  totalCyclesSinceNew: 5500,  hoursSinceOverhaul: 8200,  cyclesSinceOverhaul: 5500, tboHours: null,  tboCycles: null,  tboCalendarDays: 3650, lifeLimitHours: null, lifeLimitCycles: null, status: 'INSTALLED', installationDate: new Date('2020-01-15'), installationAircraftHours: 5900 },
    { aircraftReg: 'XA-GRI', partNumber: 'MLG-737-LH',   serialNumber: 'LG-GRI-L01',   description: 'Tren de aterrizaje principal izquierdo',            manufacturer: 'Safran Landing',     position: 'MLG izquierdo',    totalHoursSinceNew: 12450, totalCyclesSinceNew: 8320,  hoursSinceOverhaul: 6100,  cyclesSinceOverhaul: 4200, tboHours: null,  tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 60000, status: 'INSTALLED', installationDate: new Date('2021-03-10'), installationAircraftHours: 7100 },

    // ── XA-DAL (Boeing 737-700 / CFM56-7B22) ────────────────────────────
    { aircraftReg: 'XA-DAL', partNumber: 'CFM56-7B22',    serialNumber: 'ENG-DAL-1A',   description: 'Motor turbofan CFM56-7B22 — Posición #1',          manufacturer: 'CFM International',  position: 'Motor 1',          totalHoursSinceNew: 9870,  totalCyclesSinceNew: 7210,  hoursSinceOverhaul: 2500,  cyclesSinceOverhaul: 1800, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2023-01-20'), installationAircraftHours: 7370 },
    { aircraftReg: 'XA-DAL', partNumber: 'CFM56-7B22',    serialNumber: 'ENG-DAL-2A',   description: 'Motor turbofan CFM56-7B22 — Posición #2',          manufacturer: 'CFM International',  position: 'Motor 2',          totalHoursSinceNew: 9870,  totalCyclesSinceNew: 7210,  hoursSinceOverhaul: 2500,  cyclesSinceOverhaul: 1800, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2023-01-20'), installationAircraftHours: 7370 },
    { aircraftReg: 'XA-DAL', partNumber: 'ELT-406-AF',   serialNumber: 'ELT-DAL-001',  description: 'Localizador de emergencia ELT 406 MHz',             manufacturer: 'Artex',              position: 'Fuselaje sec. 41', totalHoursSinceNew: 5200,  totalCyclesSinceNew: 3800,  hoursSinceOverhaul: 5200,  cyclesSinceOverhaul: 3800, tboHours: null,  tboCycles: null,  tboCalendarDays: 1825, lifeLimitHours: null, lifeLimitCycles: null, status: 'INSTALLED', installationDate: new Date('2021-07-01'), installationAircraftHours: 4670 },

    // ── XA-MTO (Airbus A320-214 / CFM56-5B4, IN_MAINTENANCE) ────────────
    { aircraftReg: 'XA-MTO', partNumber: 'CFM56-5B4',     serialNumber: 'ENG-MTO-1A',   description: 'Motor turbofan CFM56-5B4 — Posición #1 (en taller)',manufacturer: 'CFM International',  position: 'Motor 1',          totalHoursSinceNew: 18240, totalCyclesSinceNew: 14500, hoursSinceOverhaul: 5500,  cyclesSinceOverhaul: 4000, tboHours: 20000, tboCycles: 12000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 25000, status: 'IN_SHOP',   installationDate: null, installationAircraftHours: null },
    { aircraftReg: 'XA-MTO', partNumber: 'CFM56-5B4',     serialNumber: 'ENG-MTO-2A',   description: 'Motor turbofan CFM56-5B4 — Posición #2',           manufacturer: 'CFM International',  position: 'Motor 2',          totalHoursSinceNew: 18240, totalCyclesSinceNew: 14500, hoursSinceOverhaul: 2000,  cyclesSinceOverhaul: 1500, tboHours: 20000, tboCycles: 12000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 25000, status: 'INSTALLED', installationDate: new Date('2023-05-10'), installationAircraftHours: 16240 },
    { aircraftReg: 'XA-MTO', partNumber: 'ADIRU-A320',    serialNumber: 'ADIRU-MTO-01', description: 'Unidad ADIRU (Air Data / Inertial Reference)',        manufacturer: 'Honeywell',          position: 'Avionics E6',      totalHoursSinceNew: 12000, totalCyclesSinceNew: 9200,  hoursSinceOverhaul: 12000, cyclesSinceOverhaul: 9200, tboHours: null,  tboCycles: null,  tboCalendarDays: 3650, lifeLimitHours: null, lifeLimitCycles: null, status: 'INSTALLED', installationDate: new Date('2021-02-01'), installationAircraftHours: 6240 },

    // ── XA-SOL (Airbus A320-232 / IAE V2527) ─────────────────────────────
    { aircraftReg: 'XA-SOL', partNumber: 'IAE-V2527-A5',  serialNumber: 'ENG-SOL-1A',   description: 'Motor turbofan IAE V2527-A5 — Posición #1',        manufacturer: 'IAE International',  position: 'Motor 1',          totalHoursSinceNew: 21300, totalCyclesSinceNew: 16800, hoursSinceOverhaul: 3100,  cyclesSinceOverhaul: 2400, tboHours: 20000, tboCycles: 14000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 28000, status: 'INSTALLED', installationDate: new Date('2022-11-01'), installationAircraftHours: 18200 },
    { aircraftReg: 'XA-SOL', partNumber: 'IAE-V2527-A5',  serialNumber: 'ENG-SOL-2A',   description: 'Motor turbofan IAE V2527-A5 — Posición #2',        manufacturer: 'IAE International',  position: 'Motor 2',          totalHoursSinceNew: 21300, totalCyclesSinceNew: 16800, hoursSinceOverhaul: 3100,  cyclesSinceOverhaul: 2400, tboHours: 20000, tboCycles: 14000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 28000, status: 'INSTALLED', installationDate: new Date('2022-11-01'), installationAircraftHours: 18200 },

    // ── XA-VEN (Boeing 737-MAX8 / LEAP-1B27) ─────────────────────────────
    { aircraftReg: 'XA-VEN', partNumber: 'LEAP-1B27',     serialNumber: 'ENG-VEN-1A',   description: 'Motor LEAP-1B27 — Posición #1',                    manufacturer: 'CFM International',  position: 'Motor 1',          totalHoursSinceNew: 4120,  totalCyclesSinceNew: 3050,  hoursSinceOverhaul: 4120,  cyclesSinceOverhaul: 3050, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2022-03-01'), installationAircraftHours: 0 },
    { aircraftReg: 'XA-VEN', partNumber: 'LEAP-1B27',     serialNumber: 'ENG-VEN-2A',   description: 'Motor LEAP-1B27 — Posición #2',                    manufacturer: 'CFM International',  position: 'Motor 2',          totalHoursSinceNew: 4120,  totalCyclesSinceNew: 3050,  hoursSinceOverhaul: 4120,  cyclesSinceOverhaul: 3050, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2022-03-01'), installationAircraftHours: 0 },

    // ── XA-HMO (Boeing 737-800 / CFM56-7B27) ─────────────────────────────
    { aircraftReg: 'XA-HMO', partNumber: 'CFM56-7B27',    serialNumber: 'ENG-HMO-1A',   description: 'Motor turbofan CFM56-7B27 — Posición #1',          manufacturer: 'CFM International',  position: 'Motor 1',          totalHoursSinceNew: 14600, totalCyclesSinceNew: 9900,  hoursSinceOverhaul: 5800,  cyclesSinceOverhaul: 3900, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2021-09-15'), installationAircraftHours: 8800 },
    { aircraftReg: 'XA-HMO', partNumber: 'CFM56-7B27',    serialNumber: 'ENG-HMO-2A',   description: 'Motor turbofan CFM56-7B27 — Posición #2',          manufacturer: 'CFM International',  position: 'Motor 2',          totalHoursSinceNew: 14600, totalCyclesSinceNew: 9900,  hoursSinceOverhaul: 5800,  cyclesSinceOverhaul: 3900, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'INSTALLED', installationDate: new Date('2021-09-15'), installationAircraftHours: 8800 },

    // ── XA-CUL (Embraer E190, AOG) ───────────────────────────────────────
    { aircraftReg: 'XA-CUL', partNumber: 'GE-CF34-10E',   serialNumber: 'ENG-CUL-1A',   description: 'Motor GE CF34-10E — Posición #1 (removido por AOG)', manufacturer: 'GE Aviation',       position: 'Motor 1',          totalHoursSinceNew: 8900,  totalCyclesSinceNew: 6700,  hoursSinceOverhaul: 3200,  cyclesSinceOverhaul: 2100, tboHours: 16000, tboCycles: 10000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 20000, status: 'UNSERVICEABLE', installationDate: null, installationAircraftHours: null },

    // ── Almacén / SERVICEABLE sin aeronave asignada ───────────────────────
    { aircraftReg: null, partNumber: 'CFM56-7B24',    serialNumber: 'ENG-SPARE-01',  description: 'Motor CFM56-7B24 en almacén (spare)',               manufacturer: 'CFM International',  position: null,               totalHoursSinceNew: 6800,  totalCyclesSinceNew: 4200,  hoursSinceOverhaul: 6800,  cyclesSinceOverhaul: 4200, tboHours: 20000, tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 30000, status: 'SERVICEABLE', installationDate: null, installationAircraftHours: null },
    { aircraftReg: null, partNumber: 'MLG-737-RH',   serialNumber: 'LG-SPARE-R02',  description: 'Tren de aterrizaje principal derecho (spare)',        manufacturer: 'Safran Landing',     position: null,               totalHoursSinceNew: 9300,  totalCyclesSinceNew: 6100,  hoursSinceOverhaul: 2400,  cyclesSinceOverhaul: 1600, tboHours: null,  tboCycles: 15000, tboCalendarDays: null, lifeLimitHours: null, lifeLimitCycles: 60000, status: 'SERVICEABLE', installationDate: null, installationAircraftHours: null },
    { aircraftReg: null, partNumber: 'ELT-406-AF',   serialNumber: 'ELT-SPARE-02',  description: 'ELT 406 MHz — en almacén',                          manufacturer: 'Artex',              position: null,               totalHoursSinceNew: 1200,  totalCyclesSinceNew: 850,   hoursSinceOverhaul: 1200,  cyclesSinceOverhaul: 850,  tboHours: null,  tboCycles: null,  tboCalendarDays: 1825, lifeLimitHours: null, lifeLimitCycles: null, status: 'SERVICEABLE', installationDate: null, installationAircraftHours: null },
    { aircraftReg: null, partNumber: 'ADIRU-A320',   serialNumber: 'ADIRU-SPARE-01', description: 'ADIRU de repuesto — en almacén',                   manufacturer: 'Honeywell',          position: null,               totalHoursSinceNew: 4500,  totalCyclesSinceNew: 3000,  hoursSinceOverhaul: 4500,  cyclesSinceOverhaul: 3000, tboHours: null,  tboCycles: null,  tboCalendarDays: 3650, lifeLimitHours: null, lifeLimitCycles: null, status: 'SERVICEABLE', installationDate: null, installationAircraftHours: null },
  ] as unknown as Array<{
    aircraftReg: string | null; partNumber: string; serialNumber: string; description: string;
    manufacturer: string; position: string | null; totalHoursSinceNew: number; totalCyclesSinceNew: number;
    hoursSinceOverhaul: number; cyclesSinceOverhaul: number; tboHours: number | null; tboCycles: number | null;
    tboCalendarDays: number | null; lifeLimitHours: number | null; lifeLimitCycles: number | null;
    status: string; installationDate: Date | null; installationAircraftHours: number | null;
  }>;

  let componentCount = 0;
  for (const c of componentData) {
    const aircraftId = c.aircraftReg ? (aircraftRecords[c.aircraftReg] ?? null) : null;
    await prisma.component.upsert({
      where: { serialNumber_organizationId: { serialNumber: c.serialNumber, organizationId: org.id } },
      create: {
        organizationId: org.id,
        aircraftId,
        partNumber:     c.partNumber,
        serialNumber:   c.serialNumber,
        description:    c.description,
        manufacturer:   c.manufacturer,
        position:       c.position ?? null,
        totalHoursSinceNew:   c.totalHoursSinceNew,
        totalCyclesSinceNew:  c.totalCyclesSinceNew,
        hoursSinceOverhaul:   c.hoursSinceOverhaul,
        cyclesSinceOverhaul:  c.cyclesSinceOverhaul,
        tboHours:       c.tboHours ?? null,
        tboCycles:      c.tboCycles ?? null,
        tboCalendarDays: c.tboCalendarDays ?? null,
        lifeLimitHours:  c.lifeLimitHours ?? null,
        lifeLimitCycles: c.lifeLimitCycles ?? null,
        status:         c.status as any,
        installationDate:         c.installationDate ?? null,
        installationAircraftHours: c.installationAircraftHours ?? null,
      },
      update: {},
    });
    componentCount++;
  }
  console.log(`✅  ${componentCount} components seeded`);

  console.log('\n🎉  Seed complete!');
  console.log(`\n  Login: admin@demo-airlines.com / Admin1234!`);
  console.log(`  Organization: demo-airlines`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

