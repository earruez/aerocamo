import { PrismaClient, WorkOrderAssignmentStatus } from '@prisma/client';
import { WorkOrderService } from './WorkOrderService';

const prisma = new PrismaClient();
const workOrderService = new WorkOrderService();

/**
 * WorkOrderAssignmentService
 * Gestiona la asignación de OT a técnicos
 */
export class WorkOrderAssignmentService {
  /**
   * Asignar Work Order a un técnico
   * Valida que el técnico tenga rol TECHNICIAN
   */
  static async assignToTechnician(
    workOrderId: string,
    technicianId: string,
    organizationId: string,
    assignedById: string
  ): Promise<any> {
    // Validar WO existe y pertenece a la org
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { aircraft: true },
    });

    if (!workOrder) {
      throw new Error('Work Order not found');
    }

    if (workOrder.organizationId !== organizationId) {
      throw new Error('Unauthorized: WO does not belong to this organization');
    }

    if (workOrder.assignmentStatus !== 'PENDING') {
      throw new Error(
        `Cannot assign: WO is already assigned or in progress (status: ${workOrder.assignmentStatus})`
      );
    }

    // Validar que el técnico existe, pertenece a la org y tiene rol TECHNICIAN
    const technician = await prisma.user.findUnique({
      where: { id: technicianId },
    });

    if (!technician) {
      throw new Error('Technician not found');
    }

    if (technician.organizationId !== organizationId) {
      throw new Error('Unauthorized: technician does not belong to this organization');
    }

    if (technician.role !== 'TECHNICIAN') {
      throw new Error('User must have TECHNICIAN role to be assigned work orders');
    }

    // Validar que quien asigna tiene permisos (SUPERVISOR/ADMIN)
    const assignedBy = await prisma.user.findUnique({
      where: { id: assignedById },
    });

    if (!assignedBy || !['SUPERVISOR', 'ADMIN'].includes(assignedBy.role)) {
      throw new Error('Only SUPERVISOR or ADMIN can assign work orders');
    }

    // Actualizar WO con la asignación
    const updatedWO = await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        assignedTechnicianId: technicianId,
        assignmentStatus: 'ASSIGNED',
        assignedAt: new Date(),
      },
      include: {
        aircraft: { select: { registration: true, model: true } },
        assignedTechnician: { select: { id: true, name: true, email: true } },
        tasks: { include: { task: true } },
      },
    });

    if (workOrder.status === 'DRAFT') {
      return workOrderService.transition(
        workOrderId,
        'OPEN',
        organizationId,
        {
          id: assignedBy.id,
          email: assignedBy.email,
          role: assignedBy.role,
        },
      );
    }

    return updatedWO;
  }

  /**
   * Marcar OT como "en ejecución" por el técnico
   */
  static async startExecution(
    workOrderId: string,
    technicianId: string,
    organizationId: string
  ): Promise<any> {
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
    });

    if (!workOrder) {
      throw new Error('Work Order not found');
    }

    if (workOrder.organizationId !== organizationId) {
      throw new Error('Unauthorized');
    }

    if (workOrder.assignedTechnicianId !== technicianId) {
      throw new Error('Only assigned technician can start execution');
    }

    if (workOrder.assignmentStatus !== 'ASSIGNED') {
      throw new Error(
        `Cannot start execution: WO is not in ASSIGNED state (currently: ${workOrder.assignmentStatus})`
      );
    }

    const technician = await prisma.user.findUnique({ where: { id: technicianId } });
    if (!technician) {
      throw new Error('Technician not found');
    }

    const updatedWO = await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        assignmentStatus: 'IN_PROGRESS',
        actualStartDate: new Date(),
      },
    });

    if (workOrder.status === 'OPEN') {
      return workOrderService.transition(
        workOrderId,
        'IN_PROGRESS',
        organizationId,
        {
          id: technicianId,
          email: technician.email,
          role: 'TECHNICIAN',
        },
      );
    }

    return updatedWO;
  }

  /**
   * Marcar OT como "esperando evidencia" (trabajo completado)
   */
  static async markAwaitingEvidence(
    workOrderId: string,
    technicianId: string,
    organizationId: string
  ): Promise<any> {
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
    });

    if (!workOrder) {
      throw new Error('Work Order not found');
    }

    if (workOrder.organizationId !== organizationId) {
      throw new Error('Unauthorized');
    }

    if (workOrder.assignedTechnicianId !== technicianId) {
      throw new Error('Only assigned technician can update work order');
    }

    if (workOrder.assignmentStatus !== 'IN_PROGRESS') {
      throw new Error('Work order must be in IN_PROGRESS state');
    }

    const updatedWO = await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        assignmentStatus: 'AWAITING_EVIDENCE',
      },
    });

    return updatedWO;
  }

  /**
   * Obtener trabajadores disponibles para asignación
   */
  static async getAvailableTechnicians(organizationId: string): Promise<any[]> {
    return prisma.user.findMany({
      where: {
        organizationId,
        role: 'TECHNICIAN',
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        licenseNumber: true,
        certifications: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Obtener conteo de OT asignadas a un técnico
   */
  static async getAssignedWorkOrdersCount(
    technicianId: string,
    status?: WorkOrderAssignmentStatus
  ): Promise<number> {
    return prisma.workOrder.count({
      where: {
        assignedTechnicianId: technicianId,
        ...(status && { assignmentStatus: status }),
      },
    });
  }

  /**
   * Listing de OT asignadas a un técnico
   */
  static async getAssignedWorkOrders(
    technicianId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any[]> {
    return prisma.workOrder.findMany({
      where: { assignedTechnicianId: technicianId },
      include: {
        aircraft: { select: { registration: true, model: true } },
        tasks: { include: { task: true } },
      },
      take: limit,
      skip: offset,
      orderBy: { assignedAt: 'desc' },
    });
  }
}
