import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../database/prisma.client';
import { ValidationError } from '../../../shared/errors/AppError';
import { bufferToDataUri, isAllowedImageMimeType } from '../../../shared/dataUri';

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — de sobra para un logo, liviano para incrustar en cada PDF.

export class OrganizationController {
  /** Datos públicos de la organización del usuario autenticado (nombre, razón social, logo). */
  static async getCurrent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: req.organizationId },
        select: { id: true, name: true, legalName: true, logoDataUri: true },
      });
      res.json({ status: 'success', data: organization });
    } catch (err) { next(err); }
  }

  static async uploadLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) throw new ValidationError('No se recibió ningún archivo.');
      if (!isAllowedImageMimeType(req.file.mimetype)) {
        throw new ValidationError('El logo debe ser una imagen PNG o JPG.');
      }
      if (req.file.size > MAX_LOGO_SIZE_BYTES) {
        throw new ValidationError('El logo no puede superar los 2MB.');
      }

      const logoDataUri = bufferToDataUri(req.file.buffer, req.file.mimetype);
      const organization = await prisma.organization.update({
        where: { id: req.organizationId },
        data: { logoDataUri },
        select: { id: true, name: true, legalName: true, logoDataUri: true },
      });

      res.json({ status: 'success', message: 'Logo actualizado', data: organization });
    } catch (err) { next(err); }
  }

  static async removeLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organization = await prisma.organization.update({
        where: { id: req.organizationId },
        data: { logoDataUri: null },
        select: { id: true, name: true, legalName: true, logoDataUri: true },
      });
      res.json({ status: 'success', message: 'Logo eliminado', data: organization });
    } catch (err) { next(err); }
  }
}
