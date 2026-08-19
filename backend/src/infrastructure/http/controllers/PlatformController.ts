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
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.client';
import { NotFoundError, ConflictError, ValidationError } from '../../../shared/errors/AppError';
import { AuditLogService } from '../../../domain/services/AuditLogService';
import { PasswordResetService } from '../../../domain/services/PasswordResetService';
import { EmailService } from '../../../domain/services/EmailService';
import { env } from '../../../config/env';

const auditLog = new AuditLogService();
const BCRYPT_ROUNDS = 12;

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  TECHNICIAN: 'Técnico',
  INSPECTOR: 'Inspector',
  READONLY: 'Solo lectura',
};

/** Emite el token de activación y dispara el correo de bienvenida. No lanza:
 * si el correo falla, el usuario igual queda creado — el caller decide qué
 * avisar con el `emailSent` que devuelve. */
async function sendWelcomeEmail(user: { id: string; name: string; email: string; role: string }, organizationName: string): Promise<boolean> {
  const token = await PasswordResetService.issueToken(user.id);
  const setPasswordUrl = `${env.appUrl}/reset-password?token=${token}`;
  return EmailService.sendWelcomeEmail({
    to: user.email,
    name: user.name,
    organizationName,
    roleLabel: ROLE_LABELS[user.role] ?? user.role,
    setPasswordUrl,
  });
}

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

const copyTasksSchema = z.object({
  sourceOrganizationId: z.string().uuid(),
  applicableModels: z.array(z.string().nullable()).min(1),
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

      const emailSent = await sendWelcomeEmail(adminUser, org.name);

      res.status(201).json({
        status: 'success',
        data: { id: org.id, name: org.name, slug: org.slug, admin: { id: adminUser.id, email: adminUser.email } },
        emailSent,
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

  /** Elimina la empresa y en cascada toda su data (aeronaves, cumplimientos,
   * OT, historial, usuarios, etc. — ver onDelete: Cascade en schema.prisma).
   * Irreversible; el frontend exige escribir el nombre exacto antes de llamar
   * a este endpoint. */
  deleteOrganization = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.organization.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, slug: true, _count: { select: { users: true, aircraft: true } } },
      });
      if (!existing) throw new NotFoundError('Organization', req.params.id);

      try {
        await prisma.organization.delete({ where: { id: existing.id } });
      } catch (err) {
        // Postgres 23503 = foreign_key_violation, 23001 = restrict_violation (nuestro caso:
        // compliances/discrepancies tienen ON DELETE RESTRICT hacia organizations a propósito,
        // para no perder trazabilidad regulatoria). Prisma entrega esto como error "unknown",
        // no como P2003, así que hay que revisar el mensaje.
        const isRestrictViolation =
          (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') ||
          (err instanceof Error && /23001|23503|violates.*foreign key|violates.*RESTRICT/i.test(err.message));
        if (isRestrictViolation) {
          throw new ConflictError(
            'No se puede eliminar: la empresa tiene cumplimientos, discrepancias u otro historial de mantenimiento registrado. Desactívala en vez de eliminarla para conservar la trazabilidad.',
          );
        }
        throw err;
      }

      await auditLog.log({
        organizationId: existing.id,
        entityType: 'Organization',
        entityId: existing.id,
        action: 'DELETE',
        previousValue: { name: existing.name, slug: existing.slug, userCount: existing._count.users, aircraftCount: existing._count.aircraft },
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(204).send();
    } catch (err) { next(err); }
  };

  // ── Biblioteca de mantenimiento (tareas agrupadas por modelo de aeronave) ──
  listMaintenanceTaskModels = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!org) throw new NotFoundError('Organization', req.params.id);

      const grouped = await prisma.maintenanceTask.groupBy({
        by: ['applicableModel'],
        where: { organizationId: org.id },
        _count: { _all: true },
        orderBy: { applicableModel: 'asc' },
      });

      res.status(200).json({
        status: 'success',
        data: grouped.map((g) => ({ applicableModel: g.applicableModel, taskCount: g._count._all })),
      });
    } catch (err) { next(err); }
  };

  /** Copia tareas de la biblioteca de una empresa origen hacia esta empresa,
   * filtradas por modelo de aeronave (applicableModel), como filas
   * independientes — no queda ningún vínculo con el origen. Se salta las
   * tareas cuyo `code` ya existe en destino (código único por empresa), y lo
   * informa en `skipped`. */
  copyMaintenanceTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetOrg = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!targetOrg) throw new NotFoundError('Organization', req.params.id);

      const { sourceOrganizationId, applicableModels } = copyTasksSchema.parse(req.body);
      if (sourceOrganizationId === targetOrg.id) {
        throw new ValidationError('La empresa origen y destino no pueden ser la misma');
      }

      const namedModels = applicableModels.filter((m): m is string => m !== null);
      const includeNull = applicableModels.includes(null);

      const sourceTasks = await prisma.maintenanceTask.findMany({
        where: {
          organizationId: sourceOrganizationId,
          OR: [
            ...(namedModels.length > 0 ? [{ applicableModel: { in: namedModels } }] : []),
            ...(includeNull ? [{ applicableModel: null }] : []),
          ],
        },
      });
      if (sourceTasks.length === 0) throw new NotFoundError('Tareas de biblioteca');

      const existingCodes = new Set(
        (await prisma.maintenanceTask.findMany({
          where: { organizationId: targetOrg.id },
          select: { code: true },
        })).map((t) => t.code),
      );

      const copied: string[] = [];
      const skipped: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const t of sourceTasks) {
          if (existingCodes.has(t.code)) {
            skipped.push(t.code);
            continue;
          }
          await tx.maintenanceTask.create({
            data: {
              organizationId: targetOrg.id,
              code: t.code,
              ata: t.ata,
              equipmentScope: t.equipmentScope,
              complianceRecurrence: t.complianceRecurrence,
              title: t.title,
              description: t.description,
              intervalType: t.intervalType,
              intervalHours: t.intervalHours,
              intervalCycles: t.intervalCycles,
              intervalCalendarDays: t.intervalCalendarDays,
              intervalCalendarMonths: t.intervalCalendarMonths,
              toleranceHours: t.toleranceHours,
              toleranceCycles: t.toleranceCycles,
              toleranceCalendarDays: t.toleranceCalendarDays,
              referenceNumber: t.referenceNumber,
              referenceType: t.referenceType,
              isMandatory: t.isMandatory,
              estimatedManHours: t.estimatedManHours,
              requiresInspection: t.requiresInspection,
              isComponentControl: t.isComponentControl,
              applicableModel: t.applicableModel,
              applicablePartNumber: t.applicablePartNumber,
              isActive: t.isActive,
            },
          });
          copied.push(t.code);
          existingCodes.add(t.code);
        }
      });

      await auditLog.log({
        organizationId: targetOrg.id,
        entityType: 'MaintenanceTask',
        entityId: targetOrg.id,
        action: 'COPY',
        newValue: { sourceOrganizationId, applicableModels, copiedCount: copied.length, skippedCount: skipped.length },
        userId: req.currentUser.id,
        userEmail: req.currentUser.email,
        userRole: req.currentUser.role,
      });

      res.status(200).json({ status: 'success', data: { copied: copied.length, skipped } });
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
      const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
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

      const emailSent = await sendWelcomeEmail(user, org.name);

      res.status(201).json({ status: 'success', data: user, emailSent });
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
