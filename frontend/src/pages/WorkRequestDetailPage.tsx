import { useEffect, useMemo, useRef, useState } from 'react';
import { RegisterOTModal } from '../components/workRequests/RegisterOTModal';
import { SendWorkRequestDialog, type DispatchSelection } from '../components/workRequests/SendWorkRequestDialog';
import { useNavigate } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { ArrowLeft, Ban, FileDown, History, MessageSquareText, Paperclip, Save, Send, Trash2, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWorkRequestStore } from '../store/workRequestStore';
import { WorkRequestBadge } from '../components/workRequests/WorkRequestBadges';
import { WorkRequestAttachments } from '../components/workRequests/WorkRequestAttachments';
import { WorkRequestItemForm } from '../components/workRequests/WorkRequestItemForm';
import { workRequestsApi } from '../api/workRequests.api';
import { adaptApiWorkRequest, upsertWorkRequestCache } from '../shared/workRequestApiAdapter';
import {
  WORK_REQUEST_ITEM_STATUS_LABELS,
  WorkRequestItem,
} from '../shared/workRequestTypes';
import { canTransitionTo, getVisibleState, getVisibleStateLabel } from '../shared/workflowVisibleState';
import { useWorkRequestStateMachine } from '../shared/workflowStateMachineQueries';

const SOURCE_LABELS: Record<string, string> = {
  maintenance_plan: 'Plan de mantenimiento',
  component_inspection: 'Componentes e inspecciones',
  discrepancy: 'Discrepancia',
  compliance_due: 'Cumplimiento vencido',
  manual: 'Manual',
};

function shorten(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

const PRIORITY_WEIGHT: Record<'alta' | 'media' | 'baja', number> = {
  alta: 3,
  media: 2,
  baja: 1,
};

export default function WorkRequestDetailPage() {
  const navigate = useNavigate();
  const selectedId = useWorkRequestStore(s => s.selectedWorkRequestId);
  const selectedDetailSection = useWorkRequestStore(s => s.selectedDetailSection);
  const viewDensity = useWorkRequestStore(s => s.viewDensity);
  const selectWorkRequest = useWorkRequestStore(s => s.selectWorkRequest);
  const setFilterAircraftId = useWorkRequestStore(s => s.setFilterAircraftId);
  const setFilterStatus = useWorkRequestStore(s => s.setFilterStatus);
  const setSearchText = useWorkRequestStore(s => s.setSearchText);
  const setWorkRequests = useWorkRequestStore(s => s.setWorkRequests);
  const workRequest = useWorkRequestStore(s => s.workRequests.find(w => w.id === selectedId));
  const historyRef = useRef<HTMLDivElement | null>(null);
  const { data: workRequestStateMachine } = useWorkRequestStateMachine();
  const [notice, setNotice] = useState<string | null>(null);
  const [showRegisterOT, setShowRegisterOT] = useState(false);
  const [showAddItemForm, setShowAddItemForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [pendingOtData, setPendingOtData] = useState<{ otNumber: string; receivedAt: string; file?: File | null; notes: string } | null>(null);

  const syncWorkRequest = (nextApiWorkRequest: Awaited<ReturnType<typeof workRequestsApi.getById>>) => {
    const adapted = adaptApiWorkRequest(nextApiWorkRequest);
    setWorkRequests(upsertWorkRequestCache(useWorkRequestStore.getState().workRequests, adapted));
    return adapted;
  };

  const visibleStatus = useMemo(() => (
    workRequest
      ? workRequestStateMachine
        ? (getVisibleState(workRequestStateMachine, workRequest.status) === 'draft'
            ? 'borrador'
            : getVisibleState(workRequestStateMachine, workRequest.status) === 'cancelled'
              ? 'cancelada'
              : 'en_proceso')
        : 'en_proceso'
      : 'borrador'
  ), [workRequest, workRequestStateMachine]);

  const canEditCurrent = useMemo(() => {
    if (!workRequest) return false;
    if (!workRequestStateMachine) return false;
    return getVisibleState(workRequestStateMachine, workRequest.status) === 'draft';
  }, [workRequest, workRequestStateMachine]);

  const canSendCurrent = useMemo(() => {
    if (!workRequest) return false;
    if (!workRequestStateMachine) return false;
    return canTransitionTo(workRequestStateMachine, workRequest.status, 'SENT');
  }, [workRequest, workRequestStateMachine]);

  // Borrar solo el borrador: una vez enviada, la ST existe fuera de la
  // plataforma y debe cancelarse para conservar el registro.
  const canDeleteCurrent = canEditCurrent;
  const canCancelCurrent = useMemo(() => {
    if (!workRequest || !workRequestStateMachine) return false;
    return canTransitionTo(workRequestStateMachine, workRequest.status, 'CANCELLED');
  }, [workRequest, workRequestStateMachine]);

  const handleDelete = async () => {
    if (!workRequest) return;
    const { id, folio } = workRequest;
    try {
      await workRequestsApi.remove(id);
      // El detalle se muestra según la ST seleccionada en el store, no por ruta:
      // hay que soltar la selección y sacarla de la caché, o el listado la sigue mostrando.
      setConfirmDelete(false);
      selectWorkRequest(null, 'general');
      setWorkRequests(
        useWorkRequestStore.getState().workRequests.filter((wr) => wr.id !== id),
      );
      toast.success(`${folio} eliminada`);
    } catch {
      toast.error('No se pudo eliminar la solicitud');
    }
  };

  const handleCancel = async (reason: string) => {
    if (!workRequest) return;
    try {
      const updated = await workRequestsApi.cancel(workRequest.id, reason);
      syncWorkRequest(updated);
      setCancelReason(null);
      toast.success('Solicitud cancelada');
    } catch {
      toast.error('No se pudo cancelar la solicitud');
    }
  };

  const visibleStatusLabel = useMemo(() => {
    if (!workRequest) return '';
    return workRequestStateMachine
      ? getVisibleStateLabel(workRequestStateMachine, workRequest.status)
      : workRequest.status;
  }, [workRequest, workRequestStateMachine]);

  const timeline = useMemo(() => {
    if (!workRequest) return [] as Array<{ label: string; done: boolean; date?: string }>;

    return [
      { label: 'Creada', done: true, date: workRequest.createdAt },
      {
        label: 'Enviada',
        done: Boolean(workRequest.sentAt) || visibleStatus === 'en_proceso',
        date: workRequest.sentAt,
      },
      { label: 'Cancelada', done: visibleStatus === 'cancelada', date: workRequest.closedAt },
    ];
  }, [workRequest, visibleStatus]);

  const sortedItems = useMemo(() => {
    if (!workRequest) return [];
    return [...workRequest.items].sort((a, b) => {
      const priorityDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.dateAtRequest.localeCompare(b.dateAtRequest);
    });
  }, [workRequest]);

  const pagePadding = viewDensity === 'compact' ? 'p-4 lg:p-5 space-y-4' : 'p-6 lg:p-8 space-y-6';
  const cardPadding = viewDensity === 'compact' ? 'p-4 lg:p-5' : 'p-5 lg:p-6';
  const cardGap = viewDensity === 'compact' ? 'space-y-3' : 'space-y-5';
  const gridGap = viewDensity === 'compact' ? 'gap-4' : 'gap-6';
  const blockGap = viewDensity === 'compact' ? 'space-y-3' : 'space-y-5';
  const itemCardPadding = viewDensity === 'compact' ? 'p-3' : 'p-4';
  const timelineGap = viewDensity === 'compact' ? 'space-y-1.5' : 'space-y-2';
  const timelineConnector = viewDensity === 'compact' ? 'h-2.5' : 'h-3';
  const headingClass = viewDensity === 'compact' ? 'text-sm font-semibold text-slate-900 mb-2' : 'text-base font-semibold text-slate-900 mb-3';
  const paragraphClass = viewDensity === 'compact' ? 'text-xs text-slate-600' : 'text-sm text-slate-600';

  const handleSaveDraft = async () => {
    if (!workRequest || !canEditCurrent) return;
    try {
      const updated = await workRequestsApi.updateDraft(workRequest.id, {
        notes: notesDraft ?? workRequest.generalNotes ?? null,
      });
      syncWorkRequest(updated);
      setNotesDraft(null);
      toast.success('Borrador guardado');
    } catch {
      toast.error('No se pudo guardar el borrador');
    }
  };

  const handleSend = () => {
    if (!workRequest || !canSendCurrent) return;
    if (workRequest.items.length === 0) {
      setNotice('Agrega al menos un item antes de enviar.');
      return;
    }
    // La ST va a una persona de un taller: hay que elegir destino y vía.
    setShowSendDialog(true);
  };

  const [isSending, setIsSending] = useState(false);

  const handleConfirmSend = async (selection: DispatchSelection) => {
    if (!workRequest) return;
    setIsSending(true);
    try {
      const sent = await workRequestsApi.send(workRequest.id, selection);
      syncWorkRequest(sent);
      setShowSendDialog(false);
      toast.success(
        selection.dispatchMethod === 'EMAIL'
          ? 'Solicitud enviada por correo'
          : 'Solicitud registrada como entregada en mano',
      );
    } catch {
      toast.error('No se pudo enviar la solicitud');
    } finally {
      setIsSending(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!workRequest) return;
    // El PDF lo arma el servidor: membrete, datos de aeronave, tabla paginada
    // y bloque de firmas. Antes se generaba aquí un texto plano con extensión
    // .pdf que ningún lector abría.
    try {
      const blob = await workRequestsApi.downloadPdf(workRequest.id);
      saveAs(blob, `${workRequest.folio}.pdf`);
    } catch {
      toast.error('No se pudo generar el PDF');
    }
  };

  const handleBackToMain = () => {
    selectWorkRequest(null, 'general');
    setFilterAircraftId(null);
    setFilterStatus(null);
    setSearchText('');
    navigate('/work-requests');
  };

  useEffect(() => {
    if (selectedDetailSection === 'history' && historyRef.current) {
      historyRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDetailSection, workRequest?.id]);

  if (!workRequest) return <div className="p-8 text-sm text-slate-500">Seleccione una ST desde la bandeja.</div>;

  const handleAddItem = async (item: Omit<WorkRequestItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const openDuplicate = useWorkRequestStore.getState().itemAlreadyInOpenWorkRequest(
      item.sourceKind,
      item.sourceId,
      workRequest.id,
    );

    if (openDuplicate) {
      setNotice(`El item ya está en una ST activa (${openDuplicate.folio}).`);
      return;
    }

    try {
      const payload = item.sourceKind === 'maintenance_plan'
        ? { taskId: item.sourceId, category: 'MAINTENANCE_PLAN' as const }
        : item.sourceKind === 'component_inspection'
          ? { componentId: item.sourceId, category: 'COMPONENT_INSPECTION' as const }
          : item.sourceKind === 'discrepancy'
            ? { discrepancyId: item.sourceId, category: 'DISCREPANCY' as const }
            : {
                category: 'OTHER' as const,
                code: item.referenceCode ?? item.ataCode,
                title: item.title,
                description: item.description,
              };

      const updated = await workRequestsApi.addItem(workRequest.id, payload);
      syncWorkRequest(updated);
      setShowAddItemForm(false);
      setNotice('Item agregado a la ST.');
    } catch {
      toast.error('No se pudo agregar el item');
    }
  };

  // Determinar si la ST ya tiene OT cargada
  const hasOT = Boolean(
    (workRequest?.otReference && workRequest?.otReceivedAt)
    || pendingOtData,
  );

  // Handler para guardar datos de OT
  const handleRegisterOT = (data: { otNumber: string; receivedAt: string; file?: File | null; notes: string }) => {
    setPendingOtData(data);
    setShowRegisterOT(false);
    setNotice('OT registrada correctamente. Ahora puedes cerrar la solicitud.');
  };

  // Handler para cerrar solicitud (solo habilitado si hay OT cargada)
  const canClose = hasOT;
  const handleCloseRequest = async () => {
    if (!workRequest || !canClose) return;
    try {
      const aircraftHoursAtClose = Math.max(0, ...workRequest.items.map((it) => it.aircraftHoursAtRequest));
      const aircraftCyclesAtClose = Math.max(0, ...workRequest.items.map((it) => it.aircraftCyclesAtRequest));

      await workRequestsApi.closeAndComply(workRequest.id, {
        aircraftHoursAtClose,
        aircraftCyclesN1AtClose: aircraftCyclesAtClose,
        aircraftCyclesN2AtClose: aircraftCyclesAtClose,
        notes: pendingOtData
          ? `OT: ${pendingOtData.otNumber}. ${pendingOtData.notes}`
          : 'Cierre desde detalle de ST',
        closedAt: pendingOtData?.receivedAt,
        evidenceFile: pendingOtData?.file ?? undefined,
      });

      const refreshed = await workRequestsApi.getById(workRequest.id);
      syncWorkRequest(refreshed);
      setPendingOtData(null);
      setNotice('Solicitud cerrada correctamente.');
    } catch {
      toast.error('No se pudo cerrar la solicitud');
    }
  };

  return (
    <div className={`${pagePadding} max-w-7xl mx-auto`}>
      <section className={`relative overflow-hidden bg-white rounded-2xl border border-slate-200 ${cardPadding} ${cardGap} shadow-sm`}>
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-brand-50/80 via-sky-50/70 to-transparent pointer-events-none" />

        <div className="relative flex flex-wrap items-start gap-3">
          <button
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white/90 border border-slate-200 rounded-lg px-2.5 py-1.5"
            onClick={handleBackToMain}
          >
            <ArrowLeft size={13} />
            Volver a Solicitudes
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">N° ST {workRequest.folio}</h1>
              <WorkRequestBadge status={workRequest.status} />
            </div>
            <p className="text-xs text-slate-500 mt-1">Gestion operativa de solicitud de trabajo</p>
          </div>

          <div className="ml-auto rounded-xl border border-slate-200 bg-white/90 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Estado actual</p>
            <p className="text-sm font-semibold text-slate-700">{visibleStatusLabel}</p>
          </div>
        </div>

        <div className={`relative grid grid-cols-1 sm:grid-cols-3 ${viewDensity === 'compact' ? 'gap-2 text-xs' : 'gap-3 text-sm'}`}>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">Aeronave</p>
            <p className="font-semibold text-slate-900">{workRequest.aircraftId}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">Prioridad</p>
            <p className="font-semibold text-slate-900 capitalize">{workRequest.priority}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">Creada</p>
            <p className="font-semibold text-slate-900">{workRequest.createdAt.slice(0, 10)}</p>
          </div>
        </div>

        <div className="relative rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Acciones principales</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => setShowAddItemForm((v) => !v)}
              disabled={!canEditCurrent}
            >
              {showAddItemForm ? 'Ocultar formulario' : 'Agregar item'}
            </button>
            <button className="btn-primary" onClick={handleSend} disabled={!canSendCurrent}>
              <Send size={14} />
              Enviar a Oficina Tecnica
            </button>
            <button className="btn-secondary" onClick={handleSaveDraft} disabled={!canEditCurrent}>
              <Save size={14} />
              Guardar borrador
            </button>
            <button className="btn-secondary" onClick={handleDownloadPdf}>
              <FileDown size={14} />
              Descargar PDF
            </button>
            {canCancelCurrent && !canDeleteCurrent && (
              <button className="btn-secondary text-amber-700" onClick={() => setCancelReason('')}>
                <Ban size={14} />
                Cancelar solicitud
              </button>
            )}
            {canDeleteCurrent && (
              <button className="btn-secondary text-rose-600" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                Eliminar
              </button>
            )}
            {/* Registrar OT recibida solo si está en proceso y no tiene OT */}
            {visibleStatus === 'en_proceso' && !hasOT && (
              <button className="btn-primary" onClick={() => setShowRegisterOT(true)}>
                Registrar OT recibida
              </button>
            )}
            {/* Cerrar solicitud solo si ya tiene OT cargada */}
            {hasOT && (
              <button className="btn-success" onClick={handleCloseRequest}>
                Cerrar solicitud
              </button>
            )}
          </div>
          {showAddItemForm && canEditCurrent && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-600 mb-2">Agregar item a esta ST</p>
              <div className="mb-3 flex flex-wrap gap-2">
                <button className="btn-xs btn-outline" onClick={() => navigate(`/maintenance-plan?aircraft=${workRequest.aircraftId}`)}>
                  Agregar desde plan
                </button>
                <button className="btn-xs btn-outline" onClick={() => navigate(`/components?aircraft=${workRequest.aircraftId}`)}>
                  Agregar desde componentes
                </button>
                <button className="btn-xs btn-outline" onClick={() => navigate(`/work-requests?aircraftId=${workRequest.aircraftId}`)}>
                  Agregar discrepancia
                </button>
              </div>
              <WorkRequestItemForm
                onSave={handleAddItem}
                onCancel={() => setShowAddItemForm(false)}
              />
            </div>
          )}
        </div>
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-sm font-bold text-slate-900">Eliminar solicitud</h2>
            <p className="mt-2 text-sm text-slate-600">
              Se eliminará <b>{workRequest.folio}</b> y sus {workRequest.items.length} ítem
              {workRequest.items.length !== 1 ? 's' : ''}. Esta acción no se puede deshacer.
            </p>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Solo se puede eliminar mientras está en borrador, porque nunca salió de la oficina.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary">Volver</button>
              <button onClick={handleDelete} className="btn-primary bg-rose-600 hover:bg-rose-700 border-rose-600">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelReason !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={(e) => { e.preventDefault(); if (cancelReason.trim()) void handleCancel(cancelReason.trim()); }}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-sm font-bold text-slate-900">Cancelar solicitud</h2>
            <p className="mt-2 text-sm text-slate-600">
              <b>{workRequest.folio}</b> quedará anulada pero se conserva en el expediente,
              porque ya salió de la oficina.
            </p>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Motivo <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              autoFocus
              className="input mt-1"
              placeholder="Ej: el taller no tiene disponibilidad; se reemplaza por otra ST…"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelReason(null)} className="btn-secondary">Volver</button>
              <button type="submit" className="btn-primary" disabled={!cancelReason.trim()}>
                Cancelar solicitud
              </button>
            </div>
          </form>
        </div>
      )}

      {showSendDialog && (
        <SendWorkRequestDialog
          folio={workRequest.folio}
          itemsCount={workRequest.items.length}
          isSending={isSending}
          onClose={() => setShowSendDialog(false)}
          onConfirm={handleConfirmSend}
          onDownloadPdf={handleDownloadPdf}
        />
      )}

      {/* Modal para registrar OT */}
      <RegisterOTModal
        open={showRegisterOT}
        onClose={() => setShowRegisterOT(false)}
        onSave={handleRegisterOT}
      />

        {notice && <div className="relative text-xs text-sky-800 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">{notice}</div>}
      </section>

      <div className={`grid grid-cols-1 lg:grid-cols-3 ${gridGap}`}>
        <section className={`lg:col-span-2 bg-white rounded-2xl border border-slate-200 ${cardPadding} shadow-sm`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className={`${headingClass} !mb-0 inline-flex items-center gap-2`}>
              <Wrench size={16} className="text-brand-600" />
              Que incluye esta solicitud
            </h2>
            <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-full">
              {sortedItems.length} item{sortedItems.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={blockGap}>
            {sortedItems.length === 0 && (
              <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 ${viewDensity === 'compact' ? 'p-4' : 'p-7'} text-center`}>
                <div className="mx-auto w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center mb-3">
                  <Wrench size={16} className="text-slate-500" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Aun no hay trabajos agregados</p>
                <p className="text-xs text-slate-500 mt-1">Esta ST esta lista para recibir items de mantenimiento o discrepancias.</p>
              </div>
            )}

            {sortedItems.map((item) => (
              <article key={item.id} className={`border border-slate-200 rounded-xl ${itemCardPadding} bg-slate-50/40 hover:bg-white hover:shadow-sm transition-all`}>
                <div className={`flex flex-wrap items-center ${viewDensity === 'compact' ? 'gap-1.5 mb-0.5' : 'gap-2 mb-1'}`}>
                  <span className="text-xs bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">ATA {item.ataCode}</span>
                  <span className="text-xs text-slate-500">{SOURCE_LABELS[item.sourceKind] ?? 'Manual'}</span>
                  <span className="text-xs text-slate-600 ml-auto bg-white border border-slate-200 px-2 py-0.5 rounded-full">{WORK_REQUEST_ITEM_STATUS_LABELS[item.itemStatus]}</span>
                </div>
                <h3 className={`${viewDensity === 'compact' ? 'text-xs' : 'text-sm'} font-semibold text-slate-900`}>{item.title}</h3>
                <p className={paragraphClass}>{shorten(item.description)}</p>
                <div className={`${viewDensity === 'compact' ? 'mt-1.5' : 'mt-2'} text-xs text-slate-500`}>
                  Horas/Ciclos al momento: {item.aircraftHoursAtRequest} / {item.aircraftCyclesAtRequest}
                </div>
                {canEditCurrent && (
                  <div className="mt-2">
                    <button
                      className="btn-xs btn-outline"
                      onClick={() => {
                        void (async () => {
                          try {
                            const updated = await workRequestsApi.removeItem(workRequest.id, item.id);
                            syncWorkRequest(updated);
                            setNotice('Item eliminado de la ST.');
                          } catch {
                            toast.error('No se pudo eliminar el item');
                          }
                        })();
                      }}
                    >
                      Eliminar item
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className={`bg-white rounded-2xl border border-slate-200 ${cardPadding} ${viewDensity === 'compact' ? 'space-y-4' : 'space-y-5'} shadow-sm`}>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5">
              <Paperclip size={14} className="text-slate-600" />
              Adjuntos
            </h3>
            <WorkRequestAttachments attachments={workRequest.attachments} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5">
              <MessageSquareText size={14} className="text-slate-600" />
              Observaciones
            </h3>
            {canEditCurrent ? (
              <textarea
                value={notesDraft ?? workRequest.generalNotes ?? ''}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                className="input text-sm"
                placeholder="Observaciones para el taller: acceso, disponibilidad, materiales…"
              />
            ) : (
              <p className="text-sm text-slate-600 leading-relaxed">{workRequest.generalNotes || 'Sin observaciones registradas.'}</p>
            )}
            {canEditCurrent && notesDraft !== null && notesDraft !== (workRequest.generalNotes ?? '') && (
              <p className="mt-1.5 text-[11px] text-amber-700">Cambios sin guardar — usa «Guardar borrador».</p>
            )}
          </div>

          <div ref={historyRef} className="scroll-mt-20 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5">
              <History size={14} className="text-slate-600" />
              Historial
            </h3>
            <ol className={timelineGap}>
              {timeline.map((step, index) => (
                <li key={step.label} className={`flex ${viewDensity === 'compact' ? 'gap-1.5' : 'gap-2'} items-start ${viewDensity === 'compact' ? 'text-xs' : 'text-sm'}`}>
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full ${step.done ? 'bg-sky-600' : 'bg-slate-300'}`} />
                  <div>
                    <div className={step.done ? 'text-slate-900 font-medium' : 'text-slate-500'}>{step.label}</div>
                    {step.date && <div className="text-xs text-slate-500">{step.date.slice(0, 10)}</div>}
                    {index < timeline.length - 1 && <div className={`${timelineConnector} border-l border-slate-200 ml-1.5 mt-1`} />}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
