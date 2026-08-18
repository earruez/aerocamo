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

  createOrganization: async (input: CreateOrganizationInput): Promise<{ id: string; emailSent: boolean }> => {
    const { data } = await apiClient.post<{ status: string; data: { id: string }; emailSent: boolean }>('/platform/organizations', input);
    return { ...data.data, emailSent: data.emailSent };
  },

  updateOrganization: async (id: string, input: Partial<Pick<PlatformOrganization, 'name' | 'legalName' | 'isActive' | 'subscriptionPlan' | 'subscriptionStatus'>>) =>
    unwrap((await apiClient.patch<{ status: string; data: PlatformOrganization }>(`/platform/organizations/${id}`, input)).data),

  deleteOrganization: async (id: string): Promise<void> => {
    await apiClient.delete(`/platform/organizations/${id}`);
  },

  listOrganizationUsers: async (orgId: string): Promise<PlatformUser[]> =>
    unwrap((await apiClient.get<{ status: string; data: PlatformUser[] }>(`/platform/organizations/${orgId}/users`)).data),

  createUser: async (orgId: string, input: CreateUserInput): Promise<PlatformUser & { emailSent: boolean }> => {
    const { data } = await apiClient.post<{ status: string; data: PlatformUser; emailSent: boolean }>(`/platform/organizations/${orgId}/users`, input);
    return { ...data.data, emailSent: data.emailSent };
  },

  updateUser: async (
    userId: string,
    input: { name?: string; email?: string; role?: PlatformUser['role']; isActive?: boolean; password?: string },
  ): Promise<PlatformUser> =>
    unwrap((await apiClient.patch<{ status: string; data: PlatformUser }>(`/platform/users/${userId}`, input)).data),

  deleteUser: async (userId: string): Promise<void> => {
    await apiClient.delete(`/platform/users/${userId}`);
  },
};
