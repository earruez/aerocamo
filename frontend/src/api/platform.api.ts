import { apiClient } from './client';

export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  country: string;
  subscriptionPlan: 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
  subscriptionStatus: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';
  isActive: boolean;
  createdAt: string;
  userCount: number;
  aircraftCount: number;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'TECHNICIAN' | 'INSPECTOR' | 'READONLY';
  isActive: boolean;
  createdAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  legalName?: string | null;
  country: string;
  subscriptionPlan?: PlatformOrganization['subscriptionPlan'];
  admin: { name: string; email: string; password: string };
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: PlatformUser['role'];
}

const unwrap = <T>(data: { status: string; data: T }): T => data.data;

export const platformApi = {
  listOrganizations: async (): Promise<PlatformOrganization[]> =>
    unwrap((await apiClient.get<{ status: string; data: PlatformOrganization[] }>('/platform/organizations')).data),

  createOrganization: async (input: CreateOrganizationInput) =>
    unwrap((await apiClient.post<{ status: string; data: { id: string } }>('/platform/organizations', input)).data),

  updateOrganization: async (id: string, input: Partial<Pick<PlatformOrganization, 'name' | 'legalName' | 'isActive' | 'subscriptionPlan' | 'subscriptionStatus'>>) =>
    unwrap((await apiClient.patch<{ status: string; data: PlatformOrganization }>(`/platform/organizations/${id}`, input)).data),

  listOrganizationUsers: async (orgId: string): Promise<PlatformUser[]> =>
    unwrap((await apiClient.get<{ status: string; data: PlatformUser[] }>(`/platform/organizations/${orgId}/users`)).data),

  createUser: async (orgId: string, input: CreateUserInput): Promise<PlatformUser> =>
    unwrap((await apiClient.post<{ status: string; data: PlatformUser }>(`/platform/organizations/${orgId}/users`, input)).data),

  updateUser: async (userId: string, input: { role?: PlatformUser['role']; isActive?: boolean; password?: string }): Promise<PlatformUser> =>
    unwrap((await apiClient.patch<{ status: string; data: PlatformUser }>(`/platform/users/${userId}`, input)).data),
};
