import { apiClient } from './client';

export interface Organization {
  id: string;
  name: string;
  legalName: string | null;
  logoDataUri: string | null;
}

export const organizationApi = {
  getCurrent: async (): Promise<Organization> => {
    const { data } = await apiClient.get<{ status: string; data: Organization }>('/organization');
    return data.data;
  },

  uploadLogo: async (file: File): Promise<Organization> => {
    const formData = new FormData();
    formData.append('logo', file);
    const { data } = await apiClient.post<{ status: string; data: Organization }>(
      '/organization/logo',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data.data;
  },

  removeLogo: async (): Promise<Organization> => {
    const { data } = await apiClient.delete<{ status: string; data: Organization }>('/organization/logo');
    return data.data;
  },
};
