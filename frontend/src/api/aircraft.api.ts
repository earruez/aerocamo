import { apiClient } from './client';

export type AircraftStatus = 'OPERATIONAL' | 'AOG' | 'IN_MAINTENANCE' | 'GROUNDED' | 'DECOMMISSIONED';

/** Registro de un cambio de estado operacional. */
/** Lectura de un contador para una aeronave o uno de sus motores. */
export interface CounterReading {
  id: string;
  value: string;
  readingDate: string;
  notes: string | null;
  counterType: { id: string; code: string; name: string; unit: string; scope: string };
  engine: { id: string; position: string; model: string; serialNumber: string } | null;
  recordedBy: { id: string; name: string } | null;
}

export interface AircraftStatusChange {
  id: string;
  fromStatus: AircraftStatus | null;
  toStatus: AircraftStatus;
  reason: string;
  changedAt: string;
  changedBy: { id: string; name: string; role: string } | null;
}

export interface Aircraft {
  id: string;
  registration: string;
  model: string;
  manufacturer: string;
  serialNumber: string;
  engineCount: number;
  engineModel: string | null;
  totalFlightHours: number;
  totalCycles: number;
  status: AircraftStatus;
  owner: string | null;
  yearManufactured: number | null;
  coaExpiryDate: string | null;
  insuranceExpiryDate: string | null;
}

export interface CreateAircraftInput {
  registration: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  totalFlightHours?: number;
  totalCycles?: number;
  engineCount?: number;
  engineModel?: string | null;
  owner?: string | null;
  yearManufactured?: number | null;
  /// ISO date; el vencimiento del certificado de aeronavegabilidad
  coaExpiryDate?: string | null;
  assignedPlans?: Array<{
    category: 'manufacturer' | 'national_dgac' | 'engine_components' | 'origin_country';
    templateId: string;
  }>;
}

export interface AircraftAuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  userId: string;
  userEmail: string;
  userRole: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type AircraftUsageSource = 'manual' | 'flight_log' | 'ot_close' | 'import' | 'baseline';

export interface AircraftUsageLog {
  id: string;
  aircraftId: string;
  date: string;
  totalHours: number;
  totalCycles: number;
  source: AircraftUsageSource;
  notes: string | null;
  createdAt: string;
}

export interface AircraftUsageHistory {
  aircraft: {
    totalHours: number;
    totalCycles: number;
    lastUpdatedAt: string;
  };
  history: AircraftUsageLog[];
}

export type AircraftEnginePosition = 'N1' | 'N2';

export interface AircraftEngine {
  id: string;
  aircraftId: string;
  position: AircraftEnginePosition;
  manufacturer: string;
  model: string;
  serialNumber: string;
  latestUsage: {
    hours: number;
    cycles: number;
    date: string;
  } | null;
}

export interface CreateAircraftUsageLogInput {
  date: string;
  totalHours: number;
  totalCycles: number;
  source: AircraftUsageSource;
  notes?: string | null;
}

function normalizeListResponse<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const first = record.data;
    if (Array.isArray(first)) return first as T[];

    if (first && typeof first === 'object') {
      const nested = (first as Record<string, unknown>).data;
      if (Array.isArray(nested)) return nested as T[];
    }
  }

  return [];
}

export const aircraftApi = {
  findAll: async (): Promise<Aircraft[]> => {
    const { data } = await apiClient.get('/aircraft', { params: { page: 1, limit: 100 } });
    return normalizeListResponse<Aircraft>(data);
  },
  findById: async (id: string): Promise<Aircraft> => {
    const { data } = await apiClient.get<{ status: string; data: Aircraft }>(`/aircraft/${id}`);
    return data.data;
  },
  create: async (input: CreateAircraftInput): Promise<Aircraft> => {
    const { data } = await apiClient.post<{ status: string; data: Aircraft }>('/aircraft', input);
    return data.data;
  },
  getAuditLog: async (id: string): Promise<AircraftAuditEntry[]> => {
    const { data } = await apiClient.get<{ status: string; data: AircraftAuditEntry[] }>(
      `/audit-logs/aircraft/${id}`,
    );
    return data.data ?? [];
  },
  getUsageHistory: async (id: string): Promise<AircraftUsageHistory> => {
    const { data } = await apiClient.get<{ status: string; data: AircraftUsageHistory }>(
      `/aircraft/${id}/usage-history`,
    );
    return data.data;
  },
  createUsageLog: async (id: string, input: CreateAircraftUsageLogInput): Promise<AircraftUsageLog> => {
    const { data } = await apiClient.post<{ status: string; data: AircraftUsageLog }>(
      `/aircraft/${id}/usage-history`,
      input,
    );
    return data.data;
  },
  listEngines: async (id: string): Promise<AircraftEngine[]> => {
    const { data } = await apiClient.get<{ status: string; data: AircraftEngine[] }>(
      `/aircraft/${id}/engines`,
    );
    return data.data ?? [];
  },

  /** Edita los datos de ficha de la aeronave. */
  async update(id: string, input: {
    owner?: string | null;
    yearManufactured?: number | null;
    coaExpiryDate?: string | null;
    insuranceExpiryDate?: string | null;
  }): Promise<Aircraft> {
    const { data } = await apiClient.patch<{ status: string; data: Aircraft }>(`/aircraft/${id}`, input);
    return data.data;
  },

  /** Cambia el estado operacional dejando constancia del motivo. */
  async changeStatus(id: string, status: AircraftStatus, reason: string): Promise<Aircraft> {
    const { data } = await apiClient.patch<{ status: string; data: Aircraft }>(
      `/aircraft/${id}/status`,
      { status, reason },
    );
    return data.data;
  },

  async listStatusChanges(id: string): Promise<AircraftStatusChange[]> {
    const { data } = await apiClient.get<{ status: string; data: AircraftStatusChange[] }>(
      `/aircraft/${id}/status-changes`,
    );
    return data.data;
  },

  async listCounterReadings(id: string): Promise<CounterReading[]> {
    const { data } = await apiClient.get<{ status: string; data: CounterReading[] }>(
      `/aircraft/${id}/counter-readings`,
    );
    return data.data;
  },

  async createCounterReading(id: string, input: {
    counterTypeId: string;
    engineId?: string | null;
    value: number;
    readingDate: string;
    notes?: string | null;
  }): Promise<CounterReading> {
    const { data } = await apiClient.post<{ status: string; data: CounterReading }>(
      `/aircraft/${id}/counter-readings`,
      input,
    );
    return data.data;
  },
};
