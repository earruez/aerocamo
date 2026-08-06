import { Aircraft, CreateAircraftInput, UpdateAircraftInput } from '../../domain/entities/Aircraft';
import { IAircraftRepository, MaintenancePlanItem } from '../../domain/repositories/IAircraftRepository';
import { PaginatedResult, PaginationOptions } from '../../domain/repositories/shared';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError';

export class CreateAircraftUseCase {
  constructor(private readonly repo: IAircraftRepository) {}

  async execute(input: CreateAircraftInput): Promise<Aircraft> {
    const existing = await this.repo.findByRegistration(input.registration, input.organizationId);
    if (existing) {
      throw new ConflictError(
        `Aircraft with registration '${input.registration}' already exists`,
      );
    }
    return this.repo.create(input);
  }
}

export class GetAircraftUseCase {
  constructor(private readonly repo: IAircraftRepository) {}

  async findById(id: string, organizationId: string): Promise<Aircraft> {
    const aircraft = await this.repo.findById(id, organizationId);
    if (!aircraft) throw new NotFoundError('Aircraft', id);
    return aircraft;
  }

  async findAll(
    organizationId: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResult<Aircraft>> {
    return this.repo.findAll(organizationId, options);
  }
}

export class UpdateAircraftUseCase {
  constructor(private readonly repo: IAircraftRepository) {}

  async execute(
    id: string,
    organizationId: string,
    input: UpdateAircraftInput,
  ): Promise<Aircraft> {
    const aircraft = await this.repo.findById(id, organizationId);
    if (!aircraft) throw new NotFoundError('Aircraft', id);
    return this.repo.update(id, organizationId, input);
  }
}

export class GetMaintenancePlanUseCase {
  constructor(private readonly repo: IAircraftRepository) {}

  async execute(aircraftId: string, organizationId: string): Promise<MaintenancePlanItem[]> {
    const aircraft = await this.repo.findById(aircraftId, organizationId);
    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);
    return this.repo.getMaintenancePlan(aircraftId, organizationId);
  }
}

export class DeleteAircraftUseCase {
  constructor(private readonly repo: IAircraftRepository) {}

  async execute(id: string, organizationId: string): Promise<void> {
    const aircraft = await this.repo.findById(id, organizationId);
    if (!aircraft) throw new NotFoundError('Aircraft', id);
    await this.repo.delete(id, organizationId);
  }
}
