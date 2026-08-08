// ─────────────────────────────────────────────────────────────────────────────
//  AircraftAlterationController — Alteraciones aprobadas (STC / Form DGAC 337)
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { NotFoundError } from '../../../shared/errors/AppError';

const baseSchema = z.object({
  documentNumber: z.string().min(1).max(255),
  description: z.string().min(1),
  approvalDate: z.coerce.date().optional().nullable(),
  hasFlightManualSupplement: z.boolean().optional(),
  flightManualReference: z.string().max(255).optional().nullable(),
  hasIca: z.boolean().optional(),
  icaReference: z.string().max(255).optional().nullable(),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

const include = {
  createdBy: { select: { id: true, name: true } },
} as const;

export class AircraftAlterationController {
  private async assertAircraft(aircraftId: string, organizationId: string): Promise<void> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: { id: true },
    });
    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);
  }

  listByAircraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.assertAircraft(req.params.aircraftId, req.organizationId);
      const data = await prisma.aircraftAlteration.findMany({
        where: { aircraftId: req.params.aircraftId, organizationId: req.organizationId },
        include,
        orderBy: [{ approvalDate: 'desc' }, { createdAt: 'desc' }],
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.assertAircraft(req.params.aircraftId, req.organizationId);
      const body = createSchema.parse(req.body);

      const created = await prisma.aircraftAlteration.create({
        data: {
          organizationId: req.organizationId,
          aircraftId: req.params.aircraftId,
          documentNumber: body.documentNumber,
          description: body.description,
          approvalDate: body.approvalDate ?? null,
          hasFlightManualSupplement: body.hasFlightManualSupplement ?? false,
          flightManualReference: body.flightManualReference ?? null,
          hasIca: body.hasIca ?? false,
          icaReference: body.icaReference ?? null,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          createdById: req.currentUser.id,
        },
        include,
      });

      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.aircraftAlteration.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('AircraftAlteration', req.params.id);

      const body = updateSchema.parse(req.body);
      const updated = await prisma.aircraftAlteration.update({
        where: { id: existing.id },
        data: body,
        include,
      });

      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.aircraftAlteration.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('AircraftAlteration', req.params.id);

      await prisma.aircraftAlteration.delete({ where: { id: existing.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  };
}
