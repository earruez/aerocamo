import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { aircraftApi, type AircraftStatus } from '@api/aircraft.api';

const STATUS_LABEL: Record<AircraftStatus, string> = {
  OPERATIONAL: 'Operacional',
  AOG: 'AOG',
  IN_MAINTENANCE: 'En Mantenimiento',
  GROUNDED: 'En Tierra',
  DECOMMISSIONED: 'Retirada',
};

const STATUS_HINT: Record<AircraftStatus, string> = {
  OPERATIONAL: 'Disponible para volar.',
  AOG: 'Detenida por una falla que impide el vuelo.',
  IN_MAINTENANCE: 'En un mantenimiento programado.',
  GROUNDED: 'Detenida por una razón administrativa (certificado vencido, por ejemplo).',
  DECOMMISSIONED: 'Retirada de servicio de forma permanente.',
};

const ORDER: AircraftStatus[] = ['OPERATIONAL', 'IN_MAINTENANCE', 'AOG', 'GROUNDED', 'DECOMMISSIONED'];

/**
 * Cambiar el estado operacional es una decisión de aeronavegabilidad: la toma
 * una persona y queda registrada con su motivo, no se deduce del plan.
 */
export function AircraftStatusControl({
  aircraftId, currentStatus, canEdit,
}: {
  aircraftId: string;
  currentStatus: AircraftStatus;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<AircraftStatus | null>(null);
  const [reason, setReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const { data: changes = [], isLoading } = useQuery({
    queryKey: ['aircraft-status-changes', aircraftId],
    queryFn: () => aircraftApi.listStatusChanges(aircraftId),
    enabled: showHistory,
  });

  const change = useMutation({
    mutationFn: () => aircraftApi.changeStatus(aircraftId, target!, reason.trim()),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['aircraft'] });
      qc.invalidateQueries({ queryKey: ['aircraft-status-changes', aircraftId] });
      setTarget(null);
      setReason('');
      toast.success(`Estado cambiado a ${STATUS_LABEL[updated.status as AircraftStatus]}`);
    },
    onError: () => toast.error('No se pudo cambiar el estado'),
  });

  return (
    <>
      <div className="flex items-center gap-2">
        {canEdit && (
          <select
            value={currentStatus}
            onChange={(e) => {
              const next = e.target.value as AircraftStatus;
              if (next !== currentStatus) { setTarget(next); setReason(''); }
            }}
            className="filter-input h-7 py-0 px-2 text-xs"
            title="Cambiar estado operacional"
          >
            {ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowHistory(true)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
          title="Ver historial de cambios de estado"
        >
          <History size={12} /> Historial
        </button>
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(e) => { e.preventDefault(); if (reason.trim()) change.mutate(); }}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-sm font-bold text-slate-900">Cambiar estado operacional</h2>
            <p className="mt-2 text-sm text-slate-600">
              De <b>{STATUS_LABEL[currentStatus]}</b> a <b>{STATUS_LABEL[target]}</b>.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{STATUS_HINT[target]}</p>

            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Motivo <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              className="input mt-1"
              placeholder="Ej: ingresa a inspección de 100 FH; se detecta fuga en MGB; certificado por vencer…"
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Queda registrado con tu nombre y la fecha, y no se puede borrar.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setTarget(null)} className="btn-secondary">Cancelar</button>
              <button type="submit" className="btn-primary" disabled={change.isPending || !reason.trim()}>
                {change.isPending ? 'Guardando…' : 'Cambiar estado'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-sm font-bold text-slate-900">Historial de estado operacional</h2>
              <button onClick={() => setShowHistory(false)} className="rounded-lg p-1.5 hover:bg-slate-100">
                <X size={15} className="text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              {isLoading ? (
                <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
              ) : changes.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Sin cambios registrados. El estado actual viene de la carga inicial.
                </p>
              ) : (
                <ul className="space-y-2">
                  {changes.map((c) => (
                    <li key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">
                          {c.fromStatus ? `${STATUS_LABEL[c.fromStatus]} → ` : ''}{STATUS_LABEL[c.toStatus]}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {new Date(c.changedAt).toLocaleString('es-CL')}
                          {c.changedBy ? ` · ${c.changedBy.name}` : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{c.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 px-6 py-3">
              <button onClick={() => setShowHistory(false)} className="btn-secondary">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
