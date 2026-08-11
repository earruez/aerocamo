// ─────────────────────────────────────────────────────────────────────────────
//  PlatformController — Panel de plataforma: crear empresas y sus usuarios
//
//  A diferencia de todo lo demás en la API, esto no está acotado a una
//  organización: lo usa quien administra Aerocamo para dar de alta empresas
//  nuevas y su primer usuario. Solo lo alcanza el rol SUPER_ADMIN.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ConflictError, ValidationError } from '../../../shared/errors/AppError';
import { AuditLogService } from '../../../domain/services/AuditLogService';

const auditLog = new AuditLogService();
const BCRYPT_ROUNDS = 12;

const slugify = (value: string): string =>
  value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(255),
  legalName: z.string().trim().max(255).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase(),
  subscriptionPlan: z.enum(['FREE', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  admin: z.object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(200),
  }),
});

const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  legalName: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
  subscriptionPlan: z.enum(['FREE', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
  subscriptionStatus: z.enum(['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'SUSPENDED']).optional(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'INSPECTOR', 'READONLY']),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'INSPECTOR', 'READONLY']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

export class PlatformController {
  // ── Organizaciones ────────────────────────────────────────────────────────
  listOrganizations = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgs = await prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true, aircraft: true } } },
      });
      res.status(200).json({
        status: 'success',
        data: orgs.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          legalName: o.legalName,
          country: o.country,
          subscriptionPlan: o.subscriptionPlan,
          subscriptionStatus: o.subscriptionStatus,
          isActive: o.isActive,
          createdAt: o.createdAt,
          userCount: o._count.users,
          aircraftCount: o._count.aircraft,
        })),
      });
    } catch (err) { next(err); }
  };

  createOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createOrgSchema.parse(req.body);

      const baseSlug = slugify(body.name) || 'empresa';
      let slug = baseSlug;
      let suffix = 2;
      while (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const existingEmail = await prisma.user.findFirst({
        where: { email: { equals: body.admin.email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existingEmail) throw new ConflictError('Ya existe un usuario con ese correo');

      const passwordHash = await bcrypt.hash(body.admin.password, BCRYPT_ROUNDS);

      const { org, adminUser } = await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: body.name,
            slug,
            legalName: body.legalName ?? null,
            country: body.country,
            subscriptionPlan: body.subscriptionPlan ?? 'FREE',
            subscriptionStatus: 'TRIALING',
          },
        });
        const adminUser = await tx.user.create({
          data: {
            organizationId: org.id,
            name: body.admin.name,
            email: body.admin.email,
            passwordHash,
            role: 'ADMIN',
          },
        });
        return { org, adminUser };
      });

      await auditLog.log({
        organizationId: org.id,
        entityType: 'Organization',
        entityId: org.id,
        action: 'CREATE',
        newValue: { name: org.name, slug: org.slug, adminEmail: adminUser.email },
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(201).json({
        status: 'success',
        data: { id: org.id, name: org.name, slug: org.slug, admin: { id: adminUser.id, email: adminUser.email } },
      });
    } catch (err) { next(err); }
  };

  updateOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new NotFoundError('Organization', req.params.id);

      const body = updateOrgSchema.parse(req.body);
      const updated = await prisma.organization.update({ where: { id: existing.id }, data: body });

      await auditLog.log({
        organizationId: existing.id,
        entityType: 'Organization',
        entityId: existing.id,
        action: 'UPDATE',
        previousValue: { isActive: existing.isActive, subscriptionStatus: existing.subscriptionStatus },
        newValue: body,
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  // ── Usuarios de una organización ──────────────────────────────────────────
  listOrganizationUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        where: { organizationId: req.params.id },
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      res.status(200).json({ status: 'success', data: users });
    } catch (err) { next(err); }
  };

  createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!org) throw new NotFoundError('Organization', req.params.id);

      const body = createUserSchema.parse(req.body);
      const existingEmail = await prisma.user.findFirst({
        where: { email: { equals: body.email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existingEmail) throw new ConflictError('Ya existe un usuario con ese correo');

      const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
      const user = await prisma.user.create({
        data: { organizationId: org.id, name: body.name, email: body.email, passwordHash, role: body.role },
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      });

      await auditLog.log({
        organizationId: org.id,
        entityType: 'User',
        entityId: user.id,
        action: 'CREATE',
        newValue: { email: user.email, role: user.role },
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(201).json({ status: 'success', data: user });
    } catch (err) { next(err); }
  };

  updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
      if (!existing) throw new NotFoundError('User', req.params.userId);
      if (existing.role === 'SUPER_ADMIN') {
        throw new ValidationError('Las cuentas de plataforma no se administran desde aquí');
      }

      const body = updateUserSchema.parse(req.body);

      if (body.email && body.email !== existing.email) {
        const existingEmail = await prisma.user.findFirst({
          where: { email: { equals: body.email, mode: 'insensitive' }, id: { not: existing.id } },
          select: { id: true },
        });
        if (existingEmail) throw new ConflictError('Ya existe un usuario con ese correo');
      }

      if (body.role && body.role !== 'ADMIN' && existing.role === 'ADMIN') {
        await this.assertNotLastAdmin(existing.organizationId, existing.id, 'cambiar de rol al último administrador');
      }
      if (body.isActive === false && existing.role === 'ADMIN' && existing.isActive) {
        await this.assertNotLastAdmin(existing.organizationId, existing.id, 'desactivar al último administrador');
      }

      const data: Record<string, unknown> = {
        name: body.name, email: body.email, role: body.role, isActive: body.isActive,
      };
      if (body.password) data.passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

      const updated = await prisma.user.update({
        where: { id: existing.id },
        data,
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });

      await auditLog.log({
        organizationId: existing.organizationId,
        entityType: 'User',
        entityId: existing.id,
        action: 'UPDATE',
        previousValue: { name: existing.name, email: existing.email, role: existing.role, isActive: existing.isActive },
        newValue: { name: updated.name, email: updated.email, role: updated.role, isActive: updated.isActive, passwordReset: Boolean(body.password) },
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(200).json({ status: 'success', data: updated });
    } catch (err) { next(err); }
  };

  deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
      if (!existing) throw new NotFoundError('User', req.params.userId);
      if (existing.role === 'SUPER_ADMIN') {
        throw new ValidationError('Las cuentas de plataforma no se administran desde aquí');
      }
      if (existing.role === 'ADMIN') {
        await this.assertNotLastAdmin(existing.organizationId, existing.id, 'eliminar al último administrador');
      }

      await prisma.user.delete({ where: { id: existing.id } });

      await auditLog.log({
        organizationId: existing.organizationId,
        entityType: 'User',
        entityId: existing.id,
        action: 'DELETE',
        previousValue: { name: existing.name, email: existing.email, role: existing.role },
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(204).send();
    } catch (err) { next(err); }
  };

  private assertNotLastAdmin = async (organizationId: string, excludingUserId: string, action: string): Promise<void> => {
    const otherActiveAdmins = await prisma.user.count({
      where: { organizationId, role: 'ADMIN', isActive: true, id: { not: excludingUserId } },
    });
    if (otherActiveAdmins === 0) {
      throw new ValidationError(`No se puede ${action}: la empresa se quedaría sin administrador activo`);
    }
  };
}
