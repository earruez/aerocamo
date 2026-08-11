// ─────────────────────────────────────────────────────────────────────────────
//  WhatsAppService — Aviso por WhatsApp Business (Meta Cloud API)
//
//  WhatsApp no permite mensajes libres iniciados por la empresa: un aviso que
//  nace de la plataforma debe usar una plantilla aprobada por Meta. El PDF viaja
//  en el encabezado de esa plantilla, y para eso primero se sube al endpoint de
//  medios y se manda por su media_id — así no hace falta publicar el documento
//  en una URL accesible desde internet.
//
//  Plantilla esperada (nombre configurable, por defecto "nueva_solicitud_trabajo"):
//    Encabezado: DOCUMENT
//    Cuerpo: "Se ha generado una nueva Solicitud de Trabajo {{1}} para la
//             aeronave {{2}}, matrícula {{3}}. Enviada por {{4}}."
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '../../config/env';
import { logger } from '../../config/logger';

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super(
      'WhatsApp no está configurado en el servidor (faltan WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN).',
    );
    this.name = 'WhatsAppNotConfiguredError';
  }
}

export class WhatsAppService {
  static isConfigured(): boolean {
    return Boolean(env.whatsapp.phoneNumberId && env.whatsapp.accessToken);
  }

  /**
   * Meta espera solo dígitos con código de país: "+56 9 1234 5678" → "56912345678".
   * A los números guardados sin código se les antepone el del país configurado.
   */
  static normalizePhone(raw: string): string | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    if (digits.length < 8) return null;

    const cc = env.whatsapp.defaultCountryCode.replace(/\D/g, '');
    if (raw.trim().startsWith('+') || digits.startsWith(cc)) return digits;
    return `${cc}${digits}`;
  }

  private static baseUrl(): string {
    const host = env.whatsapp.apiBaseUrl ?? 'https://graph.facebook.com';
    return `${host}/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}`;
  }

  private static async call(path: string, init: RequestInit): Promise<any> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.whatsapp.accessToken}`, ...(init.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok) {
      // Meta devuelve el detalle en error.message; sin él, el código HTTP.
      const detail = body?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return body;
  }

  /** Sube el PDF y devuelve el media_id con el que se adjunta a la plantilla. */
  static async uploadPdf(pdf: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);

    const body = await this.call('/media', { method: 'POST', body: form });
    if (!body?.id) throw new Error('Meta no devolvió el identificador del documento');
    return body.id as string;
  }

  /**
   * Avisa de una ST enviada, con el PDF adjunto.
   * Devuelve el número normalizado al que se envió.
   */
  static async notifyWorkRequestSent(input: {
    phone: string;
    contactName: string;
    workRequestNumber: string;
    aircraftModel: string;
    aircraftRegistration: string;
    senderName: string;
    pdf: Buffer;
  }): Promise<string> {
    if (!this.isConfigured()) throw new WhatsAppNotConfiguredError();

    const to = this.normalizePhone(input.phone);
    if (!to) throw new Error(`El teléfono "${input.phone}" no es un número válido`);

    const filename = `${input.workRequestNumber}.pdf`;
    const mediaId = await this.uploadPdf(input.pdf, filename);

    await this.call('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: env.whatsapp.templateName,
          language: { code: env.whatsapp.templateLang },
          components: [
            {
              type: 'header',
              parameters: [{ type: 'document', document: { id: mediaId, filename } }],
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: input.workRequestNumber },
                { type: 'text', text: input.aircraftModel },
                { type: 'text', text: input.aircraftRegistration },
                { type: 'text', text: input.senderName },
              ],
            },
          ],
        },
      }),
    });

    logger.info({ to, workRequest: input.workRequestNumber }, 'WhatsApp notification sent');
    return to;
  }
}
