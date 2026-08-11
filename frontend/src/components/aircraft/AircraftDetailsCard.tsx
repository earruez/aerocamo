import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { aircraftApi, type Aircraft } from '@api/aircraft.api';

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { timeZone: 'UTC' }) : '—';

const toInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

/** Faltan menos de 90 días: el certificado hay que renovarlo con antelación. */
const expiryTone = (iso: string | null): string => {
  if (!iso) return 'text-slate-900';
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'text-rose-700';
  if (days <= 90) return 'text-amber-700';
  return 'text-slate-900';
};

export function AircraftDetailsCard({ aircraft, canEdit }: { aircraft: Aircraft; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    owner: aircraft.owner ?? '',
    yearManufactured: aircraft.yearManufactured ? String(aircraft.yearManufactured) : '',
    coaExpiryDate: toInput(aircraft.coaExpiryDate),
  });

  const save = useMutation({
    mutationFn: () => aircraftApi.update(aircraft.id, {
      owner: form.owner.trim() || null,
      yearManufactured: form.yearManufactured ? Number(form.yearManufactured) : null,
      coaExpiryDate: form.coaExpiryDate || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aircraft'] });
      setEditing(false);
      toast.success('Datos actualizados');
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudieron guardar los datos');
    },
  });

  const daysToExpiry = aircraft.coaExpiryDate
    ? Math.ceil((new Date(aircraft.coaExpiryDate).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
            <FileText size={14} className="text-slate-600" />
          </div>
          <p className="text-sm font-bold text-slate-900">Datos de la aeronave</p>
        </div>
        {canEdit && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
          >
            <Pencil size={12} /> Editar
          </button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Propietario</label>
              <input
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                className="input text-sm"
                placeholder="Ej: PUBLI G"
                maxLength={180}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Año de fabricación</label>
              <input
                value={form.yearManufactured}
                onChange={(e) => setForm({ ...form, yearManufactured: e.target.value })}
                className="input text-sm"
                placeholder="2017"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Vencimiento del CdN</label>
              <input
                type="date"
                value={form.coaExpiryDate}
                onChange={(e) => setForm({ ...form, coaExpiryDate: e.target.value })}
                className="input text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setForm({
                  owner: aircraft.owner ?? '',
                  yearManufactured: aircraft.yearManufactured ? String(aircraft.yearManufactured) : '',
                  coaExpiryDate: toInput(aircraft.coaExpiryDate),
                });
              }}
              className="btn-secondary btn-sm"
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary btn-sm" disabled={save.isPending}>
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Propietario</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{aircraft.owner || '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Año de fabricación</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{aircraft.yearManufactured ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Vencimiento del CdN</p>
            <p className={`text-sm font-semibold mt-0.5 ${expiryTone(aircraft.coaExpiryDate)}`}>
              {fmtDate(aircraft.coaExpiryDate)}
            </p>
            {daysToExpiry != null && daysToExpiry <= 90 && (
              <p className="text-[10px] text-amber-700 mt-0.5">
                {daysToExpiry < 0 ? `Vencido hace ${Math.abs(daysToExpiry)} días` : `Vence en ${daysToExpiry} días`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
