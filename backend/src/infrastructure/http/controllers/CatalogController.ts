// ─────────────────────────────────────────────────────────────────────────────
//  CatalogController — Manuales de referencia y talleres (CMA)
//
//  Catálogos de Configuración: se consultan al planificar y al cerrar una OT,
//  y la organización los amplía por su cuenta.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ConflictError, ValidationError } from '../../../shared/errors/AppError';

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

const contactSchema = z.object({
  name: z.string().trim().min(1).max(180),
  role: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email('Correo inválido').max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(60).optional().nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const counterTypeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(30).optional(),
  scope: z.enum(['AIRCRAFT', 'ENGINE', 'BOTH']).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export class CatalogController {
  // ── Contadores ─────────────────────────────────────────────────────────────
  listCounterTypes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await prisma.counterType.findMany({
        where: { organizationId: req.organizationId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createCounterType = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = counterTypeSchema.parse(req.body);
      const duplicate = await prisma.counterType.findFirst({
        where: { organizationId: req.organizationId, code: { equals: body.code, mode: 'insensitive' } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictError(`Ya existe un contador con el código ${body.code}`);

      const created = await prisma.counterType.create({
        data: {
          organizationId: req.organizationId,
          code: body.code.toUpperCase(),
          name: body.name,
          unit: body.unit?.trim() || 'ciclos',
          scope: body.scope ?? 'BOTH',
          isActive: body.isActive ?? true,
          sortOrder: body.sortOrder ?? 100,
        },
      });
      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  updateCounterType = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.counterType.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true, legacyField: true },
      });
      if (!existing) throw new NotFoundError('CounterType', req.params.id);

      const body = counterTypeSchema.partial().parse(req.body);
      // Los contadores que reflejan un campo fijo no pueden cambiar de alcance
      // ni de código: son el puente con los datos que ya existían.
      if (existing.legacyField && (body.code || body.scope)) {
        throw new ValidationError('Este contador está enlazado a los datos existentes: solo puedes cambiar su nombre o unidad.');
      }

      const updated = await prisma.counterType.update({
        where: { id: existing.id },
        data: { ...body, code: body.code?.toUpperCase() },
      });
      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  removeCounterType = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.counterType.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true, legacyField: true, code: true, _count: { select: { readings: true } } },
      });
      if (!existing) throw new NotFoundError('CounterType', req.params.id);
      if (existing.legacyField) {
        throw new ValidationError(`${existing.code} está enlazado a los datos existentes y no se puede eliminar. Desactívalo si no lo usas.`);
      }
      if (existing._count.readings > 0) {
        throw new ValidationError(`${existing.code} tiene ${existing._count.readings} lecturas registradas. Desactívalo en vez de eliminarlo.`);
      }

      await prisma.counterType.delete({ where: { id: existing.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  };

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

  // ── Contactos del taller ───────────────────────────────────────────────────
  listContacts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await prisma.repairShopContact.findMany({
        where: { repairShopId: req.params.shopId, organizationId: req.organizationId },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      });
      res.status(200).json({ status: 'success', data });
    } catch (err) { next(err); }
  };

  createContact = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const shop = await prisma.repairShop.findFirst({
        where: { id: req.params.shopId, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!shop) throw new NotFoundError('RepairShop', req.params.shopId);

      const body = contactSchema.parse(req.body);
      const created = await prisma.repairShopContact.create({
        data: {
          organizationId: req.organizationId,
          repairShopId: shop.id,
          name: body.name,
          role: body.role?.trim() || null,
          email: body.email?.trim() || null,
          phone: body.phone?.trim() || null,
          isPrimary: body.isPrimary ?? false,
          isActive: body.isActive ?? true,
        },
      });
      res.status(201).json({ status: 'success', data: created });
    } catch (err) { next(err); }
  };

  updateContact = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.repairShopContact.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('RepairShopContact', req.params.id);

      const body = contactSchema.partial().parse(req.body);
      const updated = await prisma.repairShopContact.update({
        where: { id: existing.id },
        data: {
          ...body,
          email: body.email === undefined ? undefined : (body.email?.trim() || null),
        },
      });
      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  removeContact = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.repairShopContact.findFirst({
        where: { id: req.params.id, organizationId: req.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('RepairShopContact', req.params.id);
      await prisma.repairShopContact.delete({ where: { id: existing.id } });
      res.status(204).send();
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
