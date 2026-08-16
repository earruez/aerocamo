import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { aircraftApi } from '@api/aircraft.api';
import type { Aircraft } from '@api/aircraft.api';
import { maintenancePlanApi } from '@api/maintenancePlan.api';
import type { MaintenancePlanItem, PlanItemStatus } from '@api/maintenancePlan.api';
import { tasksApi } from '@api/tasks.api';
import type { TaskDefinition, CreateTaskInput } from '@api/tasks.api';
import { complianceApi } from '@api/compliance.api';
import { taskNotesApi } from '@api/taskNotes.api';
import { useAuthStore } from '../store/authStore';
import type { RecordComplianceInput } from '@api/compliance.api';
import { workRequestsApi } from '@api/workRequests.api';
import { useWorkRequestStore } from '../store/workRequestStore';
import { isActiveWorkRequestStatus } from '@/shared/workRequestTypes';
import { adaptApiWorkRequest } from '@/shared/workRequestApiAdapter';
import { applySort, SortableHeader, toggleSort, type SortState } from '@/shared/tableSort';
import {
  ClipboardCheck, AlertTriangle, Clock, CheckCircle2,
  ChevronRight, Search, BookOpen, Calendar, Gauge, RefreshCw, Plane,
  FileText, Eye, Package,
  Plus, Pencil, Trash2, X, Check,
  StickyNote,
} from 'lucide-react';

type MaintenanceType = 'HORARIO' | 'CALENDARIO' | 'MIXTO';
type MaintenanceTypeTab = 'ALL' | MaintenanceType;
type NormativeTab = 'PROGRAMA' | 'AD' | 'SB' | 'MIM' | 'INSPECCIONES' | 'COMPONENTES';
type EquipmentTab = 'ALL' | 'AIRCRAFT' | 'ENGINE';
type RecurrenceTab = 'ALL' | 'REPETITIVE' | 'ONE_TIME';
type ApplicabilityTab = 'APPLIES' | 'NOT_APPLIES' | 'ALL';

const MAINTENANCE_TYPE_META: Record<MaintenanceType, { label: string; badge: string }> = {
  HORARIO: {
    label: 'Horario',
    badge: 'bg-slate-100 text-slate-700 ring-slate-300/70',
  },
  CALENDARIO: {
    label: 'Calendario',
    badge: 'bg-slate-100 text-slate-700 ring-slate-300/70',
  },
  MIXTO: {
    label: 'Mixto',
    badge: 'bg-slate-100 text-slate-700 ring-slate-300/70',
  },
};

function classifyMaintenanceType(task: {
  intervalType: string;
  intervalHours: number | null;
  intervalCalendarDays: number | null;
  intervalCalendarMonths?: number | null;
}): MaintenanceType {
  const hasLimit1 = task.intervalHours != null && task.intervalHours > 0;
  const hasLimit2 =
    (task.intervalCalendarDays != null && task.intervalCalendarDays > 0)
    || (task.intervalCalendarMonths != null && task.intervalCalendarMonths > 0);

  if (hasLimit1 && hasLimit2) return 'MIXTO';
  if (hasLimit1) return 'HORARIO';
  if (hasLimit2) return 'CALENDARIO';

  if (task.intervalType === 'FLIGHT_HOURS_OR_CALENDAR') return 'MIXTO';
  if (task.intervalType === 'CALENDAR_DAYS') return 'CALENDARIO';
  return 'HORARIO';
}

/**
 * Categoría normativa de la tarea, en el vocabulario del Access:
 * AD y SB vienen del tipo de referencia; MIM es la normativa nacional (INTERNAL);
 * el resto son manual de fabricante, separados por isComponentControl entre
 * inspecciones y control de vida de componentes.
 *
 * El equipo (aeronave o motor) es un eje aparte: vive en equipmentScope, que
 * viene del equipo al que el Access asoció el ítem (AN / EN1).
 */
function classifyTaskCategory(item: MaintenancePlanItem): 'AD' | 'SB' | 'MIM' | 'INSPECCIONES' | 'COMPONENTES' {
  if (item.referenceType === 'AD') return 'AD';
  if (item.referenceType === 'SB') return 'SB';
  if (item.referenceType === 'INTERNAL') return 'MIM';
  return item.isComponentControl ? 'COMPONENTES' : 'INSPECCIONES';
}

// ─── Status helpers ────────────────────────────────────────────────────────────
const STATUS_ORDER: Record<PlanItemStatus, number> = { OVERDUE: 0, DUE_SOON: 1, NEVER_PERFORMED: 2, OK: 3 };

type PriorityVisual = 'critical' | 'attention' | 'controlled';
type PriorityBand = 'overdue' | 'next-critical' | 'next-normal' | 'no-urgency';
type PriorityDriver = 'HORAS' | 'FECHA' | 'NONE';
type AircraftAlertState = 'normal' | 'attention' | 'critical';
type RiskLevel = 'bajo' | 'medio' | 'alto' | 'critico';

interface SmartPriority {
  visual: PriorityVisual;
  band: PriorityBand;
  driver: PriorityDriver;
  remaining: number | null;
  remainingPercent: number | null;
  mixedReason: 'horas' | 'fecha' | null;
}

const BAND_ORDER: Record<PriorityBand, number> = {
  overdue: 0,
  'next-critical': 1,
  'next-normal': 2,
  'no-urgency': 3,
};

const VISUAL_META: Record<PriorityVisual, { label: string; badge: string; dot: string }> = {
  critical: {
    label: 'Crítico',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
  },
  attention: {
    label: 'Atención',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  controlled: {
    label: 'Controlado',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
};

const AIRCRAFT_ALERT_META: Record<Exclude<AircraftAlertState, 'normal'>, {
  title: string;
  rail: string;
  border: string;
  text: string;
}> = {
  critical: {
    title: 'Esta aeronave ya debería ingresar a mantenimiento',
    rail: 'border-l-rose-500',
    border: 'border-slate-200',
    text: 'text-rose-800',
  },
  attention: {
    title: 'Esta aeronave requiere planificación de ingreso',
    rail: 'border-l-amber-500',
    border: 'border-slate-200',
    text: 'text-amber-800',
  },
};

const RISK_LEVEL_META: Record<RiskLevel, {
  label: string;
  card: string;
  badge: string;
}> = {
  bajo: {
    label: 'Bajo',
    card: 'bg-white border-slate-200',
    badge: 'badge-state-success',
  },
  medio: {
    label: 'Medio',
    card: 'bg-white border-slate-200',
    badge: 'badge-state-warning',
  },
  alto: {
    label: 'Alto',
    card: 'bg-white border-slate-200',
    badge: 'badge-state-warning',
  },
  critico: {
    label: 'Crítico',
    card: 'bg-white border-slate-200',
    badge: 'badge-state-critical',
  },
};

function startOfDay(date: Date): Date {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function getDaysRemaining(nextDueDate: string | null, today: Date): number | null {
  if (!nextDueDate) return null;
  const due = startOfDay(new Date(nextDueDate));
  if (Number.isNaN(due.getTime())) return null;
  const now = startOfDay(today);
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getSmartPriority(
  item: MaintenancePlanItem,
  context?: { currentHours?: number | null; today?: Date },
): SmartPriority {
  const maintenanceType = classifyMaintenanceType(item);
  const today = context?.today ?? new Date();
  const currentHours = context?.currentHours ?? null;

  const calendarIntervalDays =
    (item.intervalCalendarDays != null && item.intervalCalendarDays > 0)
      ? item.intervalCalendarDays
      : (item.intervalCalendarMonths != null && item.intervalCalendarMonths > 0)
        ? item.intervalCalendarMonths * 30
        : null;

  const hoursRemaining =
    (item.nextDueHours != null && currentHours != null)
      ? item.nextDueHours - currentHours
      : item.hoursRemaining ?? null;
  const daysRemaining = getDaysRemaining(item.nextDueDate, today) ?? item.daysRemaining ?? null;

  let driver: PriorityDriver = 'NONE';
  let remaining: number | null = null;
  let remainingPercent: number | null = null;
  let mixedReason: 'horas' | 'fecha' | null = null;

  if (maintenanceType === 'HORARIO') {
    driver = 'HORAS';
    remaining = hoursRemaining;
    if (remaining != null && item.intervalHours != null && item.intervalHours > 0) {
      remainingPercent = remaining / item.intervalHours;
    }
  } else if (maintenanceType === 'CALENDARIO') {
    driver = 'FECHA';
    remaining = daysRemaining;
    if (remaining != null && calendarIntervalDays != null && calendarIntervalDays > 0) {
      remainingPercent = remaining / calendarIntervalDays;
    }
  } else {
    const hasHours = hoursRemaining != null;
    const hasDays = daysRemaining != null;
    const hasHoursInterval = item.intervalHours != null && item.intervalHours > 0;
    const hasDaysInterval = calendarIntervalDays != null && calendarIntervalDays > 0;

    const hoursPercent = hasHours && hasHoursInterval ? hoursRemaining! / item.intervalHours! : null;
    const daysPercent = hasDays && hasDaysInterval ? daysRemaining! / calendarIntervalDays! : null;

    if (hoursPercent != null && daysPercent != null) {
      if (hoursPercent <= daysPercent) {
        driver = 'HORAS';
        remaining = hoursRemaining!;
        remainingPercent = hoursPercent;
        mixedReason = 'horas';
      } else {
        driver = 'FECHA';
        remaining = daysRemaining!;
        remainingPercent = daysPercent;
        mixedReason = 'fecha';
      }
    } else if (hoursPercent != null) {
      driver = 'HORAS';
      remaining = hoursRemaining!;
      remainingPercent = hoursPercent;
      mixedReason = 'horas';
    } else if (daysPercent != null) {
      driver = 'FECHA';
      remaining = daysRemaining!;
      remainingPercent = daysPercent;
      mixedReason = 'fecha';
    } else if (hasHours && hasDays) {
      if (hoursRemaining! <= daysRemaining!) {
        driver = 'HORAS';
        remaining = hoursRemaining!;
        mixedReason = 'horas';
      } else {
        driver = 'FECHA';
        remaining = daysRemaining!;
        mixedReason = 'fecha';
      }
    } else if (hasHours) {
      driver = 'HORAS';
      remaining = hoursRemaining!;
      mixedReason = 'horas';
    } else if (hasDays) {
      driver = 'FECHA';
      remaining = daysRemaining!;
      mixedReason = 'fecha';
    }
  }

  const overdue = item.status === 'OVERDUE' || (remaining != null && remaining < 0);
  const visual: PriorityVisual = overdue
    ? 'critical'
    : remainingPercent != null
      ? remainingPercent < 0.10
        ? 'critical'
        : remainingPercent <= 0.25
          ? 'attention'
          : 'controlled'
      : item.status === 'DUE_SOON' || item.status === 'NEVER_PERFORMED'
        ? 'attention'
        : 'controlled';

  const band: PriorityBand = overdue
    ? 'overdue'
    : visual === 'critical'
      ? 'next-critical'
      : visual === 'attention'
        ? 'next-normal'
        : 'no-urgency';

  return { visual, band, driver, remaining, remainingPercent, mixedReason };
}

const STATUS_META: Record<PlanItemStatus, { label: string; badge: string; icon: typeof AlertTriangle }> = {
  OVERDUE:         { label: 'Vencida',        badge: 'badge-overdue',      icon: AlertTriangle },
  DUE_SOON:        { label: 'Próx. vencer',   badge: 'badge-deferred',     icon: Clock },
  OK:              { label: 'Al día',         badge: 'badge-operational',  icon: CheckCircle2 },
  NEVER_PERFORMED: { label: 'Sin registro',   badge: 'badge-decommissioned', icon: BookOpen },
};

const REF_BADGE: Record<string, string> = {
  AD:       'bg-rose-50 text-rose-700 ring-rose-600/20',
  AMM:      'bg-blue-50 text-blue-700 ring-blue-600/20',
  SB:       'bg-purple-50 text-purple-700 ring-purple-600/20',
  CMR:      'bg-orange-50 text-orange-700 ring-orange-600/20',
  INTERNAL: 'bg-slate-100 text-slate-600 ring-slate-400/20',
  MPD:      'bg-teal-50 text-teal-700 ring-teal-600/20',
  ETOPS:    'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
};

function refBadge(type: string) {
  return `inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${REF_BADGE[type] ?? REF_BADGE.INTERNAL}`;
}

// ─── Reference options ───────────────────────────────────────────────────────
const REFERENCE_TYPES = ['AD', 'AMM', 'SB', 'CMR', 'MPD', 'ETOPS', 'INTERNAL'];

// ─── Modal shell ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={15} className="text-slate-500" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Modal 1: Record Compliance ───────────────────────────────────────────────
function RecordComplianceModal({
  item, aircraftId, eligibleWorkOrderNumber, onClose, onSubmit, isPending,
}: {
  item: MaintenancePlanItem;
  aircraftId: string;
  eligibleWorkOrderNumber: string;
  onClose: () => void;
  onSubmit: (input: RecordComplianceInput) => void;
  isPending: boolean;
}) {
  const today = new Date().toISOString().split('T')[0];
  const [performedAt, setPerformedAt] = useState(today);
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!performedAt) { toast.error('Ingresa la fecha de realización'); return; }
    onSubmit({
      aircraftId,
      taskId: item.taskId,
      performedAt,
      workOrderNumber: eligibleWorkOrderNumber,
      notes: notes.trim() || null,
    });
  };

  return (
    <Modal title={`Registrar cumplimiento — ${item.taskCode}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div className="bg-slate-50 rounded-xl p-3.5">
            <p className="text-xs font-semibold text-slate-700">{item.taskTitle}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              <span className={refBadge(item.referenceType)}>{item.referenceType}</span>
              {item.referenceNumber && <span className="ml-1.5">{item.referenceNumber}</span>}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Fecha de realización <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={performedAt}
              max={today}
              onChange={e => setPerformedAt(e.target.value)}
              className="input"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">N° Orden de trabajo</label>
            <input
              type="text"
              value={eligibleWorkOrderNumber}
              readOnly
              className="input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Observaciones, materiales usados, etc."
              className="input resize-none"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" disabled={isPending} className="btn-primary">
            {isPending ? 'Guardando…' : 'Registrar cumplimiento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal 2: Assign task ─────────────────────────────────────────────────────
function AssignTaskModal({
  aircraftId, assignedTaskIds, onClose, onAssign, onCreateNew, isPending,
}: {
  aircraftId: string;
  assignedTaskIds: string[];
  onClose: () => void;
  onAssign: (taskId: string) => void;
  onCreateNew: () => void;
  isPending: boolean;
}) {
  const [search, setSearch] = useState('');
  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: tasksApi.listAll,
  });

  const available = useMemo(() =>
    allTasks
      .filter(t => t.isActive && !assignedTaskIds.includes(t.id))
      .filter(t => !search || t.code.toLowerCase().includes(search.toLowerCase()) || t.title.toLowerCase().includes(search.toLowerCase())),
    [allTasks, assignedTaskIds, search],
  );

  return (
    <Modal title="Agregar tarea al plan" onClose={onClose}>
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-6 pt-4 pb-2 shrink-0 space-y-3">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por código o descripción…"
              className="input pl-8"
            />
          </div>
          <button onClick={onCreateNew} className="btn-secondary w-full justify-center gap-2 text-xs">
            <Plus size={14} />
            Crear nueva tarea
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-1 min-h-0">
          {isLoading && <p className="text-center py-8 text-xs text-slate-400">Cargando tareas…</p>}
          {!isLoading && available.length === 0 && (
            <p className="text-center py-8 text-xs text-slate-400">
              {allTasks.length === 0 ? 'No hay tareas definidas en la organización.' : 'Todas las tareas ya están asignadas o no coincide la búsqueda.'}
            </p>
          )}
          {available.map(task => (
            <div key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/60 px-3.5 py-3 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-800">{task.code}</span>
                  <span className={refBadge(task.referenceType)}>{task.referenceType}</span>
                  {task.isMandatory && <span className="text-[10px] text-rose-600 font-bold">OBLIGATORIA</span>}
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">{task.title}</p>
              </div>
              <button
                onClick={() => onAssign(task.id)}
                disabled={isPending}
                className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Plus size={13} /> Asignar
              </button>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0">
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal 3: Create / Edit task definition ───────────────────────────────────
type TaskFormState = {
  code: string;
  ata: string;
  title: string;
  description: string;
  maintenanceType: MaintenanceType;
  intervalType: string;
  intervalHours: string;
  intervalCycles: string;
  intervalCalendarDays: string;
  intervalCalendarMonths: string;
  toleranceHours: string;
  toleranceCycles: string;
  toleranceCalendarDays: string;
  referenceType: string;
  referenceNumber: string;
  isMandatory: boolean;
  requiresInspection: boolean;
  estimatedManHours: string;
};

function blankForm(): TaskFormState {
  return {
    code: '', ata: '', title: '', description: '', maintenanceType: 'HORARIO', intervalType: 'FLIGHT_HOURS',
    intervalHours: '', intervalCycles: '', intervalCalendarDays: '', intervalCalendarMonths: '',
    toleranceHours: '', toleranceCycles: '', toleranceCalendarDays: '',
    referenceType: 'AMM', referenceNumber: '',
    isMandatory: false, requiresInspection: false, estimatedManHours: '',
  };
}

function taskToForm(task: TaskDefinition): TaskFormState {
  return {
    code: task.code,
    ata: task.ata ?? '',
    title: task.title,
    description: task.description,
    maintenanceType: classifyMaintenanceType(task),
    intervalType: task.intervalType,
    intervalHours: task.intervalHours != null ? String(task.intervalHours) : '',
    intervalCycles: task.intervalCycles != null ? String(task.intervalCycles) : '',
    intervalCalendarDays: task.intervalCalendarDays != null ? String(task.intervalCalendarDays) : '',
    intervalCalendarMonths: task.intervalCalendarMonths != null ? String(task.intervalCalendarMonths) : '',
    toleranceHours: task.toleranceHours != null ? String(task.toleranceHours) : '',
    toleranceCycles: task.toleranceCycles != null ? String(task.toleranceCycles) : '',
    toleranceCalendarDays: task.toleranceCalendarDays != null ? String(task.toleranceCalendarDays) : '',
    referenceType: task.referenceType,
    referenceNumber: task.referenceNumber ?? '',
    isMandatory: task.isMandatory,
    requiresInspection: task.requiresInspection,
    estimatedManHours: task.estimatedManHours != null ? String(task.estimatedManHours) : '',
  };
}

function formToInput(f: TaskFormState): CreateTaskInput {
  const intervalType =
    f.maintenanceType === 'MIXTO'
      ? 'FLIGHT_HOURS_OR_CALENDAR'
      : f.maintenanceType === 'CALENDARIO'
        ? 'CALENDAR_DAYS'
        : 'FLIGHT_HOURS';

  return {
    code: f.code.trim().toUpperCase(),
    ata: f.ata.trim() || null,
    title: f.title.trim(),
    description: f.description.trim(),
    intervalType,
    intervalHours: f.intervalHours ? Number(f.intervalHours) : null,
    intervalCycles: f.intervalCycles ? Number(f.intervalCycles) : null,
    intervalCalendarDays: f.intervalCalendarDays ? Number(f.intervalCalendarDays) : null,
    intervalCalendarMonths: f.intervalCalendarMonths ? Number(f.intervalCalendarMonths) : null,
    toleranceHours: f.toleranceHours ? Number(f.toleranceHours) : null,
    toleranceCycles: f.toleranceCycles ? Number(f.toleranceCycles) : null,
    toleranceCalendarDays: f.toleranceCalendarDays ? Number(f.toleranceCalendarDays) : null,
    referenceType: f.referenceType,
    referenceNumber: f.referenceNumber.trim() || null,
    isMandatory: f.isMandatory,
    requiresInspection: f.requiresInspection,
    estimatedManHours: f.estimatedManHours ? Number(f.estimatedManHours) : null,
  };
}

function CreateEditTaskModal({
  task, onClose, onCreate, onUpdate, isPending,
}: {
  task: TaskDefinition | null;
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => void;
  onUpdate: (id: string, input: Partial<CreateTaskInput>) => void;
  isPending: boolean;
}) {
  const isEdit = task !== null;
  const [form, setForm] = useState<TaskFormState>(() => isEdit ? taskToForm(task!) : blankForm());

  const set = (k: keyof TaskFormState, v: string | boolean) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const showLimit1 = form.maintenanceType === 'HORARIO' || form.maintenanceType === 'MIXTO';
  const showLimit2 = form.maintenanceType === 'CALENDARIO' || form.maintenanceType === 'MIXTO';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('El título es obligatorio'); return; }
    if (!isEdit && !form.code.trim()) { toast.error('El código es obligatorio'); return; }
    const input = formToInput(form);
    if (isEdit) {
      const { code: _code, ...rest } = input;
      onUpdate(task!.id, rest);
    } else {
      onCreate(input);
    }
  };

  const F = ({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) => (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );

  return (
    <Modal title={isEdit ? `Editar tarea — ${task!.code}` : 'Nueva tarea'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <F label="Código" required>
                <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
                  placeholder="EG. TRK-100" className="input font-mono uppercase" required />
              </F>
            )}
            <F label="Tipo de mantenimiento" required>
              <select value={form.maintenanceType} onChange={e => set('maintenanceType', e.target.value as MaintenanceType)} className="input">
                <option value="HORARIO">Mantenimiento Horario</option>
                <option value="CALENDARIO">Mantenimiento Calendario</option>
                <option value="MIXTO">Mantenimiento Mixto</option>
              </select>
            </F>
          </div>

          {form.maintenanceType === 'MIXTO' && (
            <div className="rounded-lg border border-purple-200 bg-purple-50/50 px-3 py-2 text-xs text-purple-700">
              Vencimiento por criterio mixto: se considera vencida por lo que ocurra primero.
            </div>
          )}

          <F label="Título" required>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="Descripción corta de la tarea" className="input" required />
          </F>

          <F label="Descripción">
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Procedimiento, alcance, notas…" className="input resize-none" />
          </F>

          {/* Interval values */}
          {form.maintenanceType && (
            <div className="grid grid-cols-3 gap-3">
              {showLimit1 && (
                <F label="Limit 1 (Horas)">
                  <input type="number" min="1" value={form.intervalHours}
                    onChange={e => set('intervalHours', e.target.value)} className="input" />
                </F>
              )}
              {showLimit2 && (
                <F label="Limit 2 (Meses)">
                  <input type="number" min="1" value={form.intervalCalendarMonths}
                    onChange={e => set('intervalCalendarMonths', e.target.value)} className="input" />
                </F>
              )}
              {showLimit2 && (
                <F label="Limit 2 (Días)">
                  <input type="number" min="1" value={form.intervalCalendarDays}
                    onChange={e => set('intervalCalendarDays', e.target.value)} className="input" />
                </F>
              )}
              {showLimit1 && (
                <F label="Tolerancia (h)">
                  <input type="number" min="0" value={form.toleranceHours}
                    onChange={e => set('toleranceHours', e.target.value)} className="input" />
                </F>
              )}
              {showLimit2 && (
                <F label="Tolerancia (días)">
                  <input type="number" min="0" value={form.toleranceCalendarDays}
                    onChange={e => set('toleranceCalendarDays', e.target.value)} className="input" />
                </F>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <F label="ATA">
              <input value={form.ata} onChange={e => set('ata', e.target.value)}
                placeholder="05-10-01" className="input font-mono" />
            </F>
            <F label="Tipo de referencia">
              <select value={form.referenceType} onChange={e => set('referenceType', e.target.value)} className="input">
                {REFERENCE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </F>
            <F label="N° de referencia">
              <input value={form.referenceNumber} onChange={e => set('referenceNumber', e.target.value)}
                placeholder="AMM 05-10-00" className="input" />
            </F>
          </div>

          <F label="Horas-hombre estimadas">
            <input type="number" min="0" step="0.5" value={form.estimatedManHours}
              onChange={e => set('estimatedManHours', e.target.value)} className="input" placeholder="4" />
          </F>

          <div className="flex gap-5 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isMandatory}
                onChange={e => set('isMandatory', e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-xs font-medium text-slate-700">Obligatoria (AD / CMR)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.requiresInspection}
                onChange={e => set('requiresInspection', e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-xs font-medium text-slate-700">Requiere inspección</span>
            </label>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" disabled={isPending} className="btn-primary">
            {isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear tarea'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modal 4: Confirm remove ──────────────────────────────────────────────────
function ConfirmRemoveModal({
  item, registration, onClose, onConfirm, isPending,
}: {
  item: MaintenancePlanItem;
  registration: string;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Modal title="Eliminar tarea del plan" onClose={onClose}>
      <div className="px-6 py-5">
        <p className="text-sm text-slate-700">
          ¿Confirmas eliminar{' '}
          <span className="font-bold text-slate-900">{item.taskCode}</span>{' '}
          del plan de mantenimiento de{' '}
          <span className="font-bold text-slate-900">{registration}</span>?
        </p>
        <p className="text-xs text-slate-400 mt-2">
          {item.taskTitle}. Esta acción solo desvincula la tarea del plan; los registros de cumplimiento anteriores se conservan.
        </p>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5">
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button
          onClick={onConfirm}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm border border-rose-700/20 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
        >
          {isPending ? 'Eliminando…' : 'Sí, eliminar del plan'}
        </button>
      </div>
    </Modal>
  );
}

function SelectWorkRequestTargetModal({
  items,
  candidates,
  onClose,
  onSelect,
  onCreateNew,
}: {
  items: MaintenancePlanItem[];
  candidates: Array<{ id: string; folio: string; statusLabel: string; itemsCount: number }>;
  onClose: () => void;
  onSelect: (workRequestId: string) => void;
  onCreateNew: () => void;
}) {
  const firstCode = items[0]?.taskCode ?? 'tarea';
  const count = items.length;

  return (
    <Modal title="Seleccionar borrador ST" onClose={onClose}>
      <div className="px-6 py-5 space-y-3">
        <p className="text-sm text-slate-700">
          {count === 1
            ? <>Hay varias ST abiertas para esta aeronave. Elige dónde agregar la tarea <span className="font-semibold">{firstCode}</span>.</>
            : <>Hay varias ST abiertas para esta aeronave. Elige dónde agregar las <span className="font-semibold">{count} tareas seleccionadas</span>.</>}
        </p>

        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
          {candidates.map((st) => (
            <button
              key={st.id}
              onClick={() => onSelect(st.id)}
              className="w-full text-left rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2.5 transition-colors"
            >
              <p className="text-sm font-semibold text-slate-900">{st.folio}</p>
              <p className="text-xs text-slate-500 mt-0.5">{st.statusLabel} · {st.itemsCount} ítems</p>
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5">
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button onClick={onCreateNew} className="btn-primary">Nueva ST</button>
      </div>
    </Modal>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────
function SummaryBar({ items }: { items: MaintenancePlanItem[] }) {
  const overdue  = items.filter(i => i.status === 'OVERDUE').length;
  const dueSoon  = items.filter(i => i.status === 'DUE_SOON').length;
  const inRequest = items.filter(i => Boolean(i.inWorkRequestId || i.inWorkRequestNumber)).length;
  const never    = items.filter(i => i.status === 'NEVER_PERFORMED').length;

  const cards = [
    { label: 'Vencidas', value: overdue, subtitle: 'Requieren acción inmediata', cls: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' },
    { label: 'Próximas', value: dueSoon, subtitle: 'Programar antes del límite', cls: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
    { label: 'En solicitud', value: inRequest, subtitle: 'Ya en gestión ST', cls: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
    { label: 'Sin registro', value: never, subtitle: 'Pendientes de trazabilidad', cls: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 shrink-0">
      {cards.map(c => (
        <div key={c.label} className={`rounded-xl border ${c.bg} px-4 py-3.5`}> 
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">{c.label}</p>
          <p className={`text-3xl font-extrabold tabular-nums leading-none mt-1 ${c.cls}`}>{c.value}</p>
          <p className="text-[11px] text-slate-500 mt-1">{c.subtitle}</p>
        </div>
      ))}
    </div>
  );
}

function getOperationalStatusLabel(status: string): string {
  if (status === 'IN_MAINTENANCE') return 'En mantenimiento';
  if (status === 'OPERATIONAL') return 'Operacional';
  if (status === 'GROUNDED') return 'En tierra';
  if (status === 'AOG') return 'AOG';
  return status.replace('_', ' ');
}

function getOperationalStatusClass(status: string): string {
  if (status === 'OPERATIONAL') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'AOG') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'IN_MAINTENANCE') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'GROUNDED') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

interface TaskRowProps {
  item: MaintenancePlanItem;
  priority: SmartPriority;
  workflow: { state: 'none' | 'open' | 'valid'; stId?: string; stRef?: string };
  selected: boolean;
  selectable: boolean;
  applicabilityPending: boolean;
  onToggleSelect: (item: MaintenancePlanItem, checked: boolean) => void;
  onSetApplicability: (item: MaintenancePlanItem, applies: boolean) => void;
  onRecord: (item: MaintenancePlanItem) => void;
  onViewHistory: (item: MaintenancePlanItem) => void;
  noteCount: number;
  onEdit:   (item: MaintenancePlanItem) => void;
  onRemove: (item: MaintenancePlanItem) => void;
  onGenerateST: (item: MaintenancePlanItem) => void;
  onViewST: (item: MaintenancePlanItem, stId?: string) => void;
}

function TaskRow({
  item,
  priority,
  workflow,
  selected,
  selectable,
  applicabilityPending,
  onToggleSelect,
  onSetApplicability,
  onRecord,
  onViewHistory,
  noteCount,
  onEdit,
  onRemove,
  onGenerateST,
  onViewST,
}: TaskRowProps) {
  const meta = STATUS_META[item.status];
  const visualMeta = VISUAL_META[priority.visual];
  const maintenanceType = classifyMaintenanceType(item);
  const typeMeta = MAINTENANCE_TYPE_META[maintenanceType];
  const resolvedStId = workflow.stId ?? item.inWorkRequestId ?? null;
  const resolvedStRef = workflow.stRef ?? item.inWorkRequestNumber ?? resolvedStId;
  const hasST = Boolean(resolvedStId);

  const intervalLabel = () => {
    const parts = [];
    if (item.intervalHours) parts.push(`${item.intervalHours} h`);
    if (item.intervalCycles) parts.push(`${item.intervalCycles} cic`);
    if (item.intervalCalendarDays) parts.push(`${item.intervalCalendarDays} d`);
    if (item.intervalCalendarMonths) parts.push(`${item.intervalCalendarMonths} m`);
    return parts.join(' / ') || '—';
  };

  const nextDueLabel = () => {
    const parts = [];
    if (item.nextDueHours) parts.push(`${item.nextDueHours.toFixed(0)}h`);
    if (item.nextDueCycles) parts.push(`${item.nextDueCycles} cic`);
    if (item.nextDueDate) parts.push(new Date(item.nextDueDate).toLocaleDateString('es-MX'));
    return parts.join(' · ') || '—';
  };

  const rowAccent = item.status === 'OVERDUE'
    ? 'border-l-4 border-l-rose-500'
    : priority.visual === 'critical'
      ? 'border-l-4 border-l-rose-400'
      : priority.visual === 'attention'
      ? 'border-l-4 border-l-amber-400'
      : hasST
        ? 'border-l-4 border-l-blue-400'
        : 'border-l-4 border-l-transparent';

  const rowBg = '';

  return (
    <tr className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors ${rowAccent} ${rowBg} ${selected ? 'ring-1 ring-brand-200' : ''}`}>
      <td className="px-3 py-3.5 whitespace-nowrap text-center">
        <input
          type="checkbox"
          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          checked={selected}
          disabled={!selectable}
          onChange={(e) => onToggleSelect(item, e.target.checked)}
        />
      </td>
      <td className="px-4 py-3.5 min-w-[270px]">
        <div className="flex items-start gap-2">
          <div>
            <p className="font-mono text-[11px] font-semibold text-slate-500">{item.taskCode}</p>
            <p className="text-base font-semibold text-slate-900 leading-snug mt-0.5">{item.taskTitle}</p>
            {hasST && (
              <span className="inline-flex mt-1 text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full">
                Incluida en solicitud
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap text-xs">
        <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${typeMeta.badge}`}>
          {typeMeta.label}
        </span>
        {maintenanceType === 'MIXTO' && priority.mixedReason && (
          <p className="mt-1 text-[11px] font-semibold text-slate-600">
            {priority.mixedReason === 'horas' ? 'Vence por horas' : 'Vence por fecha'}
          </p>
        )}
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600">
        {!item.isApplicable && item.applicabilityNotes ? (
          <span className="block max-w-[220px] truncate text-[11px] text-amber-800" title={item.applicabilityNotes}>
            No aplica: {item.applicabilityNotes}
          </span>
        ) : intervalLabel()}
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap text-xs">
        <span className={item.status === 'OVERDUE' ? 'text-rose-700 font-semibold' : item.status === 'DUE_SOON' ? 'text-amber-700 font-semibold' : 'text-slate-600'}>
          {nextDueLabel()}
        </span>
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600">
        <button
          type="button"
          onClick={() => onViewHistory(item)}
          className="text-left underline-offset-2 hover:text-brand-700 hover:underline"
          title="Ver historial de cumplimientos y notas de revisión"
        >
          {item.lastPerformedAt
            ? `${new Date(item.lastPerformedAt).toLocaleDateString('es-MX')}${item.lastHoursAtCompliance != null ? ` · ${item.lastHoursAtCompliance.toFixed(0)}h` : ''}`
            : item.controlStartAt
              ? `Inicio de control: ${new Date(item.controlStartAt).toLocaleDateString('es-MX')}${item.controlStartHours != null ? ` · ${item.controlStartHours.toFixed(0)}h` : ''}`
              : 'Sin dato histórico'}
        </button>
        {noteCount > 0 && (
          <button
            type="button"
            onClick={() => onViewHistory(item)}
            className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"
            title={`${noteCount} nota${noteCount !== 1 ? 's' : ''} de revisión`}
          >
            <StickyNote size={10} /> {noteCount}
          </button>
        )}
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${visualMeta.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${visualMeta.dot}`} />
            {visualMeta.label}
          </span>
          <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {meta.label}
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap">
        {hasST ? (
          <div className="flex items-center gap-2">
              {workflow.state === 'open' ? (
                <>
                  <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                    ST abierta/borrador {resolvedStRef}
                  </span>
                  <button className="btn-secondary btn-xs" onClick={() => onViewST(item, resolvedStId ?? undefined)}>
                    Ver ST
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    ST válida con OT {resolvedStRef}
                  </span>
                  <button className="btn-secondary btn-xs" onClick={() => onViewST(item, resolvedStId ?? undefined)}>
                    Ver ST
                  </button>
                </>
              )}
          </div>
        ) : (
          <button className="btn-primary btn-xs" onClick={() => onGenerateST(item)}>
            Agregar a ST
          </button>
        )}
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <select
            className={`filter-input h-7 min-w-[108px] py-0 px-2 text-xs ${item.isApplicable ? '' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
            value={item.isApplicable ? 'applies' : 'not_applies'}
            disabled={applicabilityPending}
            onChange={(e) => onSetApplicability(item, e.target.value === 'applies')}
          >
            <option value="applies">Aplica</option>
            <option value="not_applies">No aplica</option>
          </select>
          <button
            title={workflow.state === 'valid' ? 'Registrar cumplimiento' : 'Requiere ST válida con OT recibida/firmada'}
            onClick={() => workflow.state === 'valid' && onRecord(item)}
            className="btn-secondary btn-xs"
            disabled={workflow.state !== 'valid'}
          >
            Registrar
          </button>
          <button title="Editar tarea" onClick={() => onEdit(item)} className="btn-xs btn-outline">
            Editar
          </button>
          <button title="Eliminar del plan" onClick={() => onRemove(item)} className="btn-xs btn-outline text-rose-700">
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Panel: historial de cumplimientos de una tarea ───────────────────────────
function TaskComplianceHistoryPanel({
  item, aircraftId, onClose,
}: {
  item: MaintenancePlanItem;
  aircraftId: string;
  onClose: () => void;
}) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['task-compliance-history', aircraftId, item.taskId],
    queryFn: () => complianceApi.historyForTask(aircraftId, item.taskId),
  });

  const isBaseline = (record: { applicationType?: string; notes?: string | null }) =>
    record.applicationType === 'baseline'
    || (record.notes ?? '').trim().toLowerCase() === 'inicio de control';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Historial y notas</h2>
            <p className="mt-0.5 text-xs text-slate-500">{item.taskCode} · {item.taskTitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">✕</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">Cargando historial…</p>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Esta tarea aún no tiene cumplimientos registrados.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-header">Fecha</th>
                    <th className="table-header">Tipo</th>
                    <th className="table-header text-right">Horas</th>
                    <th className="table-header text-right">Ciclos</th>
                    <th className="table-header">Próximo vencimiento</th>
                    <th className="table-header">OT</th>
                    <th className="table-header">Observación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {history.map((record) => {
                    const baseline = isBaseline(record);
                    const nextDue = [
                      record.nextDueHours != null ? `${Number(record.nextDueHours).toFixed(1)} FH` : null,
                      record.nextDueCycles != null ? `${record.nextDueCycles} CYC` : null,
                      record.nextDueDate ? new Date(record.nextDueDate).toLocaleDateString('es-MX') : null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <tr key={record.id} className="hover:bg-slate-50">
                        <td className="table-cell text-xs text-slate-700">
                          {new Date(record.performedAt).toLocaleDateString('es-MX')}
                        </td>
                        <td className="table-cell text-xs">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            baseline ? 'badge-state-neutral' : 'badge-state-success'
                          }`}>
                            {baseline ? 'Inicio de control' : record.applicationType === 'replacement_start' ? 'Reemplazo' : 'Cumplimiento'}
                          </span>
                        </td>
                        <td className="table-cell text-xs tabular-nums text-slate-700 text-right">
                          {Number(record.aircraftHoursAtCompliance).toFixed(1)}
                        </td>
                        <td className="table-cell text-xs tabular-nums text-slate-700 text-right">
                          {record.aircraftCyclesAtCompliance}
                        </td>
                        <td className="table-cell text-xs text-slate-600">{nextDue || '—'}</td>
                        <td className="table-cell text-xs text-slate-600">
                          {record.workOrderNumber
                            ? <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">{record.workOrderNumber}</span>
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="table-cell max-w-[260px] text-xs text-slate-500">{record.notes ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-6 py-4">
          <TaskNotesSection aircraftId={aircraftId} taskId={item.taskId} />
        </div>

        <div className="flex justify-end border-t border-slate-200 px-6 py-3">
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Notas de revisión sobre la tarea ─────────────────────────────────────────
// Bitácora libre: dejar constancia de una revisión sin registrar cumplimiento
// (que exigiría ST vigente y OT firmada).
function TaskNotesSection({ aircraftId, taskId }: { aircraftId: string; taskId: string }) {
  const qc = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const currentRole = useAuthStore((state) => state.user?.role);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['task-notes', aircraftId, taskId],
    queryFn: () => taskNotesApi.listForTask(aircraftId, taskId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-notes', aircraftId, taskId] });
    qc.invalidateQueries({ queryKey: ['task-note-counts', aircraftId] });
  };

  const createMutation = useMutation({
    mutationFn: (note: string) => taskNotesApi.create(aircraftId, taskId, note),
    onSuccess: () => { invalidate(); setDraft(''); toast.success('Nota registrada'); },
    onError: () => toast.error('No se pudo registrar la nota'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => taskNotesApi.update(id, note),
    onSuccess: () => { invalidate(); setEditingId(null); toast.success('Nota actualizada'); },
    onError: () => toast.error('No se pudo actualizar la nota'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => taskNotesApi.remove(id),
    onSuccess: () => { invalidate(); toast.success('Nota eliminada'); },
    onError: () => toast.error('No se pudo eliminar la nota'),
  });

  const canModify = (authorId: string | undefined) =>
    currentRole === 'ADMIN' || currentRole === 'SUPERVISOR' || (!!authorId && authorId === currentUserId);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-slate-900">Notas de revisión</h3>
        <span className="text-[11px] text-slate-500">No registran cumplimiento ni mueven vencimientos</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = draft.trim();
          if (value) createMutation.mutate(value);
        }}
        className="mb-3 flex items-start gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="input flex-1 text-xs"
          placeholder="Ej: revisada la AD, sigue vigente; se solicitó aclaración al fabricante…"
        />
        <button type="submit" className="btn-primary btn-sm shrink-0" disabled={createMutation.isPending || !draft.trim()}>
          {createMutation.isPending ? 'Guardando…' : 'Agregar nota'}
        </button>
      </form>

      {isLoading ? (
        <p className="py-3 text-center text-xs text-slate-400">Cargando notas…</p>
      ) : notes.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-400">Sin notas registradas para esta tarea.</p>
      ) : (
        <ul className="max-h-48 space-y-2 overflow-auto">
          {notes.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600">
                  {entry.createdBy?.name ?? 'Usuario eliminado'}
                  <span className="ml-2 font-normal text-slate-400">
                    {new Date(entry.createdAt).toLocaleString('es-CL')}
                    {entry.updatedAt !== entry.createdAt ? ' · editada' : ''}
                  </span>
                </span>
                {canModify(entry.createdBy?.id) && editingId !== entry.id && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      onClick={() => { setEditingId(entry.id); setEditDraft(entry.note); }}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => removeMutation.mutate(entry.id)}
                      className="text-[11px] font-semibold text-rose-500 hover:text-rose-700"
                      disabled={removeMutation.isPending}
                    >
                      Eliminar
                    </button>
                  </span>
                )}
              </div>
              {editingId === entry.id ? (
                <div className="mt-1.5 flex items-start gap-2">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    className="input flex-1 text-xs"
                  />
                  <span className="flex shrink-0 flex-col gap-1">
                    <button
                      onClick={() => editDraft.trim() && updateMutation.mutate({ id: entry.id, note: editDraft.trim() })}
                      className="btn-primary btn-xs"
                      disabled={updateMutation.isPending || !editDraft.trim()}
                    >
                      Guardar
                    </button>
                    <button onClick={() => setEditingId(null)} className="btn-secondary btn-xs">Cancelar</button>
                  </span>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{entry.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Modal: justificar la no aplicabilidad ────────────────────────────────────
function NotApplicableModal({
  item, currentNotes, onCancel, onConfirm, isPending,
}: {
  item: MaintenancePlanItem;
  currentNotes: string | null;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
  isPending: boolean;
}) {
  const [notes, setNotes] = useState(currentNotes ?? '');

  return (
    <Modal title="Marcar como no aplica" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!notes.trim()) return;
          onConfirm(notes.trim());
        }}
        className="space-y-4"
      >
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="font-mono text-xs text-slate-500">{item.taskCode}</p>
          <p className="text-sm font-medium text-slate-800">{item.taskTitle}</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">
            ¿Por qué no aplica? <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            autoFocus
            className="input"
            placeholder="Ej: no aplica por ambiente salino; aeronave nueva; superseded por AD posterior…"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            La tarea seguirá visible en el plan y podrás volver a marcarla como aplica
            si cambian las condiciones de operación.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary" disabled={isPending || !notes.trim()}>
            {isPending ? 'Guardando…' : 'Marcar como no aplica'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type ModalState =
  | null
  | { type: 'record-compliance'; item: MaintenancePlanItem; workOrderNumber: string }
  | { type: 'assign-task' }
  | { type: 'create-task' }
  | { type: 'edit-task'; task: TaskDefinition }
  | { type: 'confirm-remove'; item: MaintenancePlanItem };

type PendingSTSelection = {
  items: MaintenancePlanItem[];
  candidates: Array<{ id: string; folio: string; statusLabel: string; itemsCount: number }>;
};

type ApplicabilityUndoAction = {
  aircraftId: string;
  taskId: string;
  taskCode: string;
  appliesAfterChange: boolean;
  previousNotes: string | null;
};

export default function MaintenancePlanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [filterStatus, setFilterStatus] = useState<PlanItemStatus | ''>(searchParams.get('status') as PlanItemStatus | '' ?? '');
  const [normativeTab, setNormativeTab] = useState<NormativeTab>('PROGRAMA');
  const [equipmentTab, setEquipmentTab] = useState<EquipmentTab>('ALL');
  // Flujo del filtro replicando el Access: primero Equipo, luego Categoría,
  // recién ahí el resto de filtros finos. Cada paso queda abierto una vez
  // que el usuario lo tocó — no se vuelve a esconder al cambiar de opción.
  const [equipmentStepDone, setEquipmentStepDone] = useState(false);
  const [categoryStepDone, setCategoryStepDone] = useState(false);
  const [recurrenceTab, setRecurrenceTab] = useState<RecurrenceTab>('ALL');
  const [applicabilityTab, setApplicabilityTab] = useState<ApplicabilityTab>('APPLIES');
  const [historyTask, setHistoryTask] = useState<MaintenancePlanItem | null>(null);
  const [notApplicableTask, setNotApplicableTask] = useState<MaintenancePlanItem | null>(null);
  const [maintenanceTab, setMaintenanceTab] = useState<MaintenanceTypeTab>('ALL');
  const [onlyPendingAction, setOnlyPendingAction] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [inlineStByTaskId, setInlineStByTaskId] = useState<Record<string, { id: string; folio: string }>>({});
  const [pendingSTSelection, setPendingSTSelection] = useState<PendingSTSelection | null>(null);
  const [lastApplicabilityAction, setLastApplicabilityAction] = useState<ApplicabilityUndoAction | null>(null);
  const [applicabilityBusyTaskId, setApplicabilityBusyTaskId] = useState<string | null>(null);

  // Sync URL → filter when navigating here from Dashboard
  useEffect(() => {
    const s = searchParams.get('status') as PlanItemStatus | '';
    if (s) {
      setFilterStatus(s);
      // Si llega con intención (ej. "Vencidas" del Dashboard), no lo hacemos
      // pasar por Equipo → Categoría para llegar al filtro que ya pidió.
      setEquipmentStepDone(true);
      setCategoryStepDone(true);
    }
  }, [searchParams]);

  // Sync URL → selected aircraft when navigating here from another page (ej. detalle de ST)
  useEffect(() => {
    const aircraftId = searchParams.get('aircraftId') ?? searchParams.get('aircraft');
    if (aircraftId) setSelectedId(aircraftId);
  }, [searchParams]);
  const [modal, setModal] = useState<ModalState>(null);
  const selectWorkRequest = useWorkRequestStore((s) => s.selectWorkRequest);
  const getDraftWorkRequestByAircraft = useWorkRequestStore((s) => s.getDraftWorkRequestByAircraft);
  const workRequests = useWorkRequestStore((s) => s.workRequests);
  const setWorkRequests = useWorkRequestStore((s) => s.setWorkRequests);
  const itemAlreadyInOpenWorkRequest = useWorkRequestStore((s) => s.itemAlreadyInOpenWorkRequest);

  const qc = useQueryClient();

  const { data: result, isLoading: loadingAircraft } = useQuery({
    queryKey: ['aircraft'],
    queryFn: () => aircraftApi.findAll(),
  });
  const allAircraft: Aircraft[] = result ?? [];

  const {
    data: planItems = [],
    isLoading: loadingPlan,
    isError: planError,
    error: planErrorDetails,
  } = useQuery({
    queryKey: ['maintenance-plan', selectedId],
    queryFn: () => maintenancePlanApi.getForAircraft(selectedId!, { includeNotApplicable: true }),
    enabled: !!selectedId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const workRequestsForAircraftQuery = useQuery({
    queryKey: ['work-requests-aircraft', selectedId],
    queryFn: () => workRequestsApi.listByAircraft(selectedId!),
    enabled: Boolean(selectedId),
    staleTime: 0,
  });

  useEffect(() => {
    if (!selectedId) return;
    if (!workRequestsForAircraftQuery.isSuccess) return;

    const mapped = workRequestsForAircraftQuery.data.map(adaptApiWorkRequest);
    const current = useWorkRequestStore.getState().workRequests;
    const currentForAircraft = current
      .filter((wr) => wr.aircraftId === selectedId)
      .map((wr) => ({ id: wr.id, status: wr.status, updatedAt: wr.updatedAt, itemsCount: wr.items.length }));
    const nextForAircraft = mapped
      .map((wr) => ({ id: wr.id, status: wr.status, updatedAt: wr.updatedAt, itemsCount: wr.items.length }));

    if (JSON.stringify(currentForAircraft) === JSON.stringify(nextForAircraft)) return;

    setWorkRequests([
      ...current.filter((wr) => wr.aircraftId !== selectedId),
      ...mapped,
    ]);
  }, [selectedId, setWorkRequests, workRequestsForAircraftQuery.isSuccess, workRequestsForAircraftQuery.data]);

  // All org tasks — preloaded so "edit" can look up the full definition
  const { data: allTasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: tasksApi.listAll });

  const selectedAircraft = allAircraft.find(a => a.id === selectedId) ?? null;

  const { data: noteCounts = {} } = useQuery({
    queryKey: ['task-note-counts', selectedId],
    queryFn: () => taskNotesApi.countsByAircraft(selectedId!),
    enabled: !!selectedId,
  });

  const invalidatePlan = () => qc.invalidateQueries({ queryKey: ['maintenance-plan', selectedId] });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const recordMutation = useMutation({
    mutationFn: (input: RecordComplianceInput) => complianceApi.record(input),
    onSuccess: () => { toast.success('Cumplimiento registrado'); setModal(null); invalidatePlan(); },
    onError: () => toast.error('No se pudo registrar el cumplimiento'),
  });

  const assignMutation = useMutation({
    mutationFn: (taskId: string) => tasksApi.assignToAircraft(selectedId!, taskId),
    onSuccess: () => { toast.success('Tarea asignada al plan'); invalidatePlan(); },
    onError: () => toast.error('No se pudo asignar la tarea'),
  });

  const removeMutation = useMutation({
    mutationFn: (taskId: string) => tasksApi.removeFromAircraft(selectedId!, taskId),
    onSuccess: () => { toast.success('Tarea eliminada del plan'); setModal(null); invalidatePlan(); },
    onError: () => toast.error('No se pudo eliminar la tarea'),
  });

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => tasksApi.create(input),
    onSuccess: (task) => {
      toast.success(`Tarea ${task.code} creada`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
      // Auto-assign to current aircraft if one is selected
      if (selectedId) {
        tasksApi.assignToAircraft(selectedId, task.id).then(invalidatePlan).catch(() => void 0);
      }
      setModal(null);
    },
    onError: (err: Error) => toast.error(err.message ?? 'No se pudo crear la tarea'),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateTaskInput> }) => tasksApi.update(id, input),
    onSuccess: () => {
      toast.success('Tarea actualizada');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      invalidatePlan();
      setModal(null);
    },
    onError: () => toast.error('No se pudo actualizar la tarea'),
  });

  const selectedAircraftReg = selectedAircraft?.registration ?? '';
  const assignedTaskIds = useMemo(() => planItems.map(i => i.taskId), [planItems]);

  useEffect(() => {
    setInlineStByTaskId({});
    setSelectedTaskIds([]);
    setLastApplicabilityAction(null);
  }, [selectedId]);

  const setTaskApplicability = async (
    item: MaintenancePlanItem,
    applies: boolean,
    options?: { trackUndo?: boolean; aircraftIdOverride?: string; notes?: string | null },
  ) => {
    const aircraftId = options?.aircraftIdOverride ?? selectedId;
    if (!aircraftId) {
      toast.error('Selecciona una aeronave');
      return;
    }

    setApplicabilityBusyTaskId(item.taskId);
    try {
      await tasksApi.setApplicability(aircraftId, item.taskId, {
        applies,
        notes: options?.notes ?? null,
      });

      qc.invalidateQueries({ queryKey: ['maintenance-plan', aircraftId] });

      if (options?.trackUndo !== false) {
        setLastApplicabilityAction({
          aircraftId,
          taskId: item.taskId,
          taskCode: item.taskCode,
          appliesAfterChange: applies,
          previousNotes: item.applicabilityNotes,
        });
        toast.success(applies ? 'Marcada como aplica' : 'Marcada como no aplica');
        toast('Presiona Ctrl+Z o Cmd+Z para deshacer', { icon: '↩️' });
      }
    } catch {
      toast.error(applies ? 'No se pudo marcar como aplica' : 'No se pudo marcar como no aplica');
    } finally {
      setApplicabilityBusyTaskId(null);
    }
  };

  const undoLastApplicabilityChange = async () => {
    if (!lastApplicabilityAction || applicabilityBusyTaskId) return;

    const reverseApplies = !lastApplicabilityAction.appliesAfterChange;
    setApplicabilityBusyTaskId(lastApplicabilityAction.taskId);

    try {
      await tasksApi.setApplicability(
        lastApplicabilityAction.aircraftId,
        lastApplicabilityAction.taskId,
        {
          applies: reverseApplies,
          notes: reverseApplies ? null : lastApplicabilityAction.previousNotes ?? 'Restaurado por deshacer',
        },
      );

      qc.invalidateQueries({ queryKey: ['maintenance-plan', lastApplicabilityAction.aircraftId] });
      toast.success(`Deshecho: ${lastApplicabilityAction.taskCode}`);
      setLastApplicabilityAction(null);
    } catch {
      toast.error('No se pudo deshacer el último cambio');
    } finally {
      setApplicabilityBusyTaskId(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
      if (!isUndo) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const typingField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
        if (typingField) return;
      }

      if (!lastApplicabilityAction) return;
      event.preventDefault();
      void undoLastApplicabilityChange();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lastApplicabilityAction, applicabilityBusyTaskId]);

  const resolveInlineSt = (item: MaintenancePlanItem) => inlineStByTaskId[item.taskId];

  const taskWorkflowByTaskId = useMemo(() => {
    const map = new Map<string, { state: 'none' | 'open' | 'valid'; stId?: string; stRef?: string }>();
    if (!selectedId) return map;

    const validStatuses = new Set([
      'SENT',
    ]);

    const openStatuses = new Set(['DRAFT']);

    for (const wr of workRequests) {
      if (wr.aircraftId !== selectedId) continue;
      const hasOtEvidence = true;
      const state: 'open' | 'valid' | null = validStatuses.has(wr.status) && hasOtEvidence
        ? 'valid'
        : openStatuses.has(wr.status)
          ? 'open'
          : null;

      if (!state) continue;

      for (const wrItem of wr.items) {
        if (wrItem.sourceKind !== 'maintenance_plan' || !wrItem.sourceId) continue;
        const existing = map.get(wrItem.sourceId);
        if (!existing || (existing.state !== 'valid' && state === 'valid')) {
          map.set(wrItem.sourceId, { state, stId: wr.id, stRef: wr.folio });
        }
      }
    }

    for (const [taskId, st] of Object.entries(inlineStByTaskId)) {
      if (!map.has(taskId)) {
        map.set(taskId, { state: 'open', stId: st.id, stRef: st.folio });
      }
    }

    return map;
  }, [workRequests, selectedId, inlineStByTaskId]);

  const resolveTaskWorkflow = (item: MaintenancePlanItem) => {
    const fromMap = taskWorkflowByTaskId.get(item.taskId);
    if (fromMap) return fromMap;

    const inline = resolveInlineSt(item);
    if (inline) return { state: 'open' as const, stId: inline.id, stRef: inline.folio };

    if (item.inWorkRequestId || item.inWorkRequestNumber) {
      return {
        state: 'open' as const,
        stId: item.inWorkRequestId ?? undefined,
        stRef: item.inWorkRequestNumber ?? item.inWorkRequestId ?? undefined,
      };
    }

    return { state: 'none' as const };
  };

  const isItemInRequest = (item: MaintenancePlanItem) => resolveTaskWorkflow(item).state !== 'none';

  const priorityContext = useMemo(
    () => ({ currentHours: selectedAircraft?.totalFlightHours ?? null, today: new Date() }),
    [selectedAircraft?.totalFlightHours],
  );

  const smartPriorityByTaskId = useMemo(() => {
    const map = new Map<string, SmartPriority>();
    for (const item of planItems) {
      map.set(item.taskId, getSmartPriority(item, priorityContext));
    }
    return map;
  }, [planItems, priorityContext]);

  const filteredPlan = useMemo(() => {
    return planItems
      .filter(i => {
        // El control de vida de componentes vive en la página de Componentes:
        // el plan solo lo muestra si se pide su pestaña explícitamente.
        if (normativeTab === 'PROGRAMA' ? i.isComponentControl : classifyTaskCategory(i) !== normativeTab) return false;
        if (equipmentTab !== 'ALL' && i.equipmentScope !== equipmentTab) return false;
        if (applicabilityTab === 'APPLIES' && !i.isApplicable) return false;
        if (applicabilityTab === 'NOT_APPLIES' && i.isApplicable) return false;
        if (recurrenceTab === 'REPETITIVE' && i.complianceRecurrence !== 'REPETITIVE') return false;
        if (recurrenceTab === 'ONE_TIME' && i.complianceRecurrence !== 'ONE_TIME') return false;
        if (maintenanceTab !== 'ALL' && classifyMaintenanceType(i) !== maintenanceTab) return false;
        if (filterStatus && i.status !== filterStatus) return false;
        if (onlyPendingAction && i.status === 'OK') return false;
        if (search) {
          const q = search.toLowerCase();
          return i.taskCode.toLowerCase().includes(q) || i.taskTitle.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => {
        const ap = smartPriorityByTaskId.get(a.taskId) ?? getSmartPriority(a, priorityContext);
        const bp = smartPriorityByTaskId.get(b.taskId) ?? getSmartPriority(b, priorityContext);

        const bandSort = BAND_ORDER[ap.band] - BAND_ORDER[bp.band];
        if (bandSort !== 0) return bandSort;

        const ar = ap.remaining ?? Number.POSITIVE_INFINITY;
        const br = bp.remaining ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;

        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      });
  }, [planItems, filterStatus, normativeTab, equipmentTab, recurrenceTab, applicabilityTab, maintenanceTab, search, smartPriorityByTaskId, onlyPendingAction, priorityContext]);

  const getSortValue = (item: MaintenancePlanItem, key: string): unknown => {
    switch (key) {
      case 'tarea': return item.taskCode;
      case 'tipo': return MAINTENANCE_TYPE_META[classifyMaintenanceType(item)].label;
      case 'intervalo': return item.intervalHours ?? item.intervalCycles ?? item.intervalCalendarDays ?? item.intervalCalendarMonths;
      case 'proximo': return item.nextDueDate ? new Date(item.nextDueDate) : item.nextDueHours ?? item.nextDueCycles;
      case 'historico': return item.lastPerformedAt ? new Date(item.lastPerformedAt) : item.controlStartAt ? new Date(item.controlStartAt) : null;
      case 'estado': return STATUS_ORDER[item.status];
      default: return null;
    }
  };

  // Sin orden manual, se conserva el orden inteligente por prioridad ya calculado en filteredPlan.
  const visiblePlan = useMemo(() => applySort(filteredPlan, sort, getSortValue), [filteredPlan, sort]);

  // Las tareas marcadas "no aplica" siguen en el plan, pero no deben contar como
  // pendientes ni disparar alertas de aeronavegabilidad.
  const activePlanItems = useMemo(() => planItems.filter((i) => i.isApplicable), [planItems]);

  const normativeCounts = useMemo(() => {
    // El conteo de categorías respeta el equipo elegido, y viceversa: así las
    // cifras acompañan al filtro en vez de contradecirlo.
    const scopedByEquipment = equipmentTab === 'ALL'
      ? activePlanItems
      : activePlanItems.filter(i => i.equipmentScope === equipmentTab);
    const ad = scopedByEquipment.filter(i => classifyTaskCategory(i) === 'AD').length;
    const sb = scopedByEquipment.filter(i => classifyTaskCategory(i) === 'SB').length;
    const mim = scopedByEquipment.filter(i => classifyTaskCategory(i) === 'MIM').length;
    const inspecciones = scopedByEquipment.filter(i => classifyTaskCategory(i) === 'INSPECCIONES').length;
    const componentes = scopedByEquipment.filter(i => classifyTaskCategory(i) === 'COMPONENTES').length;
    const total = scopedByEquipment.filter(i => !i.isComponentControl).length;
    return { ad, sb, mim, inspecciones, componentes, total };
  }, [activePlanItems, equipmentTab]);

  /** Conteo por equipo, respetando la categoría normativa ya elegida. */
  const equipmentCounts = useMemo(() => {
    const scopedByCategory = normativeTab === 'PROGRAMA'
      ? activePlanItems.filter(i => !i.isComponentControl)
      : activePlanItems.filter(i => classifyTaskCategory(i) === normativeTab);
    return {
      ALL: scopedByCategory.length,
      AIRCRAFT: scopedByCategory.filter(i => i.equipmentScope === 'AIRCRAFT').length,
      ENGINE: scopedByCategory.filter(i => i.equipmentScope === 'ENGINE').length,
    };
  }, [activePlanItems, normativeTab]);

  const applicabilityCounts = useMemo(() => ({
    applies: planItems.filter((i) => i.isApplicable).length,
    notApplies: planItems.filter((i) => !i.isApplicable).length,
  }), [planItems]);

  /** Conteo de recurrencia sobre el origen ya elegido, para que las cifras acompañen al filtro. */
  const recurrenceCounts = useMemo(() => {
    const byEquipment = equipmentTab === 'ALL'
      ? activePlanItems
      : activePlanItems.filter((i) => i.equipmentScope === equipmentTab);
    const scoped = normativeTab === 'PROGRAMA'
      ? byEquipment.filter((i) => !i.isComponentControl)
      : byEquipment.filter((i) => {
          return classifyTaskCategory(i) === normativeTab;
        });
    return {
      repetitive: scoped.filter((i) => i.complianceRecurrence === 'REPETITIVE').length,
      oneTime: scoped.filter((i) => i.complianceRecurrence === 'ONE_TIME').length,
    };
  }, [activePlanItems, normativeTab, equipmentTab]);

  const pendingActionCount = useMemo(() => (
    activePlanItems.filter((item) => item.status !== 'OK').length
  ), [activePlanItems]);

  const smartSummary = useMemo(() => {
    const criticalItems = filteredPlan.filter((item) => {
      const priority = smartPriorityByTaskId.get(item.taskId) ?? getSmartPriority(item, priorityContext);
      return priority.visual === 'critical';
    });

    const byHours = criticalItems.filter((item) => {
      const priority = smartPriorityByTaskId.get(item.taskId) ?? getSmartPriority(item, priorityContext);
      return priority.driver === 'HORAS';
    }).length;

    const byDate = criticalItems.filter((item) => {
      const priority = smartPriorityByTaskId.get(item.taskId) ?? getSmartPriority(item, priorityContext);
      return priority.driver === 'FECHA';
    }).length;

    return {
      critical: criticalItems.length,
      byHours,
      byDate,
    };
  }, [filteredPlan, smartPriorityByTaskId, priorityContext]);

  const draftForAircraft = useMemo(() => (
    selectedId ? getDraftWorkRequestByAircraft(selectedId) : null
  ), [selectedId, getDraftWorkRequestByAircraft]);

  const openWorkRequestsForAircraft = useMemo(() => {
    if (!selectedId) return [];
    return workRequests.filter((wr) => wr.aircraftId === selectedId && isActiveWorkRequestStatus(wr.status));
  }, [selectedId, workRequests]);

  const aircraftRiskScore = useMemo(() => {
    let overdueCount = 0;
    let dueSoonCriticalCount = 0;
    let mixedCriticalCount = 0;
    let neverRelevantCount = 0;
    let inWorkRequestCount = 0;
    let dueSoonCount = 0;

    for (const item of activePlanItems) {
      const priority = smartPriorityByTaskId.get(item.taskId) ?? getSmartPriority(item, priorityContext);
      const maintenanceType = classifyMaintenanceType(item);
      const inRequest = isItemInRequest(item);

      if (item.status === 'OVERDUE') overdueCount += 1;
      if (item.status === 'DUE_SOON') dueSoonCount += 1;
      if (item.status === 'DUE_SOON' && priority.visual === 'critical') dueSoonCriticalCount += 1;

      const mixedCriticalSoon = maintenanceType === 'MIXTO'
        && (
          priority.visual === 'critical'
          || priority.visual === 'attention'
        );
      if (mixedCriticalSoon) mixedCriticalCount += 1;

      if (item.status === 'NEVER_PERFORMED' && (item.isMandatory || priority.visual !== 'controlled')) {
        neverRelevantCount += 1;
      }

      if (inRequest) inWorkRequestCount += 1;
    }

    const rawScore = (
      overdueCount * 30
      + dueSoonCriticalCount * 15
      + mixedCriticalCount * 20
      + neverRelevantCount * 2
    );

    const mitigation = Math.min(inWorkRequestCount * 8, Math.floor(rawScore * 0.35));
    const score = Math.max(0, Math.min(100, rawScore - mitigation));

    const level: RiskLevel = score >= 75
      ? 'critico'
      : score >= 50
        ? 'alto'
        : score >= 25
          ? 'medio'
          : 'bajo';

    return {
      score,
      level,
      overdueCount,
      dueSoonCount,
      inWorkRequestCount,
      rawScore,
      mitigation,
    };
  }, [activePlanItems, smartPriorityByTaskId, inlineStByTaskId, priorityContext]);

  const aircraftAlert = useMemo(() => {
    const overdueCount = activePlanItems.filter((item) => item.status === 'OVERDUE').length;
    const dueSoonCount = activePlanItems.filter((item) => item.status === 'DUE_SOON').length;

    const mixedCriticalSoonCount = activePlanItems.filter((item) => {
      if (classifyMaintenanceType(item) !== 'MIXTO') return false;
      const priority = smartPriorityByTaskId.get(item.taskId) ?? getSmartPriority(item, priorityContext);
      return priority.visual === 'critical' || priority.visual === 'attention';
    }).length;

    const pendingWithoutSTCount = activePlanItems.filter((item) => (
      item.status !== 'OK' && !isItemInRequest(item)
    )).length;

    // Las filas de componentes salen del plan por defecto, pero su vencimiento
    // debe seguir avisando aquí: una batería vencida no puede dejar de verse.
    const componentOverdueCount = activePlanItems.filter(
      (item) => item.isComponentControl && item.status === 'OVERDUE',
    ).length;
    const componentDueSoonCount = activePlanItems.filter(
      (item) => item.isComponentControl && item.status === 'DUE_SOON',
    ).length;

    const draftItemsCount = draftForAircraft?.items.length ?? 0;
    const hasAccumulatedDraft = draftItemsCount >= 3;

    const state: AircraftAlertState = overdueCount >= 1
      ? 'critical'
      : (dueSoonCount >= 3 || mixedCriticalSoonCount >= 1 || pendingWithoutSTCount >= 4)
        ? 'attention'
        : 'normal';

    return {
      state,
      overdueCount,
      dueSoonCount,
      mixedCriticalSoonCount,
      pendingWithoutSTCount,
      componentOverdueCount,
      componentDueSoonCount,
      hasAccumulatedDraft,
      draftItemsCount,
    };
  }, [planItems, smartPriorityByTaskId, draftForAircraft, inlineStByTaskId, priorityContext]);

  const handleReviewCritical = () => {
    setOnlyPendingAction(true);
    setFilterStatus(aircraftAlert.state === 'critical' ? 'OVERDUE' : 'DUE_SOON');
  };

  // Handlers for TaskRow callbacks
  const handleRecord = async (item: MaintenancePlanItem) => {
    if (!selectedId) {
      toast.error('Selecciona una aeronave');
      return;
    }
    const executionType = item.executionType === 'component_replacement'
      ? 'component_replacement'
      : 'maintenance_application';
    const eligibility = await workRequestsApi.getExecutionEligibility(selectedId, {
      sourceKind: 'maintenance_plan',
      sourceId: item.taskId,
      executionType,
    });
    if (!eligibility.eligible || !eligibility.workOrderNumber) {
      toast.error(eligibility.message);
      return;
    }
    setModal({ type: 'record-compliance', item, workOrderNumber: eligibility.workOrderNumber });
  };
  const handleEdit   = (item: MaintenancePlanItem) => {
    const task = allTasks.find(t => t.id === item.taskId);
    if (task) setModal({ type: 'edit-task', task });
    else toast.error('No se encontró la definición de la tarea');
  };
  const handleRemove = (item: MaintenancePlanItem) => setModal({ type: 'confirm-remove', item });

  const applyInlineStForTask = (taskId: string, stId: string) => {
    const wr = workRequests.find((x) => x.id === stId);
    setInlineStByTaskId((prev) => ({
      ...prev,
      [taskId]: { id: stId, folio: wr?.folio ?? stId },
    }));
  };

  const addTaskItemToWorkRequest = async (item: MaintenancePlanItem, workRequestId: string, options?: { silent?: boolean }) => {
    if (!selectedAircraft) return;

    const wr = workRequests.find((x) => x.id === workRequestId);
    const alreadyInTarget = wr?.items.some((it) => it.sourceKind === 'maintenance_plan' && it.sourceId === item.taskId);
    if (alreadyInTarget) {
      applyInlineStForTask(item.taskId, workRequestId);
      if (!options?.silent) toast('La tarea ya estaba en esta ST', { icon: 'ℹ️' });
      return { added: false, linked: true };
    }

    try {
      const updated = await workRequestsApi.addItem(workRequestId, {
        taskId: item.taskId,
        category: 'MAINTENANCE_PLAN',
      });
      const adapted = adaptApiWorkRequest(updated);
      setWorkRequests([
        adapted,
        ...useWorkRequestStore.getState().workRequests.filter((wrCurrent) => wrCurrent.id !== adapted.id),
      ]);
    } catch {
      if (!options?.silent) toast.error('No se pudo agregar el item al borrador ST');
      return { added: false, linked: false };
    }

    applyInlineStForTask(item.taskId, workRequestId);
    if (!options?.silent) toast.success('Agregado al borrador ST');
    return { added: true, linked: true };
  };

  const addItemsToWorkRequest = async (
    items: MaintenancePlanItem[],
    workRequestId: string,
    options?: { mode?: 'single' | 'multi' },
  ) => {
    const unique = Array.from(new Map(items.map((item) => [item.taskId, item])).values());
    let added = 0;
    let linked = 0;

    for (const item of unique) {
      const result = await addTaskItemToWorkRequest(item, workRequestId, { silent: true });
      if (result?.linked) linked += 1;
      if (result?.added) added += 1;
    }

    const wr = workRequests.find((x) => x.id === workRequestId);
    const stRef = wr?.folio ?? workRequestId;

    if (linked > 0) {
      if (options?.mode === 'single') {
        toast.success(`Ítem agregado a ${stRef}`);
      } else {
        toast.success(`${linked} ítems agregados a ${stRef}`);
      }
    } else {
      toast('No hubo ítems para agregar', { icon: 'ℹ️' });
    }

    setSelectedTaskIds([]);
    return { added, linked, stId: workRequestId, stRef };
  };

  const getSTCandidates = () => (
    openWorkRequestsForAircraft.map((wr) => ({
      id: wr.id,
      folio: wr.folio,
      statusLabel: wr.status === 'DRAFT' ? 'Borrador' : 'En proceso',
      itemsCount: wr.items.length,
    }))
  );

  const sendItemsToST = async (items: MaintenancePlanItem[], options?: { mode?: 'single' | 'multi' }) => {
    if (!selectedAircraft) {
      toast.error('Selecciona una aeronave para agregar ítems a ST');
      return;
    }

    const validItems = items.filter((item) => !item.inWorkRequestId);
    if (validItems.length === 0) {
      toast('Todas las tareas seleccionadas ya están en una ST', { icon: 'ℹ️' });
      setSelectedTaskIds([]);
      return;
    }

    if (openWorkRequestsForAircraft.length > 1) {
      setPendingSTSelection({ items: validItems, candidates: getSTCandidates() });
      return;
    }

    try {
      const target = draftForAircraft ?? adaptApiWorkRequest(await workRequestsApi.createDraft(selectedAircraft.id));
      if (!draftForAircraft) {
        setWorkRequests([
          target,
          ...useWorkRequestStore.getState().workRequests.filter((wr) => wr.id !== target.id),
        ]);
      }
      await addItemsToWorkRequest(validItems, target.id, { mode: options?.mode ?? 'multi' });
    } catch {
      toast.error('No se pudo crear o actualizar la ST');
    }
  };

  const handleGenerateSTFromPlan = (item: MaintenancePlanItem) => {
    if (!selectedAircraft) {
      toast.error('Selecciona una aeronave para agregar el item a ST');
      return;
    }

    const existingInline = resolveInlineSt(item);
    if (existingInline) {
      toast('La tarea ya está agregada a un borrador ST', { icon: 'ℹ️' });
      return;
    }

    if (item.inWorkRequestId) {
      toast('Esta tarea ya tiene una ST activa', { icon: 'ℹ️' });
      return;
    }

    const existingOpenForItem = itemAlreadyInOpenWorkRequest('maintenance_plan', item.taskId);
    if (existingOpenForItem) {
      applyInlineStForTask(item.taskId, existingOpenForItem.id);
      toast('La tarea ya estaba en una ST abierta', { icon: 'ℹ️' });
      return;
    }

    void sendItemsToST([item], { mode: 'single' });
  };

  const handleToggleTaskSelection = (item: MaintenancePlanItem, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      if (checked) return prev.includes(item.taskId) ? prev : [...prev, item.taskId];
      return prev.filter((id) => id !== item.taskId);
    });
  };

  const selectedItems = useMemo(() => (
    filteredPlan.filter((item) => selectedTaskIds.includes(item.taskId))
  ), [filteredPlan, selectedTaskIds]);

  const handleAddSelectedToST = () => {
    if (selectedItems.length === 0) {
      toast('Selecciona al menos una tarea', { icon: 'ℹ️' });
      return;
    }
    void sendItemsToST(selectedItems, { mode: 'multi' });
  };

  const handleViewSTFromPlan = (item: MaintenancePlanItem, stId?: string) => {
    if (!selectedAircraft) return;
    const targetId = stId ?? item.inWorkRequestId ?? resolveInlineSt(item)?.id;
    if (!targetId) return;
    selectWorkRequest(targetId, 'general');
    navigate(`/work-requests?aircraftId=${selectedAircraft.id}&stId=${targetId}`);
  };

  return (
    <>
    <div className="p-6 lg:p-8 min-h-full flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 lg:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-[320px] flex-1">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-3">Plan de Mantenimiento</h1>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Aeronave</label>
            <select
              className="input w-full"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              disabled={loadingAircraft}
            >
              <option value="">{loadingAircraft ? 'Cargando aeronaves…' : 'Seleccionar aeronave'}</option>
              {allAircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.registration} · {a.manufacturer} {a.model}
                </option>
              ))}
            </select>
            {selectedAircraft && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-slate-500">Matrícula</p>
                  <p className="font-semibold text-slate-900 font-mono">{selectedAircraft.registration}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-slate-500">Modelo</p>
                  <p className="font-semibold text-slate-900">{selectedAircraft.manufacturer} {selectedAircraft.model}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-slate-500">Horas / ciclos</p>
                  <p className="font-semibold text-slate-900">{selectedAircraft.totalFlightHours.toFixed(0)}h / {selectedAircraft.totalCycles} cic.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-slate-500">Estado operacional</p>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getOperationalStatusClass(selectedAircraft.status)}`}>
                    {getOperationalStatusLabel(selectedAircraft.status)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 min-w-[280px] w-full lg:w-auto">
            <div className="flex items-start justify-end gap-2.5 flex-wrap lg:flex-nowrap">
              <div className="text-right rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 min-w-[112px]">
                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Tareas asignadas</p>
                <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none mt-1">{activePlanItems.length}</p>
              </div>

              {selectedAircraft && (
                <div className={`rounded-xl border px-3.5 py-2.5 min-w-[230px] ${RISK_LEVEL_META[aircraftRiskScore.level].card}`}>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">Riesgo Operacional</p>
                  <div className="flex items-end gap-2 mt-1">
                    <p className="text-3xl font-extrabold text-slate-900 tabular-nums leading-none">{aircraftRiskScore.score}</p>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${RISK_LEVEL_META[aircraftRiskScore.level].badge}`}>
                      {RISK_LEVEL_META[aircraftRiskScore.level].label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1" title="Calculado según vencimientos, proximidad y tareas sin control">
                    Calculado según vencimientos, proximidad y tareas sin control
                  </p>
                  <p className="text-[11px] text-slate-700 mt-1.5 font-medium">
                    {aircraftRiskScore.overdueCount} vencida{aircraftRiskScore.overdueCount !== 1 ? 's' : ''} · {aircraftRiskScore.dueSoonCount} próxima{aircraftRiskScore.dueSoonCount !== 1 ? 's' : ''} · {aircraftRiskScore.inWorkRequestCount} en solicitud
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-2.5">
              <button
                onClick={() => setModal({ type: 'assign-task' })}
                className="btn-primary gap-1.5"
                disabled={!selectedAircraft}
              >
                <Plus size={15} />
                Agregar tarea
              </button>
              <button
                onClick={() => navigate(`/work-requests?aircraftId=${selectedId ?? ''}`)}
                className="btn-secondary gap-1.5"
                title="Ver Solicitudes de Trabajo"
                disabled={!selectedAircraft}
              >
                Ver solicitudes
              </button>
            </div>
          </div>
        </div>

        {selectedAircraft && planItems.length > 0 && (
          <div className="mt-5">
            <SummaryBar items={planItems} />
          </div>
        )}
      </div>

      {!selectedAircraft ? (
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400 gap-3">
          <ClipboardCheck size={40} strokeWidth={1.5} className="text-slate-300" />
          <p className="text-sm font-medium">Selecciona una aeronave para ver su plan</p>
        </div>
      ) : (
        <>
          {(aircraftAlert.state !== 'normal' || aircraftAlert.hasAccumulatedDraft) && (
            <div
              className={`rounded-2xl border border-l-4 px-5 py-4 shadow-sm bg-white ${
                aircraftAlert.state === 'critical'
                  ? `${AIRCRAFT_ALERT_META.critical.rail} ${AIRCRAFT_ALERT_META.critical.border}`
                  : aircraftAlert.state === 'attention'
                    ? `${AIRCRAFT_ALERT_META.attention.rail} ${AIRCRAFT_ALERT_META.attention.border}`
                    : 'border-l-slate-300 border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className={`text-sm font-semibold ${
                    aircraftAlert.state === 'critical'
                      ? AIRCRAFT_ALERT_META.critical.text
                      : aircraftAlert.state === 'attention'
                        ? AIRCRAFT_ALERT_META.attention.text
                        : 'text-slate-700'
                  }`}>
                    {aircraftAlert.state === 'critical'
                      ? AIRCRAFT_ALERT_META.critical.title
                      : aircraftAlert.state === 'attention'
                        ? AIRCRAFT_ALERT_META.attention.title
                        : 'Hay acciones pendientes por organizar'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    {aircraftAlert.overdueCount > 0 && `${aircraftAlert.overdueCount} vencida${aircraftAlert.overdueCount !== 1 ? 's' : ''}`}
                    {aircraftAlert.overdueCount > 0 && aircraftAlert.dueSoonCount > 0 && ' · '}
                    {aircraftAlert.dueSoonCount > 0 && `${aircraftAlert.dueSoonCount} próxima${aircraftAlert.dueSoonCount !== 1 ? 's' : ''}`}
                    {(aircraftAlert.overdueCount > 0 || aircraftAlert.dueSoonCount > 0) && aircraftAlert.mixedCriticalSoonCount > 0 && ' · '}
                    {aircraftAlert.mixedCriticalSoonCount > 0 && `${aircraftAlert.mixedCriticalSoonCount} mixta muy cercana`}
                    {(aircraftAlert.overdueCount > 0 || aircraftAlert.dueSoonCount > 0 || aircraftAlert.mixedCriticalSoonCount > 0) && aircraftAlert.pendingWithoutSTCount > 0 && ' · '}
                    {aircraftAlert.pendingWithoutSTCount > 0 && `${aircraftAlert.pendingWithoutSTCount} pendiente${aircraftAlert.pendingWithoutSTCount !== 1 ? 's' : ''} sin ST`}
                    {(aircraftAlert.overdueCount > 0 || aircraftAlert.dueSoonCount > 0 || aircraftAlert.mixedCriticalSoonCount > 0 || aircraftAlert.pendingWithoutSTCount > 0) && aircraftAlert.hasAccumulatedDraft && ' · '}
                    {aircraftAlert.hasAccumulatedDraft && `Borrador ST con ${aircraftAlert.draftItemsCount} ítems acumulados`}
                  </p>
                  {(aircraftAlert.componentOverdueCount > 0 || aircraftAlert.componentDueSoonCount > 0) && (
                    <p className="text-xs text-slate-600 mt-1">
                      Incluye{' '}
                      {aircraftAlert.componentOverdueCount > 0 && `${aircraftAlert.componentOverdueCount} vencida${aircraftAlert.componentOverdueCount !== 1 ? 's' : ''}`}
                      {aircraftAlert.componentOverdueCount > 0 && aircraftAlert.componentDueSoonCount > 0 && ' y '}
                      {aircraftAlert.componentDueSoonCount > 0 && `${aircraftAlert.componentDueSoonCount} próxima${aircraftAlert.componentDueSoonCount !== 1 ? 's' : ''}`}
                      {' '}de control de componentes ·{' '}
                      <button
                        type="button"
                        onClick={() => setNormativeTab('COMPONENTES')}
                        className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                      >
                        ver en el plan
                      </button>
                      {' · '}
                      <button
                        type="button"
                        onClick={() => navigate('/components')}
                        className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                      >
                        ir a Componentes
                      </button>
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn-secondary btn-xs"
                    onClick={handleReviewCritical}
                  >
                    Revisar tareas críticas
                  </button>
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => navigate(`/work-requests?aircraftId=${selectedId ?? ''}`)}
                  >
                    Ver solicitudes
                  </button>
                  {draftForAircraft && (
                    <button
                      className="btn-primary btn-xs"
                      onClick={() => {
                        selectWorkRequest(draftForAircraft.id, 'general');
                        navigate(`/work-requests?aircraftId=${selectedId ?? ''}&stId=${draftForAircraft.id}`);
                      }}
                    >
                      Abrir borrador ST
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Filters — replica el flujo del Access: primero Equipo, luego
              Categoría, y recién ahí el resto de filtros finos. */}
          <div className="bg-white rounded-2xl border border-slate-200 px-6 py-4 shadow-sm">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Equipo</span>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => { setEquipmentTab('AIRCRAFT'); setEquipmentStepDone(true); }}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3.5 text-sm font-bold transition-colors ${
                      equipmentTab === 'AIRCRAFT'
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <Plane size={16} /> Aeronave ({equipmentCounts.AIRCRAFT})
                  </button>
                  <button
                    onClick={() => { setEquipmentTab('ENGINE'); setEquipmentStepDone(true); }}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3.5 text-sm font-bold transition-colors ${
                      equipmentTab === 'ENGINE'
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <Gauge size={16} /> Motor ({equipmentCounts.ENGINE})
                  </button>
                </div>
                <button
                  onClick={() => { setEquipmentTab('ALL'); setEquipmentStepDone(true); }}
                  className={`mt-2 text-xs font-medium transition-colors ${
                    equipmentTab === 'ALL' && equipmentStepDone
                      ? 'text-brand-700 font-semibold'
                      : 'text-slate-500 hover:text-brand-600'
                  }`}
                >
                  Ver todas las tareas ({equipmentCounts.ALL})
                </button>
              </div>

              {equipmentStepDone && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Categoría</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([
                      { key: 'PROGRAMA', label: `Programa (${normativeCounts.total})`, icon: ClipboardCheck },
                      { key: 'AD', label: `AD (${normativeCounts.ad})`, icon: AlertTriangle },
                      { key: 'SB', label: `SB (${normativeCounts.sb})`, icon: FileText },
                      { key: 'MIM', label: `MIM (${normativeCounts.mim})`, icon: BookOpen },
                      { key: 'INSPECCIONES', label: `Inspecciones (${normativeCounts.inspecciones})`, icon: Eye },
                      { key: 'COMPONENTES', label: `Componentes (${normativeCounts.componentes})`, icon: Package },
                    ] as const).map(tab => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => { setNormativeTab(tab.key); setCategoryStepDone(true); }}
                          className={`inline-flex items-center gap-1.5 text-sm font-bold px-3.5 py-2 rounded-xl border-2 transition-colors ${
                            normativeTab === tab.key
                              ? 'border-brand-600 bg-brand-50 text-brand-700'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <Icon size={15} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {categoryStepDone && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1 shrink-0">Aplicabilidad</span>
                    {([
                      { key: 'APPLIES', label: `Aplica (${applicabilityCounts.applies})` },
                      { key: 'NOT_APPLIES', label: `No aplica (${applicabilityCounts.notApplies})` },
                      { key: 'ALL', label: 'Todas' },
                    ] as const).map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => setApplicabilityTab(tab.key)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors shrink-0 ${
                          applicabilityTab === tab.key
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1 shrink-0">Recurrencia</span>
                    {([
                      { key: 'ALL', label: 'Todas' },
                      { key: 'REPETITIVE', label: `Repetitivas (${recurrenceCounts.repetitive})` },
                      { key: 'ONE_TIME', label: `Cumplimiento único (${recurrenceCounts.oneTime})` },
                    ] as const).map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => setRecurrenceTab(tab.key)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors shrink-0 ${
                          recurrenceTab === tab.key
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1 shrink-0">Tipo de control</span>
                    {([
                      { key: 'ALL', label: 'Todas' },
                      { key: 'HORARIO', label: 'Horario', icon: Clock },
                      { key: 'CALENDARIO', label: 'Calendario', icon: Calendar },
                      { key: 'MIXTO', label: 'Mixto', icon: RefreshCw },
                    ] as Array<{ key: MaintenanceTypeTab; label: string; icon?: typeof Clock }>).map(tab => {
                      const Icon = tab.icon;
                      const active = maintenanceTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setMaintenanceTab(tab.key)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors shrink-0 inline-flex items-center gap-1.5 ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {Icon && <Icon size={12} />}
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Buscar tarea…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="filter-input pl-8 w-56"
                      />
                    </div>
                    <select
                      value={filterStatus}
                      onChange={e => setFilterStatus(e.target.value as PlanItemStatus | '')}
                      className="filter-input cursor-pointer min-w-[170px]"
                    >
                      <option value="">Todos los estados</option>
                      <option value="OVERDUE">Vencidas</option>
                      <option value="DUE_SOON">Próx. vencer</option>
                      <option value="OK">Al día</option>
                      <option value="NEVER_PERFORMED">Sin registro</option>
                    </select>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 shrink-0">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={onlyPendingAction}
                        onChange={(e) => setOnlyPendingAction(e.target.checked)}
                      />
                      Solo pendientes de acción
                    </label>
                    {(search || filterStatus || normativeTab !== 'PROGRAMA' || equipmentTab !== 'ALL' || recurrenceTab !== 'ALL' || applicabilityTab !== 'APPLIES' || maintenanceTab !== 'ALL') && (
                      <button
                        onClick={() => { setSearch(''); setFilterStatus(''); setNormativeTab('PROGRAMA'); setEquipmentTab('ALL'); setRecurrenceTab('ALL'); setApplicabilityTab('APPLIES'); setMaintenanceTab('ALL'); }}
                        className="text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
                      >
                        Limpiar
                      </button>
                    )}
                    <button
                      onClick={() => { void undoLastApplicabilityChange(); }}
                      disabled={!lastApplicabilityAction || Boolean(applicabilityBusyTaskId)}
                      className="btn-secondary btn-xs"
                      title={lastApplicabilityAction ? `Deshacer último cambio en ${lastApplicabilityAction.taskCode}` : 'No hay cambios para deshacer'}
                    >
                      Deshacer último cambio
                    </button>
                    <span className="ml-auto text-xs text-slate-400">
                      {filteredPlan.length} tarea{filteredPlan.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

          <div className="bg-white rounded-2xl border border-slate-200 px-6 py-3 shadow-sm flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              {smartSummary.critical} tareas críticas · {smartSummary.byHours} por horas · {smartSummary.byDate} por fecha
            </p>
            <p className="text-sm text-slate-700">
              {pendingActionCount} tarea{pendingActionCount !== 1 ? 's' : ''} requieren atención · {activePlanItems.filter((item) => isItemInRequest(item)).length} ya están en solicitud
            </p>
          </div>

          {selectedItems.length > 0 && (
            <div className="sticky top-0 z-20 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-brand-800">
                {selectedItems.length} tarea{selectedItems.length !== 1 ? 's' : ''} seleccionada{selectedItems.length !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2">
                <button className="btn-primary btn-xs" onClick={handleAddSelectedToST}>
                  Agregar a ST
                </button>
                <button
                  className="btn-secondary btn-xs"
                  onClick={() => setSelectedTaskIds([])}
                >
                  Limpiar selección
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
            {loadingPlan ? (
              <div className="flex items-center justify-center h-40 text-sm text-slate-400">
                Cargando plan de mantenimiento…
              </div>
            ) : planError ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                <AlertTriangle size={28} strokeWidth={1.5} className="text-rose-300" />
                <p className="text-sm text-rose-600">No se pudo cargar el plan de mantenimiento</p>
                <p className="text-xs text-slate-400 max-w-lg text-center">
                  {(planErrorDetails as { message?: string } | null)?.message ?? 'Error de red o servidor'}
                </p>
                <button
                  onClick={() => invalidatePlan()}
                  className="btn-secondary text-xs gap-1 mt-1"
                >
                  <RefreshCw size={13} /> Reintentar
                </button>
              </div>
            ) : filteredPlan.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                <ClipboardCheck size={28} strokeWidth={1.5} className="text-slate-300" />
                <p className="text-sm">
                  {planItems.length === 0 ? 'Esta aeronave no tiene tareas asignadas' : 'No hay tareas que coincidan con los filtros'}
                </p>
                {planItems.length === 0 && (
                  <button onClick={() => setModal({ type: 'assign-task' })} className="btn-secondary text-xs gap-1 mt-1">
                    <Plus size={13} /> Agregar primera tarea
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
                  <tr>
                    <th className="table-header w-12 text-center">Sel</th>
                    <SortableHeader label="Tarea" sortKey="tarea" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header" />
                    <SortableHeader label="Tipo" sortKey="tipo" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header" />
                    <SortableHeader label="Intervalo" sortKey="intervalo" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header" />
                    <SortableHeader label="Próx. vencimiento" sortKey="proximo" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header" />
                    <SortableHeader label="Histórico" sortKey="historico" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header" />
                    <SortableHeader label="Estado" sortKey="estado" sort={sort} onSort={(k) => setSort((p) => toggleSort(p, k))} className="table-header" />
                    <th className="table-header">Solicitud</th>
                    <th className="table-header">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePlan.map(item => (
                    <TaskRow
                      key={item.taskId}
                      item={item}
                      priority={smartPriorityByTaskId.get(item.taskId) ?? getSmartPriority(item, priorityContext)}
                      workflow={resolveTaskWorkflow(item)}
                      selected={selectedTaskIds.includes(item.taskId)}
                      selectable={!isItemInRequest(item)}
                      applicabilityPending={applicabilityBusyTaskId === item.taskId || removeMutation.isPending || assignMutation.isPending}
                      onToggleSelect={handleToggleTaskSelection}
                      onSetApplicability={(taskItem, applies) => {
                        if (!selectedId) {
                          toast.error('Selecciona una aeronave');
                          return;
                        }

                        if (!applies) {
                          if (isItemInRequest(taskItem)) {
                            toast.error('No puedes marcar como no aplica una tarea con ST activa');
                            return;
                          }
                          // La no aplicabilidad exige justificación auditable.
                          setNotApplicableTask(taskItem);
                          return;
                        }

                        void setTaskApplicability(taskItem, true, { trackUndo: true });
                      }}
                      onRecord={handleRecord}
                      onViewHistory={(taskItem) => setHistoryTask(taskItem)}
                      noteCount={noteCounts[item.taskId] ?? 0}
                      onEdit={handleEdit}
                      onRemove={handleRemove}
                      onGenerateST={handleGenerateSTFromPlan}
                      onViewST={handleViewSTFromPlan}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>

    {/* ── Modals ── */}
    {modal?.type === 'record-compliance' && (
      <RecordComplianceModal
        item={modal.item}
        aircraftId={selectedId!}
        eligibleWorkOrderNumber={modal.workOrderNumber}
        onClose={() => setModal(null)}
        onSubmit={input => recordMutation.mutate(input)}
        isPending={recordMutation.isPending}
      />
    )}
    {modal?.type === 'assign-task' && (
      <AssignTaskModal
        aircraftId={selectedId!}
        assignedTaskIds={assignedTaskIds}
        onClose={() => setModal(null)}
        onAssign={taskId => assignMutation.mutate(taskId)}
        onCreateNew={() => setModal({ type: 'create-task' })}
        isPending={assignMutation.isPending}
      />
    )}
    {(modal?.type === 'create-task' || modal?.type === 'edit-task') && (
      <CreateEditTaskModal
        task={modal.type === 'edit-task' ? modal.task : null}
        onClose={() => setModal(null)}
        onCreate={input => createTaskMutation.mutate(input)}
        onUpdate={(id, input) => updateTaskMutation.mutate({ id, input })}
        isPending={createTaskMutation.isPending || updateTaskMutation.isPending}
      />
    )}
    {modal?.type === 'confirm-remove' && (
      <ConfirmRemoveModal
        item={modal.item}
        registration={selectedAircraftReg}
        onClose={() => setModal(null)}
        onConfirm={() => removeMutation.mutate(modal.item.taskId)}
        isPending={removeMutation.isPending}
      />
    )}
    {notApplicableTask && (
      <NotApplicableModal
        item={notApplicableTask}
        currentNotes={notApplicableTask.applicabilityNotes}
        isPending={applicabilityBusyTaskId === notApplicableTask.taskId}
        onCancel={() => setNotApplicableTask(null)}
        onConfirm={(notes) => {
          const target = notApplicableTask;
          setNotApplicableTask(null);
          void setTaskApplicability(target, false, { trackUndo: true, notes });
        }}
      />
    )}

    {historyTask && selectedId && (
      <TaskComplianceHistoryPanel
        item={historyTask}
        aircraftId={selectedId}
        onClose={() => setHistoryTask(null)}
      />
    )}

    {pendingSTSelection && (
      <SelectWorkRequestTargetModal
        items={pendingSTSelection.items}
        candidates={pendingSTSelection.candidates}
        onClose={() => setPendingSTSelection(null)}
        onSelect={(workRequestId) => {
          void addItemsToWorkRequest(
            pendingSTSelection.items,
            workRequestId,
            { mode: pendingSTSelection.items.length === 1 ? 'single' : 'multi' },
          );
          setPendingSTSelection(null);
        }}
        onCreateNew={() => {
          if (!selectedAircraft) return;
          void (async () => {
            try {
              const fresh = adaptApiWorkRequest(await workRequestsApi.createDraft(selectedAircraft.id));
              setWorkRequests([
                fresh,
                ...useWorkRequestStore.getState().workRequests.filter((wr) => wr.id !== fresh.id),
              ]);
              await addItemsToWorkRequest(
                pendingSTSelection.items,
                fresh.id,
                { mode: pendingSTSelection.items.length === 1 ? 'single' : 'multi' },
              );
            } catch {
              toast.error('No se pudo crear la ST');
            } finally {
              setPendingSTSelection(null);
            }
          })();
        }}
      />
    )}
    </>
  );
}
