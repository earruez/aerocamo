import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, MessageCircle, Printer, X } from 'lucide-react';
import { catalogsApi } from '@api/catalogs.api';

export interface DispatchSelection {
  repairShopId: string | null;
  repairShopContactId: string | null;
  dispatchMethod: 'EMAIL' | 'MANUAL';
  dispatchNotes: string | null;
  notifyWhatsApp: boolean;
}

/**
 * Elegir a quién va la ST. El envío por correo necesita un contacto con
 * dirección; el manual cubre al taller que recibe el PDF impreso en mano.
 */
export function SendWorkRequestDialog({
  folio, itemsCount, isSending, onClose, onConfirm, onDownloadPdf,
}: {
  folio: string;
  itemsCount: number;
  isSending: boolean;
  onClose: () => void;
  onConfirm: (selection: DispatchSelection) => void;
  onDownloadPdf: () => void;
}) {
  const [shopId, setShopId] = useState('');
  const [contactId, setContactId] = useState('');
  const [method, setMethod] = useState<'EMAIL' | 'MANUAL'>('EMAIL');
  const [notes, setNotes] = useState('');
  const [notifyWhatsApp, setNotifyWhatsApp] = useState(false);

  const { data: shops = [] } = useQuery({
    queryKey: ['catalog-shops'],
    queryFn: catalogsApi.listShops,
  });

  const { data: contacts = [], isFetching: loadingContacts } = useQuery({
    queryKey: ['shop-contacts', shopId],
    queryFn: () => catalogsApi.listContacts(shopId),
    enabled: !!shopId,
  });

  const activeShops = useMemo(() => shops.filter((s) => s.isActive), [shops]);
  const contact = contacts.find((c) => c.id === contactId) ?? null;

  // Al cambiar de taller, la persona elegida deja de ser válida.
  useEffect(() => { setContactId(''); }, [shopId]);

  // Un contacto sin correo solo puede recibirla en mano.
  useEffect(() => {
    if (contact && !contact.email) setMethod('MANUAL');
  }, [contact]);

  // El aviso por WhatsApp depende del teléfono, no de la vía de envío.
  useEffect(() => { setNotifyWhatsApp(Boolean(contact?.phone)); }, [contact]);

  const emailBlocked = method === 'EMAIL' && !contact?.email;
  const canSend = !!shopId && !!contactId && !emailBlocked && !isSending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Enviar {folio}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{itemsCount} ítem{itemsCount !== 1 ? 's' : ''} incluidos</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X size={15} className="text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Taller <span className="text-rose-500">*</span>
            </label>
            <select value={shopId} onChange={(e) => setShopId(e.target.value)} className="input" autoFocus>
              <option value="">Selecciona el taller</option>
              {activeShops.map((s) => (
                <option key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ''}{s.name}</option>
              ))}
            </select>
            {activeShops.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-700">
                No hay talleres cargados. Agrégalos en Configuración.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Persona <span className="text-rose-500">*</span>
            </label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="input"
              disabled={!shopId || loadingContacts}
            >
              <option value="">{loadingContacts ? 'Cargando…' : 'Selecciona a quién se envía'}</option>
              {contacts.filter((c) => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.role ? ` — ${c.role}` : ''}{c.email ? '' : ' (sin correo)'}
                </option>
              ))}
            </select>
            {shopId && !loadingContacts && contacts.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-700">
                Este taller no tiene contactos. Agrégalos en Configuración → Talleres.
              </p>
            )}
            {contact?.email && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-slate-600">
                <Mail size={12} /> {contact.email}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1.5">Cómo se envía</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod('EMAIL')}
                disabled={!contact?.email}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  method === 'EMAIL' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'
                } ${!contact?.email ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Mail size={13} /> Por correo
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">Se adjunta el PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setMethod('MANUAL')}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  method === 'MANUAL' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Printer size={13} /> En mano
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">Imprimes y entregas</span>
              </button>
            </div>
            {method === 'MANUAL' && (
              <button
                type="button"
                onClick={onDownloadPdf}
                className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
              >
                Descargar el PDF para imprimir
              </button>
            )}
            {contact && !contact.email && (
              <p className="mt-1.5 text-[11px] text-amber-700">
                {contact.name} no tiene correo registrado, así que solo puede recibirla en mano.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 px-3 py-2.5">
            <label className={`flex items-start gap-2 ${contact?.phone ? '' : 'opacity-55'}`}>
              <input
                type="checkbox"
                checked={notifyWhatsApp}
                disabled={!contact?.phone}
                onChange={(e) => setNotifyWhatsApp(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <MessageCircle size={13} /> Avisar por WhatsApp
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  {contact?.phone
                    ? `Se envía a ${contact.phone} con la ST adjunta.`
                    : 'El contacto no tiene teléfono registrado.'}
                </span>
              </span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nota del envío</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="input text-sm"
              placeholder="Ej: entregada en recepción a las 10:00; coordinar ingreso el lunes…"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3.5">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => onConfirm({
              repairShopId: shopId || null,
              repairShopContactId: contactId || null,
              dispatchMethod: method,
              dispatchNotes: notes.trim() || null,
              notifyWhatsApp: notifyWhatsApp && Boolean(contact?.phone),
            })}
            className="btn-primary"
            disabled={!canSend}
          >
            {isSending ? 'Enviando…' : method === 'EMAIL' ? 'Enviar por correo' : 'Marcar como entregada'}
          </button>
        </div>
      </div>
    </div>
  );
}
