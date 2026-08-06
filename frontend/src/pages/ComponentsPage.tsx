import { type ReactNode, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { componentApi, type ComponentComplianceRecord, type CreateComponentInput, type RegisterInitialComponentInput } from '@api/component.api';
import { aircraftApi } from '@api/aircraft.api';
import { maintenancePlanApi } from '@api/maintenancePlan.api';
import type { MaintenancePlanItem } from '@api/maintenancePlan.api';
import { complianceApi } from '@api/compliance.api';
import { workRequestsApi } from '@api/workRequests.api';
import { Package, ChevronDown, X, Loader2 } from 'lucide-react';
import { createSTFromSource } from '@/shared/createSTFromSource';
import { useWorkRequestStore } from '../store/workRequestStore';
import { isActiveWorkRequestStatus } from '@/shared/workRequestTypes';
import {
  MISSING_OPERATIONAL_CONTEXT_BADGE_CLASS,
  MISSING_OPERATIONAL_CONTEXT_LABEL,
} from '@/shared/operationalContext';
import { calculateComponentDue, calculateNextDue, type ComponentDueResult } from '@/shared/componentDueCalculator';
import { mockComponentApplications, mockComponentMovements } from '@/shared/componentTrackingMocks';
import type {
  AircraftSnapshot,
  ComponentApplication,
  ComponentDefinition,
  ComponentMovement,
  WorkRequestExecutionType,
} from '@/shared/componentTrackingTypes';

interface ComponentRow {
  id: string;
  partNumber: string;
  serialNumber: string;
  description: string;
  manufacturer: string | null;
  position: string | null;
  tboHours: number | null;
  tboCycles: number | null;
  tboCalendarDays: number | null;
  lifeLimitHours: number | null;
  lifeLimitCycles: number | null;
  hoursSinceOverhaul: number | null;
  cyclesSinceOverhaul: number | null;
  totalHoursSinceNew: number | null;
  totalCyclesSinceNew: number | null;
  installationDate: string | null;
  installationAircraftHours: number | null;
  installationAircraftCycles: number | null;
  aircraftId: string | null;
}

type ExecutionContext = {
  workRequestId: string;
  workOrderNumber: string;
  officeOrderId: string;
};

type TaskExecutionType = 'maintenance' | 'component_replacement';

type TaskExecutionModel = {
  executionType: TaskExecutionType;
  requiresComponentTracking: boolean;
};

const DEMO_PLACEHOLDERS_ENABLED = import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test';

type CriticalBy = 'hours' | 'cycles' | 'calendar' | 'none';

function renderMetricPills(
  entries: Array<{ key: Exclude<CriticalBy, 'none'>; label: string }>,
  criticalBy: CriticalBy,
): ReactNode {
  if (entries.length === 0) return <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map((entry) => (
        <span
          key={entry.key}
          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            criticalBy === entry.key
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {entry.label}
        </span>
      ))}
    </div>
  );
}

type VisibleComponentState = 'Sin registro' | 'Próx. vencer' | 'Vencida' | 'En ST' | 'OT recibida' | 'Al día / Ejecutado';
type TimelineEventType = 'installation' | 'application' | 'removal' | 'replacement';

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  occurredAt: string;
  title: string;
  details: string[];
  stRef: string | null;
  otRef: string | null;
}

function visibleStateBadge(state: VisibleComponentState) {
  if (state === 'Vencida') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-critical">Vencida</span>;
  }
  if (state === 'Próx. vencer') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-warning">Próx. vencer</span>;
  }
  if (state === 'En ST') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">En ST</span>;
  }
  if (state === 'OT recibida') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">OT recibida</span>;
  }
  if (state === 'Al día / Ejecutado') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-success">Al día / Ejecutado</span>;
  }
  return <span className={MISSING_OPERATIONAL_CONTEXT_BADGE_CLASS}>{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>;
}

function timelineStyle(type: TimelineEventType): { dot: string; badge: string; label: string } {
  if (type === 'installation') return { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Instalación' };
  if (type === 'application') return { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Aplicación' };
  if (type === 'removal') return { dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-700 border-slate-200', label: 'Remoción' };
  return { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Reemplazo' };
}

function movementTypeBadge(movementType: string): ReactNode {
  const normalized = (movementType ?? '').toLowerCase();
  if (normalized === 'replacement') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-warning">Reemplazo</span>;
  }
  if (normalized === 'remove' || normalized === 'removal') {
    return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-neutral">Remoción</span>;
  }
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-success">Instalación</span>;
}

function NewComponentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: aircraft = [] } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });
  const [form, setForm] = useState<CreateComponentInput>({
    partNumber: '',
    serialNumber: '',
    description: '',
    manufacturer: '',
    aircraftId: null,
    position: null,
    tboHours: null,
    tboCycles: null,
  });

  const mutation = useMutation({
    mutationFn: componentApi.create,
    onSuccess: () => {
      toast.success('Componente creado correctamente');
      qc.invalidateQueries({ queryKey: ['components'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear componente';
      toast.error(msg);
    },
  });

  const set = <K extends keyof CreateComponentInput>(field: K, value: CreateComponentInput[K]) =>
    setForm((p) => ({ ...p, [field]: value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.partNumber?.trim() || !form.serialNumber?.trim() || !form.description?.trim() || !form.manufacturer?.trim()) {
      toast.error('P/N, N/S, Descripción y Fabricante son obligatorios');
      return;
    }
    mutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-brand-600" />
            <h2 className="text-base font-bold text-slate-900">Nuevo Componente</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="form-label">Descripción <span className="text-rose-500">*</span></label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)} className="filter-input w-full" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">P/N <span className="text-rose-500">*</span></label>
              <input value={form.partNumber} onChange={(e) => set('partNumber', e.target.value)} className="filter-input w-full" />
            </div>
            <div>
              <label className="form-label">S/N <span className="text-rose-500">*</span></label>
              <input value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} className="filter-input w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Fabricante <span className="text-rose-500">*</span></label>
              <input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} className="filter-input w-full" />
            </div>
            <div>
              <label className="form-label">Posición</label>
              <input value={form.position ?? ''} onChange={(e) => set('position', e.target.value || null)} className="filter-input w-full" />
            </div>
          </div>
          <div>
            <label className="form-label">Aeronave</label>
            <select value={form.aircraftId ?? ''} onChange={(e) => set('aircraftId', e.target.value || null)} className="filter-input w-full">
              <option value="">Sin aeronave</option>
              {aircraft.map((a) => (
                <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-1.5">
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function resolveIntervalType(task: MaintenancePlanItem): 'hours' | 'cycles' | 'calendar' | 'mixed' {
  const hasHours = task.intervalHours != null && task.intervalHours > 0;
  const hasCycles = task.intervalCycles != null && task.intervalCycles > 0;
  const hasCalendar = (task.intervalCalendarDays != null && task.intervalCalendarDays > 0)
    || (task.intervalCalendarMonths != null && task.intervalCalendarMonths > 0);
  const count = [hasHours, hasCycles, hasCalendar].filter(Boolean).length;
  if (count > 1) return 'mixed';
  if (hasHours) return 'hours';
  if (hasCycles) return 'cycles';
  return 'calendar';
}

function buildOperationalFallbackDue(component: ComponentRow, snapshot: AircraftSnapshot): ComponentDueResult | null {
  const limitHours = component.tboHours ?? component.lifeLimitHours ?? null;
  const limitCycles = component.tboCycles ?? component.lifeLimitCycles ?? null;
  const limitDays = component.tboCalendarDays ?? null;

  const sourceActualHours = component.hoursSinceOverhaul ?? component.totalHoursSinceNew ?? null;
  const sourceActualCycles = component.cyclesSinceOverhaul ?? component.totalCyclesSinceNew ?? null;

  const usesHours = (limitHours != null && limitHours > 0) || sourceActualHours != null;
  const usesCycles = (limitCycles != null && limitCycles > 0) || sourceActualCycles != null;
  const usesCalendar = (limitDays != null && limitDays > 0) || component.installationDate != null;

  if (!usesHours && !usesCycles && !usesCalendar) return null;

  const actualHours = usesHours
    ? sourceActualHours
    : null;
  const actualCycles = usesCycles
    ? sourceActualCycles
    : null;
  const actualDays = usesCalendar && component.installationDate
    ? Math.max(0, Math.round((new Date(snapshot.currentDate).getTime() - new Date(component.installationDate).getTime()) / 86400000))
    : null;

  const remainingHours = limitHours != null && actualHours != null ? limitHours - actualHours : null;
  const remainingCycles = limitCycles != null && actualCycles != null ? limitCycles - actualCycles : null;
  const remainingDays = limitDays != null && actualDays != null ? limitDays - actualDays : null;

  const nextDueHours = remainingHours != null ? snapshot.currentHours + remainingHours : null;
  const nextDueCycles = remainingCycles != null ? snapshot.currentCycles + remainingCycles : null;
  const nextDueDate = limitDays != null && component.installationDate
    ? new Date(new Date(component.installationDate).getTime() + (limitDays * 86400000)).toISOString()
    : null;

  const ratios: Array<{ by: 'hours' | 'cycles' | 'calendar'; ratio: number }> = [];
  if (remainingHours != null && limitHours != null && limitHours > 0) ratios.push({ by: 'hours', ratio: remainingHours / limitHours });
  if (remainingCycles != null && limitCycles != null && limitCycles > 0) ratios.push({ by: 'cycles', ratio: remainingCycles / limitCycles });
  if (remainingDays != null && limitDays != null && limitDays > 0) ratios.push({ by: 'calendar', ratio: remainingDays / limitDays });

  const critical = ratios.length ? ratios.reduce((prev, cur) => (cur.ratio < prev.ratio ? cur : prev)) : null;
  const expired = (remainingHours != null && remainingHours < 0)
    || (remainingCycles != null && remainingCycles < 0)
    || (remainingDays != null && remainingDays < 0);

  const status: 'critical' | 'warning' | 'ok' = expired || (critical && critical.ratio < 0.1)
    ? 'critical'
    : critical && critical.ratio <= 0.25
      ? 'warning'
      : 'ok';

  const fmtHours = (value: number) => `${value.toFixed(0)} FH`;
  const fmtCycles = (value: number) => `${Math.round(value)} CYC`;
  const fmtDays = (value: number) => `${Math.round(value)} D`;
  const fmtDate = (value: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-MX');
  };

  return {
    intervalType: usesHours && usesCycles && usesCalendar ? 'mixed' : usesHours ? 'hours' : usesCycles ? 'cycles' : 'calendar',
    ataCode: 'EQ',
    ataChapter: 'EQ',
    limitHours,
    limitCycles,
    limitDays,
    actualHours,
    actualCycles,
    actualDays,
    remainingHours,
    remainingCycles,
    remainingDays,
    nextDueHours,
    nextDueCycles,
    nextDueDate,
    criticalBy: critical?.by ?? 'none',
    status,
    labels: {
      ata: 'EQ',
      limit: [
        ...(limitHours != null ? [{ key: 'hours' as const, label: fmtHours(limitHours) }] : []),
        ...(limitCycles != null ? [{ key: 'cycles' as const, label: fmtCycles(limitCycles) }] : []),
        ...(limitDays != null ? [{ key: 'calendar' as const, label: fmtDays(limitDays) }] : []),
      ],
      actual: [
        ...(actualHours != null ? [{ key: 'hours' as const, label: fmtHours(actualHours) }] : []),
        ...(actualCycles != null ? [{ key: 'cycles' as const, label: fmtCycles(actualCycles) }] : []),
        ...(actualDays != null ? [{ key: 'calendar' as const, label: fmtDays(actualDays) }] : []),
      ],
      remaining: [
        ...(remainingHours != null ? [{ key: 'hours' as const, label: fmtHours(remainingHours) }] : []),
        ...(remainingCycles != null ? [{ key: 'cycles' as const, label: fmtCycles(remainingCycles) }] : []),
        ...(remainingDays != null ? [{ key: 'calendar' as const, label: fmtDays(remainingDays) }] : []),
      ],
      nextDue: [
        ...(nextDueHours != null ? [{ key: 'hours' as const, label: fmtHours(nextDueHours) }] : []),
        ...(nextDueCycles != null ? [{ key: 'cycles' as const, label: fmtCycles(nextDueCycles) }] : []),
        ...(nextDueDate != null ? [{ key: 'calendar' as const, label: fmtDate(nextDueDate) }] : []),
      ],
      dueOn: fmtDate(nextDueDate),
      status: status === 'critical' ? 'Crítico' : status === 'warning' ? 'Atención' : 'OK',
    },
  };
}

function RegisterComponentExecutionModal({
  mode,
  context,
  task,
  aircraftId,
  aircraftHours,
  aircraftCycles,
  existingComponents,
  existingApplications,
  onClose,
  onSaved,
  onCreateComponent,
  onMovement,
  onApplication,
}: {
  mode: WorkRequestExecutionType;
  context: ExecutionContext;
  task: MaintenancePlanItem;
  aircraftId: string;
  aircraftHours: number;
  aircraftCycles: number;
  existingComponents: ComponentRow[];
  existingApplications: ComponentApplication[];
  onClose: () => void;
  onSaved: () => void;
  onCreateComponent: () => void;
  onMovement: (movement: ComponentMovement) => void;
  onApplication: (application: ComponentApplication) => void;
}) {
  const isReplacementFlow = mode === 'component_replacement';
  const [componentId, setComponentId] = useState(existingComponents[0]?.id ?? '');
  const [position, setPosition] = useState(existingComponents[0]?.position ?? '');
  const [newPartNumber, setNewPartNumber] = useState('');
  const [newSerialNumber, setNewSerialNumber] = useState('');
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 16));
  const [hours, setHours] = useState(String(aircraftHours.toFixed(1)));
  const [cycles, setCycles] = useState(String(aircraftCycles));
  const workOrderNumber = context.workOrderNumber;
  const [notes, setNotes] = useState('');

  const selectedComponent = existingComponents.find((c) => c.id === componentId) ?? null;
  const hasComponents = existingComponents.length > 0;

  const deriveInstalledHours = (component: ComponentRow): number | null => {
    const consumedHours = component.hoursSinceOverhaul ?? component.totalHoursSinceNew;
    if (consumedHours == null || !Number.isFinite(aircraftHours)) return null;
    const baseline = aircraftHours - consumedHours;
    return Number.isFinite(baseline) ? baseline : null;
  };

  const deriveInstalledCycles = (component: ComponentRow): number | null => {
    const consumedCycles = component.cyclesSinceOverhaul ?? component.totalCyclesSinceNew;
    if (consumedCycles == null || !Number.isFinite(aircraftCycles)) return null;
    const baseline = aircraftCycles - consumedCycles;
    return Number.isFinite(baseline) ? baseline : null;
  };

  const latestApplicationForComponentTask = (componentInstanceId: string, taskId: string): ComponentApplication | null => {
    const matches = existingApplications.filter(
      (app) => app.componentInstanceId === componentInstanceId && app.taskId === taskId,
    );
    if (matches.length === 0) return null;
    return matches.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())[0] ?? null;
  };

  const latestApplicationForComponent = (componentInstanceId: string): ComponentApplication | null => {
    const matches = existingApplications.filter((app) => app.componentInstanceId === componentInstanceId);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())[0] ?? null;
  };

  const isBaselineApplication = (app: ComponentApplication | null): boolean => {
    if (!app) return false;
    return app.type === 'baseline' || (app.notes ?? '').trim().toLowerCase() === 'inicio de control';
  };

  const duePreview = useMemo(() => {
    return calculateNextDue({
      intervalType: resolveIntervalType(task),
      intervalHours: task.intervalHours,
      intervalCycles: task.intervalCycles,
      intervalDays: task.intervalCalendarDays ?? (task.intervalCalendarMonths != null ? task.intervalCalendarMonths * 30 : null),
      appliedAt: new Date(performedAt).toISOString(),
      aircraftHoursAtApplication: Number(hours),
      aircraftCyclesAtApplication: Number(cycles),
      currentAircraftHours: aircraftHours,
      currentAircraftCycles: aircraftCycles,
    });
  }, [task, performedAt, hours, cycles, aircraftHours, aircraftCycles]);

  const mutation = useMutation({
    mutationFn: async () => {
      const iso = new Date(performedAt).toISOString();
      const parsedHours = Number(hours);
      const parsedCycles = Number(cycles);
      if (Number.isNaN(new Date(iso).getTime())) throw new Error('Fecha/hora inválida');
      if (!Number.isFinite(parsedHours) || parsedHours < 0) throw new Error('Horas aeronave inválidas');
      if (!Number.isFinite(parsedCycles) || parsedCycles < 0) throw new Error('Ciclos aeronave inválidos');
      if (!workOrderNumber.trim()) throw new Error('N° OT obligatorio');

      if (isReplacementFlow && !hasComponents) {
        throw new Error('No hay componentes asociados todavía');
      }

      if (isReplacementFlow && !position.trim()) {
        throw new Error('Posición obligatoria');
      }

      if (selectedComponent) {
        const installedAtHours = deriveInstalledHours(selectedComponent);
        const installedAtCycles = deriveInstalledCycles(selectedComponent);
        const installedAtDate = selectedComponent.installationDate ? new Date(selectedComponent.installationDate) : null;

        const lastSameTask = latestApplicationForComponentTask(selectedComponent.id, task.taskId);
        const lastForComponent = latestApplicationForComponent(selectedComponent.id);
        const lastSameTaskIsBaseline = isBaselineApplication(lastSameTask);
        const lastForComponentIsBaseline = isBaselineApplication(lastForComponent);

        if (lastSameTask && parsedHours < lastSameTask.aircraftHoursAtApplication) {
          throw new Error('Las horas no pueden ser menores al último registro del componente.');
        }
        if (lastSameTask && parsedCycles < lastSameTask.aircraftCyclesAtApplication) {
          throw new Error(lastSameTaskIsBaseline
            ? 'Los ciclos no pueden ser menores al inicio de control registrado.'
            : 'Los ciclos no pueden ser menores al último cumplimiento registrado.');
        }
        if (lastSameTask && new Date(iso).getTime() < new Date(lastSameTask.appliedAt).getTime()) {
          throw new Error(lastSameTaskIsBaseline
            ? 'La fecha no puede ser anterior al inicio de control registrado.'
            : 'La fecha no puede ser anterior al último cumplimiento registrado.');
        }

        if (installedAtHours != null && parsedHours < installedAtHours) {
          throw new Error('Las horas no pueden ser menores a la instalación actual del componente.');
        }
        if (installedAtCycles != null && parsedCycles < installedAtCycles) {
          throw new Error('Los ciclos no pueden ser menores a la instalación actual del componente.');
        }
        if (installedAtDate && new Date(iso).getTime() < installedAtDate.getTime()) {
          throw new Error('La fecha no puede ser anterior a la instalación actual.');
        }

        if (isReplacementFlow && lastForComponent) {
          if (parsedHours < lastForComponent.aircraftHoursAtApplication) {
            throw new Error('Las horas no pueden ser menores al último registro del componente.');
          }
          if (parsedCycles < lastForComponent.aircraftCyclesAtApplication) {
            throw new Error(lastForComponentIsBaseline
              ? 'Los ciclos no pueden ser menores al inicio de control registrado.'
              : 'Los ciclos no pueden ser menores al último cumplimiento registrado.');
          }
          if (new Date(iso).getTime() < new Date(lastForComponent.appliedAt).getTime()) {
            throw new Error(lastForComponentIsBaseline
              ? 'La fecha no puede ser anterior al inicio de control registrado.'
              : 'La fecha no puede ser anterior al último cumplimiento registrado.');
          }
        }
      }

      let targetComponentId: string | null = isReplacementFlow ? componentId : null;

      if (isReplacementFlow) {
        if (!newPartNumber.trim() || !newSerialNumber.trim()) {
          throw new Error('P/N y S/N nuevos son obligatorios');
        }

        if (targetComponentId) {
          await componentApi.update(targetComponentId, {
            position: `REMOVED ${position.trim()}`,
            notes: `Removido por OT ${workOrderNumber.trim()}`,
          });
        }

        const created = await componentApi.create({
          partNumber: newPartNumber.trim(),
          serialNumber: newSerialNumber.trim(),
          description: task.taskTitle,
          manufacturer: selectedComponent?.manufacturer ?? 'OT EXEC',
          aircraftId,
          position: position.trim(),
          // These fields are sent for forward compatibility if backend supports instance metadata.
          definitionId: task.taskId,
          status: 'installed',
        } as CreateComponentInput & { definitionId: string; status: 'installed' });

        await componentApi.updateInstallation(created.id, {
          aircraftId,
          installationDate: iso,
          position: position.trim(),
          notes: notes.trim() || null,
        });

        targetComponentId = created.id;

        onMovement({
          id: `mov-${Date.now()}`,
          aircraftId,
          position: position.trim(),
          movementType: 'replacement',
          removedComponentInstanceId: componentId || null,
          installedComponentInstanceId: created.id,
          removedPartNumber: selectedComponent?.partNumber ?? null,
          removedSerialNumber: selectedComponent?.serialNumber ?? null,
          installedPartNumber: newPartNumber.trim(),
          installedSerialNumber: newSerialNumber.trim(),
          workRequestId: context.workRequestId,
          officeOrderId: context.officeOrderId,
          workOrderNumber: workOrderNumber.trim(),
          performedAt: iso,
          aircraftHoursAtMovement: parsedHours,
          aircraftCyclesAtMovement: parsedCycles,
          notes: notes.trim() || null,
          createdAt: new Date().toISOString(),
          performedByUserName: 'Usuario Operaciones',
        });
      }

      if (isReplacementFlow && !targetComponentId) throw new Error('Selecciona un componente');

      await complianceApi.record({
        aircraftId,
        taskId: task.taskId,
        componentId: targetComponentId,
        applicationType: isReplacementFlow ? 'replacement_start' : 'application',
        performedAt: iso,
        aircraftHoursAtCompliance: parsedHours,
        nextDueHours: duePreview.nextDueHours,
        nextDueCycles: duePreview.nextDueCycles,
        nextDueDate: duePreview.nextDueDate,
        workOrderNumber: workOrderNumber.trim(),
        notes: notes.trim() || null,
      });

      if (targetComponentId) {
        onApplication({
          id: `app-${Date.now()}`,
          type: isReplacementFlow ? 'replacement_start' : 'application',
          isInitial: false,
          componentInstanceId: targetComponentId,
          taskId: task.taskId,
          aircraftId,
          workRequestId: context.workRequestId,
          officeOrderId: context.officeOrderId,
          workOrderNumber: workOrderNumber.trim(),
          appliedAt: iso,
          aircraftHoursAtApplication: parsedHours,
          aircraftCyclesAtApplication: parsedCycles,
          nextDueHours: duePreview.nextDueHours,
          nextDueCycles: duePreview.nextDueCycles,
          nextDueDate: duePreview.nextDueDate,
          notes: notes.trim() || null,
          createdAt: new Date().toISOString(),
        });
      }
    },
    onSuccess: () => {
      toast.success(
        mode === 'component_replacement'
          ? 'Componente registrado correctamente y próximo vencimiento calculado.'
          : 'Aplicación registrada correctamente y próximo vencimiento calculado.',
      );
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string }).message ?? 'No se pudo registrar';
      toast.error(msg);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {mode === 'component_replacement' ? 'Registrar cambio ejecutado' : 'Registrar aplicación'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">OT {context.workOrderNumber} · {task.taskCode}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {isReplacementFlow ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Componente asociado</p>
              {!hasComponents ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-sm text-slate-600">No hay componentes asociados todavía</p>
                  <button type="button" className="btn-secondary btn-xs" onClick={onCreateComponent}>+ Crear componente</button>
                </div>
              ) : (
                <div className="mt-2">
                  <label className="form-label">Componente <span className="text-rose-500">*</span></label>
                  <select className="filter-input w-full" value={componentId} onChange={(e) => setComponentId(e.target.value)}>
                    <option value="">Seleccionar componente</option>
                    {existingComponents.map((c) => (
                      <option key={c.id} value={c.id}>{c.partNumber} / {c.serialNumber} - {c.description}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">Esta tarea es de mantenimiento y no requiere componente (P/N y S/N).</p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Datos del registro</p>
            {isReplacementFlow && (
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <label className="form-label">P/N nuevo <span className="text-rose-500">*</span></label>
                  <input value={newPartNumber} onChange={(e) => setNewPartNumber(e.target.value)} className="filter-input w-full" />
                </div>
                <div>
                  <label className="form-label">S/N nuevo <span className="text-rose-500">*</span></label>
                  <input value={newSerialNumber} onChange={(e) => setNewSerialNumber(e.target.value)} className="filter-input w-full" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <label className="form-label">Fecha/hora <span className="text-rose-500">*</span></label>
                <input type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} className="filter-input w-full" />
              </div>
              {isReplacementFlow && (
                <div>
                  <label className="form-label">Posición <span className="text-rose-500">*</span></label>
                  <input value={position} onChange={(e) => setPosition(e.target.value)} className="filter-input w-full" />
                </div>
              )}
              <div>
                <label className="form-label">Horas aeronave <span className="text-rose-500">*</span></label>
                <input type="number" min={0} step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} className="filter-input w-full" />
              </div>
              <div>
                <label className="form-label">Ciclos aeronave <span className="text-rose-500">*</span></label>
                <input type="number" min={0} step="1" value={cycles} onChange={(e) => setCycles(e.target.value)} className="filter-input w-full" />
              </div>
              <div>
                <label className="form-label">N° OT <span className="text-rose-500">*</span></label>
                <input value={workOrderNumber} readOnly className="filter-input w-full bg-slate-50 text-slate-600" />
              </div>
              <div>
                <label className="form-label">Notas (opcional)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="filter-input w-full" />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Próximo cumplimiento calculado</p>
            <p className="text-sm text-emerald-800 mt-1 font-medium">
              {[
                duePreview.nextDueHours != null ? `${duePreview.nextDueHours.toFixed(1)} h` : null,
                duePreview.nextDueCycles != null ? `${duePreview.nextDueCycles} cic` : null,
                duePreview.nextDueDate ? new Date(duePreview.nextDueDate).toLocaleDateString('es-MX') : null,
              ].filter(Boolean).join(' / ') || 'No aplica'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending || (isReplacementFlow && !hasComponents)}>
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RegisterInitialComponentModal({
  task,
  aircraftId,
  onClose,
  onSaved,
}: {
  task: MaintenancePlanItem;
  aircraftId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RegisterInitialComponentInput>({
    aircraftId,
    taskId: task.taskId,
    partNumber: '',
    serialNumber: '',
    description: task.taskTitle,
    manufacturer: '',
    position: '',
    notes: 'Registro inicial',
  });

  const mutation = useMutation({
    mutationFn: () => componentApi.registerInitialComponent(form),
    onSuccess: () => {
      toast.success('Componente inicial registrado');
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (err as { message?: string })?.message
        ?? 'No se pudo registrar el componente inicial';
      toast.error(msg);
    },
  });

  const setField = <K extends keyof RegisterInitialComponentInput>(key: K, value: RegisterInitialComponentInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">Registrar componente inicial</h2>
            <p className="text-xs text-slate-500 mt-0.5">{task.taskCode} · {task.taskTitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"><X size={16} /></button>
        </div>

        <form
          className="p-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.partNumber.trim() || !form.serialNumber.trim() || !form.description.trim() || !form.manufacturer.trim()) {
              toast.error('P/N, S/N, descripción y fabricante son obligatorios');
              return;
            }
            mutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">P/N <span className="text-rose-500">*</span></label>
              <input className="filter-input w-full" value={form.partNumber} onChange={(e) => setField('partNumber', e.target.value)} />
            </div>
            <div>
              <label className="form-label">S/N <span className="text-rose-500">*</span></label>
              <input className="filter-input w-full" value={form.serialNumber} onChange={(e) => setField('serialNumber', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Descripción <span className="text-rose-500">*</span></label>
              <input className="filter-input w-full" value={form.description} onChange={(e) => setField('description', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Fabricante <span className="text-rose-500">*</span></label>
              <input className="filter-input w-full" value={form.manufacturer} onChange={(e) => setField('manufacturer', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Posición</label>
              <input className="filter-input w-full" value={form.position ?? ''} onChange={(e) => setField('position', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Notas</label>
              <input className="filter-input w-full" value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Se registrará como Inicio de control usando fecha y horas/ciclos base de la aeronave. No requiere ST/OT.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando…' : 'Registrar inicial'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ComponentsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [executionDraft, setExecutionDraft] = useState<{
    mode: WorkRequestExecutionType;
    task: MaintenancePlanItem;
    context: ExecutionContext;
  } | null>(null);
  const [initialRegistrationTask, setInitialRegistrationTask] = useState<MaintenancePlanItem | null>(null);
  const [expandedComponentId, setExpandedComponentId] = useState<string | null>(null);
  const [componentSearch, setComponentSearch] = useState('');
  const [componentTaskSearch, setComponentTaskSearch] = useState('');
  const [componentMovements, setComponentMovements] = useState<ComponentMovement[]>(
    DEMO_PLACEHOLDERS_ENABLED ? mockComponentMovements : [],
  );
  const [componentApplications, setComponentApplications] = useState<ComponentApplication[]>(
    DEMO_PLACEHOLDERS_ENABLED ? mockComponentApplications : [],
  );
  const [removedComponentIds, setRemovedComponentIds] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();

  const workRequests = useWorkRequestStore((s) => s.workRequests);
  const selectWorkRequest = useWorkRequestStore((s) => s.selectWorkRequest);

  const { data: aircraft = [] } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });
  const selectedAircraft = params.get('aircraft') ?? aircraft[0]?.id ?? '';

  const { data: components = [], isLoading } = useQuery({
    queryKey: ['components', selectedAircraft],
    queryFn: () => (selectedAircraft ? componentApi.findByAircraft(selectedAircraft) : Promise.resolve([])),
  });

  const { data: bulkComponentApplications = [] } = useQuery({
    queryKey: ['component-applications-bulk', selectedAircraft, components.map((c) => c.id).join(',')],
    queryFn: async () => {
      const rows = components as ComponentRow[];
      const historyByComponent = await Promise.all(
        rows.map(async (component) => {
          const history = await componentApi.getComplianceHistory(component.id);
          return { component, history };
        }),
      );

      const mapped: ComponentApplication[] = [];
      for (const { component, history } of historyByComponent) {
        for (const record of history as ComponentComplianceRecord[]) {
          const hoursAtApplication = Number(record.aircraftHoursAtCompliance);
          const cyclesAtApplication = Number(record.aircraftCyclesAtCompliance);
          const nextDueHours = record.nextDueHours != null ? Number(record.nextDueHours) : null;
          const nextDueCycles = record.nextDueCycles != null ? Number(record.nextDueCycles) : null;
          mapped.push({
            id: `api-${record.id}`,
            type: record.applicationType,
            isInitial: record.isInitial,
            componentInstanceId: component.id,
            taskId: record.task.id,
            aircraftId: component.aircraftId ?? selectedAircraft,
            workRequestId: '',
            officeOrderId: '',
            workOrderNumber: record.workOrderNumber ?? '',
            appliedAt: record.performedAt,
            aircraftHoursAtApplication: Number.isFinite(hoursAtApplication) ? hoursAtApplication : 0,
            aircraftCyclesAtApplication: Number.isFinite(cyclesAtApplication) ? cyclesAtApplication : 0,
            nextDueHours,
            nextDueCycles,
            nextDueDate: record.nextDueDate,
            notes: record.notes,
            createdAt: record.performedAt,
          });
        }
      }

      return mapped;
    },
    enabled: Boolean(selectedAircraft) && components.length > 0,
    staleTime: 0,
  });

  const { data: componentHistory = [], isLoading: loadingComponentHistory } = useQuery({
    queryKey: ['component-compliance-history', expandedComponentId],
    queryFn: () => componentApi.getComplianceHistory(expandedComponentId!),
    enabled: !!expandedComponentId,
    staleTime: 0,
  });

  const { data: planItems = [], isLoading: loadingPlanTasks } = useQuery({
    queryKey: ['components-plan-items', selectedAircraft],
    queryFn: () => maintenancePlanApi.getForAircraft(selectedAircraft),
    enabled: !!selectedAircraft,
    staleTime: 0,
  });

  const selectedAircraftData = aircraft.find((a) => a.id === selectedAircraft) ?? null;

  const componentChapterTasks = useMemo(
    () => planItems.filter((item) => item.requiresComponentTracking || item.executionType === 'component_replacement' || item.componentDefinitionId != null),
    [planItems],
  );

  const taskExecutionModelByTaskId = useMemo(() => {
    const map = new Map<string, TaskExecutionModel>();

    for (const task of componentChapterTasks) {
      map.set(task.taskId, {
        executionType: task.executionType,
        requiresComponentTracking: task.requiresComponentTracking,
      });
    }

    return map;
  }, [componentChapterTasks]);

  const filteredComponentChapterTasks = useMemo(() => {
    const q = componentTaskSearch.trim().toLowerCase();
    if (!q) return componentChapterTasks;
    return componentChapterTasks.filter((item) =>
      [item.taskCode, item.taskTitle, item.referenceType, item.referenceNumber ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [componentChapterTasks, componentTaskSearch]);

  const filteredComponents = useMemo(() => {
    const q = componentSearch.trim().toLowerCase();
    if (!q) return components;
    return components.filter((c) => [c.partNumber, c.serialNumber, c.description, c.manufacturer ?? '', c.position ?? ''].join(' ').toLowerCase().includes(q));
  }, [components, componentSearch]);

  const componentById = useMemo(() => {
    const map = new Map<string, ComponentRow>();
    for (const c of components as ComponentRow[]) {
      map.set(c.id, c);
    }
    return map;
  }, [components]);

  const installedComponents = useMemo(
    () => filteredComponents.filter((c) => !removedComponentIds.includes(c.id) && !(c.position ?? '').toUpperCase().startsWith('REMOVED')),
    [filteredComponents, removedComponentIds],
  );

  const effectiveComponentApplications = useMemo(() => {
    const byKey = new Map<string, ComponentApplication>();

    for (const app of bulkComponentApplications) {
      if (selectedAircraft && app.aircraftId !== selectedAircraft) continue;
      const key = `${app.componentInstanceId}::${app.taskId}::${app.appliedAt}`;
      byKey.set(key, app);
    }

    for (const app of componentApplications) {
      if (selectedAircraft && app.aircraftId !== selectedAircraft) continue;
      const key = `${app.componentInstanceId}::${app.taskId}::${app.appliedAt}`;
      byKey.set(key, app);
    }

    return Array.from(byKey.values()).sort(
      (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
    );
  }, [bulkComponentApplications, componentApplications, selectedAircraft]);

  const latestApplicationByComponentId = useMemo(() => {
    const map = new Map<string, ComponentApplication>();
    for (const app of effectiveComponentApplications) {
      if (app.type === 'baseline') continue;
      const existing = map.get(app.componentInstanceId);
      if (!existing || new Date(app.appliedAt).getTime() > new Date(existing.appliedAt).getTime()) {
        map.set(app.componentInstanceId, app);
      }
    }
    return map;
  }, [effectiveComponentApplications]);

  const currentComponentByTaskId = useMemo(() => {
    const map = new Map<string, ComponentRow>();

    const sortedApps = [...effectiveComponentApplications].sort(
      (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
    );

    for (const app of sortedApps) {
      if (app.aircraftId !== selectedAircraft) continue;
      if (map.has(app.taskId)) continue;
      const comp = componentById.get(app.componentInstanceId);
      if (!comp) continue;
      if ((comp.position ?? '').toUpperCase().startsWith('REMOVED')) continue;
      map.set(app.taskId, comp);
    }

    return map;
  }, [effectiveComponentApplications, componentById, selectedAircraft]);

  const taskById = useMemo(() => {
    const map = new Map<string, MaintenancePlanItem>();
    for (const t of planItems) map.set(t.taskId, t);
    return map;
  }, [planItems]);

  const componentDefinitionByTaskId = useMemo(() => {
    const map = new Map<string, ComponentDefinition>();
    const now = new Date().toISOString();

    for (const task of componentChapterTasks) {
      const intervalDays = task.intervalCalendarDays != null
        ? task.intervalCalendarDays
        : task.intervalCalendarMonths != null
          ? task.intervalCalendarMonths * 30
          : null;
      map.set(task.taskId, {
        id: task.taskId,
        ataChapter: task.taskCode.split('-')[0] ?? 'N/A',
        ataCode: task.taskCode,
        name: task.taskTitle,
        description: task.taskTitle,
        executionType: task.executionType,
        intervalType: resolveIntervalType(task),
        intervalHours: task.intervalHours,
        intervalCycles: task.intervalCycles,
        intervalDays,
        requiresComponentTracking: task.requiresComponentTracking,
        sourceGroup: 'MAINTENANCE_PLAN',
        reference: task.referenceNumber ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    return map;
  }, [componentChapterTasks, taskExecutionModelByTaskId]);

  const workRequestRefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const wr of workRequests) map.set(wr.id, wr.folio);
    return map;
  }, [workRequests]);

  const buildDueContextForComponent = (c: ComponentRow) => {
    const latestApplication = latestApplicationByComponentId.get(c.id) ?? null;
    const linkedDefinition = latestApplication
      ? componentDefinitionByTaskId.get(latestApplication.taskId) ?? null
      : null;
    const traceTask = latestApplication
      ? taskById.get(latestApplication.taskId) ?? null
      : null;

    const snapshot: AircraftSnapshot = {
      currentHours: selectedAircraftData?.totalFlightHours ?? 0,
      currentCycles: selectedAircraftData?.totalCycles ?? 0,
      currentDate: new Date().toISOString(),
    };

    if (!latestApplication || !linkedDefinition) {
      return {
        due: buildOperationalFallbackDue(c, snapshot),
        latestApplication,
        traceTask,
      };
    }

    return {
      due: calculateComponentDue(linkedDefinition, latestApplication, snapshot),
      latestApplication,
      traceTask,
    };
  };

  const selectedTimelineComponent = useMemo(
    () => (expandedComponentId ? (componentById.get(expandedComponentId) ?? null) : null),
    [expandedComponentId, componentById],
  );

  const selectedTimelineDue = useMemo(
    () => (selectedTimelineComponent ? buildDueContextForComponent(selectedTimelineComponent) : null),
    [selectedTimelineComponent],
  );

  const resolveVisibleState = (input: {
    flow: { openOrDraftSt: { id: string; ref: string } | null; validSt: { id: string; ref: string } | null };
    latestApplication: ComponentApplication | null;
    traceStatus?: MaintenancePlanItem['status'];
    dueStatus?: 'critical' | 'warning' | 'ok';
  }): VisibleComponentState => {
    if (input.flow.validSt) return 'OT recibida';
    if (input.flow.openOrDraftSt) return 'En ST';
    if (input.latestApplication) return 'Al día / Ejecutado';
    if (input.traceStatus === 'OVERDUE' || input.dueStatus === 'critical') return 'Vencida';
    if (input.traceStatus === 'DUE_SOON' || input.dueStatus === 'warning') return 'Próx. vencer';
    return 'Sin registro';
  };

  const timelineEvents = useMemo(() => {
    if (!selectedTimelineComponent) return [] as TimelineEvent[];
    const componentId = selectedTimelineComponent.id;
    const events: TimelineEvent[] = [];

    if (selectedTimelineComponent.installationDate) {
      events.push({
        id: `inst-${componentId}`,
        type: 'installation',
        occurredAt: selectedTimelineComponent.installationDate,
        title: 'Componente instalado',
        details: [
          `P/N: ${selectedTimelineComponent.partNumber}`,
          `S/N: ${selectedTimelineComponent.serialNumber}`,
          `Posición: ${selectedTimelineComponent.position ?? '—'}`,
        ],
        stRef: null,
        otRef: null,
      });
    }

    for (const app of effectiveComponentApplications.filter((x) => x.componentInstanceId === componentId)) {
      const task = taskById.get(app.taskId);
      const appHours = Number(app.aircraftHoursAtApplication);
      const appCycles = Number(app.aircraftCyclesAtApplication);
      const appNextDueHours = app.nextDueHours != null ? Number(app.nextDueHours) : null;
      const isBaseline = app.type === 'baseline' || (app.notes ?? '').trim().toLowerCase() === 'inicio de control';
      const isReplacementStart = app.type === 'replacement_start';
      events.push({
        id: `app-${app.id}`,
        type: 'application',
        occurredAt: app.appliedAt,
        title: isBaseline ? 'Inicio de control' : isReplacementStart ? 'Reemplazo ejecutado' : 'Aplicación registrada',
        details: [
          `Tarea ATA: ${task?.taskCode ?? app.taskId}`,
          `Horas/Ciclos: ${Number.isFinite(appHours) ? appHours.toFixed(1) : '0.0'} / ${Number.isFinite(appCycles) ? Math.round(appCycles) : 0}`,
          `Próximo: ${[
            appNextDueHours != null && Number.isFinite(appNextDueHours) ? `${appNextDueHours.toFixed(0)} FH` : null,
            app.nextDueCycles != null ? `${app.nextDueCycles} CYC` : null,
            app.nextDueDate ? new Date(app.nextDueDate).toLocaleDateString('es-MX') : null,
          ].filter(Boolean).join(' · ') || '—'}`,
        ],
        stRef: workRequestRefById.get(app.workRequestId) ?? app.workRequestId,
        otRef: app.workOrderNumber,
      });
    }

    for (const h of componentHistory) {
      const historyHours = Number(h.aircraftHoursAtCompliance);
      const historyCycles = Number(h.aircraftCyclesAtCompliance);
      const historyNextDueHours = h.nextDueHours != null ? Number(h.nextDueHours) : null;
      const isBaseline = h.applicationType === 'baseline' || (h.notes ?? '').trim().toLowerCase() === 'inicio de control';
      const isReplacementStart = h.applicationType === 'replacement_start';
      events.push({
        id: `api-app-${h.id}`,
        type: 'application',
        occurredAt: h.performedAt,
        title: isBaseline ? 'Inicio de control' : isReplacementStart ? 'Reemplazo ejecutado' : 'Aplicación registrada',
        details: [
          `Tarea ATA: ${h.task?.code ?? 'N/A'}`,
          `Horas/Ciclos: ${Number.isFinite(historyHours) ? historyHours.toFixed(1) : '0.0'} / ${Number.isFinite(historyCycles) ? Math.round(historyCycles) : 0}`,
          `Próximo: ${[
            historyNextDueHours != null && Number.isFinite(historyNextDueHours) ? `${historyNextDueHours.toFixed(0)} FH` : null,
            h.nextDueCycles != null ? `${h.nextDueCycles} CYC` : null,
            h.nextDueDate ? new Date(h.nextDueDate).toLocaleDateString('es-MX') : null,
          ].filter(Boolean).join(' · ') || '—'}`,
        ],
        stRef: null,
        otRef: h.workOrderNumber,
      });
    }

    for (const move of componentMovements) {
      const touchesComponent = move.installedComponentInstanceId === componentId || move.removedComponentInstanceId === componentId;
      if (!touchesComponent) continue;
      const movementHours = Number(move.aircraftHoursAtMovement);
      const movementCycles = Number(move.aircraftCyclesAtMovement);

      if (move.movementType === 'replacement') {
        events.push({
          id: `repl-${move.id}`,
          type: 'replacement',
          occurredAt: move.performedAt,
          title: 'Reemplazo de componente',
          details: [
            `Saliente: ${move.removedPartNumber ?? (move.removedComponentInstanceId ? componentById.get(move.removedComponentInstanceId)?.partNumber ?? '—' : '—')} / ${move.removedSerialNumber ?? (move.removedComponentInstanceId ? componentById.get(move.removedComponentInstanceId)?.serialNumber ?? '—' : '—')}`,
            `Entrante: ${move.installedPartNumber ?? (move.installedComponentInstanceId ? componentById.get(move.installedComponentInstanceId)?.partNumber ?? '—' : '—')} / ${move.installedSerialNumber ?? (move.installedComponentInstanceId ? componentById.get(move.installedComponentInstanceId)?.serialNumber ?? '—' : '—')}`,
            `Posición: ${move.position}`,
            `Horas/Ciclos: ${Number.isFinite(movementHours) ? movementHours.toFixed(1) : '0.0'} / ${Number.isFinite(movementCycles) ? Math.round(movementCycles) : 0}`,
          ],
          stRef: workRequestRefById.get(move.workRequestId) ?? move.workRequestId,
          otRef: move.workOrderNumber,
        });
        continue;
      }

      if (move.movementType === 'remove' && move.removedComponentInstanceId === componentId) {
        events.push({
          id: `rem-${move.id}`,
          type: 'removal',
          occurredAt: move.performedAt,
          title: 'Componente removido',
          details: [
            `P/N: ${move.removedPartNumber ?? componentById.get(componentId)?.partNumber ?? '—'}`,
            `S/N: ${move.removedSerialNumber ?? componentById.get(componentId)?.serialNumber ?? '—'}`,
            `Posición: ${move.position}`,
            `Horas/Ciclos: ${Number.isFinite(movementHours) ? movementHours.toFixed(1) : '0.0'} / ${Number.isFinite(movementCycles) ? Math.round(movementCycles) : 0}`,
          ],
          stRef: workRequestRefById.get(move.workRequestId) ?? move.workRequestId,
          otRef: move.workOrderNumber,
        });
      }
    }

    const unique = new Map<string, TimelineEvent>();
    for (const ev of events) {
      const dedupeKey = `${ev.type}-${ev.occurredAt}-${ev.title}-${ev.otRef ?? ''}-${ev.stRef ?? ''}`;
      if (!unique.has(dedupeKey)) unique.set(dedupeKey, ev);
    }

    return Array.from(unique.values()).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [selectedTimelineComponent, effectiveComponentApplications, componentMovements, componentHistory, componentById, taskById, workRequestRefById]);

  const isValidSTForExecution = (wrStatus: string, _hasOtEvidence: boolean) => {
    return wrStatus === 'SENT';
  };

  const isOpenOrDraftST = (wrStatus: string) => {
    return wrStatus === 'DRAFT';
  };

  const hasExecutionForComponentInWorkRequest = (componentId: string, workRequestId: string) => {
    const hasApplication = effectiveComponentApplications.some(
      (app) => app.workRequestId === workRequestId && app.componentInstanceId === componentId,
    );

    const hasMovement = componentMovements.some((movement) => {
      if (movement.workRequestId !== workRequestId) return false;
      return movement.removedComponentInstanceId === componentId
        || movement.installedComponentInstanceId === componentId;
    });

    return hasApplication || hasMovement;
  };

  const componentFlowById = useMemo(() => {
    const map = new Map<string, {
      openOrDraftSt: { id: string; ref: string } | null;
      validSt: { id: string; ref: string } | null;
    }>();
    for (const wr of workRequests) {
      if (wr.aircraftId !== selectedAircraft) continue;
      const hasOtEvidence = true;
      const isValid = isValidSTForExecution(wr.status, hasOtEvidence);
      const isOpen = isOpenOrDraftST(wr.status);

      if (!isValid && !isOpen) continue;
      for (const item of wr.items) {
        if (item.sourceKind !== 'component_inspection' || !item.sourceId) continue;
        const existing = map.get(item.sourceId) ?? { openOrDraftSt: null, validSt: null };
        const alreadyExecuted = hasExecutionForComponentInWorkRequest(item.sourceId, wr.id);
        if (isValid && !alreadyExecuted) existing.validSt = existing.validSt ?? { id: wr.id, ref: wr.folio };
        if (!isValid && isOpen) existing.openOrDraftSt = existing.openOrDraftSt ?? { id: wr.id, ref: wr.folio };
        map.set(item.sourceId, existing);
      }
    }
    return map;
  }, [workRequests, selectedAircraft, effectiveComponentApplications, componentMovements]);

  const installedStateSummary = useMemo(() => {
    const summary = {
      total: installedComponents.length,
      overdue: 0,
      dueSoon: 0,
      inST: 0,
      otReceived: 0,
      executed: 0,
      noRecord: 0,
    };

    for (const component of installedComponents) {
      const flow = componentFlowById.get(component.id) ?? { openOrDraftSt: null, validSt: null };
      const { due, latestApplication, traceTask } = buildDueContextForComponent(component);

      const state = resolveVisibleState({
        flow,
        latestApplication,
        traceStatus: traceTask?.status,
        dueStatus: due?.status,
      });

      if (state === 'Vencida') summary.overdue += 1;
      else if (state === 'Próx. vencer') summary.dueSoon += 1;
      else if (state === 'En ST') summary.inST += 1;
      else if (state === 'OT recibida') summary.otReceived += 1;
      else if (state === 'Sin registro') summary.noRecord += 1;
      else summary.executed += 1;
    }

    return summary;
  }, [installedComponents, componentFlowById, selectedAircraftData?.totalFlightHours, selectedAircraftData?.totalCycles, latestApplicationByComponentId, taskById]);

  const openOrDraftSTByTaskId = useMemo(() => {
    const map = new Map<string, { id: string; ref: string }>();
    for (const wr of workRequests) {
      if (wr.aircraftId !== selectedAircraft) continue;
      if (!isOpenOrDraftST(wr.status)) continue;
      for (const item of wr.items) {
        if (!item.sourceId) continue;
        if (!map.has(item.sourceId)) {
          map.set(item.sourceId, { id: wr.id, ref: wr.folio });
        }
      }
    }
    return map;
  }, [workRequests, selectedAircraft]);

  const getWorkRequestRef = (workRequestId: string) => {
    const wr = useWorkRequestStore.getState().workRequests.find((x) => x.id === workRequestId);
    return wr?.folio ?? workRequestId;
  };

  const handleInlineAddComponentToST = async (component: ComponentRow) => {
    if (!component.aircraftId) {
      toast.error('El componente debe estar asociado a una aeronave para agregarlo a ST');
      return;
    }

    const stId = await createSTFromSource('component', {
      aircraftId: component.aircraftId,
      sourceId: component.id,
      ataCode: component.partNumber,
      title: component.description,
      description: 'Accion requerida',
      aircraftHoursAtRequest: selectedAircraftData?.totalFlightHours ?? 0,
      aircraftCyclesAtRequest: selectedAircraftData?.totalCycles ?? 0,
      priority: 'media',
    });

    const stRef = getWorkRequestRef(stId);
    selectWorkRequest(stId, 'general');
    toast.success(`Ítem agregado a ${stRef}`);
  };

  const handleInlineAddTaskToST = async (item: MaintenancePlanItem) => {
    if (!selectedAircraft) {
      toast.error('Selecciona una aeronave para agregar la tarea a ST');
      return;
    }

    const taskModel = taskExecutionModelByTaskId.get(item.taskId) ?? {
      executionType: item.executionType,
      requiresComponentTracking: item.requiresComponentTracking,
    };

    const stId = await createSTFromSource('maintenance_plan', {
      aircraftId: selectedAircraft,
      sourceId: item.taskId,
      ataCode: item.taskCode,
      title: item.taskTitle,
      description: 'Accion requerida',
      aircraftHoursAtRequest: selectedAircraftData?.totalFlightHours ?? 0,
      aircraftCyclesAtRequest: selectedAircraftData?.totalCycles ?? 0,
      priority: 'media',
      requiresComponentTracking: taskModel.requiresComponentTracking,
      executionType: taskModel.executionType === 'component_replacement' ? 'component_replacement' : 'maintenance_application',
      componentDefinitionId: item.componentDefinitionId ?? undefined,
    });

    const stRef = getWorkRequestRef(stId);
    selectWorkRequest(stId, 'general');
    toast.success(`Ítem agregado a ${stRef}`);
  };

  const handleInlineViewST = (stId: string) => {
    const exists = workRequests.some((wr) => wr.id === stId);
    if (!exists) {
      toast.error('No se encontro la ST asociada');
      return;
    }
    const stRef = getWorkRequestRef(stId);
    selectWorkRequest(stId, 'general');
    const query = selectedAircraft
      ? `/work-requests?aircraftId=${selectedAircraft}&stId=${stId}`
      : `/work-requests?stId=${stId}`;
    navigate(query);
    toast.success(`Abriendo ${stRef}`);
  };

  const replacementIntervalLabel = (item: MaintenancePlanItem) => {
    const parts: string[] = [];
    if (item.intervalHours != null && item.intervalHours > 0) parts.push(`${item.intervalHours} h`);
    if (item.intervalCycles != null && item.intervalCycles > 0) parts.push(`${item.intervalCycles} cic`);
    if (item.intervalCalendarDays != null && item.intervalCalendarDays > 0) parts.push(`${item.intervalCalendarDays} d`);
    if (item.intervalCalendarMonths != null && item.intervalCalendarMonths > 0) parts.push(`${item.intervalCalendarMonths} m`);
    return parts.length > 0 ? parts.join(' / ') : '—';
  };

  const getExecutionBlockMessage = (mode: WorkRequestExecutionType) => (
    mode === 'component_replacement'
      ? 'No existe un item exacto de ST válida con OT recibida/firmada para registrar cambio ejecutado de este componente/tarea.'
      : 'No existe un item exacto de ST válida con OT recibida/firmada para registrar aplicación de esta tarea.'
  );

  const getExecutionContextFromBackend = async (
    task: MaintenancePlanItem,
    mode: WorkRequestExecutionType,
    requiredComponentId?: string,
  ): Promise<ExecutionContext | null> => {
    if (!selectedAircraft) return null;
    const eligibility = await workRequestsApi.getExecutionEligibility(selectedAircraft, {
      sourceKind: 'maintenance_plan',
      sourceId: task.taskId,
      executionType: mode,
      requiredComponentSourceId: requiredComponentId,
    });

    if (!eligibility.eligible || !eligibility.workRequestId || !eligibility.workOrderNumber) {
      return null;
    }

    return {
      workRequestId: eligibility.workRequestId,
      workOrderNumber: eligibility.workOrderNumber,
      officeOrderId: `oo-${eligibility.workRequestId}`,
    };
  };

  const getExecutionContextForTask = (
    task: MaintenancePlanItem,
    mode: WorkRequestExecutionType,
    requiredComponentId?: string,
  ): ExecutionContext | null => {
    for (const wr of workRequests) {
      if (wr.aircraftId !== selectedAircraft) continue;
      const hasOtEvidence = true;
      if (!isValidSTForExecution(wr.status, hasOtEvidence)) continue;

      const match = wr.items.find((it) => {
        const linked = it.sourceId === task.taskId;
        if (!linked) return false;
        if (mode === 'component_replacement') {
          return it.executionType === 'component_replacement' && it.requiresComponentTracking === true;
        }
        return it.executionType === 'maintenance_application';
      });

      const hasRequiredComponent = requiredComponentId
        ? wr.items.some((it) => it.sourceKind === 'component_inspection' && it.sourceId === requiredComponentId)
        : true;

      if (match && hasRequiredComponent) {
        return {
          workRequestId: wr.id,
          workOrderNumber: wr.otReference!,
          officeOrderId: `oo-${wr.id}`,
        };
      }
    }
    return null;
  };

  const openExecutionFlow = (
    task: MaintenancePlanItem,
    mode: WorkRequestExecutionType,
    requiredComponentId?: string,
  ) => {
    void (async () => {
      const context = await getExecutionContextFromBackend(task, mode, requiredComponentId);
      if (!context) {
        toast.error(getExecutionBlockMessage(mode));
        return;
      }
      setExecutionDraft({ mode, task, context });
    })();
  };

  const openFromInstalledComponent = (component: ComponentRow, mode: WorkRequestExecutionType) => {
    void (async () => {
      for (const task of filteredComponentChapterTasks) {
        const context = await getExecutionContextFromBackend(task, mode, component.id);
        if (!context) continue;
        setExecutionDraft({ mode, task, context });
        return;
      }
      toast.error(getExecutionBlockMessage(mode));
    })();
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <Package size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Componentes (EQ)</h1>
            <p className="text-sm text-slate-500">Vista de componente instalado, trazabilidad y vencimientos.</p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Nuevo componente</button>
      </div>

      <div className="filter-bar">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest shrink-0">Aeronave</label>
        <div className="relative">
          <select
            value={selectedAircraft}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set('aircraft', e.target.value);
              setParams(next);
            }}
            className="filter-input pr-8 min-w-48 appearance-none cursor-pointer"
          >
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <input
          type="text"
          value={componentSearch}
          onChange={(e) => setComponentSearch(e.target.value)}
          placeholder="Buscar componente..."
          className="filter-input min-w-72"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Instalados</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{installedStateSummary.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vencidas</p>
          <p className="mt-1 text-2xl font-bold text-rose-700 tabular-nums">{installedStateSummary.overdue}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Próx. vencer</p>
          <p className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">{installedStateSummary.dueSoon}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">En ST</p>
          <p className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">{installedStateSummary.inST}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">OT recibida</p>
          <p className="mt-1 text-2xl font-bold text-blue-700 tabular-nums">{installedStateSummary.otReceived}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Al día</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{installedStateSummary.executed}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Componentes instalados actualmente</h2>
        </div>
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-header">P/N</th>
              <th className="table-header">S/N</th>
              <th className="table-header">Descripción</th>
              <th className="table-header">Posición</th>
              <th className="table-header">ATA</th>
              <th className="table-header">Límite</th>
              <th className="table-header">Actual</th>
              <th className="table-header">Remanente</th>
              <th className="table-header">Próximo cumplimiento</th>
              <th className="table-header">Vence el</th>
              <th className="table-header">Estado</th>
              <th className="table-header">ST</th>
              <th className="table-header text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={13} className="table-cell text-center text-slate-400 py-12">Cargando…</td></tr>}
            {!isLoading && installedComponents.length === 0 && <tr><td colSpan={13} className="table-cell text-center text-slate-400 py-12">No hay componentes instalados actualmente</td></tr>}
            {installedComponents.map((c: ComponentRow) => {
              const flow = componentFlowById.get(c.id) ?? { openOrDraftSt: null, validSt: null };
              const applicationTask = filteredComponentChapterTasks.find((row) => getExecutionContextForTask(row, 'maintenance_application')) ?? null;
              const replacementTask = filteredComponentChapterTasks.find((row) => getExecutionContextForTask(row, 'component_replacement', c.id)) ?? null;
              const showExecutionActions = Boolean(flow.validSt);
              const { due, latestApplication, traceTask } = buildDueContextForComponent(c);
              const installedVisibleState = resolveVisibleState({
                flow,
                latestApplication,
                traceStatus: traceTask?.status,
                dueStatus: due?.status,
              });

              const stateAccent = installedVisibleState === 'Vencida'
                ? 'border-l-2 border-l-rose-500'
                : installedVisibleState === 'Próx. vencer'
                  ? 'border-l-2 border-l-amber-500'
                  : installedVisibleState === 'En ST' || installedVisibleState === 'OT recibida'
                    ? 'border-l-2 border-l-blue-500'
                    : installedVisibleState === 'Al día / Ejecutado'
                      ? 'border-l-2 border-l-emerald-500'
                      : 'border-l-2 border-l-slate-300';

              return (
                <tr key={c.id} className={`hover:bg-slate-50 transition-colors ${stateAccent}`}>
                  <td className="table-cell font-mono text-xs text-slate-700">{c.partNumber}</td>
                  <td className="table-cell font-mono text-xs text-slate-700">{c.serialNumber}</td>
                  <td className="table-cell text-slate-700">{c.description}</td>
                  <td className="table-cell text-slate-500">{c.position ?? '—'}</td>
                  <td className="table-cell text-xs text-slate-700 font-medium">{due?.labels.ata ?? MISSING_OPERATIONAL_CONTEXT_LABEL}</td>
                  <td className="table-cell text-xs">{renderMetricPills(due?.labels.limit ?? [], due?.criticalBy ?? 'none')}</td>
                  <td className="table-cell text-xs">{renderMetricPills(due?.labels.actual ?? [], due?.criticalBy ?? 'none')}</td>
                  <td className="table-cell text-xs">{renderMetricPills(due?.labels.remaining ?? [], due?.criticalBy ?? 'none')}</td>
                  <td className="table-cell text-xs">{renderMetricPills(due?.labels.nextDue ?? [], due?.criticalBy ?? 'none')}</td>
                  <td className="table-cell text-xs text-slate-600">{due?.labels.dueOn ?? MISSING_OPERATIONAL_CONTEXT_LABEL}</td>
                  <td className="table-cell text-xs">{visibleStateBadge(installedVisibleState)} <span className="sr-only">{due?.labels.status ?? MISSING_OPERATIONAL_CONTEXT_LABEL}</span></td>
                  <td className="table-cell text-xs text-slate-600">
                    {flow.validSt ? `OT recibida/firmada ${flow.validSt.ref}` : flow.openOrDraftSt ? `En borrador ${flow.openOrDraftSt.ref}` : 'Sin ST'}
                  </td>
                  <td className="table-cell text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        className="btn-secondary btn-xs"
                        onClick={() => setExpandedComponentId(c.id)}
                      >
                        Ver historial
                      </button>
                      {!showExecutionActions && !flow.openOrDraftSt && (
                        <button
                          className="btn-primary btn-xs"
                          onClick={() => handleInlineAddComponentToST(c)}
                        >
                          Agregar a ST
                        </button>
                      )}
                      {!showExecutionActions && flow.openOrDraftSt && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handleInlineViewST(flow.openOrDraftSt!.id)}
                        >
                          Ver ST
                        </button>
                      )}
                      {showExecutionActions && applicationTask && (
                        <button className="btn-secondary btn-xs" onClick={() => openExecutionFlow(applicationTask, 'maintenance_application', c.id)}>
                          Registrar aplicación
                        </button>
                      )}
                      {showExecutionActions && replacementTask && (
                        <button className="btn-primary btn-xs" onClick={() => openExecutionFlow(replacementTask, 'component_replacement', c.id)}>
                          Registrar cambio ejecutado
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expandedComponentId && selectedTimelineComponent && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Timeline de componente</h2>
                <p className="text-xs text-slate-500 mt-0.5">Historial completo con eventos respaldados por ST/OT</p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setExpandedComponentId(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[340px,1fr]">
              <aside className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h3 className="text-sm font-bold text-slate-900">Componente actual</h3>
                <div className="mt-3 space-y-2 text-xs text-slate-700">
                  <p><span className="font-semibold text-slate-500">Descripción:</span> {selectedTimelineComponent.description}</p>
                  <p><span className="font-semibold text-slate-500">P/N:</span> <span className="font-mono">{selectedTimelineComponent.partNumber}</span></p>
                  <p><span className="font-semibold text-slate-500">S/N:</span> <span className="font-mono">{selectedTimelineComponent.serialNumber}</span></p>
                  <p><span className="font-semibold text-slate-500">Posición:</span> {selectedTimelineComponent.position ?? '—'}</p>
                  <p><span className="font-semibold text-slate-500">ATA:</span> {selectedTimelineDue?.due?.labels.ata ?? MISSING_OPERATIONAL_CONTEXT_LABEL}</p>
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500">Estado</span>
                    {(() => {
                      const flow = componentFlowById.get(selectedTimelineComponent.id) ?? { openOrDraftSt: null, validSt: null };
                      const traceStatus = selectedTimelineDue?.traceTask?.status;
                      const dueStatus = selectedTimelineDue?.due?.status;
                      const visible = resolveVisibleState({
                        flow,
                        latestApplication: selectedTimelineDue?.latestApplication ?? null,
                        traceStatus,
                        dueStatus,
                      });
                      return visibleStateBadge(visible);
                    })()}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Actual</span><div>{renderMetricPills(selectedTimelineDue?.due?.labels.actual ?? [], selectedTimelineDue?.due?.criticalBy ?? 'none')}</div></div>
                  <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Remanente</span><div>{renderMetricPills(selectedTimelineDue?.due?.labels.remaining ?? [], selectedTimelineDue?.due?.criticalBy ?? 'none')}</div></div>
                  <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Próximo</span><div>{renderMetricPills(selectedTimelineDue?.due?.labels.nextDue ?? [], selectedTimelineDue?.due?.criticalBy ?? 'none')}</div></div>
                </div>
              </aside>

              <section>
                <h3 className="text-sm font-bold text-slate-900">Timeline operacional</h3>
                {loadingComponentHistory ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-400">Cargando timeline…</div>
                ) : timelineEvents.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-400">Sin eventos registrados para este componente.</div>
                ) : (
                  <ol className="mt-4 space-y-4">
                    {timelineEvents.map((event, index) => {
                      const style = timelineStyle(event.type);
                      return (
                        <li key={event.id} className="relative rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex items-start gap-3">
                            <div className="relative mt-1">
                              <span className={`block h-2.5 w-2.5 rounded-full ${style.dot}`} />
                              {index < timelineEvents.length - 1 && <span className="absolute left-1.5 top-3 block h-14 w-px bg-slate-200" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}>{style.label}</span>
                                <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                                <span className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString('es-MX')}</span>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 md:grid-cols-2">
                                {event.details.map((detail) => <p key={detail}>{detail}</p>)}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {event.stRef && <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">ST {event.stRef}</span>}
                                {event.otRef && <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">OT {event.otRef}</span>}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Tareas de componente desde plan</h2>
          <p className="text-xs text-slate-500 mt-1">Filtro por contrato backend: tracking explícito o reemplazo de componente.</p>
          <div className="mt-3">
            <input
              type="text"
              value={componentTaskSearch}
              onChange={(e) => setComponentTaskSearch(e.target.value)}
              placeholder="Buscar tarea de componente..."
              className="filter-input w-full md:w-96"
            />
          </div>
        </div>
        {!selectedAircraft ? (
          <div className="px-5 py-10 text-sm text-slate-400 text-center">Selecciona una aeronave para ver sus tareas de componente.</div>
        ) : loadingPlanTasks ? (
          <div className="px-5 py-10 text-sm text-slate-400 text-center">Cargando tareas de componente...</div>
        ) : filteredComponentChapterTasks.length === 0 ? (
          <div className="px-5 py-10 text-sm text-slate-400 text-center">No hay tareas de componente para esta aeronave.</div>
        ) : (
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
              <tr>
                <th className="table-header">Tarea</th>
                <th className="table-header">Descripción</th>
                <th className="table-header">Intervalo</th>
                <th className="table-header">Próximo cumplimiento</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Tracking</th>
                <th className="table-header">Solicitud</th>
                <th className="table-header text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredComponentChapterTasks.map((item) => {
                const taskModel = taskExecutionModelByTaskId.get(item.taskId) ?? {
                  executionType: item.executionType,
                  requiresComponentTracking: item.requiresComponentTracking,
                };
                const appContext = getExecutionContextForTask(item, 'maintenance_application');
                const replacementContext = getExecutionContextForTask(item, 'component_replacement');
                const openSt = openOrDraftSTByTaskId.get(item.taskId) ?? null;
                const associatedComponent = currentComponentByTaskId.get(item.taskId) ?? null;
                const hasExecutedApplication = effectiveComponentApplications.some((app) => (
                  app.taskId === item.taskId
                  && app.aircraftId === selectedAircraft
                  && app.type !== 'baseline'
                ));
                const contextForTask = taskModel.executionType === 'component_replacement' ? replacementContext : appContext;
                const taskVisibleState: VisibleComponentState = contextForTask
                  ? 'OT recibida'
                  : openSt
                    ? 'En ST'
                    : hasExecutedApplication || item.status === 'OK'
                      ? 'Al día / Ejecutado'
                      : item.status === 'OVERDUE'
                        ? 'Vencida'
                        : item.status === 'DUE_SOON'
                          ? 'Próx. vencer'
                          : 'Sin registro';

                return (
                <tr key={item.taskId} className="hover:bg-slate-50 transition-colors">
                  <td className="table-cell font-mono text-xs text-slate-700">{item.taskCode}</td>
                  <td className="table-cell text-slate-700">{item.taskTitle}</td>
                  <td className="table-cell text-xs text-slate-600">{replacementIntervalLabel(item)}</td>
                  <td className="table-cell text-xs text-slate-600">
                    {[
                      item.nextDueHours != null ? `${item.nextDueHours.toFixed(1)} h` : null,
                      item.nextDueCycles != null ? `${item.nextDueCycles} cic` : null,
                      item.nextDueDate ? new Date(item.nextDueDate).toLocaleDateString('es-MX') : null,
                    ].filter(Boolean).join(' / ') || MISSING_OPERATIONAL_CONTEXT_LABEL}
                  </td>
                  <td className="table-cell text-xs">{visibleStateBadge(taskVisibleState)}</td>
                  <td className="table-cell text-xs text-slate-600">
                    {taskModel.requiresComponentTracking
                      ? associatedComponent
                        ? `${associatedComponent.partNumber} / ${associatedComponent.serialNumber}`
                        : 'Sin componente asociado'
                      : 'No requiere componente'}
                  </td>
                  <td className="table-cell text-xs text-slate-600">
                    {contextForTask ? (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">OT recibida/firmada</span>
                    ) : openSt ? (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">En borrador {openSt.ref}</span>
                    ) : (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-neutral">Sin solicitud</span>
                    )}
                  </td>
                  <td className="table-cell text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {!contextForTask && !openSt && (
                        <button
                          className="btn-primary btn-xs"
                          onClick={() => handleInlineAddTaskToST(item)}
                        >
                          Agregar a ST
                        </button>
                      )}
                      {taskModel.executionType === 'component_replacement' && taskModel.requiresComponentTracking && !associatedComponent && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => setInitialRegistrationTask(item)}
                        >
                          Registrar componente inicial
                        </button>
                      )}
                      {!contextForTask && openSt && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handleInlineViewST(openSt.id)}
                        >
                          Ver ST
                        </button>
                      )}
                      {taskModel.executionType === 'maintenance' && appContext && (
                        <button className="btn-secondary btn-xs" onClick={() => openExecutionFlow(item, 'maintenance_application')}>
                          Registrar aplicación
                        </button>
                      )}
                      {taskModel.executionType === 'component_replacement' && replacementContext && (
                        <button className="btn-primary btn-xs" onClick={() => openExecutionFlow(item, 'component_replacement')}>
                          Registrar cambio ejecutado
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Historial de movimientos</h2>
        </div>
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="table-header">Fecha</th>
              <th className="table-header">Posición</th>
              <th className="table-header">Movimiento</th>
              <th className="table-header">P/N saliente</th>
              <th className="table-header">S/N saliente</th>
              <th className="table-header">P/N entrante</th>
              <th className="table-header">S/N entrante</th>
              <th className="table-header">Hrs</th>
              <th className="table-header">Ciclos</th>
              <th className="table-header">ST</th>
              <th className="table-header">OT</th>
              <th className="table-header">Usuario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {componentMovements.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                <td className="table-cell text-xs text-slate-600">{new Date(row.performedAt).toLocaleString('es-MX')}</td>
                <td className="table-cell text-xs text-slate-700">{row.position}</td>
                <td className="table-cell text-xs text-slate-700">{movementTypeBadge(row.movementType)}</td>
                <td className="table-cell text-xs text-slate-700 font-mono">{row.removedPartNumber ?? (row.removedComponentInstanceId ? componentById.get(row.removedComponentInstanceId)?.partNumber ?? '—' : '—')}</td>
                <td className="table-cell text-xs text-slate-700 font-mono">{row.removedSerialNumber ?? (row.removedComponentInstanceId ? componentById.get(row.removedComponentInstanceId)?.serialNumber ?? '—' : '—')}</td>
                <td className="table-cell text-xs text-slate-700 font-mono">{row.installedPartNumber ?? (row.installedComponentInstanceId ? componentById.get(row.installedComponentInstanceId)?.partNumber ?? '—' : '—')}</td>
                <td className="table-cell text-xs text-slate-700 font-mono">{row.installedSerialNumber ?? (row.installedComponentInstanceId ? componentById.get(row.installedComponentInstanceId)?.serialNumber ?? '—' : '—')}</td>
                <td className="table-cell text-xs text-slate-700 tabular-nums">{row.aircraftHoursAtMovement.toFixed(1)}</td>
                <td className="table-cell text-xs text-slate-700 tabular-nums">{row.aircraftCyclesAtMovement}</td>
                <td className="table-cell text-xs text-slate-700">
                  {row.workRequestId
                    ? <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">ST {row.workRequestId}</span>
                    : <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-neutral">Sin ST</span>}
                </td>
                <td className="table-cell text-xs text-slate-700">
                  {row.workOrderNumber
                    ? <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">OT {row.workOrderNumber}</span>
                    : <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-neutral">Sin OT</span>}
                </td>
                <td className="table-cell text-xs text-slate-500">{row.performedByUserName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Historial de aplicaciones</h2>
        </div>
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="table-header">Fecha</th>
              <th className="table-header">Tarea ATA</th>
              <th className="table-header">Horas al aplicar</th>
              <th className="table-header">Ciclos al aplicar</th>
              <th className="table-header">Próximo cumplimiento</th>
              <th className="table-header">OT</th>
              <th className="table-header">Notas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {effectiveComponentApplications.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                <td className="table-cell text-xs text-slate-600">{new Date(row.appliedAt).toLocaleString('es-MX')}</td>
                <td className="table-cell text-xs text-slate-700">{row.taskId}</td>
                <td className="table-cell text-xs text-slate-700 tabular-nums">{row.aircraftHoursAtApplication.toFixed(1)}</td>
                <td className="table-cell text-xs text-slate-700 tabular-nums">{row.aircraftCyclesAtApplication}</td>
                <td className="table-cell text-xs text-slate-700">
                  {[
                    row.nextDueHours != null ? `${row.nextDueHours.toFixed(1)} h` : null,
                    row.nextDueCycles != null ? `${row.nextDueCycles} cic` : null,
                    row.nextDueDate ? new Date(row.nextDueDate).toLocaleDateString('es-MX') : null,
                  ].filter(Boolean).join(' / ') || MISSING_OPERATIONAL_CONTEXT_LABEL}
                </td>
                <td className="table-cell text-xs text-slate-700">
                  {row.workOrderNumber
                    ? <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-progress">OT {row.workOrderNumber}</span>
                    : <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold badge-state-neutral">Sin OT</span>}
                </td>
                <td className="table-cell text-xs text-slate-500">{row.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && <NewComponentModal onClose={() => setShowModal(false)} />}

      {initialRegistrationTask && selectedAircraftData && (
        <RegisterInitialComponentModal
          task={initialRegistrationTask}
          aircraftId={selectedAircraftData.id}
          onClose={() => setInitialRegistrationTask(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['components', selectedAircraft] });
            qc.invalidateQueries({ queryKey: ['components-plan-items', selectedAircraft] });
            qc.invalidateQueries({ queryKey: ['maintenance-plan', selectedAircraft] });
            qc.invalidateQueries({ queryKey: ['component-applications-bulk', selectedAircraft] });
          }}
        />
      )}

      {executionDraft && selectedAircraftData && (
        <RegisterComponentExecutionModal
          mode={executionDraft.mode}
          context={executionDraft.context}
          task={executionDraft.task}
          aircraftId={selectedAircraftData.id}
          aircraftHours={selectedAircraftData.totalFlightHours}
          aircraftCycles={selectedAircraftData.totalCycles}
          existingComponents={installedComponents as ComponentRow[]}
          existingApplications={effectiveComponentApplications.filter((app) => app.aircraftId === selectedAircraftData.id)}
          onClose={() => setExecutionDraft(null)}
          onCreateComponent={() => {
            setExecutionDraft(null);
            setShowModal(true);
          }}
          onMovement={(movement) => {
            setComponentMovements((prev) => [movement, ...prev]);
            if (movement.removedComponentInstanceId) {
              setRemovedComponentIds((prev) => [...prev, movement.removedComponentInstanceId!]);
            }
          }}
          onApplication={(application) => setComponentApplications((prev) => [application, ...prev])}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['components', selectedAircraft] });
            qc.invalidateQueries({ queryKey: ['components-plan-items', selectedAircraft] });
            qc.invalidateQueries({ queryKey: ['maintenance-plan', selectedAircraft] });
          }}
        />
      )}
    </div>
  );
}
