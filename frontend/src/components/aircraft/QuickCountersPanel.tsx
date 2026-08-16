import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Plane } from 'lucide-react';
import toast from 'react-hot-toast';
import { aircraftApi, type Aircraft } from '@api/aircraft.api';
import { catalogsApi, type CounterType } from '@api/catalogs.api';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * En el Access los contadores se leen en dos bloques —aeronave y motor— y ese
 * corte es el que hace rápida una tarea que se repite a diario. La etiqueta de
 * horas se muestra como HRS en ambos: el bloque ya dice de qué equipo se trata,
 * igual que en la pantalla de origen.
 */
const displayCode = (t: CounterType): string =>
  (t.unit === 'horas' && t.legacyField != null ? 'HRS' : t.code);

type Draft = Record<string, string>;

/**
 * Vive fija arriba de /aircraft (no como modal): registrar contadores es una
 * tarea diaria y taparla detrás de un botón + overlay solo agrega fricción.
 */
export function QuickCountersPanel({ aircraft }: { aircraft: Aircraft[] }) {
  const qc = useQueryClient();
  const [aircraftId, setAircraftId] = useState(aircraft[0]?.id ?? '');
  const [readingDate, setReadingDate] = useState(today());
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Si la lista de aeronaves carga después del primer render, o cambia,
  // aseguramos que siempre haya una seleccionada.
  useEffect(() => {
    if (!aircraftId && aircraft.length > 0) setAircraftId(aircraft[0].id);
  }, [aircraft, aircraftId]);

  const { data: types = [] } = useQuery({
    queryKey: ['catalog-counter-types'],
    queryFn: catalogsApi.listCounterTypes,
  });

  const { data: engines = [] } = useQuery({
    queryKey: ['aircraft-engines', aircraftId],
    queryFn: () => aircraftApi.listEngines(aircraftId),
    enabled: !!aircraftId,
  });

  const { data: readings = [] } = useQuery({
    queryKey: ['aircraft-counter-readings', aircraftId],
    queryFn: () => aircraftApi.listCounterReadings(aircraftId),
    enabled: !!aircraftId,
  });

  // Al cambiar de aeronave se descarta lo escrito: pertenecía a la anterior.
  useEffect(() => { setDraft({}); }, [aircraftId]);

  /** Valor vigente por contador y equipo, para mostrarlo junto al campo. */
  const currentByKey = useMemo(() => {
    const map = new Map<string, { value: string; date: string }>();
    for (const r of readings) {
      const key = `${r.counterType.id}|${r.engine?.id ?? 'ac'}`;
      if (!map.has(key)) map.set(key, { value: r.value, date: r.readingDate.slice(0, 10) });
    }
    return map;
  }, [readings]);

  // Los seis de la pantalla del Access son los que gobiernan límites: los que
  // reflejan un campo previo o tienen ranura asignada. El resto del catálogo
  // está declarado pero no se lee a diario, y llenaría el formulario de ruido.
  const isPrimary = (t: CounterType) => t.legacyField != null || t.slot != null;
  const activeTypes = useMemo(
    () => types.filter((t) => t.isActive && (showAll || isPrimary(t))),
    [types, showAll],
  );
  const aircraftTypes = activeTypes.filter((t) => t.scope === 'AIRCRAFT' || t.scope === 'BOTH');
  const engineTypes = activeTypes.filter((t) => t.scope === 'ENGINE');

  const filled = Object.entries(draft).filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v)));

  const save = async () => {
    if (filled.length === 0) return;
    setSaving(true);
    let ok = 0;
    const failures: string[] = [];

    // Cada lectura es un hecho independiente: si una falla, las otras valen.
    for (const [key, value] of filled) {
      const [counterTypeId, engineKey] = key.split('|');
      try {
        await aircraftApi.createCounterReading(aircraftId, {
          counterTypeId,
          engineId: engineKey === 'ac' ? null : engineKey,
          value: Number(value),
          readingDate,
        });
        ok += 1;
      } catch (err) {
        const type = types.find((t) => t.id === counterTypeId);
        const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        failures.push(`${type ? displayCode(type) : 'Contador'}: ${detail ?? 'no se pudo guardar'}`);
      }
    }

    setSaving(false);
    qc.invalidateQueries({ queryKey: ['aircraft-counter-readings', aircraftId] });
    qc.invalidateQueries({ queryKey: ['aircraft'] });
    qc.invalidateQueries({ queryKey: ['maintenance-plan'] });

    if (ok > 0) toast.success(`${ok} lectura${ok !== 1 ? 's' : ''} registrada${ok !== 1 ? 's' : ''}`);
    failures.forEach((f) => toast.error(f, { duration: 7000 }));
    if (failures.length === 0) setDraft({});
  };

  const field = (t: CounterType, engineKey: string) => {
    const key = `${t.id}|${engineKey}`;
    const current = currentByKey.get(key);
    return (
      <div key={key}>
        <label className="flex items-baseline justify-between text-[11px] font-semibold text-slate-600">
          <span>{displayCode(t)}</span>
          <span className="font-normal text-slate-400">{t.unit}</span>
        </label>
        <input
          value={draft[key] ?? ''}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className="input mt-0.5 text-sm tabular-nums"
          placeholder={current ? Number(current.value).toLocaleString('es-CL') : '—'}
          inputMode="decimal"
        />
        <p className="mt-0.5 text-[10px] text-slate-400">
          {current ? `Actual ${Number(current.value).toLocaleString('es-CL')} · ${current.date}` : 'Sin lectura previa'}
        </p>
      </div>
    );
  };

  if (aircraft.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white shadow-card border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <Gauge size={17} className="text-brand-500" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Registrar contadores</h2>
            <p className="text-xs text-slate-500 mt-0.5">Deja en blanco lo que no cambió.</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Aeronave</label>
            <div className="relative">
              <Plane size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select value={aircraftId} onChange={(e) => setAircraftId(e.target.value)} className="input pl-8 text-sm">
                {aircraft.map((a) => (
                  <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Fecha de lectura</label>
            <input type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} className="input text-sm" />
          </div>
        </div>

        {/* Bloque de aeronave, como en la pantalla del Access */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <p className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            Aeronave
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-4 py-3">
            {aircraftTypes.length === 0
              ? <p className="text-xs text-slate-400">Sin contadores de aeronave configurados.</p>
              : aircraftTypes.map((t) => field(t, 'ac'))}
          </div>
        </div>

        {/* Un bloque por motor, con sus propios contadores */}
        {engines.map((en) => (
          <div key={en.id} className="rounded-xl border border-slate-200 overflow-hidden">
            <p className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Motor {en.position}
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                {en.model} · S/N {en.serialNumber}
              </span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-4 py-3">
              {engineTypes.length === 0
                ? <p className="text-xs text-slate-400">Sin contadores de motor configurados.</p>
                : engineTypes.map((t) => field(t, en.id))}
            </div>
          </div>
        ))}

        {engines.length === 0 && (
          <p className="text-xs text-amber-700">
            Esta aeronave no tiene motores registrados, así que no se pueden cargar sus contadores.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-3.5">
        <span className="flex items-center gap-3 text-[11px] text-slate-500">
          <span>{filled.length > 0 ? `${filled.length} lectura${filled.length !== 1 ? 's' : ''} por registrar` : 'Nada por registrar'}</span>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-semibold text-brand-700 hover:underline"
          >
            {showAll ? 'Ver solo los principales' : 'Ver todos los contadores'}
          </button>
        </span>
        <button onClick={save} className="btn-primary" disabled={saving || filled.length === 0}>
          {saving ? 'Guardando…' : 'Registrar'}
        </button>
      </div>
    </div>
  );
}
