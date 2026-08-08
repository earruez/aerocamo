// ─────────────────────────────────────────────────────────────────────────────
//  AircraftTaskNoteController — Notas de revisión sobre una tarea
//
//  Bitácora libre, sin cumplimiento asociado: registrar que se revisó una AD y
//  sigue vigente, que se pidió información al fabricante, o cualquier
//  seguimiento. No mueve vencimientos ni el estado de la tarea.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ForbiddenError } from '../../../shared/errors/AppError';

const noteSchema = z.object({
  note: z.string().trim().min(1, 'La nota no puede estar vacía').max(4000),
});

const include = {
  createdBy: { select: { id: true, name: true, role: true } },
} as const;

export class AircraftTaskNoteController {
  listForTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { aircraftId, taskId } = req.params;
      const data = await prisma.aircraftTaskNote.findMany({
        where: { aircraftId, taskId, organizationId: req.organizationId },
        include,
        orderBy: { createdAt: 'desc' },
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  /** Cuántas notas tiene cada tarea de la aeronave, para marcarlas en el plan. */
  countsByAircraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const grouped = await prisma.aircraftTaskNote.groupBy({
        by: ['taskId'],
        where: { aircraftId: req.params.aircraftId, organizationId: req.organizationId },
        _count: { _all: true },
      });
      const data = grouped.map((row) => ({ taskId: row.taskId, count: row._count._all }));
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { aircraftId, taskId } = req.params;
      const { note } = noteSchema.parse(req.body);

      // La nota se ancla al vínculo: la tarea debe estar asignada a la aeronave,
      // aunque esté marcada como no aplicable (ahí también se documenta).
      const link = await prisma.aircraftTask.findFirst({
        where: { aircraftId, taskId, aircraft: { organizationId: req.organizationId } },
        select: { aircraftId: true },
      });
      if (!link) throw new NotFoundError('AircraftTask');

      const created = await prisma.aircraftTaskNote.create({
        data: {
          organizationId: req.organizationId,
          aircraftId,
          taskId,
          note,
          createdById: req.currentUser.id,
        },
        include,
      });

      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.aircraftTaskNote.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true, createdById: true },
      });
      if (!existing) throw new NotFoundError('AircraftTaskNote', req.params.id);
      this.assertCanModify(req, existing.createdById);

      const { note } = noteSchema.parse(req.body);
      const updated = await prisma.aircraftTaskNote.update({
        where: { id: existing.id },
        data: { note },
        include,
      });

      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.aircraftTaskNote.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true, createdById: true },
      });
      if (!existing) throw new NotFoundError('AircraftTaskNote', req.params.id);
      this.assertCanModify(req, existing.createdById);

      await prisma.aircraftTaskNote.delete({ where: { id: existing.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  };

  /** Cada quien edita lo suyo; ADMIN y SUPERVISOR pueden corregir cualquiera. */
  private assertCanModify(req: Request, authorId: string | null): void {
    const role = req.currentUser.role;
    if (role === 'ADMIN' || role === 'SUPERVISOR') return;
    if (authorId && authorId === req.currentUser.id) return;
    throw new ForbiddenError('Solo puedes modificar tus propias notas');
  }
}
