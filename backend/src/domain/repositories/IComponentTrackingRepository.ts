import {
  ComponentDefinition,
  ComponentInstance,
  ComponentApplication,
  ComponentMovement,
  CreateComponentDefinitionInput,
  CreateComponentInstanceInput,
  CreateComponentApplicationInput,
  CreateComponentMovementInput,
} from '../entities/ComponentTracking';

export interface IComponentTrackingRepository {
  listDefinitions(organizationId: string): Promise<ComponentDefinition[]>;
  createDefinition(organizationId: string, input: CreateComponentDefinitionInput): Promise<ComponentDefinition>;

  listInstances(organizationId: string, aircraftId?: string): Promise<ComponentInstance[]>;
  createInstance(organizationId: string, input: CreateComponentInstanceInput): Promise<ComponentInstance>;

  listApplications(organizationId: string, aircraftId?: string): Promise<ComponentApplication[]>;
  createApplication(organizationId: string, input: CreateComponentApplicationInput): Promise<ComponentApplication>;

  listMovements(organizationId: string, aircraftId?: string): Promise<ComponentMovement[]>;
  createMovement(organizationId: string, input: CreateComponentMovementInput): Promise<ComponentMovement>;
}
