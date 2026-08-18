import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { LoginUseCase } from '../../../application/auth/LoginUseCase';
import { prisma } from '../../database/prisma.client';
import { PasswordResetService } from '../../../domain/services/PasswordResetService';
import { EmailService } from '../../../domain/services/EmailService';
import { env } from '../../../config/env';

const BCRYPT_ROUNDS = 12;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  organization: z.string().min(1), // accepts UUID or slug
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  organization: z.string().min(1),
});

const verifyResetTokenSchema = z.object({
  token: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

/** Resuelve "organización" (slug o UUID) a un organizationId, o null si no existe. */
async function resolveOrganizationId(organization: string): Promise<string | null> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(organization)) return organization;
  const org = await prisma.organization.findUnique({ where: { slug: organization } });
  return org?.id ?? null;
}

export class AuthController {
  constructor(private readonly loginUseCase: LoginUseCase) {}

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, organization } = loginSchema.parse(req.body);

      const organizationId = await resolveOrganizationId(organization);
      if (!organizationId) {
        res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid credentials' });
        return;
      }

      const result = await this.loginUseCase.execute({ email, password, organizationId });
      res.status(200).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Siempre responde el mismo mensaje genérico, exista o no el usuario/la
   * organización — así nadie puede usar este endpoint para confirmar qué
   * correos están registrados.
   */
  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const genericSuccess = () => res.status(200).json({
      status: 'success',
      message: 'Si el correo existe, te enviamos un enlace para restablecer tu contraseña.',
    });

    try {
      const { email, organization } = forgotPasswordSchema.parse(req.body);

      const organizationId = await resolveOrganizationId(organization);
      if (!organizationId) {
        genericSuccess();
        return;
      }

      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, organizationId, isActive: true },
        select: { id: true, name: true, email: true },
      });
      if (!user) {
        genericSuccess();
        return;
      }

      const token = await PasswordResetService.issueToken(user.id);
      const resetUrl = `${env.appUrl}/reset-password?token=${token}`;
      await EmailService.sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });

      genericSuccess();
    } catch (err) {
      next(err);
    }
  };

  /** Público: valida un token de activación/reseteo sin requerir sesión. */
  verifyResetToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = verifyResetTokenSchema.parse(req.query);
      const user = await PasswordResetService.verifyToken(token);

      if (!user || !user.isActive) {
        res.status(200).json({ status: 'success', data: { valid: false } });
        return;
      }

      res.status(200).json({
        status: 'success',
        data: { valid: true, name: user.name, isNewAccount: user.emailConfirmedAt == null },
      });
    } catch (err) {
      next(err);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      const user = await PasswordResetService.verifyToken(token);

      if (!user || !user.isActive) {
        res.status(400).json({
          status: 'error',
          code: 'INVALID_TOKEN',
          message: 'El enlace no es válido o ya expiró. Solicita uno nuevo.',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          emailConfirmedAt: user.emailConfirmedAt ?? new Date(),
        },
      });

      await EmailService.sendPasswordChangedConfirmation({ to: user.email, name: user.name });

      res.status(200).json({ status: 'success', message: 'Contraseña actualizada correctamente.' });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /auth/me — validates that the token's organizationId still exists.
   * Called on frontend startup to detect stale sessions after a DB reseed.
   */
  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const org = await prisma.organization.findUnique({ where: { id: req.organizationId } });
      if (!org) {
        res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'Organization no longer exists — please log in again' });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: req.currentUser!.id } });
      if (!user) {
        res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'User no longer exists — please log in again' });
        return;
      }
      res.status(200).json({ status: 'success', data: { id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId } });
    } catch (err) {
      next(err);
    }
  };
}
