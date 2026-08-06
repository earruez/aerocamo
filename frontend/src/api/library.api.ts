import { apiClient as axios } from './client';

export interface MaintenanceTemplateTask {
  id: string;
  templateId: string;
  code: string;
  title: string;
  description: string;
  chapter?: string | null;
  section?: string | null;
  intervalType: string;
  intervalHours?: number | null;
  intervalCycles?: number | null;
  intervalCalendarDays?: number | null;
  intervalCalendarMonths?: number | null;
  referenceNumber?: string | null;
  referenceType?: string;
  isMandatory?: boolean;
  estimatedManHours?: number | null;
  requiresInspection?: boolean;
  applicableModel?: string | null;
  applicablePartNumber?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceTemplate {
  id: string;
  organizationId: string;
  manufacturer: string;
  model: string;
  description?: string | null;
  version: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  tasks?: MaintenanceTemplateTask[];
}

export interface CreateTemplateInput {
  manufacturer: string;
  model: string;
  description?: string;
  version?: string;
}

export interface CreateTemplateTaskInput {
  code: string;
  title: string;
  description: string;
  chapter?: string;
  section?: string;
  intervalType: string;
  intervalHours?: number;
  intervalCycles?: number;
  intervalCalendarDays?: number;
  intervalCalendarMonths?: number;
  referenceNumber?: string;
  referenceType?: string;
  isMandatory?: boolean;
  estimatedManHours?: number;
  requiresInspection?: boolean;
  applicableModel?: string;
  applicablePartNumber?: string;
}

export interface UpdateTemplateTaskInput extends Partial<CreateTemplateTaskInput> {}

export type AssignedPlanCategory = 'manufacturer' | 'national_dgac' | 'engine_components' | 'origin_country';

export interface AircraftAssignedPlanInput {
  category: AssignedPlanCategory;
  templateId: string;
}

export interface AircraftAssignedPlan {
  category: AssignedPlanCategory;
  templateId: string;
  templateLabel: string;
  assignedAt?: string;
  tasksCloned?: number;
}

export const libraryApi = {
  /**
   * List all maintenance templates
   */
  async findAll(): Promise<MaintenanceTemplate[]> {
    const { data } = await axios.get('/library/templates');
    return data;
  },

  /**
   * Get a specific maintenance template with its tasks
   */
  async getById(id: string): Promise<MaintenanceTemplate> {
    const { data } = await axios.get(`/library/templates/${id}`);
    return data;
  },

  /**
   * Create a new maintenance template
   */
  async create(input: CreateTemplateInput): Promise<MaintenanceTemplate> {
    const { data } = await axios.post('/library/templates', input);
    return data;
  },

  /**
   * Search for a template by manufacturer and model
   */
  async search(
    manufacturer: string,
    model: string
  ): Promise<MaintenanceTemplate | null> {
    const { data } = await axios.get('/library/templates/search', {
      params: { manufacturer, model },
    });
    return data;
  },

  /**
   * Add a task to a template
   */
  async addTask(
    templateId: string,
    task: CreateTemplateTaskInput
  ): Promise<MaintenanceTemplateTask> {
    const { data } = await axios.post(`/library/templates/${templateId}/tasks`, task);
    return data;
  },

  /**
   * Update a template task
   */
  async updateTask(
    taskId: string,
    updates: UpdateTemplateTaskInput
  ): Promise<MaintenanceTemplateTask> {
    const { data } = await axios.put(`/library/templates/tasks/${taskId}`, updates);
    return data;
  },

  /**
   * Delete a template task (soft delete)
   */
  async deleteTask(taskId: string): Promise<MaintenanceTemplateTask> {
    const { data } = await axios.delete(`/library/templates/tasks/${taskId}`);
    return data;
  },

  /**
   * Clone a template to a newly created aircraft
   */
  async cloneToAircraft(
    templateId: string,
    aircraftId: string
  ): Promise<{ message: string; tasksCloned: number }> {
    const { data } = await axios.post(
      `/library/templates/${templateId}/clone-to-aircraft`,
      { aircraftId }
    );
    return data;
  },

  /**
   * Assign one maintenance plan template per category to an aircraft.
   */
  async assignBundleToAircraft(
    aircraftId: string,
    assignments: AircraftAssignedPlanInput[],
  ): Promise<{ message: string; assignments: AircraftAssignedPlan[] }> {
    const { data } = await axios.post('/library/templates/assign-bundle-to-aircraft', {
      aircraftId,
      assignments,
    });
    return data;
  },

  /**
   * Get last assigned active plans by category for an aircraft.
   */
  async getAircraftAssignedPlans(
    aircraftId: string,
  ): Promise<{ assignments: AircraftAssignedPlan[] }> {
    const { data } = await axios.get(`/library/templates/aircraft/${aircraftId}/assigned-plans`);
    return data;
  },

  /**
   * Delete a template (soft delete)
   */
  async deleteTemplate(id: string): Promise<MaintenanceTemplate> {
    const { data } = await axios.delete(`/library/templates/${id}`);
    return data;
  },
};
