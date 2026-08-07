import { Compliance, ComplianceStatus, CreateComplianceInput } from '../entities/Compliance';
import { PaginatedResult, PaginationOptions } from './shared';

export interface ComplianceFilters {
  taskId?: string;
  componentId?: string;
  status?: ComplianceStatus;
  /** Return only records where nextDueHours <= this value (fleet due-list query) */
  nextDueHoursLte?: number;
  /** Return only records where nextDueDate <= this date */
  nextDueDateLte?: Date;
}

export interface IComplianceRepository {
  findById(id: string, organizationId: string): Promise<Compliance | null>;

  /** Latest compliance entry per task for a given aircraft (current status) */
  findLatestPerTask(
    aircraftId: string,
    organizationId: string,
  ): Promise<Compliance[]>;

  /** Historial completo de una tarea en una aeronave, del más reciente al más antiguo */
  findHistoryForTask(
    aircraftId: string,
    taskId: string,
    organizationId: string,
  ): Promise<Compliance[]>;

  findAll(
    organizationId: string,
    filters?: ComplianceFilters,
    options?: PaginationOptions,
  ): Promise<PaginatedResult<Compliance>>;

  /** Append-only: no update/delete to preserve audit trail */
  create(input: CreateComplianceInput): Promise<Compliance>;
}
