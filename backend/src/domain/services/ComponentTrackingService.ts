import {
  CreateComponentApplicationInput,
  CreateComponentDefinitionInput,
  CreateComponentInstanceInput,
  CreateComponentMovementInput,
} from '../entities/ComponentTracking';
import { IComponentTrackingRepository } from '../repositories/IComponentTrackingRepository';
import { PrismaComponentTrackingRepository } from '../../infrastructure/database/repositories/PrismaComponentTrackingRepository';

export class ComponentTrackingService {
  constructor(private readonly repo: IComponentTrackingRepository = new PrismaComponentTrackingRepository()) {}

  listDefinitions(organizationId: string) {
    return this.repo.listDefinitions(organizationId);
  }

  createDefinition(organizationId: string, input: CreateComponentDefinitionInput) {
    return this.repo.createDefinition(organizationId, input);
  }

  listInstances(organizationId: string, aircraftId?: string) {
    return this.repo.listInstances(organizationId, aircraftId);
  }

  createInstance(organizationId: string, input: CreateComponentInstanceInput) {
    return this.repo.createInstance(organizationId, input);
  }

  listApplications(organizationId: string, aircraftId?: string) {
    return this.repo.listApplications(organizationId, aircraftId);
  }

  createApplication(organizationId: string, input: CreateComponentApplicationInput) {
    return this.repo.createApplication(organizationId, input);
  }

  listMovements(organizationId: string, aircraftId?: string) {
    return this.repo.listMovements(organizationId, aircraftId);
  }

  createMovement(organizationId: string, input: CreateComponentMovementInput) {
    return this.repo.createMovement(organizationId, input);
  }
}

export const componentTrackingService = new ComponentTrackingService();
