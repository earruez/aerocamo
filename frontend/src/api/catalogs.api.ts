import { apiClient } from './client';

export type ManualKind = 'AIRCRAFT' | 'ENGINE' | 'COMPONENT' | 'OTHER';

/** Manual de referencia vigente por modelo. */
export interface MaintenanceManual {
  id: string;
  model: string;
  reference: string;
  kind: ManualKind;
  notes: string | null;
  updatedAt: string;
}

/** Taller aeronáutico habilitado (CMA). */
export interface RepairShop {
  id: string;
  code: string | null;
  name: string;
  country: string | null;
  notes: string | null;
  isActive: boolean;
}

/** Persona del taller a quien se envía la ST. */
export interface RepairShopContact {
  id: string;
  repairShopId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export type RepairShopContactInput = Omit<RepairShopContact, 'id' | 'repairShopId'>;

/** Contador configurable (modelo de la tabla TN del Access). */
export interface CounterType {
  id: string;
  code: string;
  name: string;
  unit: string;
  scope: 'AIRCRAFT' | 'ENGINE' | 'BOTH';
  slot: number | null;
  legacyField: string | null;
  isActive: boolean;
  sortOrder: number;
}

export type ManualInput = Omit<MaintenanceManual, 'id' | 'updatedAt'>;
export type RepairShopInput = Omit<RepairShop, 'id'>;

const unwrap = <T>(data: { status: string; data: T }): T => data.data;

export const catalogsApi = {
  listManuals: async (): Promise<MaintenanceManual[]> =>
    unwrap((await apiClient.get<{ status: string; data: MaintenanceManual[] }>('/catalogs/manuals')).data),

  createManual: async (input: ManualInput): Promise<MaintenanceManual> =>
    unwrap((await apiClient.post<{ status: string; data: MaintenanceManual }>('/catalogs/manuals', input)).data),

  updateManual: async (id: string, input: Partial<ManualInput>): Promise<MaintenanceManual> =>
    unwrap((await apiClient.patch<{ status: string; data: MaintenanceManual }>(`/catalogs/manuals/${id}`, input)).data),

  removeManual: async (id: string): Promise<void> => {
    await apiClient.delete(`/catalogs/manuals/${id}`);
  },

  listShops: async (): Promise<RepairShop[]> =>
    unwrap((await apiClient.get<{ status: string; data: RepairShop[] }>('/catalogs/repair-shops')).data),

  createShop: async (input: RepairShopInput): Promise<RepairShop> =>
    unwrap((await apiClient.post<{ status: string; data: RepairShop }>('/catalogs/repair-shops', input)).data),

  updateShop: async (id: string, input: Partial<RepairShopInput>): Promise<RepairShop> =>
    unwrap((await apiClient.patch<{ status: string; data: RepairShop }>(`/catalogs/repair-shops/${id}`, input)).data),

  removeShop: async (id: string): Promise<void> => {
    await apiClient.delete(`/catalogs/repair-shops/${id}`);
  },

  listContacts: async (shopId: string): Promise<RepairShopContact[]> =>
    unwrap((await apiClient.get<{ status: string; data: RepairShopContact[] }>(`/catalogs/repair-shops/${shopId}/contacts`)).data),

  createContact: async (shopId: string, input: Partial<RepairShopContactInput>): Promise<RepairShopContact> =>
    unwrap((await apiClient.post<{ status: string; data: RepairShopContact }>(`/catalogs/repair-shops/${shopId}/contacts`, input)).data),

  updateContact: async (id: string, input: Partial<RepairShopContactInput>): Promise<RepairShopContact> =>
    unwrap((await apiClient.patch<{ status: string; data: RepairShopContact }>(`/catalogs/repair-shop-contacts/${id}`, input)).data),

  removeContact: async (id: string): Promise<void> => {
    await apiClient.delete(`/catalogs/repair-shop-contacts/${id}`);
  },

  listCounterTypes: async (): Promise<CounterType[]> =>
    unwrap((await apiClient.get<{ status: string; data: CounterType[] }>('/catalogs/counter-types')).data),

  createCounterType: async (input: Partial<CounterType>): Promise<CounterType> =>
    unwrap((await apiClient.post<{ status: string; data: CounterType }>('/catalogs/counter-types', input)).data),

  updateCounterType: async (id: string, input: Partial<CounterType>): Promise<CounterType> =>
    unwrap((await apiClient.patch<{ status: string; data: CounterType }>(`/catalogs/counter-types/${id}`, input)).data),

  removeCounterType: async (id: string): Promise<void> => {
    await apiClient.delete(`/catalogs/counter-types/${id}`);
  },
};
