import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Plane, X, Loader2, AlertTriangle, ChevronDown, ChevronRight, Clock, TrendingDown, Info, FileText, User } from 'lucide-react';
import { QuickCountersPanel } from '../components/aircraft/QuickCountersPanel';
import { aircraftApi, type Aircraft, type CreateAircraftInput } from '@api/aircraft.api';
import { libraryApi, type AssignedPlanCategory, type MaintenanceTemplate } from '@api/library.api';
import { maintenancePlanApi, type MaintenancePlanItem } from '@api/maintenancePlan.api';
import { AircraftStatusReport } from '@components/reports/AircraftStatusReport';
import { MISSING_OPERATIONAL_CONTEXT_LABEL } from '@/shared/operationalContext';

// ── Constants ──────────────────────────────────────────────────────────────

const DAILY_HOURS    = 2;    // assumed flight hours per day (avg)
const MS_PER_DAY     = 24 * 60 * 60 * 1000;
const ALERT_HOURS    = 15;   // < 15h remaining → orange badge
const CRITICAL_HOURS = 5;    // < 5h remaining  → red + blink
const ALERT_DAYS     = 15;   // < 15d remaining → orange badge
const CRITICAL_DAYS  = 5;    // < 5d remaining  → red + blink

const STATUS_BADGE: Record<string, string> = {
  OPERATIONAL: 'badge-operational',
  AOG: 'badge-aog',
  IN_MAINTENANCE: 'badge-maintenance',
  GROUNDED: 'badge-grounded',
  DECOMMISSIONED: 'badge-decommissioned',
};

const STATUS_LABEL: Record<string, string> = {
  OPERATIONAL:    'Operacional',
  AOG:            'AOG',
  IN_MAINTENANCE: 'En Mantenimiento',
  GROUNDED:       'En Tierra',
  DECOMMISSIONED: 'Retirada',
};

// ── Modal ──────────────────────────────────────────────────────────────────

function NewAircraftModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const demoPlaceholdersEnabled = import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test';
  const PLAN_CATEGORY_LABELS: Record<AssignedPlanCategory, string> = {
    manufacturer: 'Normativa de fabricante',
    national_dgac: 'Normativa nacional (DGAC)',
    engine_components: 'Componentes e inspecciones de motor',
    origin_country: 'Normativa país de origen (EASA)',
  };

  const [selectedTemplatesByCategory, setSelectedTemplatesByCategory] = useState<Record<AssignedPlanCategory, string>>({
    manufacturer: '',
    national_dgac: '',
    engine_components: '',
    origin_country: '',
  });

  const [form, setForm] = useState<CreateAircraftInput>({
    registration: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    totalFlightHours: 0,
    totalCycles: 0,
    engineCount: 2,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['library-templates-for-aircraft-create'],
    queryFn: libraryApi.findAll,
    staleTime: 5 * 60 * 1000,
  });

  const activeTemplates = useMemo(
    () => templates.filter((t) => t.isActive),
    [templates],
  );

  const templatesByCategory = useMemo(() => {
    const categories: AssignedPlanCategory[] = ['manufacturer', 'national_dgac', 'engine_components', 'origin_country'];
    const grouped = {} as Record<AssignedPlanCategory, MaintenanceTemplate[]>;

    for (const category of categories) {
      grouped[category] = [...activeTemplates];
    }

    return grouped;
  }, [activeTemplates]);

  useEffect(() => {
    if (!demoPlaceholdersEnabled || activeTemplates.length === 0) return;

    const categories: AssignedPlanCategory[] = ['manufacturer', 'national_dgac', 'engine_components', 'origin_country'];
    setSelectedTemplatesByCategory((prev) => {
      const next = { ...prev };
      for (const category of categories) {
        if (next[category]) continue;
        const candidate = templatesByCategory[category]?.[0];
        if (candidate) next[category] = candidate.id;
      }
      return next;
    });
  }, [activeTemplates, demoPlaceholdersEnabled, templatesByCategory]);

  const mutation = useMutation({
    mutationFn: async () => {
      const assignments = (Object.entries(selectedTemplatesByCategory) as Array<[AssignedPlanCategory, string]>)
        .filter(([, templateId]) => Boolean(templateId))
        .map(([category, templateId]) => ({ category, templateId }));

      // Un campo vacío es "sin dato", no una cadena vacía: el backend rechaza
      // un año o una fecha en blanco.
      const aircraft = await aircraftApi.create({
        ...form,
        owner: form.owner?.toString().trim() || null,
        yearManufactured: form.yearManufactured ? Number(form.yearManufactured) : null,
        coaExpiryDate: form.coaExpiryDate || null,
        assignedPlans: assignments,
      });

      return { aircraft, assignmentsApplied: assignments.length };
    },
    onSuccess: ({ assignmentsApplied }) => {
      if (assignmentsApplied > 0) {
        toast.success(`Aeronave creada y ${assignmentsApplied} planes base asignados`);
      } else {
        toast.success('Aeronave creada correctamente');
      }
      qc.invalidateQueries({ queryKey: ['aircraft'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear aeronave';
      toast.error(msg);
    },
  });

  const set = (field: keyof CreateAircraftInput, value: string | number) =>
    setForm(p => ({ ...p, [field]: value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.registration.trim() || !form.manufacturer.trim() || !form.model.trim() || !form.serialNumber.trim()) {
      toast.error('Matrícula, Marca, Modelo y N/S son obligatorios');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Plane size={16} className="text-brand-600" />
            <h2 className="text-base font-bold text-slate-900">Nueva Aeronave</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Matrícula <span className="text-rose-500">*</span></label>
              <input
                value={form.registration}
                onChange={e => set('registration', e.target.value.toUpperCase())}
                className="filter-input w-full"
                placeholder="XA-GRI"
                maxLength={20}
              />
            </div>
            <div>
              <label className="form-label">N/S (Airframe) <span className="text-rose-500">*</span></label>
              <input
                value={form.serialNumber}
                onChange={e => set('serialNumber', e.target.value)}
                className="filter-input w-full"
                placeholder="Ej: 30482"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Marca (Fabricante) <span className="text-rose-500">*</span></label>
              <input
                value={form.manufacturer}
                onChange={e => set('manufacturer', e.target.value)}
                className="filter-input w-full"
                placeholder="Boeing"
              />
            </div>
            <div>
              <label className="form-label">Modelo <span className="text-rose-500">*</span></label>
              <input
                value={form.model}
                onChange={e => set('model', e.target.value)}
                className="filter-input w-full"
                placeholder="737-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Horas Totales</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={form.totalFlightHours}
                onChange={e => set('totalFlightHours', parseFloat(e.target.value) || 0)}
                className="filter-input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label className="form-label">Ciclos Totales</label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.totalCycles}
                onChange={e => set('totalCycles', parseInt(e.target.value) || 0)}
                className="filter-input w-full"
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">N° Motores</label>
              <input
                type="number"
                min={1}
                max={4}
                value={form.engineCount}
                onChange={e => set('engineCount', parseInt(e.target.value) || 2)}
                className="filter-input w-full"
              />
            </div>
            <div>
              <label className="form-label">Modelo de Motor</label>
              <input
                value={form.engineModel ?? ''}
                onChange={e => set('engineModel', e.target.value)}
                className="filter-input w-full"
                placeholder="CFM56-7B"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Propietario</label>
              <input
                value={form.owner ?? ''}
                onChange={e => set('owner', e.target.value)}
                className="filter-input w-full"
                placeholder="Ej: PUBLI G"
                maxLength={180}
              />
            </div>
            <div>
              <label className="form-label">Año de fabricación</label>
              <input
                value={form.yearManufactured ?? ''}
                onChange={e => set('yearManufactured', e.target.value ? parseInt(e.target.value) : '')}
                className="filter-input w-full"
                placeholder="2017"
                inputMode="numeric"
              />
            </div>
          </div>

          <div>
            <label className="form-label">Vencimiento del certificado de aeronavegabilidad</label>
            <input
              type="date"
              value={(form.coaExpiryDate as string | undefined) ?? ''}
              onChange={e => set('coaExpiryDate', e.target.value)}
              className="filter-input w-full"
            />
          </div>

          <div className="space-y-3">
            <p className="form-label">Planes base por categoría</p>
            {(['manufacturer', 'national_dgac', 'engine_components', 'origin_country'] as AssignedPlanCategory[]).map((category) => (
              <div key={category}>
                <label className="form-label">{PLAN_CATEGORY_LABELS[category]}</label>
                <select
                  value={selectedTemplatesByCategory[category]}
                  onChange={(e) => setSelectedTemplatesByCategory((prev) => ({ ...prev, [category]: e.target.value }))}
                  className="filter-input w-full"
                >
                  <option value="">Sin asignar por ahora</option>
                  {(templatesByCategory[category] ?? []).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.manufacturer} {template.model} - {template.description ?? template.version}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-1.5"
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plane size={14} />}
              Guardar Aeronave
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Predictive projection helpers ─────────────────────────────────────────

interface CriticalTask {
  code: string;
  title: string;
  intervalType: string;
  hoursRemaining: number | null;
  daysRemaining: number | null;
  nextDueDate: Date | null;
  dueBy: 'HOURS' | 'CALENDAR' | null;
  /** Urgency expressed in days — min of hours→days and calendar days */
  urgencyDays: number;
  status: string;
}

/**
 * Returns up to 5 most critical tasks using DUAL criteria:
 * whichever limit (flight-hours OR calendar date) comes first drives urgency.
 */
function getCriticalTasks(plan: MaintenancePlanItem[]): CriticalTask[] {
  return plan
    .filter(item => item.hoursRemaining != null || item.daysRemaining != null)
    .map(item => {
      const hoursAsDays =
        item.hoursRemaining != null
          ? item.hoursRemaining / DAILY_HOURS   // can be negative if overdue
          : Infinity;
      const calDays = item.daysRemaining != null ? item.daysRemaining : Infinity;
      const urgencyDays = Math.min(hoursAsDays, calDays);
      return {
        code: item.taskCode,
        title: item.taskTitle,
        intervalType: item.intervalType,
        hoursRemaining: item.hoursRemaining,
        daysRemaining: item.daysRemaining,
        nextDueDate: item.nextDueDate ? new Date(item.nextDueDate) : null,
        dueBy: item.dueBy,
        urgencyDays: urgencyDays === Infinity ? 99999 : urgencyDays,
        status: item.status,
      };
    })
    .sort((a, b) => a.urgencyDays - b.urgencyDays)
    .slice(0, 5);
}

/**
 * Projects real Next Due using dual limits.
 * - Hours-only: projected by DAILY_HOURS/day.
 * - Calendar-only: uses exact due date.
 * - Dual: earliest date wins.
 */
function calculateEstimatedDate(task: CriticalTask): Date | null {
  const hoursDate = task.hoursRemaining != null
    ? new Date(Date.now() + (task.hoursRemaining / DAILY_HOURS) * MS_PER_DAY)
    : null;

  const calendarDate = task.nextDueDate ??
    (task.daysRemaining != null ? new Date(Date.now() + task.daysRemaining * MS_PER_DAY) : null);

  if (hoursDate && calendarDate) return hoursDate <= calendarDate ? hoursDate : calendarDate;
  return calendarDate ?? hoursDate;
}

type AlertTier = 'overdue' | 'critical' | 'warning' | 'ok';

function getAlertTier(task: CriticalTask): AlertTier {
  if (task.status === 'OVERDUE') return 'overdue';
  if (
    (task.hoursRemaining != null && task.hoursRemaining < CRITICAL_HOURS) ||
    (task.daysRemaining  != null && task.daysRemaining  < CRITICAL_DAYS)
  ) return 'critical';
  if (
    (task.hoursRemaining != null && task.hoursRemaining < ALERT_HOURS) ||
    (task.daysRemaining  != null && task.daysRemaining  < ALERT_DAYS)
  ) return 'warning';
  return 'ok';
}

// ── Projection Panel (expanded row) ───────────────────────────────────────

function ProjectionPanel({ aircraft }: { aircraft: Aircraft }) {
  const { data: plan = [], isLoading } = useQuery({
    queryKey: ['maintenance-plan', aircraft.id],
    queryFn: () => maintenancePlanApi.getForAircraft(aircraft.id),
    staleTime: 5 * 60 * 1000,
  });

  const critical = useMemo(() => getCriticalTasks(plan), [plan]);
  const overdueTasks = plan.filter(p => p.status === 'OVERDUE').length;
  const dueSoonTasks = plan.filter(p => p.status === 'DUE_SOON').length;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 text-xs text-slate-400">
        <Loader2 size={13} className="animate-spin" /> Calculando proyecciones…
      </div>
    );
  }

  if (critical.length === 0) {
    return (
      <div className="py-3 px-4 text-xs text-slate-400 flex items-center gap-2">
        <Info size={13} />
        {MISSING_OPERATIONAL_CONTEXT_LABEL}
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 pt-2 bg-slate-50/60 border-t border-slate-100">
      {/* Summary pills */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Proyección predictiva</span>
        <span className="text-[10px] text-slate-400">· criterio doble: horas vuelo ({DAILY_HOURS}h/día) y calendario</span>
        {overdueTasks > 0 && (
          <span className="ml-1 text-[10px] font-bold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">
            {overdueTasks} VENCIDA{overdueTasks > 1 ? 'S' : ''}
          </span>
        )}
        {dueSoonTasks > 0 && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
            {dueSoonTasks} PRÓXIMA{dueSoonTasks > 1 ? 'S' : ''}
          </span>
        )}
      </div>

      {/* Task table */}
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-slate-100">
              <th className="px-3 py-1.5 text-left font-bold text-slate-500 uppercase tracking-wide text-[10px]">Tarea</th>
              <th className="px-3 py-1.5 text-right font-bold text-slate-500 uppercase tracking-wide text-[10px]">H restantes</th>
              <th className="px-3 py-1.5 text-right font-bold text-slate-500 uppercase tracking-wide text-[10px]">Fecha estimada</th>
              <th className="px-3 py-1.5 text-right font-bold text-slate-500 uppercase tracking-wide text-[10px]">Días calendario</th>
              <th className="px-3 py-1.5 text-right font-bold text-slate-500 uppercase tracking-wide text-[10px]">Criterio urgente</th>
              <th className="px-3 py-1.5 text-left font-bold text-slate-500 uppercase tracking-wide text-[10px]">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {critical.map(t => {
              const projectedDueDate = calculateEstimatedDate(t);
              const rowTier = getAlertTier(t);
              // Which criterion is driving urgency?
              const hoursAsDays = t.hoursRemaining != null ? t.hoursRemaining / DAILY_HOURS : Infinity;
              const calDays     = t.daysRemaining  != null ? t.daysRemaining                : Infinity;
              const controlledByHours = t.dueBy != null ? t.dueBy === 'HOURS' : hoursAsDays <= calDays;
              return (
                <tr key={t.code} className={
                  rowTier === 'overdue'  ? 'bg-rose-50' :
                  rowTier === 'critical' ? 'bg-red-50/60' :
                  rowTier === 'warning'  ? 'bg-amber-50' : ''
                }>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {rowTier !== 'ok' && (
                        <AlertTriangle
                          size={12}
                          className={`shrink-0 animate-pulse ${
                            rowTier === 'overdue' || rowTier === 'critical' ? 'text-rose-500' : 'text-amber-500'
                          }`}
                        />
                      )}
                      <span className="font-mono font-bold text-slate-500 text-[10px] bg-slate-100 px-1 py-0.5 rounded">{t.code}</span>
                      <span className="text-slate-700 truncate max-w-[160px]">{t.title}</span>
                    </div>
                  </td>
                  {/* hours remaining */}
                  <td className={`px-3 py-2 text-right font-bold tabular-nums ${
                    (rowTier === 'overdue' || rowTier === 'critical') && controlledByHours ? 'text-rose-600 animate-pulse' :
                    rowTier === 'warning' && controlledByHours                            ? 'text-amber-600 animate-pulse' :
                                                                                           'text-slate-500'
                  }`}>
                    {t.hoursRemaining != null
                      ? t.hoursRemaining < 0
                        ? `+${Math.abs(t.hoursRemaining).toFixed(0)}h venc.`
                        : `${t.hoursRemaining.toFixed(1)} h`
                        : <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>}
                  </td>
                  {/* estimated calendar date based on hours */}
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                    {projectedDueDate
                      ? projectedDueDate.toLocaleDateString('es-MX')
                      : <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>}
                  </td>
                  {/* calendar days remaining */}
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    (rowTier === 'overdue' || rowTier === 'critical') && !controlledByHours ? 'text-rose-600 animate-pulse' :
                    rowTier === 'warning' && !controlledByHours                            ? 'text-amber-600 animate-pulse' :
                                                                                            'text-slate-500'
                  }`}>
                    {t.daysRemaining != null
                      ? t.daysRemaining < 0
                        ? `+${Math.abs(t.daysRemaining)}d venc.`
                        : `${t.daysRemaining}d`
                      : <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>}
                  </td>
                  {/* controlling criterion pill */}
                  <td className="px-3 py-2 text-right">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      controlledByHours ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                    }`}>
                      {controlledByHours ? 'Vence por Horas' : 'Vence por Calendario'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={t.status as 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NEVER_PERFORMED'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NEVER_PERFORMED' }) {
  const map = {
    OVERDUE:         { label: 'Vencida',     cls: 'bg-rose-100 text-rose-700' },
    DUE_SOON:        { label: 'Próxima',      cls: 'bg-amber-100 text-amber-700' },
    OK:              { label: 'Al día',       cls: 'bg-emerald-100 text-emerald-700' },
    NEVER_PERFORMED: { label: 'Sin cumplir',  cls: 'bg-slate-100 text-slate-600' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${cls}`}>{label}</span>;
}

// ── Aircraft row with predictive alert indicator ───────────────────────────

function AircraftRow({ aircraft }: { aircraft: Aircraft }) {
  const [expanded, setExpanded] = useState(false);
  const [showStatusReport, setShowStatusReport] = useState(false);
  const navigate = useNavigate();

  // Lightweight pre-fetch to show alert dot — only triggers once mounted
  const { data: plan = [] } = useQuery({
    queryKey: ['maintenance-plan', aircraft.id],
    queryFn: () => maintenancePlanApi.getForAircraft(aircraft.id),
    staleTime: 5 * 60 * 1000,
  });

  const criticalTasks = useMemo(() => getCriticalTasks(plan), [plan]);
  const isOverdue = plan.some(p => p.status === 'OVERDUE');
  // Nearest task by urgency (dual-criteria)
  const nearest = criticalTasks[0];
  const tier: AlertTier = isOverdue ? 'overdue' : nearest ? getAlertTier(nearest) : 'ok';

  return (
    <>
      <tr
        className={`transition-colors cursor-pointer ${expanded ? 'bg-slate-50' : 'hover:bg-slate-50/80'} ${
          tier === 'overdue' || tier === 'critical' ? 'border-l-2 border-l-rose-500' :
          tier === 'warning'                        ? 'border-l-2 border-l-amber-400' :
          'border-l-2 border-l-transparent'
        }`}
        onClick={() => setExpanded(prev => !prev)}
      >
        {/* Expand chevron */}
        <td className="table-cell w-8">
          <button className="p-0.5 rounded text-slate-400 hover:text-slate-600 transition-colors">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </td>

        {/* Matrícula + alert */}
        <td className="table-cell">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-slate-900">{aircraft.registration}</span>
            {(tier === 'overdue' || tier === 'critical') && (
              <AlertTriangle size={13} className="text-rose-500 animate-pulse shrink-0" />
            )}
            {tier === 'warning' && (
              <AlertTriangle size={13} className="text-amber-500 animate-pulse shrink-0" />
            )}
          </div>
        </td>

        <td className="table-cell text-slate-600">{aircraft.manufacturer}</td>
        <td className="table-cell text-slate-600">{aircraft.model}</td>
        <td className="table-cell font-mono text-xs text-slate-500">{aircraft.serialNumber}</td>
        <td className="table-cell text-right tabular-nums">{Number(aircraft.totalFlightHours).toFixed(1)}</td>
        <td className="table-cell text-right tabular-nums">{aircraft.totalCycles}</td>

        {/* Días estimados para próx. tarea */}
        <td className="table-cell text-right">
          {nearest ? (
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                {tier !== 'ok' && (
                  <Clock size={11} className={tier === 'overdue' || tier === 'critical' ? 'text-rose-400' : 'text-amber-400'} />
                )}
                <span className={`text-xs font-semibold tabular-nums ${
                  tier === 'overdue' || tier === 'critical' ? 'text-rose-600' :
                  tier === 'warning'                        ? 'text-amber-600' :
                  nearest.urgencyDays <= 30                 ? 'text-amber-500' :
                                                             'text-slate-600'
                }`}>
                  {tier === 'overdue'
                    ? 'Vencida'
                    : nearest.urgencyDays <= 0
                    ? 'Hoy'
                    : `~${Math.round(nearest.urgencyDays)}d`}
                </span>
              </div>
              {calculateEstimatedDate(nearest) && (
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {calculateEstimatedDate(nearest)?.toLocaleDateString('es-MX')}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 text-xs">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>
          )}
        </td>

        <td className="table-cell">
          {aircraft.coaExpiryDate ? new Date(aircraft.coaExpiryDate).toLocaleDateString('es-MX') : MISSING_OPERATIONAL_CONTEXT_LABEL}
        </td>
        <td className="table-cell">
          <span className={STATUS_BADGE[aircraft.status] ?? 'badge-grounded'}>
            {STATUS_LABEL[aircraft.status] ?? aircraft.status}
          </span>
        </td>
        <td className="table-cell">
          <div className="flex items-center gap-1.5">
            <button
              className="btn-secondary inline-flex items-center gap-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/aircraft/${aircraft.id}`);
              }}
            >
              <User size={12} /> Ficha
            </button>
            <button
              className="btn-secondary inline-flex items-center gap-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setShowStatusReport(true);
              }}
            >
              <FileText size={12} /> Reporte DGAC
            </button>
          </div>
        </td>
      </tr>

      {/* Expandable projection row */}
      {expanded && (
        <tr>
          <td colSpan={11} className="p-0">
            <ProjectionPanel aircraft={aircraft} />
          </td>
        </tr>
      )}

      {showStatusReport && (
        <AircraftStatusReport
          aircraftId={aircraft.id}
          registration={aircraft.registration}
          model={aircraft.model}
          currentHours={Number(aircraft.totalFlightHours)}
          onClose={() => setShowStatusReport(false)}
        />
      )}
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AircraftPage() {
  const [showModal, setShowModal] = useState(false);
  const { data: aircraft = [], isLoading, isError, error } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const aircraftList = Array.isArray(aircraft) ? aircraft : [];

  return (
    <div className="p-8 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <Plane size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Aeronaves</h1>
            <p className="text-sm text-slate-500">
              {isError
                ? 'No se pudo cargar la flota'
                : `${aircraftList.length} aeronave${aircraftList.length !== 1 ? 's' : ''} en la flota`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
            <TrendingDown size={12} className="text-brand-500" />
            <span>Clic en una fila para ver proyección predictiva</span>
          </div>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Nueva aeronave
          </button>
        </div>
      </div>

      <QuickCountersPanel aircraft={aircraftList} />

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-header w-8"></th>
              <th className="table-header">MAT</th>
              <th className="table-header">Fabricante</th>
              <th className="table-header">Modelo</th>
              <th className="table-header">N/S</th>
              <th className="table-header text-right">Horas totales</th>
              <th className="table-header text-right">Ciclos</th>
              <th className="table-header text-right">Próx. tarea</th>
              <th className="table-header">Vto. CdN</th>
              <th className="table-header">Estado</th>
              <th className="table-header">Perfil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={11} className="table-cell text-center text-slate-400 py-12">Cargando…</td>
              </tr>
            )}
            {!isLoading && !isError && aircraftList.length === 0 && (
              <tr>
                <td colSpan={11} className="table-cell text-center text-slate-400 py-12">No hay aeronaves registradas</td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={11} className="table-cell text-center text-rose-600 py-12">
                  {error instanceof Error ? error.message : 'No se pudo cargar la lista de aeronaves.'}
                </td>
              </tr>
            )}
            {!isError && aircraftList.map((a) => (
              <AircraftRow key={a.id} aircraft={a} />
            ))}
          </tbody>
        </table>
      </div>

      {showModal && <NewAircraftModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
