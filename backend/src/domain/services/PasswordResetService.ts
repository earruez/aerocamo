// ─────────────────────────────────────────────────────────────────────────────
//  PasswordResetService — tokens de un solo uso para activar cuenta / resetear
//  contraseña. Un mismo par de campos en User sirve para ambos flujos: si
//  emailConfirmedAt seguía en null cuando se consume el token, es "activar
//  cuenta"; si ya estaba confirmada, es "olvidé mi contraseña".
//
//  Se guarda sha256(token) en la base, nunca el token crudo — mismo principio
//  que passwordHash: una filtración de la base no debe dejar links utilizables.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { prisma } from '../../infrastructure/database/prisma.client';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export class PasswordResetService {
  static async issueToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetTokenHash: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    return token;
  }

  static async verifyToken(rawToken: string) {
    const user = await prisma.user.findFirst({
      where: {
        passwordResetTokenHash: hashToken(rawToken),
        passwordResetExpiresAt: { gt: new Date() },
      },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        emailConfirmedAt: true, organizationId: true,
      },
    });
    return user;
  }
}
