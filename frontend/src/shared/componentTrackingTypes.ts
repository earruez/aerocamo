import type {
  ComponentIntervalType,
  ComponentExecutionType,
  ComponentDefinition,
  ComponentInstanceStatus,
  ComponentInstance,
  ComponentMovementType,
  ComponentMovement,
  ComponentApplication,
} from '../api/componentTracking.api';

export type {
  ComponentIntervalType,
  ComponentExecutionType,
  ComponentDefinition,
  ComponentInstanceStatus,
  ComponentInstance,
  ComponentMovementType,
  ComponentMovement,
  ComponentApplication,
};

export interface AircraftSnapshot {
  currentHours: number;
  currentCycles: number;
  currentDate: string;
}

export type WorkRequestExecutionType =
  | 'maintenance_application'
  | 'component_replacement'
  | 'discrepancy_action';
