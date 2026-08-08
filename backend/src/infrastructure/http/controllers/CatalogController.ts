// ─────────────────────────────────────────────────────────────────────────────
//  CatalogController — Manuales de referencia y talleres (CMA)
//
//  Catálogos de Configuración: se consultan al planificar y al cerrar una OT,
//  y la organización los amplía por su cuenta.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ConflictError } from '../../../shared/errors/AppError';

const manualSchema = z.object({
  model: z.string().trim().min(1).max(120),
  reference: z.string().trim().min(1).max(2000),
  kind: z.enum(['AIRCRAFT', 'ENGINE', 'COMPONENT', 'OTHER']).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const shopSchema = z.object({
  code: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(1).max(180),
  country: z.string().trim().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export class CatalogController {
  // ── Manuales ───────────────────────────────────────────────────────────────
  listManuals = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await prisma.maintenanceManual.findMany({
        where: { organizationId: req.organizationId },
        orderBy: [{ kind: 'asc' }, { model: 'asc' }],
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createManual = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = manualSchema.parse(req.body);
      const duplicate = await prisma.maintenanceManual.findFirst({
        where: { organizationId: req.organizationId, model: body.model, reference: body.reference },
        select: { id: true },
      });
      if (duplicate) throw new ConflictError('Ese manual ya está registrado para el modelo');

      const created = await prisma.maintenanceManual.create({
        data: {
          organizationId: req.organizationId,
          model: body.model,
          reference: body.reference,
          kind: body.kind ?? 'ENGINE',
          notes: body.notes ?? null,
          createdById: req.currentUser.id,
        },
      });
      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  updateManual = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.maintenanceManual.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('MaintenanceManual', req.params.id);

      const updated = await prisma.maintenanceManual.update({
        where: { id: existing.id },
        data: manualSchema.partial().parse(req.body),
      });
      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  removeManual = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.maintenanceManual.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('MaintenanceManual', req.params.id);
      await prisma.maintenanceManual.delete({ where: { id: existing.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  };

  // ── Talleres ───────────────────────────────────────────────────────────────
  listShops = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await prisma.repairShop.findMany({
        where: { organizationId: req.organizationId },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createShop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = shopSchema.parse(req.body);
      const duplicate = await prisma.repairShop.findFirst({
        where: { organizationId: req.organizationId, name: { equals: body.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictError('Ya existe un taller con ese nombre');

      const created = await prisma.repairShop.create({
        data: {
          organizationId: req.organizationId,
          code: body.code?.trim() || null,
          name: body.name,
          country: body.country?.trim() || null,
          notes: body.notes ?? null,
          isActive: body.isActive ?? true,
          createdById: req.currentUser.id,
        },
      });
      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  updateShop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.repairShop.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('RepairShop', req.params.id);

      const updated = await prisma.repairShop.update({
        where: { id: existing.id },
        data: shopSchema.partial().parse(req.body),
      });
      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  removeShop = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.repairShop.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('RepairShop', req.params.id);
      await prisma.repairShop.delete({ where: { id: existing.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  };
}
