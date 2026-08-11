import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plane, Repeat, Plus, Pencil, Trash2, X, Search, FileText, BookOpen, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { aircraftApi } from '@api/aircraft.api';
import {
  aircraftAlterationsApi,
  type AircraftAlteration,
  type AircraftAlterationInput,
} from '@api/aircraftAlterations.api';
import { useAuthStore } from '../store/authStore';

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={15} className="text-slate-500" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const toDateInput = (value: string | null): string => (value ? value.slice(0, 10) : '');

// ─── Formulario de alteración ─────────────────────────────────────────────────
function AlterationForm({
  initial, onCancel, onSubmit, isPending,
}: {
  initial: AircraftAlteration | null;
  onCancel: () => void;
  onSubmit: (input: AircraftAlterationInput) => void;
  isPending: boolean;
}) {
  const [documentNumber, setDocumentNumber] = useState(initial?.documentNumber ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [approvalDate, setApprovalDate] = useState(toDateInput(initial?.approvalDate ?? null));
  const [hasFms, setHasFms] = useState(initial?.hasFlightManualSupplement ?? false);
  const [fmsRef, setFmsRef] = useState(initial?.flightManualReference ?? '');
  const [hasIca, setHasIca] = useState(initial?.hasIca ?? false);
  const [icaRef, setIcaRef] = useState(initial?.icaReference ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const canSubmit = documentNumber.trim() && description.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          documentNumber: documentNumber.trim(),
          description: description.trim(),
          approvalDate: approvalDate || null,
          hasFlightManualSupplement: hasFms,
          flightManualReference: hasFms ? fmsRef.trim() || null : null,
          hasIca,
          icaReference: hasIca ? icaRef.trim() || null : null,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Documento de aprobación <span className="text-rose-500">*</span>
          </label>
          <input
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            className="input"
            placeholder="Form DGAC 337 N° 307-2010"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha de aprobación</label>
          <input type="date" value={approvalDate} onChange={(e) => setApprovalDate(e.target.value)} className="input" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          Descripción de la alteración <span className="text-rose-500">*</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="input"
          placeholder='STC SR09613RC - INSTALLATION CREW DOOR OPENER KIT L/H & R/H'
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={hasFms} onChange={(e) => setHasFms(e.target.checked)} />
            Suplemento de manual de vuelo (FMS)
          </label>
          {hasFms && (
            <input
              value={fmsRef}
              onChange={(e) => setFmsRef(e.target.value)}
              className="input mt-2 text-xs"
              placeholder="Referencia del suplemento (opcional)"
            />
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={hasIca} onChange={(e) => setHasIca(e.target.checked)} />
            Instrucciones de aeronavegabilidad continuada (ICA)
          </label>
          {hasIca && (
            <input
              value={icaRef}
              onChange={(e) => setIcaRef(e.target.value)}
              className="input mt-2 text-xs"
              placeholder="Referencia de la ICA (opcional)"
            />
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">OT / taller donde se ejecutó</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="input"
          placeholder="OT ABU/10-06 · CMA 095 - AEROMAR"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Observaciones</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
        <button type="submit" className="btn-primary" disabled={isPending || !canSubmit}>
          {isPending ? 'Guardando…' : initial ? 'Guardar cambios' : 'Registrar alteración'}
        </button>
      </div>
    </form>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function AircraftAlterationsPage() {
  const [aircraftId, setAircraftId] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AircraftAlteration | null>(null);
  const [deleting, setDeleting] = useState<AircraftAlteration | null>(null);

  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'ADMIN' || role === 'SUPERVISOR';

  const { data: aircraft = [] } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
  });

  const { data: alterations = [], isFetching } = useQuery({
    queryKey: ['aircraft-alterations', aircraftId],
    queryFn: () => aircraftAlterationsApi.listByAircraft(aircraftId),
    enabled: !!aircraftId,
  });

  const selectedAircraft = useMemo(
    () => aircraft.find((a) => a.id === aircraftId) ?? null,
    [aircraft, aircraftId],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['aircraft-alterations', aircraftId] });

  const createMutation = useMutation({
    mutationFn: (input: AircraftAlterationInput) => aircraftAlterationsApi.create(aircraftId, input),
    onSuccess: () => { invalidate(); setFormOpen(false); toast.success('Alteración registrada'); },
    onError: () => toast.error('No se pudo registrar la alteración'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AircraftAlterationInput }) =>
      aircraftAlterationsApi.update(id, input),
    onSuccess: () => { invalidate(); setEditing(null); toast.success('Alteración actualizada'); },
    onError: () => toast.error('No se pudo actualizar la alteración'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => aircraftAlterationsApi.remove(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success('Alteración eliminada'); },
    onError: () => toast.error('No se pudo eliminar la alteración'),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return alterations;
    return alterations.filter((a) =>
      [a.documentNumber, a.description, a.reference, a.flightManualReference, a.icaReference, a.notes]
        .some((field) => field?.toLowerCase().includes(term)),
    );
  }, [alterations, search]);

  const counts = useMemo(() => ({
    total: alterations.length,
    fms: alterations.filter((a) => a.hasFlightManualSupplement).length,
    ica: alterations.filter((a) => a.hasIca).length,
  }), [alterations]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <Repeat size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Alteraciones por Aeronave</h1>
            <p className="text-sm text-slate-500">
              Modificaciones aprobadas a la configuración: STC y Formularios DGAC 337
            </p>
          </div>
        </div>
        {aircraftId && canEdit && (
          <button onClick={() => setFormOpen(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={15} /> Nueva alteración
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Aeronave</label>
            <div className="relative">
              <Plane size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select value={aircraftId} onChange={(e) => setAircraftId(e.target.value)} className="input pl-9">
                <option value="">Seleccione una aeronave</option>
                {aircraft.map((a) => (
                  <option key={a.id} value={a.id}>{a.registration} - {a.model}</option>
                ))}
              </select>
            </div>
          </div>
          {aircraftId && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Buscar</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input pl-9"
                  placeholder="Documento, STC, OT o taller…"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedAircraft && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Alteraciones registradas', value: counts.total, icon: FileText },
              { label: 'Con suplemento de manual (FMS)', value: counts.fms, icon: BookOpen },
              { label: 'Con ICA asociada', value: counts.ica, icon: Wrench },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <Icon size={14} />
                  <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
                </div>
                <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none mt-1.5">{value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">
              {selectedAircraft.registration} · {filtered.length}
              {filtered.length !== counts.total ? ` de ${counts.total}` : ''} alteraciones
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2.5">Documento</th>
                    <th className="text-left px-4 py-2.5">Descripción</th>
                    <th className="text-left px-4 py-2.5 whitespace-nowrap">Aprobación</th>
                    <th className="text-left px-4 py-2.5">FMS</th>
                    <th className="text-left px-4 py-2.5">ICA</th>
                    <th className="text-left px-4 py-2.5">OT / Taller</th>
                    {canEdit && <th className="text-right px-4 py-2.5">Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {isFetching && (
                    <tr><td className="px-4 py-4 text-slate-400" colSpan={canEdit ? 7 : 6}>Cargando…</td></tr>
                  )}
                  {!isFetching && filtered.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-slate-400" colSpan={canEdit ? 7 : 6}>
                        {counts.total === 0
                          ? 'Esta aeronave no tiene alteraciones registradas.'
                          : 'Ninguna alteración coincide con la búsqueda.'}
                      </td>
                    </tr>
                  )}
                  {!isFetching && filtered.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700 max-w-[190px]">{row.documentNumber}</td>
                      <td className="px-4 py-2.5 max-w-[340px]">
                        <span className="block text-slate-800">{row.description}</span>
                        {row.notes && <span className="block text-[11px] text-slate-500 mt-0.5">{row.notes}</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {row.approvalDate ? new Date(row.approvalDate).toLocaleDateString('es-CL', { timeZone: 'UTC' }) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <FlagCell has={row.hasFlightManualSupplement} reference={row.flightManualReference} />
                      </td>
                      <td className="px-4 py-2.5">
                        <FlagCell has={row.hasIca} reference={row.icaReference} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 max-w-[180px]">{row.reference ?? '—'}</td>
                      {canEdit && (
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <button
                            onClick={() => setEditing(row)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Pencil size={14} className="text-slate-500" />
                          </button>
                          <button
                            onClick={() => setDeleting(row)}
                            className="p-1.5 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={14} className="text-rose-500" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {formOpen && (
        <Modal title="Nueva alteración" onClose={() => setFormOpen(false)}>
          <AlterationForm
            initial={null}
            isPending={createMutation.isPending}
            onCancel={() => setFormOpen(false)}
            onSubmit={(input) => createMutation.mutate(input)}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Editar alteración" onClose={() => setEditing(null)}>
          <AlterationForm
            initial={editing}
            isPending={updateMutation.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(input) => updateMutation.mutate({ id: editing.id, input })}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title="Eliminar alteración" onClose={() => setDeleting(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Se eliminará del expediente de la aeronave. Esta acción no se puede deshacer.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="font-mono text-xs text-slate-500">{deleting.documentNumber}</p>
              <p className="text-sm text-slate-800">{deleting.description}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancelar</button>
              <button
                onClick={() => deleteMutation.mutate(deleting.id)}
                className="btn-primary bg-rose-600 hover:bg-rose-700 border-rose-600"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Sí/No con la referencia del documento cuando el Access la traía. */
function FlagCell({ has, reference }: { has: boolean; reference: string | null }) {
  if (!has) return <span className="text-xs text-slate-400">No</span>;
  return (
    <div>
      <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Sí</span>
      {reference && (
        <span className="block text-[11px] text-slate-500 mt-0.5 max-w-[130px] truncate" title={reference}>
          {reference}
        </span>
      )}
    </div>
  );
}
