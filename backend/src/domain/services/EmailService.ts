import nodemailer from 'nodemailer';
import { env } from '../../config/env';

/**
 * EmailService
 * Maneja envío de notificaciones por correo para OT
 */
export class EmailService {
  private static transporter: nodemailer.Transporter;

  /**
   * Inicializar transporte SMTP
   */
  static initialize() {
    if (env.email.provider === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: env.email.smtpHost,
        port: env.email.smtpPort,
        secure: env.email.smtpSecure,
        auth: {
          user: env.email.smtpUser,
          pass: env.email.smtpPass,
        },
      });
    } else if (env.email.provider === 'sendgrid') {
      // Usar plugin de Sendgrid si está disponible
      this.transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: env.email.sendgridApiKey,
        },
      });
    }
  }

  /**
   * Enviar notificación de asignación de OT a técnico
   */
  static async sendWorkOrderAssignmentNotification(
    technicianEmail: string,
    technicianName: string,
    workOrderNumber: string,
    aircraftRegistration: string,
    aircraftModel: string,
    plannedDate: Date,
    pdfAttachmentPath?: string
  ): Promise<void> {
    if (!this.transporter) {
      this.initialize();
    }

    const subject = `Nueva Orden de Trabajo Asignada: ${workOrderNumber}`;

    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Hola ${technicianName},</h2>
          
          <p>Se te ha asignado una nueva orden de trabajo.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Detalles de la Orden de Trabajo</h3>
            <p><strong>Número OT:</strong> ${workOrderNumber}</p>
            <p><strong>Aeronave:</strong> ${aircraftRegistration} (${aircraftModel})</p>
            <p><strong>Fecha Programada:</strong> ${plannedDate.toLocaleDateString()}</p>
          </div>
          
          <p>Por favor, accede a la plataforma para revisar los detalles completos de las tareas asignadas.</p>
          
          <p>Si tienes preguntas, contacta a tu supervisor.</p>
          
          <p>Saludos,<br/>Sistema de Gestión de Mantenimiento</p>
        </body>
      </html>
    `;

    const mailOptions: nodemailer.SendMailOptions = {
      from: env.email.fromAddress,
      to: technicianEmail,
      subject,
      html: htmlContent,
      attachments: pdfAttachmentPath
        ? [
            {
              filename: `OT-${workOrderNumber}.pdf`,
              path: pdfAttachmentPath,
            },
          ]
        : undefined,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending work order assignment email:', error);
      // No lanzar error: el sistema debe continuar aunque falle el email
    }
  }

  /**
   * Enviar notificación de requerimiento de evidencia
   */
  static async sendEvidenceRequiredNotification(
    technicianEmail: string,
    technicianName: string,
    workOrderNumber: string,
    aircraftRegistration: string
  ): Promise<void> {
    if (!this.transporter) {
      this.initialize();
    }

    const subject = `Requerida Evidencia Fotográfica: ${workOrderNumber}`;

    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Hola ${technicianName},</h2>
          
          <p>Tu supervisor requiere que cargues evidencia fotográfica para completar la orden de trabajo.</p>
          
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Orden de Trabajo:</strong> ${workOrderNumber}</p>
            <p><strong>Aeronave:</strong> ${aircraftRegistration}</p>
            <p><strong>Requerimiento:</strong> Carga al menos una foto del trabajo completado.</p>
          </div>
          
          <p>Accede a la plataforma para cargar la evidencia.</p>
          
          <p>Saludos,<br/>Sistema de Gestión de Mantenimiento</p>
        </body>
      </html>
    `;

    const mailOptions: nodemailer.SendMailOptions = {
      from: env.email.fromAddress,
      to: technicianEmail,
      subject,
      html: htmlContent,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending evidence notification email:', error);
    }
  }

  /**
   * Enviar notificación de cierre de OT a supervisor
   */
  static async sendWorkOrderClosedNotification(
    supervisorEmail: string,
    supervisorName: string,
    workOrderNumber: string,
    aircraftRegistration: string,
    technicianName: string
  ): Promise<void> {
    if (!this.transporter) {
      this.initialize();
    }

    const subject = `Orden de Trabajo Completada: ${workOrderNumber}`;

    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Hola ${supervisorName},</h2>
          
          <p>Una orden de trabajo ha sido completada y cerrada.</p>
          
          <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Número OT:</strong> ${workOrderNumber}</p>
            <p><strong>Aeronave:</strong> ${aircraftRegistration}</p>
            <p><strong>Técnico:</strong> ${technicianName}</p>
            <p><strong>Estado:</strong> Completada y cerrada</p>
          </div>
          
          <p>Los registros de cumplimiento se han actualizado automáticamente.</p>
          
          <p>Saludos,<br/>Sistema de Gestión de Mantenimiento</p>
        </body>
      </html>
    `;

    const mailOptions: nodemailer.SendMailOptions = {
      from: env.email.fromAddress,
      to: supervisorEmail,
      subject,
      html: htmlContent,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending work order closed email:', error);
    }
  }

  /**
   * Enviar alerta a supervisores de OT pendientes de asignación
   */
  static async sendPendingAssignmentAlert(
    supervisorEmail: string,
    supervisorName: string,
    pendingCount: number
  ): Promise<void> {
    if (!this.transporter) {
      this.initialize();
    }

    const subject = `Alerta: ${pendingCount} Orden(es) de Trabajo Pendiente(s) de Asignación`;

    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Hola ${supervisorName},</h2>
          
          <p>Tienes ${pendingCount} orden(s) de trabajo que requieren asignación de técnico.</p>
          
          <div style="background-color: #ffe0e0; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Acción Requerida:</strong> Asignar técnico(s) a las órdenes pendientes.</p>
          </div>
          
          <p>Accede a la plataforma para completar las asignaciones.</p>
          
          <p>Saludos,<br/>Sistema de Gestión de Mantenimiento</p>
        </body>
      </html>
    `;

    const mailOptions: nodemailer.SendMailOptions = {
      from: env.email.fromAddress,
      to: supervisorEmail,
      subject,
      html: htmlContent,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending pending assignment alert email:', error);
    }
  }

  static async sendWorkRequestNotification(input: {
    to: string;
    responsibleName: string;
    organizationName: string;
    workRequestNumber: string;
    aircraftRegistration: string;
    aircraftModel: string;
    itemCount: number;
    dispatchNotes?: string | null;
    createdAt: Date;
    pdfAttachmentPath: string;
  }): Promise<void> {
    if (!this.transporter) {
      this.initialize();
    }

    const subject = `${input.organizationName} · Nueva Solicitud de Trabajo ${input.workRequestNumber} — ${input.aircraftRegistration}`;
    const esc = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const formattedDate = input.createdAt.toLocaleDateString('es-CL', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    const notesBlock = input.dispatchNotes
      ? `
          <tr>
            <td style="padding: 0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
                <tr>
                  <td style="padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #92400e; font-family: Arial, Helvetica, sans-serif;">
                    <strong>Notas del envío:</strong> ${esc(input.dispatchNotes)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
        <body style="margin: 0; padding: 0; background-color: #f1f5f9;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #1d4ed8; background-image: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 28px 32px;">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width: 40px; height: 40px; background-color: #ffffff; border-radius: 10px; text-align: center; vertical-align: middle; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: bold; color: #1d4ed8;">
                            A
                          </td>
                          <td style="padding-left: 12px; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: bold; color: #ffffff; letter-spacing: 0.5px;">
                            AEROCAMO
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding: 32px 32px 8px; font-family: Arial, Helvetica, sans-serif;">
                      <p style="margin: 0 0 4px; font-size: 13px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: #2563eb;">
                        Nueva Solicitud de Trabajo
                      </p>
                      <h1 style="margin: 0 0 16px; font-size: 21px; line-height: 1.4; color: #0f172a;">
                        ${esc(input.aircraftRegistration)} — ${esc(input.aircraftModel)}
                      </h1>
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
                        Hola ${esc(input.responsibleName)}, <strong>${esc(input.organizationName)}</strong> ha generado una nueva solicitud de trabajo para la aeronave <strong>${esc(input.aircraftRegistration)}</strong>. Encontrarás el detalle completo de las tareas en el PDF adjunto a este correo.
                      </p>
                    </td>
                  </tr>

                  <!-- Info card -->
                  <tr>
                    <td style="padding: 0 32px 24px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <tr>
                          <td style="padding: 16px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748b; width: 40%;">Solicitud</td>
                          <td style="padding: 16px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; font-weight: bold; text-align: right;">${esc(input.workRequestNumber)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 0 20px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748b;">Aeronave</td>
                          <td style="padding: 0 20px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; font-weight: bold; text-align: right;">${esc(input.aircraftRegistration)} (${esc(input.aircraftModel)})</td>
                        </tr>
                        <tr>
                          <td style="padding: 0 20px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748b;">Ítems incluidos</td>
                          <td style="padding: 0 20px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; font-weight: bold; text-align: right;">${input.itemCount}</td>
                        </tr>
                        <tr>
                          <td style="padding: 0 20px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748b;">Fecha de envío</td>
                          <td style="padding: 0 20px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; font-weight: bold; text-align: right;">${formattedDate}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
${notesBlock}
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-family: Arial, Helvetica, sans-serif;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                        Este correo fue generado automáticamente por Aerocamo a nombre de ${esc(input.organizationName)}. Por favor no respondas a esta dirección.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    await this.transporter.sendMail({
      from: env.email.fromAddress,
      to: input.to,
      subject,
      html: htmlContent,
      attachments: [
        {
          filename: `${input.workRequestNumber}.pdf`,
          path: input.pdfAttachmentPath,
        },
      ],
    });
  }

  /**
   * Probar conexión SMTP
   */
  static async testConnection(): Promise<boolean> {
    if (!this.transporter) {
      this.initialize();
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Email service connection failed:', error);
      return false;
    }
  }
}
