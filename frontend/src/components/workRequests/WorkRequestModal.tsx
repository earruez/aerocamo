import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, FileWarning, Plus, Search, Settings2, ShieldAlert, Trash2, Wrench, X } from 'lucide-react';
import { workRequestsApi } from '@api/workRequests.api';

interface WorkRequestModalProps {
  aircraftId: string;
  onClose: () => void;
}

export function WorkRequestModal({ aircraftId, onClose }: WorkRequestModalProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [closeHours, setCloseHours] = useState('');
  const [closeCyclesN1, setCloseCyclesN1] = useState('');
  const [closeCyclesN2, setCloseCyclesN2] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [activeSection, setActiveSection] = useState<'maintenancePlan' | 'normative' | 'componentInspection' | 'discrepancies'>('maintenancePlan');

  const { data: drafts = [], isLoading: loadingDrafts } = useQuery({
    queryKey: ['work-requests-by-aircraft', aircraftId],
    queryFn: () => workRequestsApi.listByAircraft(aircraftId),
    enabled: !!aircraftId,
  });

  const draft = useMemo(() => drafts.find((d) => d.status === 'DRAFT') ?? null, [drafts]);

  const createDraftMutation = useMutation({
    mutationFn: () => workRequestsApi.createDraft(aircraftId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-requests-by-aircraft', aircraftId] });
      toast.success('Borrador ST creado');
    },
    onError: () => toast.error('No se pudo crear la ST'),
  });

  const { data: catalog } = useQuery({
    queryKey: ['work-request-catalog', aircraftId, search],
    queryFn: () => workRequestsApi.getCatalog(aircraftId, search || undefined),
    enabled: !!aircraftId,
  });

  const { data: responsibles = [] } = useQuery({
    queryKey: ['work-request-responsibles'],
    queryFn: workRequestsApi.listResponsibles,
  });

  const addItemMutation = useMutation({
    mutationFn: (payload: Parameters<typeof workRequestsApi.addItem>[1]) => workRequestsApi.addItem(draft!.id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-requests-by-aircraft', aircraftId] }),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => workRequestsApi.removeItem(draft!.id, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-requests-by-aircraft', aircraftId] }),
  });

  const updateDraftMutation = useMutation({
    mutationFn: (payload: { responsibleId?: string | null; notes?: string | null }) =>
      workRequestsApi.updateDraft(draft!.id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-requests-by-aircraft', aircraftId] }),
  });

  const sendMutation = useMutation({
    mutationFn: () => workRequestsApi.send(draft!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-requests-by-aircraft', aircraftId] });
      qc.invalidateQueries({ queryKey: ['maintenance-plan', aircraftId] });
      toast.success('ST enviada');
    },
    onError: () => toast.error('No se pudo enviar la ST'),
  });

  const closeAndComplyMutation = useMutation({
    mutationFn: () => {
      const hours = Number(closeHours);
      const cyclesN1 = Number(closeCyclesN1);
      const cyclesN2 = Number(closeCyclesN2);

      if (!Number.isFinite(hours) || hours < 0) {
        throw new Error('Ingresa horas totales reales (TSN) válidas');
      }
      if (!Number.isInteger(cyclesN1) || cyclesN1 < 0) {
        throw new Error('Ingresa ciclos N1 finales válidos');
      }
      if (!Number.isInteger(cyclesN2) || cyclesN2 < 0) {
        throw new Error('Ingresa ciclos N2 finales válidos');
      }
      if (!evidenceFile) {
        throw new Error('Adjunta evidencia documental de OT firmada');
      }

      return workRequestsApi.closeAndComply(draft!.id, {
        aircraftHoursAtClose: hours,
        aircraftCyclesN1AtClose: cyclesN1,
        aircraftCyclesN2AtClose: cyclesN2,
        notes: closeNotes || undefined,
        evidenceFile,
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['work-requests-by-aircraft', aircraftId] });
      qc.invalidateQueries({ queryKey: ['maintenance-plan', aircraftId] });
      qc.invalidateQueries({ queryKey: ['airworthiness-history', aircraftId] });
      setEvidenceFile(null);
      toast.success(`ST cerrada con ${result.generatedCompliances} cumplimientos legales`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'No se pudo cerrar y cumplir la ST');
    },
  });

  const sourceSections = [
    {
      key: 'maintenancePlan',
      title: 'Plan de Mantenimiento',
      icon: Wrench,
      items: catalog?.maintenancePlan ?? [],
      onAdd: (item: { taskId: string }) => addItemMutation.mutate({ taskId: item.taskId }),
      renderMeta: (item: { hoursRemaining: number | null; daysRemaining: number | null }) =>
        `${item.hoursRemaining != null ? `${item.hoursRemaining}h` : '-'} · ${item.daysRemaining != null ? `${item.daysRemaining}d` : '-'}`,
    },
    {
      key: 'normative',
      title: 'Normativa',
      icon: ShieldAlert,
      items: catalog?.normative ?? [],
      onAdd: (item: { taskId: string }) => addItemMutation.mutate({ taskId: item.taskId }),
      renderMeta: (item: { referenceNumber: string | null }) => item.referenceNumber ?? 'Referencia normativa',
    },
    {
      key: 'componentInspection',
      title: 'Componentes e Inspecciones',
      icon: Settings2,
      items: [
        ...(catalog?.componentInspection ?? []),
        ...((catalog?.components ?? []).map((component) => ({
          id: component.id,
          taskId: undefined,
          componentId: component.id,
          taskCode: component.partNumber,
          taskTitle: component.description,
          referenceNumber: component.position ? `Posición ${component.position}` : component.serialNumber,
        }))),
      ],
      onAdd: (item: { taskId?: string; componentId?: string }) => addItemMutation.mutate(item.taskId ? { taskId: item.taskId } : { componentId: item.componentId }),
      renderMeta: (item: { referenceNumber: string | null }) => item.referenceNumber ?? '-',
    },
    {
      key: 'discrepancies',
      title: 'Discrepancias',
      icon: FileWarning,
      items: catalog?.discrepancies ?? [],
      onAdd: (item: { id: string }) => addItemMutation.mutate({ discrepancyId: item.id }),
      renderMeta: (item: { status: string }) => item.status,
    },
  ];

  const selectedSection = sourceSections.find((section) => section.key === activeSection) ?? sourceSections[0];
  const existingKeys = new Set(
    (draft?.items ?? []).map((item) => item.taskId ?? item.componentId ?? item.discrepancyId ?? `${item.category}:${item.itemCode ?? item.itemTitle}`),
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="mx-auto flex h-full max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Solicitud de Trabajo (ST)</h2>
            <p className="text-xs text-slate-500">Contenedor dinámico para agrupar tareas antes del despacho</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-3">
          <div className="border-r border-slate-100 p-5 lg:col-span-2 overflow-y-auto">
            {loadingDrafts ? (
              <p className="text-sm text-slate-500">Cargando…</p>
            ) : !draft ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
                <p className="text-sm text-slate-600">No existe ST en borrador para esta aeronave.</p>
                <button
                  onClick={() => createDraftMutation.mutate()}
                  className="btn-primary mt-3"
                  disabled={createDraftMutation.isPending}
                >
                  Crear Borrador ST
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Solicitud Nro</p>
                    <p className="font-mono text-lg font-bold text-slate-900">{draft.number}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${draft.status === 'DRAFT' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {draft.status === 'DRAFT' ? 'BORRADOR' : 'ENVIADA'}
                  </span>
                </div>

                <div className="mb-5">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Responsable OT/CMA</label>
                  <select
                    className="input"
                    value={draft.responsibleId ?? ''}
                    onChange={(e) => updateDraftMutation.mutate({ responsibleId: e.target.value || null })}
                    disabled={draft.status !== 'DRAFT'}
                  >
                    <option value="">Seleccionar responsable</option>
                    {responsibles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">Items Incluidos</h3>
                  <div className="space-y-2">
                    {draft.items.length === 0 && (
                      <p className="text-xs text-slate-400">Sin items aún. Agrega desde las categorías laterales.</p>
                    )}
                    {draft.items.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-mono text-xs font-bold text-slate-800">{item.itemCode ?? '-'}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{item.category}</span>
                          </div>
                          <p className="text-xs text-slate-600">{item.itemTitle}</p>
                          {item.itemDescription && <p className="text-[11px] text-slate-400 mt-1">{item.itemDescription}</p>}
                        </div>
                        {draft.status === 'DRAFT' && (
                          <button
                            onClick={() => removeItemMutation.mutate(item.id)}
                            className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                            title="Quitar item"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="p-5 overflow-y-auto bg-slate-50/70">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Fuentes ST</h3>
            <div className="mb-3 flex flex-wrap gap-2">
              {sourceSections.map((section) => {
                const Icon = section.icon;
                const isActive = section.key === activeSection;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key as typeof activeSection)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={12} />
                    {section.title}
                  </button>
                );
              })}
            </div>
            <div className="relative mb-3">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar ATA, referencia, discrepancia o componente"
                className="input pl-7"
              />
            </div>

            <div className="space-y-2">
              {selectedSection.items.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-400">
                  No hay elementos disponibles en esta categoría para la búsqueda actual.
                </div>
              )}
              {selectedSection.items.slice(0, 12).map((item, index) => {
                const itemKey = ('taskId' in item && item.taskId) || ('componentId' in item && item.componentId) || ('id' in item && item.id) || `${selectedSection.key}-${index}`;
                const alreadyAdded = !!itemKey && existingKeys.has(itemKey);
                return (
                  <button
                    key={itemKey}
                    type="button"
                    disabled={!draft || draft.status !== 'DRAFT' || alreadyAdded}
                    onClick={() => selectedSection.onAdd(item as never)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      alreadyAdded
                        ? 'border-emerald-200 bg-emerald-50/70'
                        : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40'
                    } disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs font-bold text-slate-700">{'taskCode' in item ? item.taskCode : ('code' in item ? item.code : '-')}</p>
                        <p className="text-xs text-slate-600 mt-0.5">{'taskTitle' in item ? item.taskTitle : ('title' in item ? item.title : '-')}</p>
                        <p className="mt-1 text-[10px] text-slate-400">{selectedSection.renderMeta(item as never)}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${alreadyAdded ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {alreadyAdded ? <CheckCircle2 size={11} /> : <Plus size={11} />}
                        {alreadyAdded ? 'Agregado' : 'Agregar'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {draft?.status === 'DRAFT' && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Otros</h4>
                <div className="space-y-2">
                  <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} className="input" placeholder="Código / referencia" />
                  <input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} className="input" placeholder="Título manual" />
                  <textarea value={manualDescription} onChange={(e) => setManualDescription(e.target.value)} className="input resize-none" rows={3} placeholder="Descripción adicional" />
                  <button
                    className="btn-secondary w-full justify-center"
                    onClick={() => {
                      if (!manualTitle.trim()) {
                        toast.error('Ingresa un título para el item manual');
                        return;
                      }
                      addItemMutation.mutate({
                        category: 'OTHER',
                        code: manualCode || null,
                        title: manualTitle.trim(),
                        description: manualDescription || null,
                      });
                      setManualCode('');
                      setManualTitle('');
                      setManualDescription('');
                    }}
                  >
                    <Plus size={12} /> Agregar item manual
                  </button>
                </div>
              </div>
            )}

            {draft && (
              <div className="mt-5 space-y-2 border-t border-slate-200 pt-4">
                <a
                  href={workRequestsApi.getPdfUrl(draft.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary w-full justify-center"
                >
                  Generar PDF
                </a>
                <button
                  onClick={() => sendMutation.mutate()}
                  disabled={draft.status !== 'DRAFT' || sendMutation.isPending}
                  className="btn-primary flex w-full items-center justify-center gap-1.5"
                >
                  Enviar ST
                </button>

                {draft.status === 'SENT' && (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                    <p className="text-xs font-semibold text-emerald-800">Cerrar y Cumplir (Cierre legal)</p>
                    <input
                      value={closeHours}
                      onChange={(e) => setCloseHours(e.target.value)}
                      className="input"
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="Horas Totales Reales (TSN)"
                    />
                    <input
                      value={closeCyclesN1}
                      onChange={(e) => setCloseCyclesN1(e.target.value)}
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Ciclos N1 finales"
                    />
                    <input
                      value={closeCyclesN2}
                      onChange={(e) => setCloseCyclesN2(e.target.value)}
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Ciclos N2 finales"
                    />
                    <textarea
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      className="input resize-none"
                      rows={2}
                      placeholder="Notas de cierre legal (opcional)"
                    />
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.pdf"
                      className="input"
                      onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      onClick={() => closeAndComplyMutation.mutate()}
                      disabled={closeAndComplyMutation.isPending}
                      className="btn-primary w-full justify-center"
                    >
                      Cerrar y Cumplir
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
