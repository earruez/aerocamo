import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft, ClipboardList, Plane, User, Calendar, Clock, CheckCircle2,
  AlertTriangle, ShieldCheck, Loader2, Plus, Check, FileText,
  ChevronDown, X, AlertCircle, Activity, Download, Lock, Pencil,
  Stamp, Timer, GitBranch, Wrench, ListChecks, Shield, Edit3,
  AlertOctagon, RefreshCw, Eye, UserCheck, Upload, Mail,
} from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import {
  workOrdersApi,
  type WorkOrder,
  type WorkOrderStatus,
  type WorkOrderAssignmentStatus,
  type WOTask,
  type Discrepancy,
  type AuditLogEntry,
  type CreateDiscrepancyInput,
  type UpdateDiscrepancyInput,
  type CreateWorkOrderInput,
  type DiscrepancyStatus,
} from '@api/workOrders.api';
import { ensureStateMachine, getOrderedStatuses, getStatusBadgeClass, getStatusLabel } from '../shared/workflowVisibleState';
import { useWorkOrderStateMachine } from '../shared/workflowStateMachineQueries';
import { TechnicianAssignmentModal } from '@components/workOrders/TechnicianAssignmentModal';
import { EvidenceUpload, EvidenceViewer } from '@components/workOrders/EvidenceUpload';

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_ICONS: Record<WorkOrderStatus, React.ElementType> = {
  DRAFT:       ClipboardList,
  OPEN:        AlertCircle,
  IN_PROGRESS: Loader2,
  QUALITY:     ShieldCheck,
  CLOSED:      CheckCircle2,
};

// ── Lifecycle pipeline ─────────────────────────────────────────────────────

const LIFECYCLE: WorkOrderStatus[] = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'QUALITY', 'CLOSED'];

const LIFECYCLE_LABELS: Record<WorkOrderStatus, { main: string; sub: string }> = {
  DRAFT:       { main: 'Planificación', sub: 'Borrador'     },
  OPEN:        { main: 'Hangar',        sub: 'Liberada'     },
  IN_PROGRESS: { main: 'Ejecución',     sub: 'En proceso'   },
  QUALITY:     { main: 'Calidad',       sub: 'Revisión QC'  },
  CLOSED:      { main: 'Histórico',     sub: 'Archivada'    },
};

// Discrepancy status
const DISC_LABEL: Record<DiscrepancyStatus, string> = {
  OPEN:      'Abierta',
  DEFERRED:  'Diferida',
  RESOLVED:  'Resuelta',
  CANCELLED: 'Cancelada',
};
const DISC_COLORS: Record<DiscrepancyStatus, string> = {
  OPEN:      'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20',
  DEFERRED:  'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  RESOLVED:  'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-400/20',
};

// ── Lifecycle Stepper ─────────────────────────────────────────────────────

function LifecycleStepper({ current, statuses }: { current: WorkOrderStatus; statuses: WorkOrderStatus[] }) {
  const cidx = statuses.indexOf(current);
  const steps: React.ReactNode[] = [];

  statuses.forEach((status, i) => {
    const done   = i < cidx;
    const active = i === cidx;
    const Icon   = STATUS_ICONS[status];

    steps.push(
      <div key={status} className="flex flex-col items-center min-w-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${
          active ? 'bg-brand-600 text-white ring-4 ring-brand-200/70 shadow-sm' :
          done   ? 'bg-emerald-500 text-white' :
                   'bg-white border-2 border-slate-200 text-slate-400'
        }`}>
          {done ? <Check size={14} strokeWidth={2.5} /> : <Icon size={14} />}
        </div>
        <p className={`text-[10px] font-bold mt-1.5 text-center leading-tight ${
          active ? 'text-brand-700' : done ? 'text-emerald-700' : 'text-slate-400'
        }`}>{LIFECYCLE_LABELS[status].main}</p>
        <p className={`text-[10px] text-center leading-tight ${active ? 'text-slate-500' : 'text-slate-300'}`}>
          {LIFECYCLE_LABELS[status].sub}
        </p>
      </div>
    );

    if (i < statuses.length - 1) {
      steps.push(
        <div key={`c-${i}`} className={`flex-1 h-px mt-4 self-start min-w-[12px] transition-colors ${
          i < cidx ? 'bg-emerald-400' : 'bg-slate-200'
        }`} />
      );
    }
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card px-6 py-4">
      <div className="flex items-start gap-0">{steps}</div>
    </div>
  );
}

// ── Edit Work Order Modal ──────────────────────────────────────────────────

interface EditFormState {
  title: string;
  description: string;
  plannedStartDate: string;
  plannedEndDate: string;
  notes: string;
  changeReason: string;
}

// ── Hallazgos (Findings) sub-components ───────────────────────────────────

/** Single finding row — inline corrective action + close checkbox */
function FindingRow({
  disc, workOrderId, isLocked, onUpdate,
}: {
  disc: Discrepancy;
  workOrderId: string;
  isLocked: boolean;
  onUpdate: (updated: Discrepancy) => void;
}) {
  const [corrective, setCorrective] = useState(disc.resolutionNotes ?? '');
  const [closed, setClosed]         = useState(disc.status === 'RESOLVED' || disc.status === 'CANCELLED');
  const [sparePart, setSparePart]   = useState(() => loadSparePart(disc.id));
  const [dirty, setDirty]           = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      workOrdersApi.updateDiscrepancy(disc.id, {
        status:          closed ? 'RESOLVED' : 'OPEN',
        resolutionNotes: corrective.trim() || null,
      }),
    onSuccess: (updated) => {
      saveSparePart(disc.id, sparePart);
      onUpdate(updated);
      setDirty(false);
      toast.success('Hallazgo guardado');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al guardar';
      toast.error(msg);
    },
  });

  const isOpen       = disc.status === 'OPEN';
  const missingAction = isOpen && !corrective.trim();

  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2.5 transition-colors ${
      disc.status === 'RESOLVED'  ? 'border-emerald-200 bg-emerald-50/40' :
      disc.status === 'CANCELLED' ? 'border-slate-200 bg-slate-50/60'     :
      missingAction               ? 'border-rose-200 bg-rose-50/40'       :
                                    'border-amber-200 bg-amber-50/30'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] font-bold bg-white border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded">
            {disc.code}
          </span>
          <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${DISC_COLORS[disc.status]}`}>
            {DISC_LABEL[disc.status]}
          </span>
          {missingAction && !isLocked && (
            <span className="text-[10px] font-bold text-rose-600 flex items-center gap-0.5">
              <AlertCircle size={10} /> Sin acción correctiva
            </span>
          )}
        </div>
      </div>

      {/* Title + description */}
      <div>
        <p className="text-sm font-semibold text-slate-800">{disc.title}</p>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{disc.description}</p>
        {disc.location && <p className="text-[11px] text-slate-400 mt-0.5">📍 {disc.location}</p>}
      </div>

      {/* Editable corrective action */}
      {!isLocked ? (
        <div className="space-y-2">
          <div>
            <label className="form-label text-[10px]">
              Acción Correctiva
              {missingAction && <span className="text-rose-500 ml-1">*</span>}
            </label>
            <textarea
              value={corrective}
              onChange={e => { setCorrective(e.target.value); setDirty(true); }}
              rows={2}
              disabled={closed}
              placeholder="Describe la acción correctiva aplicada…"
              className={`filter-input w-full resize-none text-xs ${closed ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
            />
          </div>

          {/* Repuesto Utilizado */}
          <div>
            <label className="form-label text-[10px]">Repuesto Utilizado</label>
            <input
              value={sparePart}
              onChange={e => { setSparePart(e.target.value); setDirty(true); }}
              disabled={closed}
              placeholder="Ej: O-ring P/N MS29512-04, qty 2"
              className={`filter-input w-full text-xs ${closed ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
            />
          </div>

          <div className="flex items-center justify-between">
            {/* Closed checkbox */}
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <div
                onClick={() => { setClosed(c => !c); setDirty(true); }}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                  closed ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 group-hover:border-emerald-400'
                }`}
              >
                {closed && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>
              <span className="text-xs font-medium text-slate-700">Hallazgo cerrado / resuelto</span>
            </label>

            {/* Save per-row */}
            {dirty && (
              <button
                onClick={() => {
                  if (closed && !corrective.trim()) {
                    toast.error('Debes ingresar la acción correctiva antes de cerrar el hallazgo');
                    return;
                  }
                  mutation.mutate();
                }}
                disabled={mutation.isPending}
                className="text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
              >
                {mutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Guardar
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Read-only: corrective action + spare parts */
        <div className="space-y-1.5">
          {disc.resolutionNotes && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <span className="font-bold">Acción correctiva:</span> {disc.resolutionNotes}
            </div>
          )}
          {sparePart && (
            <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <span className="font-bold">Repuestos:</span> {sparePart}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Full hallazgos tab inside the edit modal */
function HallazgosTab({
  wo, isLocked,
}: {
  wo: WorkOrder;
  isLocked: boolean;
}) {
  const qc = useQueryClient();
  const [localDiscs, setLocalDiscs] = useState<Discrepancy[]>(wo.discrepancies);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle]       = useState('');
  const [newDesc, setNewDesc]         = useState('');

  const openCount = localDiscs.filter(d => d.status === 'OPEN').length;
  const unactionedCount = localDiscs.filter(d => d.status === 'OPEN' && !d.resolutionNotes?.trim()).length;

  const addMutation = useMutation({
    mutationFn: () => workOrdersApi.createDiscrepancy(wo.id, { title: newTitle.trim(), description: newDesc.trim() }),
    onSuccess: (disc) => {
      setLocalDiscs(prev => [...prev, disc]);
      qc.invalidateQueries({ queryKey: ['work-order', wo.id] });
      setNewTitle('');
      setNewDesc('');
      setShowAddForm(false);
      toast.success(`Hallazgo ${disc.code} registrado`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al registrar';
      toast.error(msg);
    },
  });

  function handleUpdate(updated: Discrepancy) {
    setLocalDiscs(prev => prev.map(d => d.id === updated.id ? updated : d));
    qc.invalidateQueries({ queryKey: ['work-order', wo.id] });
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-slate-600">
          {localDiscs.length} hallazgo{localDiscs.length !== 1 ? 's' : ''}
        </span>
        {openCount > 0 && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {openCount} abierto{openCount > 1 ? 's' : ''}
          </span>
        )}
        {unactionedCount > 0 && (
          <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full flex items-center gap-1">
            <AlertCircle size={10} />
            {unactionedCount} sin acción correctiva
          </span>
        )}
        {!isLocked && (
          <button
            onClick={() => setShowAddForm(s => !s)}
            className="ml-auto text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
          >
            <Plus size={12} />
            {showAddForm ? 'Cancelar' : 'Nuevo hallazgo'}
          </button>
        )}
      </div>

      {/* Blocking warning for CLOSED transition */}
      {unactionedCount > 0 && !isLocked && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs">
          <AlertTriangle size={14} className="text-rose-500 shrink-0 mt-0.5" />
          <p className="text-rose-800">
            <strong>No se puede cerrar la OT.</strong> Hay <strong>{unactionedCount}</strong> hallazgo{unactionedCount > 1 ? 's' : ''} sin acción correctiva confirmada. Completa o cancela cada hallazgo antes de cerrar.
          </p>
        </div>
      )}

      {/* Quick-add form */}
      {showAddForm && (
        <div className="rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-brand-700">Nuevo Hallazgo No Programado</p>
          <div>
            <label className="form-label text-[10px]">Título <span className="text-rose-500">*</span></label>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Ej: Fuga de líquido hidráulico en motor 1"
              className="filter-input w-full text-xs"
            />
          </div>
          <div>
            <label className="form-label text-[10px]">Descripción detallada <span className="text-rose-500">*</span></label>
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              rows={2}
              placeholder="Descripción técnica del hallazgo…"
              className="filter-input w-full resize-none text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddForm(false)} className="btn-secondary text-xs py-1 px-2.5">Cancelar</button>
            <button
              onClick={() => {
                if (!newTitle.trim() || !newDesc.trim()) { toast.error('Título y descripción son requeridos'); return; }
                addMutation.mutate();
              }}
              disabled={addMutation.isPending}
              className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1.5"
            >
              {addMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Registrar
            </button>
          </div>
        </div>
      )}

      {/* Finding list */}
      {localDiscs.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto mb-2 text-slate-300" />
          Sin hallazgos registrados en esta OT
        </div>
      ) : (
        <div className="space-y-2.5">
          {localDiscs.map(d => (
            <FindingRow
              key={d.id}
              disc={d}
              workOrderId={wo.id}
              isLocked={isLocked}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EditWorkOrderModal({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: workOrderStateMachine } = useWorkOrderStateMachine();
  if (!workOrderStateMachine) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 size={16} className="animate-spin" /> Cargando contrato de estado OT...
          </div>
        </div>
      </div>
    );
  }
  const stateMachine = ensureStateMachine(workOrderStateMachine, 'EditWorkOrderModal');
  const user = useAuthStore(s => s.user);
  const isClosed = wo.status === 'CLOSED';
  // QUALITY and CLOSED are read-only in the metadata editor
  const isLocked = isClosed || wo.status === 'QUALITY';
  // Show "Razón del Cambio" when the WO is already in execution
  const needsChangeReason = wo.status === 'IN_PROGRESS';
  const [activeTab, setActiveTab] = useState<'general' | 'hallazgos'>('general');

  const [form, setForm] = useState<EditFormState>({
    title:            wo.title,
    description:      wo.description ?? '',
    plannedStartDate: wo.plannedStartDate ? wo.plannedStartDate.split('T')[0] : '',
    plannedEndDate:   wo.plannedEndDate   ? wo.plannedEndDate.split('T')[0]   : '',
    notes:            wo.notes ?? '',
    changeReason:     '',
  });

  const mutation = useMutation({
    mutationFn: async () => {
      // Embed the change-reason in notes when editing an in-progress WO
      const combinedNotes = needsChangeReason && form.changeReason.trim()
        ? [form.notes.trim(), `[RAZÓN DE CAMBIO: ${form.changeReason.trim()}]`].filter(Boolean).join('\n')
        : form.notes;
      const updates: Partial<CreateWorkOrderInput> = {};
      if (form.title            !== wo.title)                                   updates.title            = form.title;
      if (form.description      !== (wo.description ?? ''))                     updates.description      = form.description || null;
      if (form.plannedStartDate !== (wo.plannedStartDate?.split('T')[0] ?? '')) updates.plannedStartDate = form.plannedStartDate || null;
      if (form.plannedEndDate   !== (wo.plannedEndDate?.split('T')[0] ?? ''))   updates.plannedEndDate   = form.plannedEndDate   || null;
      if (combinedNotes         !== (wo.notes ?? ''))                           updates.notes            = combinedNotes || null;
      if (Object.keys(updates).length > 0) await workOrdersApi.update(wo.id, updates);
    },
    onSuccess: () => {
      toast.success('OT actualizada');
      qc.invalidateQueries({ queryKey: ['work-order', wo.id] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al guardar cambios';
      toast.error(msg);
    },
  });

  const WOStatusIcon = STATUS_ICONS[wo.status];
  const statusClass = getStatusBadgeClass(stateMachine, wo.status);
  const statusLabel = getStatusLabel(stateMachine, wo.status);
  const inputClass = (disabled: boolean) =>
    `filter-input w-full ${disabled ? 'bg-slate-50 text-slate-500 cursor-not-allowed pointer-events-none' : ''}`;

  const openFindingsCount = wo.discrepancies.filter(d => d.status === 'OPEN').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center">
              <ClipboardList size={16} className="text-brand-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isLocked ? 'Ver Orden de Trabajo (Solo lectura)' : 'Editar Orden de Trabajo'}
              </h2>
              <p className="text-xs font-mono text-slate-400">{wo.number}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Read-only banner */}
        {isLocked && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl shrink-0">
            <Lock size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 font-medium leading-relaxed">
              {isClosed
                ? <><strong>Historial técnico protegido.</strong> Esta OT está en estado <em>Cerrada</em> — todos los campos son de solo lectura para preservar la integridad del registro aeronáutico.</>
                : <><strong>En revisión de calidad.</strong> Esta OT se encuentra en fase QC — los datos no son modificables mientras el inspector evalúa la OT.</>}
            </p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-slate-200 px-6 shrink-0 mt-1">
          {([
            { id: 'general',   label: 'Datos generales', count: 0 },
            { id: 'hallazgos', label: 'Hallazgos',        count: openFindingsCount },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-2.5 pt-2 mr-5 text-xs font-bold transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {activeTab === 'general' ? (
            <div className="space-y-4">
              {/* Estado actual (solo lectura — transiciones desde botones de acción) */}
              <div>
                <label className="form-label">Estado actual</label>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${statusClass}`}>
                    <WOStatusIcon size={11} />
                    {statusLabel}
                  </span>
                  <p className="text-[11px] text-slate-400">Los cambios de fase se realizan desde los botones de acción en la página principal.</p>
                </div>
              </div>

              {/* Título */}
              <div>
                <label className="form-label">Título {!isLocked && <span className="text-rose-500">*</span>}</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  readOnly={isLocked}
                  tabIndex={isLocked ? -1 : undefined}
                  className={inputClass(isLocked)}
                />
              </div>

              {/* Descripción */}
              <div>
                <label className="form-label">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  readOnly={isLocked}
                  rows={2}
                  className={`${inputClass(isLocked)} resize-none`}
                />
              </div>

              {/* Fechas planificadas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Inicio planificado</label>
                  <input
                    type="date"
                    value={form.plannedStartDate}
                    onChange={e => setForm(p => ({ ...p, plannedStartDate: e.target.value }))}
                    readOnly={isLocked}
                    tabIndex={isLocked ? -1 : undefined}
                    className={inputClass(isLocked)}
                  />
                </div>
                <div>
                  <label className="form-label">Fin planificado</label>
                  <input
                    type="date"
                    value={form.plannedEndDate}
                    onChange={e => setForm(p => ({ ...p, plannedEndDate: e.target.value }))}
                    readOnly={isLocked}
                    tabIndex={isLocked ? -1 : undefined}
                    className={inputClass(isLocked)}
                  />
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="form-label">Notas</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  readOnly={isLocked}
                  rows={2}
                  className={`${inputClass(isLocked)} resize-none`}
                />
              </div>

              {/* ── Razón del Cambio — solo cuando la OT está EN EJECUCIÓN ── */}
              {needsChangeReason && (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                  <label className="form-label flex items-center gap-1.5 !text-amber-800">
                    <AlertCircle size={12} className="text-amber-600" />
                    Razón del Cambio <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    value={form.changeReason}
                    onChange={e => setForm(p => ({ ...p, changeReason: e.target.value }))}
                    rows={2}
                    className="filter-input w-full resize-none"
                    placeholder="Describe el motivo de esta modificación a la OT en ejecución…"
                  />
                  <p className="text-[11px] text-amber-700 flex items-start gap-1">
                    <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                    Obligatorio: esta OT se encuentra en estado <strong className="mx-0.5">En Ejecución</strong>.
                    El motivo quedará registrado en las notas de auditoría.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <HallazgosTab wo={wo} isLocked={isLocked} />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {isLocked ? 'Cerrar' : 'Cancelar'}
          </button>

          {/* CLOSED → Generar Reporte PDF (immutable record, no save button) */}
          {isClosed && (
            <button
              onClick={() => {
                const html = `<!DOCTYPE html><html><head><title>OT ${wo.number}</title>
<style>body{font-family:sans-serif;margin:2rem;color:#111;font-size:13px}
h1{font-size:1.1rem;margin-bottom:.25rem}p{margin:.15rem 0;color:#555}
table{width:100%;border-collapse:collapse;margin-top:1rem;font-size:12px}
td,th{border:1px solid #d1d5db;padding:.35rem .6rem;text-align:left}
th{background:#f1f5f9;font-weight:700;color:#374151}
.badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;
background:#d1fae5;color:#065f46;font-size:.7rem;font-weight:700;margin-left:.5rem}
</style></head><body>
<h1>Orden de Trabajo — ${wo.number} <span class="badge">HISTÓRICO</span></h1>
<p>Generado: ${new Date().toLocaleString('es-MX')}</p>
<table><tbody>
<tr><th>Título</th><td>${wo.title}</td></tr>
<tr><th>Aeronave</th><td>${wo.aircraft.registration} — ${wo.aircraft.model}</td></tr>
<tr><th>Inspector</th><td>${wo.inspector?.name ?? '—'}</td></tr>
<tr><th>Creado por</th><td>${wo.createdBy.name}</td></tr>
<tr><th>Inicio real</th><td>${wo.actualStartDate ? new Date(wo.actualStartDate).toLocaleDateString('es-MX') : '—'}</td></tr>
<tr><th>Cierre real</th><td>${wo.actualEndDate ? new Date(wo.actualEndDate).toLocaleDateString('es-MX') : '—'}</td></tr>
<tr><th>Tareas completadas</th><td>${wo.tasks.filter((t: WOTask) => t.isCompleted).length} / ${wo.tasks.length}</td></tr>
<tr><th>Discrepancias</th><td>${wo.discrepancies.length} registrada${wo.discrepancies.length !== 1 ? 's' : ''}</td></tr>
<tr><th>Notas</th><td>${wo.notes ?? '—'}</td></tr>
</tbody></table></body></html>`;
                const win = window.open('', '_blank');
                if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300); }
                toast.success('Reporte listo para imprimir / guardar como PDF');
              }}
              className="btn-primary flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 border-slate-700"
            >
              <FileText size={14} />
              Generar Reporte PDF
            </button>
          )}

          {/* Active WO — save with validations */}
          {!isLocked && (
            <button
              onClick={() => {
                if (!form.title.trim()) { toast.error('El título es requerido'); return; }
                if (needsChangeReason && !form.changeReason.trim()) {
                  toast.error('Se requiere una Razón del Cambio para modificar una OT en ejecución');
                  return;
                }
                mutation.mutate();
              }}
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-1.5"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar cambios
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Man-hours localStorage helpers ─────────────────────────────────────────
// Backend doesn't have a man-hours field yet; we persist locally per task.
const MH_KEY = (taskId: string) => `griselle-mh-${taskId}`;

function saveManHours(taskId: string, hours: number) {
  try { localStorage.setItem(MH_KEY(taskId), String(hours)); } catch {}
}
function loadManHours(taskId: string): number | null {
  try {
    const v = localStorage.getItem(MH_KEY(taskId));
    return v !== null ? parseFloat(v) : null;
  } catch { return null; }
}

// ── Spare-parts localStorage helpers (Repuesto Utilizado) ──────────────────────
// Discrepancy model has no spare-parts field — stored locally per finding.
const SP_KEY = (discId: string) => `griselle-spare-${discId}`;

function saveSparePart(discId: string, part: string) {
  try {
    if (part.trim()) localStorage.setItem(SP_KEY(discId), part.trim());
    else localStorage.removeItem(SP_KEY(discId));
  } catch {}
}
function loadSparePart(discId: string): string {
  try { return localStorage.getItem(SP_KEY(discId)) ?? ''; } catch { return ''; }
}

// ── Complete Task Modal ────────────────────────────────────────────────────

function CompleteTaskModal({
  task, workOrderId, onClose,
}: {
  task: WOTask;
  workOrderId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [notes, setNotes] = useState('');
  const [actualHours, setActualHours] = useState<string>('');
  const mutation = useMutation({
    mutationFn: () => workOrdersApi.completeTask(workOrderId, task.id, notes || undefined),
    onSuccess: () => {
      // Persist man-hours locally if entered
      const h = parseFloat(actualHours);
      if (!isNaN(h) && h > 0) saveManHours(task.id, h);
      toast.success('Tarea completada');
      qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al completar tarea';
      toast.error(msg);
    },
  });

  const estimated = task.task.estimatedManHours;
  const actualNum = parseFloat(actualHours);
  const variance = !isNaN(actualNum) && estimated != null ? actualNum - estimated : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">Completar Tarea</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{task.task.code}</p>
            <p className="font-semibold text-slate-800 mt-0.5">{task.task.title}</p>
            {estimated != null && (
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                <Timer size={11} />
                H-H estimadas: <strong>{estimated}h</strong>
              </p>
            )}
          </div>

          {/* Man-hours */}
          <div>
            <label className="form-label flex items-center gap-1.5">
              <Timer size={12} className="text-brand-500" />
              Horas-Hombre reales{estimated != null && <span className="text-slate-400 font-normal">(estimado: {estimated}h)</span>}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.25"
                value={actualHours}
                onChange={e => setActualHours(e.target.value)}
                className="filter-input w-28"
                placeholder="0.00"
              />
              {variance !== null && !isNaN(actualNum) && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  variance > 0 ? 'bg-rose-50 text-rose-700' : variance < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {variance > 0 ? '+' : ''}{variance.toFixed(2)}h vs estimado
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Registra cuánto tiempo tomó {user ? `(Técnico: ${user.name})` : ''} — se usa para calcular costo de mano de obra.
            </p>
          </div>

          <div>
            <label className="form-label">Notas de ejecución</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="filter-input w-full resize-none"
              placeholder="Observaciones, materiales usados…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-1.5"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add Discrepancy Modal ──────────────────────────────────────────────────

function AddDiscrepancyModal({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateDiscrepancyInput>({ title: '', description: '' });
  const [repuesto, setRepuesto] = useState('');

  const mutation = useMutation({
    mutationFn: (input: CreateDiscrepancyInput) => workOrdersApi.createDiscrepancy(workOrderId, input),
    onSuccess: (d) => {
      if (repuesto.trim()) saveSparePart(d.id, repuesto.trim());
      toast.success(`Discrepancia ${d.code} registrada`);
      qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear discrepancia';
      toast.error(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">Agregar Discrepancia</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="form-label">Título <span className="text-rose-500">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              className="filter-input w-full"
              placeholder="Descripción breve del hallazgo"
            />
          </div>
          <div>
            <label className="form-label">Descripción detallada <span className="text-rose-500">*</span></label>
            <textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              className="filter-input w-full resize-none"
              placeholder="Descripción técnica completa…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Ubicación</label>
              <input
                value={form.location ?? ''}
                onChange={e => setForm(p => ({ ...p, location: e.target.value || null }))}
                className="filter-input w-full"
                placeholder="Ej: Ala izquierda"
              />
            </div>
            <div>
              <label className="form-label">Capítulo ATA</label>
              <input
                value={form.ataChapter ?? ''}
                onChange={e => setForm(p => ({ ...p, ataChapter: e.target.value || null }))}
                className="filter-input w-full"
                placeholder="Ej: 27-00"
              />
            </div>
          </div>
          <div>
            <label className="form-label">Repuesto Utilizado</label>
            <input
              value={repuesto}
              onChange={e => setRepuesto(e.target.value)}
              className="filter-input w-full"
              placeholder="Ej: Sello hidráulico P/N 2-043, qty 2 (opcional)"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => {
                if (!form.title.trim() || !form.description.trim()) { toast.error('Título y descripción requeridos'); return; }
                mutation.mutate(form);
              }}
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-1.5"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Registrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Resolve Discrepancy Modal ──────────────────────────────────────────────

function ResolveDiscrepancyModal({ disc, workOrderId, onClose }: { disc: Discrepancy; workOrderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [newStatus, setNewStatus] = useState<DiscrepancyStatus>('RESOLVED');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [deferralRef, setDeferralRef] = useState('');
  const [deferralExpiresAt, setDeferralExpiresAt] = useState('');

  const mutation = useMutation({
    mutationFn: (input: UpdateDiscrepancyInput) => workOrdersApi.updateDiscrepancy(disc.id, input),
    onSuccess: () => {
      toast.success('Discrepancia actualizada');
      qc.invalidateQueries({ queryKey: ['work-order', workOrderId] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al actualizar discrepancia';
      toast.error(msg);
    },
  });

  function handleSubmit() {
    const input: UpdateDiscrepancyInput = { status: newStatus };
    if (newStatus === 'RESOLVED') input.resolutionNotes = resolutionNotes;
    if (newStatus === 'DEFERRED') {
      input.deferralRef = deferralRef;
      input.deferralExpiresAt = deferralExpiresAt || null;
    }
    mutation.mutate(input);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">Actualizar Discrepancia</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-xs font-bold text-slate-400">{disc.code}</p>
            <p className="font-semibold text-slate-800 mt-0.5 text-sm">{disc.title}</p>
          </div>
          <div>
            <label className="form-label">Estado</label>
            <div className="relative">
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value as DiscrepancyStatus)}
                className="filter-input w-full pr-8 appearance-none"
              >
                {(['RESOLVED', 'DEFERRED', 'CANCELLED'] as DiscrepancyStatus[]).map(s => (
                  <option key={s} value={s}>{DISC_LABEL[s]}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>
          {newStatus === 'RESOLVED' && (
            <div>
              <label className="form-label">Notas de resolución <span className="text-rose-500">*</span></label>
              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                rows={3}
                className="filter-input w-full resize-none"
                placeholder="Describir cómo se resolvió la discrepancia…"
              />
            </div>
          )}
          {newStatus === 'DEFERRED' && (
            <>
              <div>
                <label className="form-label">Referencia de diferimiento <span className="text-rose-500">*</span></label>
                <input
                  value={deferralRef}
                  onChange={e => setDeferralRef(e.target.value)}
                  className="filter-input w-full"
                  placeholder="Ej: DDG-2024-001"
                />
              </div>
              <div>
                <label className="form-label">Expira</label>
                <input
                  type="date"
                  value={deferralExpiresAt}
                  onChange={e => setDeferralExpiresAt(e.target.value)}
                  className="filter-input w-full"
                />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-1.5"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Task Checklist ─────────────────────────────────────────────────────────

function TaskChecklist({ wo }: { wo: WorkOrder }) {
  const [completing, setCompleting] = useState<WOTask | null>(null);
  const isActive = wo.status === 'OPEN' || wo.status === 'IN_PROGRESS';
  const completed = wo.tasks.filter(t => t.isCompleted).length;

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} className="text-brand-600" />
          <h3 className="text-sm font-bold text-slate-800">Tareas</h3>
          <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${completed === wo.tasks.length && wo.tasks.length > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {completed}/{wo.tasks.length}
          </span>
        </div>
      </div>
      {wo.tasks.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Sin tareas asignadas</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {wo.tasks.map(t => (
            <li key={t.id} className={`flex items-start gap-3 px-5 py-3 transition-colors ${t.isCompleted ? 'bg-emerald-50/30' : 'hover:bg-slate-50'}`}>
              <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${t.isCompleted ? 'bg-emerald-500' : 'border-2 border-slate-300'}`}>
                {t.isCompleted && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{t.task.code}</span>
                  {t.task.isMandatory && (
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded ring-1 ring-inset ring-rose-600/20">OBLIGATORIA</span>
                  )}
                  {t.task.requiresInspection && (
                    <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded ring-1 ring-inset ring-purple-600/20">INSP.</span>
                  )}
                </div>
                <p className={`text-sm font-medium mt-0.5 ${t.isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.task.title}</p>
                {t.isCompleted && t.completedBy && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Completada por {t.completedBy.name} · {fmt(t.completedAt)}
                    {t.notes && ` · ${t.notes}`}
                  </p>
                )}
              </div>
              {isActive && !t.isCompleted && (
                <button
                  onClick={() => setCompleting(t)}
                  className="shrink-0 text-xs font-semibold text-brand-600 hover:text-brand-700 border border-brand-200 hover:border-brand-400 px-2 py-1 rounded-lg transition-colors"
                >
                  Completar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Man-Hours Summary ─────────────────────────────────── */}
      {wo.tasks.length > 0 && (() => {
        const estimatedTotal = wo.tasks.reduce((s, t) => s + (t.task.estimatedManHours ?? 0), 0);
        const actualTotal = wo.tasks.reduce((s, t) => {
          const h = loadManHours(t.id);
          return s + (h ?? 0);
        }, 0);
        const recordedCount = wo.tasks.filter(t => loadManHours(t.id) !== null).length;
        const RATE = 85; // USD/h placeholder
        const variance = actualTotal > 0 ? actualTotal - estimatedTotal : null;
        return (
          <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
            <div className="flex items-center gap-2 mb-2">
              <Timer size={13} className="text-brand-500" />
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Resumen Horas-Hombre</span>
              {recordedCount === 0 && (
                <span className="text-[11px] text-slate-400">(sin registros — completá tareas para ver datos)</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-400 font-medium">H-H Estimadas</p>
                <p className="text-lg font-bold text-slate-700 tabular-nums">{estimatedTotal > 0 ? `${estimatedTotal.toFixed(1)}h` : '—'}</p>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-400 font-medium">H-H Reales</p>
                <p className={`text-lg font-bold tabular-nums ${actualTotal > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                  {actualTotal > 0 ? `${actualTotal.toFixed(1)}h` : '—'}
                </p>
                {variance !== null && (
                  <p className={`text-[11px] font-semibold ${variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {variance > 0 ? '+' : ''}{variance.toFixed(1)}h
                  </p>
                )}
              </div>
              <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[11px] text-slate-400 font-medium">Costo M.O.</p>
                <p className={`text-lg font-bold tabular-nums ${actualTotal > 0 ? 'text-brand-700' : 'text-slate-300'}`}>
                  {actualTotal > 0 ? `$${(actualTotal * RATE).toFixed(0)}` : '—'}
                </p>
                {actualTotal > 0 && (
                  <p className="text-[11px] text-slate-400">${RATE}/h · {recordedCount}/{wo.tasks.length} tareas</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {completing && (
        <CompleteTaskModal task={completing} workOrderId={wo.id} onClose={() => setCompleting(null)} />
      )}
    </section>
  );
}

// ── Discrepancies Panel ────────────────────────────────────────────────────

function DiscrepanciesPanel({ wo }: { wo: WorkOrder }) {
  const [showAdd, setShowAdd] = useState(false);
  const [resolving, setResolving] = useState<Discrepancy | null>(null);
  const canAdd = wo.status !== 'CLOSED';

  const openDiscs      = wo.discrepancies.filter(d => d.status === 'OPEN').length;
  const unactionedDiscs = wo.discrepancies.filter(d => d.status === 'OPEN' && !d.resolutionNotes?.trim()).length;
  // Block advancing to QUALITY (from IN_PROGRESS) or CLOSED (from QUALITY) when unactioned findings exist
  const showBlocker = canAdd && unactionedDiscs > 0;

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle size={15} className="text-rose-500" />
          <h3 className="text-sm font-bold text-slate-800">Hallazgos y Discrepancias</h3>
          {wo.discrepancies.length > 0 && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ring-1 ring-inset ${
              openDiscs > 0 ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
            }`}>
              {openDiscs} pend. / {wo.discrepancies.length} total
            </span>
          )}
        </div>
        {canAdd && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors">
            <Plus size={13} /> Agregar
          </button>
        )}
      </div>

      {/* Blocking banner — shown when findings need corrective action before advancing */}
      {showBlocker && (
        <div className="mx-5 mt-3 flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs">
          <AlertTriangle size={14} className="text-rose-500 shrink-0 mt-0.5" />
          <p className="text-rose-800">
            <strong>{unactionedDiscs} hallazgo{unactionedDiscs > 1 ? 's' : ''} sin acción correctiva</strong> —
            la OT no puede avanzar a <strong>Calidad</strong> ni cerrarse hasta que todos los hallazgos estén resueltos.
          </p>
        </div>
      )}

      {wo.discrepancies.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Sin discrepancias registradas</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {wo.discrepancies.map(d => (
            <li key={d.id} className="px-5 py-3.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{d.code}</span>
                  <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${DISC_COLORS[d.status]}`}>{DISC_LABEL[d.status]}</span>
                  {d.ataChapter && <span className="text-[11px] text-slate-400">ATA {d.ataChapter}</span>}
                </div>
                <p className="text-sm font-semibold text-slate-800 mt-1">{d.title}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{d.description}</p>
                {d.location && <p className="text-xs text-slate-400 mt-0.5">Ubicación: {d.location}</p>}
                {d.resolutionNotes && <p className="text-xs text-emerald-700 mt-0.5">Resolución: {d.resolutionNotes}</p>}
                {d.deferralRef && <p className="text-xs text-amber-700 mt-0.5">Ref. diferimiento: {d.deferralRef}{d.deferralExpiresAt ? ` · vence ${fmt(d.deferralExpiresAt)}` : ''}</p>}
              </div>
              {d.status === 'OPEN' && canAdd && (
                <button
                  onClick={() => setResolving(d)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-400 px-2 py-1 rounded-lg transition-colors shrink-0"
                >
                  Actualizar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {showAdd && <AddDiscrepancyModal workOrderId={wo.id} onClose={() => setShowAdd(false)} />}
      {resolving && <ResolveDiscrepancyModal disc={resolving} workOrderId={wo.id} onClose={() => setResolving(null)} />}
    </section>
  );
}

// ── Audit Log Timeline ─────────────────────────────────────────────────────

// ── Audit Log helpers ──────────────────────────────────────────────────────

// Maps raw action codes to human-readable Spanish labels + visual config
const AUDIT_ACTION_CONFIG: Record<string, {
  label: (entry: AuditLogEntry) => string;
  detail: (entry: AuditLogEntry) => string | null;
  icon: React.ElementType;
  dotColor: string;
  badgeColor: string;
}> = {
  CREATED: {
    label:      () => 'OT creada',
    detail:     (e) => e.newValue ? `Nro. ${(e.newValue as { number?: string }).number ?? ''} · Estado inicial: Borrador` : null,
    icon:       ClipboardList,
    dotColor:   'bg-brand-500',
    badgeColor: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  },
  STATUS_CHANGED: {
    label: () => 'Fase cambiada',
    detail: (e) => {
      const meta = e.metadata as { transition?: string } | null;
      return meta?.transition ?? null;
    },
    icon:       GitBranch,
    dotColor:   'bg-amber-500',
    badgeColor: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  },
  UPDATED: {
    label:  () => 'Campos editados',
    detail: (e) => {
      if (!e.previousValue && !e.newValue) return null;
      const prev = e.previousValue as Record<string, unknown> | null;
      const next = e.newValue     as Record<string, unknown> | null;
      const parts: string[] = [];
      const FIELD_LABEL: Record<string, string> = {
        title: 'Título', description: 'Descripción', notes: 'Notas',
        plannedStartDate: 'Inicio plan.', plannedEndDate: 'Fin plan.',
        aircraftHoursAtOpen: 'H. aeronave (apertura)', aircraftHoursAtClose: 'H. aeronave (cierre)',
      };
      const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
      keys.forEach(k => {
        if (k === 'status') return; // shown separately by STATUS_CHANGED
        const lbl = FIELD_LABEL[k] ?? k;
        const before = prev?.[k] ?? '—';
        const after  = next?.[k] ?? '—';
        if (String(before) !== String(after)) parts.push(`${lbl}: "${before}" → "${after}"`);
      });
      return parts.length ? parts.join(' · ') : null;
    },
    icon:       Edit3,
    dotColor:   'bg-slate-400',
    badgeColor: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  },
  TASK_COMPLETED: {
    label:  (e) => {
      const v = e.newValue as { taskCode?: string } | null;
      return `Tarea completada${v?.taskCode ? `: ${v.taskCode}` : ''}`;
    },
    detail: () => null,
    icon:   ListChecks,
    dotColor:   'bg-emerald-500',
    badgeColor: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  },
  DISCREPANCY_CREATED: {
    label:  (e) => {
      const v = e.newValue as { code?: string; title?: string } | null;
      return `Hallazgo registrado${v?.code ? ` ${v.code}` : ''}`;
    },
    detail: (e) => {
      const v = e.newValue as { title?: string } | null;
      return v?.title ?? null;
    },
    icon:       AlertOctagon,
    dotColor:   'bg-rose-500',
    badgeColor: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  },
  DISCREPANCY_STATUS_CHANGED: {
    label: (e) => {
      const prev = (e.previousValue as { status?: string } | null)?.status;
      const next = (e.newValue     as { status?: string } | null)?.status;
      const DLABEL: Record<string, string> = {
        OPEN: 'Abierto', RESOLVED: 'Resuelto', DEFERRED: 'Diferido', CANCELLED: 'Cancelado',
      };
      return `Hallazgo: ${DLABEL[prev ?? ''] ?? prev ?? '?'} → ${DLABEL[next ?? ''] ?? next ?? '?'}`;
    },
    detail: () => null,
    icon:       RefreshCw,
    dotColor:   'bg-purple-500',
    badgeColor: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  },
};

const ROLE_BADGE: Record<string, string> = {
  ADMIN:      'bg-rose-50   text-rose-700',
  INSPECTOR:  'bg-purple-50 text-purple-700',
  TECHNICIAN: 'bg-blue-50   text-blue-700',
  SUPERVISOR: 'bg-amber-50  text-amber-700',
};

function AuditLogTimeline({ workOrderId }: { workOrderId: string }) {
  const { data: workOrderStateMachine } = useWorkOrderStateMachine();
  if (!workOrderStateMachine) {
    return (
      <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden p-5">
        <p className="text-sm text-slate-400 text-center py-4">
          <Loader2 size={16} className="inline animate-spin mr-1" />Cargando contrato de estado OT…
        </p>
      </section>
    );
  }
  const stateMachine = ensureStateMachine(workOrderStateMachine, 'AuditLogTimeline');
  const { data: log = [], isLoading } = useQuery({
    queryKey: ['audit-log', workOrderId],
    queryFn:  () => workOrdersApi.getAuditLog(workOrderId),
    refetchInterval: 30_000, // auto-refresh every 30 s while page is open
  });

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-900">
        <div className="w-7 h-7 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
          <Shield size={14} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white">Bitácora de Trazabilidad Oficial</h3>
          <p className="text-[11px] text-slate-400">Registro inmutable · Cumplimiento DGAC</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>{log.length} eventos</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 px-5 py-2.5 border-b border-slate-100 bg-slate-50/70">
        {[
          { dot: 'bg-brand-500',   label: 'Creación' },
          { dot: 'bg-amber-500',   label: 'Transición de fase' },
          { dot: 'bg-slate-400',   label: 'Edición de campos' },
          { dot: 'bg-emerald-500', label: 'Tarea completada' },
          { dot: 'bg-rose-500',    label: 'Hallazgo' },
          { dot: 'bg-purple-500',  label: 'Estado hallazgo' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
            <span className={`inline-block w-2 h-2 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>

      {/* Body */}
      {isLoading && (
        <p className="text-sm text-slate-400 text-center py-10">
          <Loader2 size={16} className="inline animate-spin mr-1" />Cargando bitácora…
        </p>
      )}
      {!isLoading && log.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-10">Sin eventos registrados</p>
      )}
      {!isLoading && log.length > 0 && (
        <ol className="px-5 py-4 space-y-0">
          {log.map((entry: AuditLogEntry, i) => {
            const statusChangedLabel = (() => {
              if (entry.action !== 'STATUS_CHANGED') return null;
              const prev = (entry.previousValue as { status?: WorkOrderStatus } | null)?.status;
              const next = (entry.newValue as { status?: WorkOrderStatus } | null)?.status;
              const prevLabel = prev ? getStatusLabel(stateMachine, prev) : '?';
              const nextLabel = next ? getStatusLabel(stateMachine, next) : '?';
              return `Fase cambiada: ${prevLabel} → ${nextLabel}`;
            })();
            const cfg = AUDIT_ACTION_CONFIG[entry.action] ?? {
              label:      () => entry.action,
              detail:     () => null,
              icon:       Eye,
              dotColor:   'bg-slate-300',
              badgeColor: 'bg-slate-100 text-slate-600 ring-slate-500/20',
            };
            const Icon   = cfg.icon;
            const label  = statusChangedLabel ?? cfg.label(entry);
            const detail = cfg.detail(entry);
            const isLast = i === log.length - 1;

            return (
              <li key={entry.id} className="flex gap-0">
                {/* Timeline axis */}
                <div className="flex flex-col items-center w-8 shrink-0">
                  <div className={`w-3 h-3 rounded-full shrink-0 mt-3.5 ring-2 ring-white ${cfg.dotColor}`} />
                  {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
                </div>

                {/* Card */}
                <div className={`flex-1 ml-2 pb-5 ${isLast ? '' : ''}`}>
                  <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
                    {/* Top row: icon + label + timestamp */}
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 ring-inset shrink-0 ${cfg.badgeColor}`}>
                        <Icon size={10} />
                        {label}
                      </span>
                      <span className="ml-auto text-[11px] text-slate-400 font-mono shrink-0 whitespace-nowrap">
                        {fmtTime(entry.createdAt)}
                      </span>
                    </div>

                    {/* Who */}
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                        <User size={10} className="text-slate-500" />
                      </div>
                      <span className="text-xs font-semibold text-slate-700 truncate">{entry.userEmail}</span>
                      {entry.userRole && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${ROLE_BADGE[entry.userRole] ?? 'bg-slate-100 text-slate-600'}`}>
                          {entry.userRole}
                        </span>
                      )}
                    </div>

                    {/* Detail diff block */}
                    {detail && (
                      <div className="mt-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-[11px] text-slate-600 font-mono leading-relaxed break-all">{detail}</p>
                      </div>
                    )}

                    {/* Raw metadata for unknown actions */}
                    {!AUDIT_ACTION_CONFIG[entry.action] && entry.newValue && (
                      <div className="mt-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-[11px] text-slate-400 font-mono break-all">
                          {JSON.stringify(entry.newValue).slice(0, 160)}
                          {JSON.stringify(entry.newValue).length > 160 ? '…' : ''}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ── Close Stamp Modal ─────────────────────────────────────────────────────
// Inspector must enter their license number to authorize return to service.

function CloseStampModal({
  wo,
  onConfirm,
  onClose,
  isPending,
}: {
  wo: WorkOrder;
  onConfirm: (licenseNumber: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const user = useAuthStore(s => s.user);
  const [license, setLicense] = useState('');
  const isValid = license.trim().length >= 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-slate-900 rounded-t-2xl">
          <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
            <Stamp size={16} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Sello Digital de Cierre</h2>
            <p className="text-xs text-slate-400">{wo.number} · Retorno al Servicio</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Regulatory notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Acción regulatoria.</strong> Al firmar digitalmente autorizas el retorno al servicio de la aeronave
              &nbsp;<strong>{wo.aircraft.registration}</strong>. Este registro queda vinculado a tu número de licencia
              técnica en el historial aeronáutico de la OT.
            </p>
          </div>

          {/* Inspector info */}
          {user && (
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Inspector que cierra</p>
              <p className="text-sm font-semibold text-slate-800">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email} · {user.role}</p>
            </div>
          )}

          {/* License input */}
          <div>
            <label className="form-label">
              N° de Licencia Técnica <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={license}
              onChange={e => setLicense(e.target.value.toUpperCase())}
              placeholder="Ej: AMT-2024-0042"
              className="filter-input w-full font-mono text-sm tracking-wide"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && isValid) onConfirm(license.trim()); }}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Ingresa tu número de licencia AMT, IA o equivalente emitido por la autoridad de aviación civil.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={isPending}>
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(license.trim())}
              disabled={!isValid || isPending}
              className="btn-primary flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 border-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <Stamp size={14} />}
              Firmar y Cerrar OT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Detail Page ───────────────────────────────────────────────────────

// ── Assignment Workflow Panel ─────────────────────────────────────────────

const ASSIGNMENT_STATUS_LABELS: Record<WorkOrderAssignmentStatus, string> = {
  PENDING:          'Pendiente de asignación',
  ASSIGNED:         'Asignado',
  IN_PROGRESS:      'En ejecución',
  AWAITING_EVIDENCE:'Requiere evidencia',
  EVIDENCE_UPLOADED:'Evidencia recibida',
  CLOSED:           'Cerrada',
};

const ASSIGNMENT_STATUS_COLORS: Record<WorkOrderAssignmentStatus, string> = {
  PENDING:          'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  ASSIGNED:         'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20',
  IN_PROGRESS:      'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20',
  AWAITING_EVIDENCE:'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20',
  EVIDENCE_UPLOADED:'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  CLOSED:           'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20',
};

interface AssignmentWorkflowPanelProps {
  workOrder: WorkOrder;
  onAssignClick: () => void;
  onStartExecution: () => void;
  onClose: () => void;
  onEmailPdf: (email: string) => void;
  isStartingExecution: boolean;
  isClosing: boolean;
  isSendingEmail: boolean;
  currentUserId?: string;
  canAssign: boolean;
  showEmailInput: boolean;
  setShowEmailInput: (v: boolean) => void;
  emailTarget: string;
  setEmailTarget: (v: string) => void;
}

function AssignmentWorkflowPanel({
  workOrder: wo,
  onAssignClick,
  onStartExecution,
  onClose,
  onEmailPdf,
  isStartingExecution,
  isClosing,
  isSendingEmail,
  currentUserId,
  canAssign,
  showEmailInput,
  setShowEmailInput,
  emailTarget,
  setEmailTarget,
}: AssignmentWorkflowPanelProps) {
  const qc = useQueryClient();
  const assignmentStatus: WorkOrderAssignmentStatus = wo.assignmentStatus ?? 'PENDING';
  const isAssignedToMe = wo.assignedTechnicianId === currentUserId;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCheck size={16} className="text-slate-500" />
          <h3 className="font-semibold text-slate-800 text-sm">Flujo de Asignación</h3>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${ASSIGNMENT_STATUS_COLORS[assignmentStatus]}`}>
          {ASSIGNMENT_STATUS_LABELS[assignmentStatus]}
        </span>
      </div>

      {/* Assignment workflow steps */}
      <div className="flex items-center gap-1.5 text-xs overflow-x-auto">
        {(['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_EVIDENCE', 'EVIDENCE_UPLOADED', 'CLOSED'] as WorkOrderAssignmentStatus[]).map((step, i, arr) => {
          const steps = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_EVIDENCE', 'EVIDENCE_UPLOADED', 'CLOSED'];
          const currentIdx = steps.indexOf(assignmentStatus);
          const stepIdx = steps.indexOf(step);
          const done = stepIdx < currentIdx;
          const active = stepIdx === currentIdx;
          const labels = ['Pendiente', 'Asignado', 'En ejecución', 'Esp. evidencia', 'Evidencia OK', 'Cerrada'];
          return (
            <div key={step} className="flex items-center gap-1.5 shrink-0">
              <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold transition-colors ${
                active ? 'bg-blue-600 text-white' :
                done   ? 'bg-emerald-100 text-emerald-700' :
                         'bg-slate-100 text-slate-400'
              }`}>
                {done ? <Check size={9} strokeWidth={3} /> : null}
                {labels[stepIdx]}
              </div>
              {i < arr.length - 1 && <div className={`h-px w-3 flex-shrink-0 ${stepIdx < currentIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* PDF Download button */}
        <a
          href={`/api/v1/work-orders/${wo.id}/download-pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
        >
          <Download size={12} />
          Descargar PDF
        </a>

        {/* Email PDF button */}
        {!showEmailInput ? (
          <button
            onClick={() => setShowEmailInput(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <Mail size={12} />
            Enviar PDF por email
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              type="email"
              value={emailTarget}
              onChange={(e) => setEmailTarget(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              disabled={!emailTarget.includes('@') || isSendingEmail}
              onClick={() => onEmailPdf(emailTarget)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSendingEmail ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />}
              Enviar
            </button>
            <button onClick={() => { setShowEmailInput(false); setEmailTarget(''); }} className="p-1.5 text-slate-400 hover:text-slate-600">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Assign button — only for SUPERVISOR/ADMIN and when PENDING */}
        {assignmentStatus === 'PENDING' && canAssign && (
          <button
            onClick={onAssignClick}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <UserCheck size={12} />
            Asignar Técnico
          </button>
        )}

        {/* Start execution — only for assigned technician */}
        {assignmentStatus === 'ASSIGNED' && isAssignedToMe && (
          <button
            onClick={onStartExecution}
            disabled={isStartingExecution}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {isStartingExecution ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
            Iniciar Ejecución
          </button>
        )}

        {/* Close button — only when evidence uploaded */}
        {assignmentStatus === 'EVIDENCE_UPLOADED' && canAssign && (
          <button
            onClick={onClose}
            disabled={isClosing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {isClosing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Cerrar OT
          </button>
        )}
      </div>

      {/* Evidence section */}
      {(assignmentStatus === 'IN_PROGRESS' || assignmentStatus === 'AWAITING_EVIDENCE') && isAssignedToMe && (
        <div className="border-t border-slate-100 pt-4">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Evidencia del Trabajo</h4>
          <EvidenceUpload
            workOrderId={wo.id}
            onUploaded={() => qc.invalidateQueries({ queryKey: ['work-order', wo.id] })}
          />
        </div>
      )}

      {/* Show evidence viewer when already uploaded */}
      {wo.evidenceFileUrl && (
        <div className="border-t border-slate-100 pt-4">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Evidencia del Trabajo</h4>
          <EvidenceViewer
            evidenceUrl={wo.evidenceFileUrl}
            evidenceFileName={wo.evidenceFileName}
            evidenceUploadedAt={wo.evidenceUploadedAt}
            evidenceType={wo.evidenceType}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [showEdit, setShowEdit] = useState(false);
  const [showStamp, setShowStamp] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [emailTarget, setEmailTarget] = useState('');

  const closeMutation = useMutation({
    mutationFn: () => workOrdersApi.closeWorkOrder(id!),
    onSuccess: () => {
      toast.success('Orden de Trabajo cerrada exitosamente');
      qc.invalidateQueries({ queryKey: ['work-order', id] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'No se pudo cerrar la OT');
    },
  });

  const startExecutionMutation = useMutation({
    mutationFn: () => workOrdersApi.startExecution(id!),
    onSuccess: () => {
      toast.success('Ejecución iniciada');
      qc.invalidateQueries({ queryKey: ['work-order', id] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Error al iniciar ejecución');
    },
  });

  const emailPdfMutation = useMutation({
    mutationFn: (email: string) => workOrdersApi.emailPdf(id!, email),
    onSuccess: () => {
      toast.success('PDF enviado por correo');
      setShowEmailInput(false);
      setEmailTarget('');
    },
    onError: () => {
      toast.error('Error al enviar PDF por correo');
    },
  });

  const { data: wo, isLoading, isError } = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => workOrdersApi.getById(id!),
    enabled: !!id,
  });

  const { data: workOrderStateMachine } = useWorkOrderStateMachine();

  const transitionMutation = useMutation({
    mutationFn: (status: WorkOrderStatus) => workOrdersApi.transition(id!, status),
    onSuccess: (updated) => {
      if (!workOrderStateMachine) {
        toast.error('Contrato de estado OT no disponible');
        return;
      }
      const machine = ensureStateMachine(workOrderStateMachine, 'WorkOrderDetailPage.transitionMutation');
      const label = getStatusLabel(machine, updated.status);
      toast.success(`OT ${label}`);
      qc.invalidateQueries({ queryKey: ['work-order', id] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      setShowStamp(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'No se pudo cambiar el estado';
      toast.error(msg);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 size={22} className="animate-spin mr-2" />
        Cargando OT…
      </div>
    );
  }

  if (isError || !wo) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertTriangle size={28} className="text-rose-400" />
        <p className="text-slate-600 font-medium">
          {isError ? 'Error al cargar la orden de trabajo' : 'No se encontró la orden de trabajo'}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => qc.refetchQueries({ queryKey: ['work-order', id] })}
            className="flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors"
          >
            <RefreshCw size={12} />
            Reintentar
          </button>
          <Link to="/work-orders" className="text-brand-600 text-sm font-semibold hover:underline">← Volver al listado</Link>
        </div>
      </div>
    );
  }

  if (!workOrderStateMachine) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 size={22} className="animate-spin mr-2" />
        Cargando contrato de estado OT…
      </div>
    );
  }

  const stateMachine = ensureStateMachine(workOrderStateMachine, 'WorkOrderDetailPage');

  const nextSteps = stateMachine.transitions[wo.status] ?? [];
  const lifecycleStatuses = getOrderedStatuses(stateMachine);
  const currentStatusClass = getStatusBadgeClass(stateMachine, wo.status);
  const StatusIcon = STATUS_ICONS[wo.status];
  const completedTasks = wo.tasks.filter(t => t.isCompleted).length;
  const openDisc = wo.discrepancies.filter(d => d.status === 'OPEN').length;
  const currentStatus = wo.status;

  // Determine available next transition buttons
  function getTransitionLabel(target: WorkOrderStatus): string {
    if (currentStatus === 'DRAFT'       && target === 'OPEN')         return 'Emitir Orden de Trabajo';
    if (currentStatus === 'OPEN'        && target === 'IN_PROGRESS')  return 'Iniciar Trabajo';
    if (currentStatus === 'OPEN'        && target === 'DRAFT')        return 'Revertir a Borrador';
    if (currentStatus === 'IN_PROGRESS' && target === 'QUALITY')      return 'Solicitar Inspección QC';
    if (currentStatus === 'IN_PROGRESS' && target === 'OPEN')         return 'Pausar — Volver a Abierta';
    if (currentStatus === 'QUALITY'     && target === 'CLOSED')       return 'Aprobar y Cerrar OT';
    if (currentStatus === 'QUALITY'     && target === 'IN_PROGRESS')  return 'Rechazar — Regresar a Ejecución';
    return getStatusLabel(stateMachine, target);
  }

  return (
    <div className="p-8 space-y-6">
      {/* Breadcrumb + actions row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/work-orders" className="text-slate-500 hover:text-brand-600 flex items-center gap-1 transition-colors">
            <ArrowLeft size={14} />
            Órdenes de Trabajo
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-800">{wo.number}</span>
        </div>
        <button
          onClick={() => setShowEdit(true)}
          className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
            ['QUALITY', 'CLOSED'].includes(wo.status)
              ? 'border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
              : 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200'
          }`}
        >
          {['QUALITY', 'CLOSED'].includes(wo.status) ? <Lock size={12} /> : <Pencil size={12} />}
          {wo.status === 'CLOSED' ? 'Ver detalles (Solo lectura)' : wo.status === 'QUALITY' ? 'Ver OT (en Calidad)' : 'Editar OT'}
        </button>
      </div>

      {/* Lifecycle stepper */}
      <LifecycleStepper current={wo.status} statuses={lifecycleStatuses} />

      {/* Assignment Workflow Panel */}
      {wo.status !== 'DRAFT' && (
        <AssignmentWorkflowPanel
          workOrder={wo}
          onAssignClick={() => setShowAssignModal(true)}
          onStartExecution={() => startExecutionMutation.mutate()}
          onClose={() => closeMutation.mutate()}
          onEmailPdf={(email) => emailPdfMutation.mutate(email)}
          isStartingExecution={startExecutionMutation.isPending}
          isClosing={closeMutation.isPending}
          isSendingEmail={emailPdfMutation.isPending}
          currentUserId={user?.id}
          canAssign={user?.role === 'ADMIN' || user?.role === 'SUPERVISOR'}
          showEmailInput={showEmailInput}
          setShowEmailInput={setShowEmailInput}
          emailTarget={emailTarget}
          setEmailTarget={setEmailTarget}
        />
      )}

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Left info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="font-mono font-bold text-slate-500 text-sm">{wo.number}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${currentStatusClass}`}>
                <StatusIcon size={11} />
                {getStatusLabel(stateMachine, wo.status)}
              </span>
              {wo.status === 'CLOSED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                  <Lock size={9} />
                  Solo lectura
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">{wo.title}</h1>
            {wo.description && <p className="text-sm text-slate-500 mt-1">{wo.description}</p>}

            {/* Meta grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mt-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aeronave</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Plane size={12} className="text-slate-400" />
                  <span className="font-mono font-bold text-slate-800 text-sm">{wo.aircraft.registration}</span>
                </div>
                <p className="text-xs text-slate-400">{wo.aircraft.model}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Creado por</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <User size={12} className="text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">{wo.createdBy.name}</span>
                </div>
              </div>
              {wo.assignedTechnician && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Técnico</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <User size={12} className="text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">{wo.assignedTechnician.name}</span>
                  </div>
                </div>
              )}
              {wo.inspector && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Inspector</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <ShieldCheck size={12} className="text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">{wo.inspector.name}</span>
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Inicio plan.</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{fmt(wo.plannedStartDate)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fin plan.</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{fmt(wo.plannedEndDate)}</p>
              </div>
              {wo.actualStartDate && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Inicio real</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">{fmt(wo.actualStartDate)}</p>
                </div>
              )}
              {wo.actualEndDate && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cierre real</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">{fmt(wo.actualEndDate)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: stats + actions */}
          <div className="flex flex-col items-end gap-3 shrink-0">
            {/* Mini stats */}
            <div className="flex gap-3">
              <div className="text-center px-3 py-2 bg-slate-50 rounded-xl">
                <p className={`text-xl font-bold tabular-nums ${completedTasks === wo.tasks.length && wo.tasks.length > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                  {completedTasks}/{wo.tasks.length}
                </p>
                <p className="text-[10px] text-slate-400 font-medium">Tareas</p>
              </div>
              <div className="text-center px-3 py-2 bg-slate-50 rounded-xl">
                <p className={`text-xl font-bold tabular-nums ${openDisc > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                  {openDisc}/{wo.discrepancies.length}
                </p>
                <p className="text-[10px] text-slate-400 font-medium leading-tight">Hallazgos<br />pend./total</p>
              </div>
            </div>

            {/* Transition buttons */}
            {nextSteps.length > 0 && (
              <div className="flex flex-col gap-1.5 w-full max-w-[180px]">
                {nextSteps.map(target => {
                  const openUnactioned = wo.discrepancies.filter(
                    d => d.status === 'OPEN' && !d.resolutionNotes?.trim()
                  ).length;
                  const blockedClose   = target === 'CLOSED'  && openUnactioned > 0;
                  const blockedQuality = target === 'QUALITY' && openUnactioned > 0;
                  const isBlocked      = blockedClose || blockedQuality;
                  return (
                    <button
                      key={target}
                      onClick={() => {
                        if (isBlocked) {
                          const dest = target === 'QUALITY' ? 'enviar a Calidad' : 'cerrar la OT';
                          toast.error(
                            `${openUnactioned} hallazgo${openUnactioned > 1 ? 's' : ''} sin acción correctiva. Resuélvelos antes de ${dest}.`
                          );
                          setShowEdit(true);
                          return;
                        }
                        // CLOSED requires digital stamp
                        if (target === 'CLOSED') {
                          setShowStamp(true);
                          return;
                        }
                        // REJECT (QUALITY → IN_PROGRESS) requires confirmation
                        if (currentStatus === 'QUALITY' && target === 'IN_PROGRESS') {
                          setShowRejectConfirm(true);
                          return;
                        }
                        transitionMutation.mutate(target);
                      }}
                      disabled={transitionMutation.isPending || isBlocked}
                      title={isBlocked ? `${openUnactioned} hallazgo(s) requieren acción correctiva` : undefined}
                      className={`w-full text-xs font-bold px-3 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                        isBlocked
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          : target === 'CLOSED'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : (currentStatus === 'QUALITY' && target === 'IN_PROGRESS')
                          ? 'bg-rose-600 hover:bg-rose-700 text-white'
                          : (target === 'DRAFT' || (currentStatus === 'IN_PROGRESS' && target === 'OPEN'))
                          ? 'border border-slate-300 hover:border-slate-400 text-slate-600 hover:text-slate-800'
                          : 'bg-brand-600 hover:bg-brand-700 text-white'
                      }`}
                    >
                      {transitionMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                      {isBlocked && <AlertTriangle size={12} className="shrink-0" />}
                      {getTransitionLabel(target)}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Document button */}
            {wo.status === 'CLOSED' && (
              <button
                onClick={async () => {
                  const doc = await workOrdersApi.getDocument(wo.id);
                  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement('a');
                  a.href     = url;
                  a.download = `OT-${wo.number}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success('Documento generado');
                }}
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 px-3 py-2 rounded-lg transition-colors w-full max-w-[180px] justify-center"
              >
                <Download size={12} />
                Generar Documento
              </button>
            )}
          </div>
        </div>

        {/* Hours snapshot */}
        {(wo.aircraftHoursAtOpen != null || wo.aircraftHoursAtClose != null) && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex gap-6 text-xs text-slate-500">
            {wo.aircraftHoursAtOpen != null && (
              <span>Horas al abrir: <strong className="text-slate-700">{Number(wo.aircraftHoursAtOpen).toFixed(1)} h</strong></span>
            )}
            {wo.aircraftCyclesAtOpen != null && (
              <span>Ciclos al abrir: <strong className="text-slate-700">{wo.aircraftCyclesAtOpen}</strong></span>
            )}
            {wo.aircraftHoursAtClose != null && (
              <span>Horas al cerrar: <strong className="text-slate-700">{Number(wo.aircraftHoursAtClose).toFixed(1)} h</strong></span>
            )}
            {wo.aircraftCyclesAtClose != null && (
              <span>Ciclos al cerrar: <strong className="text-slate-700">{wo.aircraftCyclesAtClose}</strong></span>
            )}
          </div>
        )}
      </div>

      {/* Two-column layout for tasks + discrepancies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TaskChecklist wo={wo} />
        <DiscrepanciesPanel wo={wo} />
      </div>

      {/* Audit log */}
      <AuditLogTimeline workOrderId={wo.id} />

      {/* Edit / Read-only modal */}
      {showEdit && <EditWorkOrderModal wo={wo} onClose={() => setShowEdit(false)} />}

      {/* Digital Stamp modal — intercepts CLOSED transition */}
      {showStamp && (
        <CloseStampModal
          wo={wo}
          onClose={() => setShowStamp(false)}
          isPending={transitionMutation.isPending}
          onConfirm={(licenseNumber) => {
            // Store stamp in audit notes via toast + fire transition
            toast.success(`Sello digital registrado — Lic. ${licenseNumber}`, { duration: 4000 });
            transitionMutation.mutate('CLOSED');
          }}
        />
      )}

      {/* Reject confirmation modal — QUALITY → IN_PROGRESS */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-rose-50 rounded-full flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">¿Rechazar la OT?</h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  La orden de trabajo regresará a <strong>En Ejecución</strong>. El técnico deberá corregir los puntos observados antes de volver a solicitar inspección QC.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowRejectConfirm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button
                onClick={() => { setShowRejectConfirm(false); transitionMutation.mutate('IN_PROGRESS'); }}
                disabled={transitionMutation.isPending}
                className="btn-primary flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 border-rose-700"
              >
                {transitionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                Sí, rechazar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Technician Assignment Modal */}
      {showAssignModal && (
        <TechnicianAssignmentModal
          workOrderId={wo.id}
          workOrderNumber={wo.number}
          organizationId={wo.organizationId}
          onClose={() => setShowAssignModal(false)}
          onAssigned={() => {
            qc.invalidateQueries({ queryKey: ['work-order', id] });
            qc.invalidateQueries({ queryKey: ['work-orders'] });
          }}
        />
      )}
    </div>
  );
}
