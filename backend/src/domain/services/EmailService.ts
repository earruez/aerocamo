import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import { env } from '../../config/env';

interface MailAttachment {
  filename: string;
  path: string;
}

interface MailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

/**
 * EmailService
 * Maneja envío de notificaciones por correo para OT
 */
export class EmailService {
  private static transporter: nodemailer.Transporter;

  /**
   * Inicializar transporte SMTP (solo se usa cuando EMAIL_PROVIDER=smtp).
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
    }
  }

  /**
   * Punto único de envío: con SendGrid usa su API HTTPS (puerto 443) en vez
   * de SMTP (puerto 587) — varios hosts (Render incluido) bloquean SMTP
   * saliente en sus planes gratis, y ahí una llamada por SMTP se queda
   * colgada indefinidamente en vez de fallar con un error claro.
   */
  private static async dispatch(input: MailInput): Promise<void> {
    if (env.email.provider === 'sendgrid') {
      await this.sendViaSendGridApi(input);
      return;
    }

    if (!this.transporter) {
      this.initialize();
    }
    await this.transporter.sendMail({
      from: env.email.fromAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments,
    });
  }

  private static async sendViaSendGridApi(input: MailInput): Promise<void> {
    const attachments = input.attachments
      ? await Promise.all(
          input.attachments.map(async (a) => ({
            content: (await readFile(a.path)).toString('base64'),
            filename: a.filename,
            type: 'application/pdf',
            disposition: 'attachment',
          })),
        )
      : undefined;

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.email.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: env.email.fromAddress },
        subject: input.subject,
        content: [{ type: 'text/html', value: input.html }],
        ...(attachments ? { attachments } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SendGrid API error ${res.status}: ${body}`);
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

    try {
      await this.dispatch({
        to: technicianEmail,
        subject,
        html: htmlContent,
        attachments: pdfAttachmentPath
          ? [{ filename: `OT-${workOrderNumber}.pdf`, path: pdfAttachmentPath }]
          : undefined,
      });
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

    try {
      await this.dispatch({ to: technicianEmail, subject, html: htmlContent });
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

    try {
      await this.dispatch({ to: supervisorEmail, subject, html: htmlContent });
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

    try {
      await this.dispatch({ to: supervisorEmail, subject, html: htmlContent });
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

    await this.dispatch({
      to: input.to,
      subject,
      html: htmlContent,
      attachments: [{ filename: `${input.workRequestNumber}.pdf`, path: input.pdfAttachmentPath }],
    });
  }

  private static escHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Shell visual de marca compartido (header degradado + card + footer),
   * la misma identidad que ya usa sendWorkRequestNotification. Los llamadores
   * pasan el contenido del cuerpo ya escapado.
   */
  private static renderBrandedEmail(params: {
    eyebrow: string;
    title: string;
    bodyHtml: string;
    ctaLabel?: string;
    ctaUrl?: string;
  }): string {
    const ctaBlock = params.ctaUrl && params.ctaLabel
      ? `
                  <tr>
                    <td style="padding: 0 32px 12px;">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="border-radius: 8px; background-color: #1d4ed8;">
                            <a href="${params.ctaUrl}" style="display: inline-block; padding: 12px 28px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px;">${this.escHtml(params.ctaLabel)}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 32px 24px; font-family: Arial, Helvetica, sans-serif;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                        Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
                        <a href="${params.ctaUrl}" style="color: #2563eb; word-break: break-all;">${params.ctaUrl}</a>
                      </p>
                    </td>
                  </tr>`
      : '';

    return `
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
                        ${this.escHtml(params.eyebrow)}
                      </p>
                      <h1 style="margin: 0 0 16px; font-size: 21px; line-height: 1.4; color: #0f172a;">
                        ${this.escHtml(params.title)}
                      </h1>
                      ${params.bodyHtml}
                    </td>
                  </tr>
${ctaBlock}
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-family: Arial, Helvetica, sans-serif;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                        Este correo fue generado automáticamente por Aerocamo. Por favor no respondas a esta dirección.
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
  }

  /**
   * Correo de bienvenida al crear una cuenta nueva: confirma la creación y
   * ofrece definir una contraseña propia en vez de la que dejó el SUPER_ADMIN.
   * Devuelve si el envío tuvo éxito — a diferencia de las notificaciones de OT,
   * el caller necesita saberlo para avisar si hay que comunicar la clave a mano.
   */
  static async sendWelcomeEmail(input: {
    to: string;
    name: string;
    organizationName: string;
    roleLabel: string;
    setPasswordUrl: string;
  }): Promise<boolean> {
    const bodyHtml = `
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
                        Hola ${this.escHtml(input.name)}, se creó tu cuenta en <strong>${this.escHtml(input.organizationName)}</strong> con el rol <strong>${this.escHtml(input.roleLabel)}</strong>. Ya puedes ingresar con la contraseña que te indicaron, o definir la tuya propia con el botón de abajo (el enlace vence en 24 horas).
                      </p>`;

    const html = this.renderBrandedEmail({
      eyebrow: 'Cuenta creada',
      title: `¡Bienvenido, ${input.name}!`,
      bodyHtml,
      ctaLabel: 'Confirmar cuenta y crear mi contraseña',
      ctaUrl: input.setPasswordUrl,
    });

    try {
      await this.dispatch({ to: input.to, subject: `Bienvenido a Aerocamo — tu cuenta en ${input.organizationName}`, html });
      return true;
    } catch (error) {
      console.error('Error sending welcome email:', error);
      return false;
    }
  }

  /**
   * Correo de "olvidé mi contraseña". El endpoint que lo dispara responde
   * siempre igual exista o no el usuario, así que este método solo se llama
   * cuando sí existe — no hay lógica anti-enumeración aquí adentro.
   */
  static async sendPasswordResetEmail(input: { to: string; name: string; resetUrl: string }): Promise<boolean> {
    const bodyHtml = `
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
                        Hola ${this.escHtml(input.name)}, recibimos una solicitud para restablecer tu contraseña de Aerocamo. Usa el botón de abajo para elegir una nueva (el enlace vence en 24 horas). Si no fuiste tú, puedes ignorar este correo — tu contraseña actual sigue funcionando.
                      </p>`;

    const html = this.renderBrandedEmail({
      eyebrow: 'Restablecer contraseña',
      title: 'Solicitud de restablecimiento',
      bodyHtml,
      ctaLabel: 'Restablecer mi contraseña',
      ctaUrl: input.resetUrl,
    });

    try {
      await this.dispatch({ to: input.to, subject: 'Restablece tu contraseña — Aerocamo', html });
      return true;
    } catch (error) {
      console.error('Error sending password reset email:', error);
      return false;
    }
  }

  /**
   * Confirmación de que la contraseña cambió — sin link, funciona como señal
   * de seguridad: si el usuario no lo hizo, sabe que algo pasó con su cuenta.
   */
  static async sendPasswordChangedConfirmation(input: { to: string; name: string }): Promise<boolean> {
    const bodyHtml = `
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
                        Hola ${this.escHtml(input.name)}, tu contraseña de Aerocamo se actualizó correctamente. Si no fuiste tú quien hizo este cambio, contacta a tu administrador de inmediato.
                      </p>`;

    const html = this.renderBrandedEmail({
      eyebrow: 'Contraseña actualizada',
      title: 'Listo, tu contraseña cambió',
      bodyHtml,
    });

    try {
      await this.dispatch({ to: input.to, subject: 'Tu contraseña fue actualizada — Aerocamo', html });
      return true;
    } catch (error) {
      console.error('Error sending password changed confirmation email:', error);
      return false;
    }
  }

  /**
   * Probar conexión de correo saliente
   */
  static async testConnection(): Promise<boolean> {
    if (env.email.provider === 'sendgrid') {
      // La API HTTPS no mantiene una conexión persistente que verificar;
      // basta con confirmar que hay una API key configurada.
      return Boolean(env.email.sendgridApiKey);
    }

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
