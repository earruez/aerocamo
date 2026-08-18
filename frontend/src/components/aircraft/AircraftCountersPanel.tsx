import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { aircraftApi, type AircraftEngine } from '@api/aircraft.api';
import { catalogsApi } from '@api/catalogs.api';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Los contadores gobiernan los vencimientos del plan: si no avanzan, nada vence.
 * Cada uno se lee contra su equipo — la célula o un motor concreto — porque no
 * son intercambiables.
 */
export function AircraftCountersPanel({
  aircraftId, engines, canEdit,
}: {
  aircraftId: string;
  engines: AircraftEngine[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ counterTypeId: '', engineId: '', value: '', readingDate: today(), notes: '', folio: '' });

  const { data: types = [] } = useQuery({
    queryKey: ['catalog-counter-types'],
    queryFn: catalogsApi.listCounterTypes,
  });

  const { data: readings = [], isLoading } = useQuery({
    queryKey: ['aircraft-counter-readings', aircraftId],
    queryFn: () => aircraftApi.listCounterReadings(aircraftId),
  });

  /** Última lectura de cada contador por equipo, que es lo que usa el plan. */
  const current = useMemo(() => {
    const map = new Map<string, { value: string; date: string; unit: string; code: string; name: string; engine: string | null }>();
    for (const r of readings) {
      const key = `${r.counterType.id}|${r.engine?.id ?? 'aircraft'}`;
      if (map.has(key)) continue; // la consulta ya viene de la más reciente a la más antigua
      map.set(key, {
        value: r.value,
        date: r.readingDate.slice(0, 10),
        unit: r.counterType.unit,
        code: r.counterType.code,
        name: r.counterType.name,
        engine: r.engine ? `Motor ${r.engine.position}` : null,
      });
    }
    return [...map.values()];
  }, [readings]);

  const selectedType = types.find((t) => t.id === form.counterTypeId) ?? null;
  const needsEngine = selectedType?.scope === 'ENGINE';
  const engineAllowed = selectedType?.scope !== 'AIRCRAFT';

  const save = useMutation({
    mutationFn: () => aircraftApi.createCounterReading(aircraftId, {
      counterTypeId: form.counterTypeId,
      engineId: form.engineId || null,
      value: Number(form.value),
      readingDate: form.readingDate,
      notes: form.notes.trim() || null,
      folio: form.folio.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aircraft-counter-readings', aircraftId] });
      qc.invalidateQueries({ queryKey: ['aircraft'] });
      qc.invalidateQueries({ queryKey: ['maintenance-plan'] });
      setAdding(false);
      setForm({ counterTypeId: '', engineId: '', value: '', readingDate: today(), notes: '', folio: '' });
      toast.success('Lectura registrada');
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo registrar la lectura');
    },
  });

  const canSave = form.counterTypeId && form.value !== '' && Number.isFinite(Number(form.value))
    && (!needsEngine || form.engineId);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-start gap-2.5">
          <Gauge size={16} className="text-brand-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Contadores</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mueven los vencimientos del plan. Si no avanzan, nada vence.
            </p>
          </div>
        </div>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="btn-secondary btn-sm flex items-center gap-1 shrink-0">
            <Plus size={13} /> Registrar lectura
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}
          className="border-b border-slate-100 bg-slate-50 px-5 py-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <select
              value={form.counterTypeId}
              onChange={(e) => setForm({ ...form, counterTypeId: e.target.value, engineId: '' })}
              className="input text-sm"
              autoFocus
            >
              <option value="">Contador</option>
              {types.filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </select>

            <select
              value={form.engineId}
              onChange={(e) => setForm({ ...form, engineId: e.target.value })}
              className="input text-sm"
              disabled={!engineAllowed || engines.length === 0}
            >
              <option value="">{needsEngine ? 'Elige el motor' : 'Aeronave'}</option>
              {engines.map((en) => (
                <option key={en.id} value={en.id}>Motor {en.position} — {en.serialNumber}</option>
              ))}
            </select>

            <input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              className="input text-sm"
              placeholder={selectedType ? `Lectura en ${selectedType.unit}` : 'Lectura'}
              inputMode="decimal"
            />
            <input
              type="date"
              value={form.readingDate}
              onChange={(e) => setForm({ ...form, readingDate: e.target.value })}
              className="input text-sm"
            />
            <input
              value={form.folio}
              onChange={(e) => setForm({ ...form, folio: e.target.value })}
              className="input text-sm"
              placeholder="Folio bitácora"
            />
          </div>

          {selectedType?.legacyField && (
            <p className="text-[11px] text-slate-500">
              {selectedType.code} también actualiza el contador que ya usaba el plan, para que no haya dos cifras distintas.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="btn-secondary btn-sm">Cancelar</button>
            <button type="submit" className="btn-primary btn-sm" disabled={save.isPending || !canSave}>
              {save.isPending ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </form>
      )}

      <div className="px-5 py-4">
        {isLoading ? (
          <p className="text-xs text-slate-400">Cargando…</p>
        ) : current.length === 0 ? (
          <p className="text-xs text-slate-400">
            Sin lecturas registradas. Los contadores configurados aparecen en Configuración.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {current.map((c) => (
              <div key={`${c.code}-${c.engine ?? 'ac'}`} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {c.code}{c.engine ? ` · ${c.engine}` : ''}
                </p>
                <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight">
                  {Number(c.value).toLocaleString('es-CL')}
                </p>
                <p className="text-[10px] text-slate-500">{c.unit} · {c.date}</p>
              </div>
            ))}
          </div>
        )}

        {readings.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-slate-800">
              Ver historial de lecturas ({readings.length})
            </summary>
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
              {readings.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2 rounded border border-slate-100 px-2.5 py-1 text-xs">
                  <span className="text-slate-700">
                    <b>{r.counterType.code}</b>
                    {r.engine ? ` · Motor ${r.engine.position}` : ''}
                    {' '}<span className="tabular-nums">{Number(r.value).toLocaleString('es-CL')}</span>
                    <span className="text-slate-400"> {r.counterType.unit}</span>
                    {r.folio && <span className="text-slate-400"> · Folio {r.folio}</span>}
                  </span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {r.readingDate.slice(0, 10)}{r.recordedBy ? ` · ${r.recordedBy.name}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
