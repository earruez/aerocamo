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
};
