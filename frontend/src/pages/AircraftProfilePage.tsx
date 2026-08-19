// ─────────────────────────────────────────────────────────────────────────────
//  Ficha de Control de Aeronave
//  /aircraft/:id
//  Counters (TSN / Ciclos / CdN) · Semáforo de Vencimientos · Historial reciente
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plane, Clock, AlertTriangle, CheckCircle2,
  FileText, Paperclip, ClipboardList, Activity,
  Calendar, Gauge, RotateCcw, Zap, ExternalLink, Plus,
  Pencil, X, Loader2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { saveAs } from 'file-saver';
import { AircraftStatusControl } from '../components/aircraft/AircraftStatusControl';
import { AircraftCountersPanel } from '../components/aircraft/AircraftCountersPanel';
import { AircraftDetailsCard } from '../components/aircraft/AircraftDetailsCard';
import { useAuthStore } from '../store/authStore';
import {
  aircraftApi,
  type Aircraft,
  type AircraftEngine,
  type AircraftUsageHistory,
  type AircraftUsageSource,
  type CounterReading,
} from '@api/aircraft.api';
import { buildCounterHistory, formatDateOnly } from '../shared/counterHistoryReport';
import { libraryApi, templateNativeCategory, type AssignedPlanCategory, type AircraftAssignedPlan, type MaintenanceTemplate } from '@api/library.api';
import { maintenancePlanApi, type MaintenancePlanItem } from '@api/maintenancePlan.api';
import { AircraftStatusReport } from '@components/reports/AircraftStatusReport';
import { useWorkRequestStore } from '../store/workRequestStore';
import { createSTFromSource } from '../shared/createSTFromSource';
import {
  findActiveWorkRequestByMaintenanceTaskId,
  type WorkRequest,
} from '../shared/workRequestTypes';
import { ensureStateMachine, getVisibleState, getVisibleStateLabel } from '../shared/workflowVisibleState';
import { useWorkRequestStateMachine } from '../shared/workflowStateMachineQueries';
import type { WorkflowStateMachine } from '../api/workRequests.api';
import { MISSING_OPERATIONAL_CONTEXT_LABEL } from '../shared/operationalContext';

// ─── Constants ────────────────────────────────────────────────────────────────
const DAILY_HOURS = 2;
const MS_PER_DAY  = 86_400_000;

type AlertTier = 'overdue' | 'critical' | 'warning' | 'ok';

const STATUS_LABEL: Record<string, string> = {
  OPERATIONAL:    'Operacional',
  AOG:            'AOG',
  IN_MAINTENANCE: 'En Mantenimiento',
  GROUNDED:       'En Tierra',
  DECOMMISSIONED: 'Retirada',
};

const STATUS_CLASSES: Record<string, string> = {
  OPERATIONAL:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  AOG:            'bg-rose-100 text-rose-800 border-rose-200',
  IN_MAINTENANCE: 'bg-amber-100 text-amber-800 border-amber-200',
  GROUNDED:       'bg-orange-100 text-orange-800 border-orange-200',
  DECOMMISSIONED: 'bg-slate-100 text-slate-600 border-slate-200',
};

const USAGE_SOURCE_LABEL: Record<AircraftUsageSource, string> = {
  manual: 'Manual',
  flight_log: 'Bitacora de vuelo',
  ot_close: 'Cierre OT',
  import: 'Importacion',
  baseline: 'Linea base',
};

const ASSIGNED_PLAN_CATEGORY_LABELS: Record<AssignedPlanCategory, string> = {
  manufacturer: 'Normativa de fabricante',
  national_dgac: 'Normativa nacional (DGAC)',
  engine_components: 'Componentes e inspecciones de motor',
  origin_country: 'Normativa país de origen',
};

// ─── Semaphore helpers ────────────────────────────────────────────────────────
function getAlertTier(item: MaintenancePlanItem): AlertTier {
  if (item.status === 'OVERDUE') return 'overdue';
  const h = item.hoursRemaining;
  const d = item.daysRemaining;
  if ((h != null && h < 5) || (d != null && d < 5))   return 'critical';
  if ((h != null && h < 15) || (d != null && d < 15))  return 'warning';
  return 'ok';
}

function tierColor(tier: AlertTier) {
  return {
    overdue:  { row: 'bg-rose-50',   badge: 'bg-rose-100 text-rose-700',   dot: 'bg-rose-500',   ring: '#ef4444' },
    critical: { row: 'bg-red-50',    badge: 'bg-red-100 text-red-700',     dot: 'bg-red-500',    ring: '#f87171' },
    warning:  { row: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400',  ring: '#f59e0b' },
    ok:       { row: '',             badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400', ring: '#10b981' },
  }[tier];
}

// ─── Circular progress ring ───────────────────────────────────────────────────
const RADIUS       = 38;
const STROKE_WIDTH = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const VIEW_SIZE     = (RADIUS + STROKE_WIDTH) * 2 + 4;

function ProgressRing({
  pct, value, unit, label, tier, sublabel,
}: {
  pct: number;
  value: string;
  unit: string;
  label: string;
  tier: AlertTier;
  sublabel?: string;
}) {
  const clamped  = Math.max(0, Math.min(100, pct));
  const offset   = CIRCUMFERENCE * (1 - clamped / 100);
  const ringColor = tierColor(tier).ring;
  const center   = VIEW_SIZE / 2;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</p>
      <div className="relative" style={{ width: VIEW_SIZE, height: VIEW_SIZE }}>
        <svg
          width={VIEW_SIZE}
          height={VIEW_SIZE}
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Track */}
          <circle
            r={RADIUS} cx={center} cy={center}
            fill="none" stroke="#e2e8f0" strokeWidth={STROKE_WIDTH}
          />
          {/* Progress arc */}
          <circle
            r={RADIUS} cx={center} cy={center}
            fill="none"
            stroke={ringColor}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.7s ease' }}
          />
        </svg>
        {/* Center label (no rotation correction: rotate the wrapper back) */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ transform: 'none' }}
        >
          <span className="text-lg font-extrabold tabular-nums text-slate-900 leading-none">
            {value}
          </span>
          <span className="text-[10px] text-slate-400 mt-0.5">{unit}</span>
        </div>
      </div>
      {sublabel && (
        <span className="text-[10px] text-slate-400">{sublabel}</span>
      )}
    </div>
  );
}

// ─── Static icon counter card (for items without a ring) ─────────────────────
function StatCard({
  Icon, label, value, sub, colorClass,
}: {
  Icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  colorClass: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-extrabold tabular-nums text-slate-900 leading-none mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Semaphore dot pill ───────────────────────────────────────────────────────
function TierBadge({ tier }: { tier: AlertTier }) {
  const labels = { overdue: 'Vencida', critical: 'Crítica', warning: 'Próxima', ok: 'Al día' };
  const { badge } = tierColor(tier);
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge}`}>
      {labels[tier]}
    </span>
  );
}

type TaskSTInfo = {
  label: 'Sin ST' | 'Borrador' | 'En proceso' | 'Cancelada';
  workRequestId: string | null;
  hasST: boolean;
  isOpen: boolean;
};

function resolveTaskSTInfo(
  item: MaintenancePlanItem,
  workRequests: WorkRequest[],
  aircraftId: string,
  workRequestStateMachine: WorkflowStateMachine<'DRAFT' | 'SENT' | 'CANCELLED'>,
): TaskSTInfo {
  const active = findActiveWorkRequestByMaintenanceTaskId({
    workRequests,
    aircraftId,
    maintenanceTaskId: item.taskId,
  });

  const byId = item.inWorkRequestId
    ? workRequests.find((wr) => wr.id === item.inWorkRequestId)
    : undefined;

  const byTask = workRequests
    .filter((wr) => wr.items.some((it) => it.sourceId === item.taskId))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  const wr = active ?? byId ?? byTask;

  if (!wr) {
    if (item.inWorkRequestId || item.inWorkRequestNumber) {
      return { label: 'En proceso', workRequestId: item.inWorkRequestId ?? null, hasST: true, isOpen: true };
    }
    return { label: 'Sin ST', workRequestId: null, hasST: false, isOpen: false };
  }

  const visible = getVisibleState(workRequestStateMachine, wr.status);
  const visibleLabel = getVisibleStateLabel(workRequestStateMachine, wr.status);
  const label: TaskSTInfo['label'] = visible === 'draft'
    ? 'Borrador'
    : visible === 'cancelled'
      ? 'Cancelada'
      : visibleLabel === 'Unknown'
        ? 'En proceso'
        : 'En proceso';
  return {
    label,
    workRequestId: wr.id,
    hasST: true,
    isOpen: visible !== 'cancelled',
  };
}

// ─── Semaphore table ──────────────────────────────────────────────────────────
function SemaphoreTable({
  plan,
  aircraftId,
  workRequests,
  workRequestStateMachine,
  viewDensity,
  onOpenST,
  onGenerateST,
}: {
  plan: MaintenancePlanItem[];
  aircraftId: string;
  workRequests: WorkRequest[];
  workRequestStateMachine: WorkflowStateMachine<'DRAFT' | 'SENT' | 'CANCELLED'>;
  viewDensity: 'comfortable' | 'compact';
  onOpenST: (workRequestId: string | null, taskCode: string) => void;
  onGenerateST: (task: MaintenancePlanItem) => void;
}) {
  const sorted = useMemo(() => {
    return [...plan]
      .filter(i => i.hoursRemaining != null || i.daysRemaining != null || i.status === 'OVERDUE')
      .map(i => {
        const hoursAsDays = i.hoursRemaining != null ? i.hoursRemaining / DAILY_HOURS : Infinity;
        const calDays     = i.daysRemaining  != null ? i.daysRemaining                : Infinity;
        const stInfo = resolveTaskSTInfo(i, workRequests, aircraftId, workRequestStateMachine);
        const isOverdueWithoutST = i.status === 'OVERDUE' && !stInfo.hasST;
        return {
          ...i,
          stInfo,
          urgencyDays: Math.min(hoursAsDays, calDays),
          sortBucket: isOverdueWithoutST ? 0 : 1,
        };
      })
      .sort((a, b) => {
        if (a.sortBucket !== b.sortBucket) return a.sortBucket - b.sortBucket;
        return a.urgencyDays - b.urgencyDays;
      })
      .slice(0, 10);
  }, [plan, workRequests, aircraftId, workRequestStateMachine]);

  if (sorted.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-400" />
        Sin tareas con vencimiento registrado.
      </div>
    );
  }

  const cellPadding = viewDensity === 'compact' ? 'px-3 py-2' : 'px-4 py-2.5';
  const headerPadding = viewDensity === 'compact' ? 'px-3 py-2' : 'px-4 py-2.5';
  const tinyText = viewDensity === 'compact' ? 'text-[9px]' : 'text-[10px]';
  const actionGap = viewDensity === 'compact' ? 'space-y-0.5' : 'space-y-1';
  const actionButtonPadding = viewDensity === 'compact' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';

  return (
    <div className="overflow-auto max-h-[60vh] rounded-xl border border-slate-200">
      <table className="min-w-full text-xs divide-y divide-slate-100">
        <thead className="bg-slate-50 sticky top-0 z-10">
          <tr>
            <th className={`${headerPadding} text-left font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>ATA · Tarea</th>
            <th className={`${headerPadding} text-right font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>H restantes</th>
            <th className={`${headerPadding} text-right font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>Días cal.</th>
            <th className={`${headerPadding} text-right font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>Próx. fecha</th>
            <th className={`${headerPadding} text-center font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>Sustento</th>
            <th className={`${headerPadding} text-center font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>Estado</th>
            <th className={`${headerPadding} text-center font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>ST</th>
            <th className={`${headerPadding} text-center font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>Acción</th>
            <th className={`${headerPadding} text-center font-bold text-slate-500 uppercase tracking-wide ${tinyText}`}>Evidencia</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {sorted.map(item => {
            const stInfo = item.stInfo;
            const tier = getAlertTier(item);
            const { row, dot } = tierColor(tier);
            const highlightNoST = item.status === 'OVERDUE' && !stInfo.hasST;
            const hoursAsDays = item.hoursRemaining != null ? item.hoursRemaining / DAILY_HOURS : Infinity;
            const calDays     = item.daysRemaining  != null ? item.daysRemaining                : Infinity;
            const drivingDate = item.hoursRemaining != null && hoursAsDays <= calDays
              ? new Date(Date.now() + hoursAsDays * MS_PER_DAY)
              : item.nextDueDate
                ? new Date(item.nextDueDate)
                : item.daysRemaining != null
                  ? new Date(Date.now() + item.daysRemaining * MS_PER_DAY)
                  : null;
            return (
              <tr key={item.taskId} className={`${row} ${highlightNoST ? 'ring-1 ring-inset ring-rose-200 bg-rose-50/70' : ''}`}>
                <td className={cellPadding}>
                  <div className={`flex items-start ${viewDensity === 'compact' ? 'gap-1.5' : 'gap-2'}`}>
                    <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${dot} ${tier !== 'ok' ? 'animate-pulse' : ''}`} />
                    <div>
                      <span className="font-mono font-bold text-slate-500 text-[10px] bg-slate-100 px-1 py-0.5 rounded mr-1">
                        {item.taskCode}
                      </span>
                      <span className="text-slate-700">{item.taskTitle}</span>
                    </div>
                  </div>
                </td>
                <td className={`${cellPadding} text-right font-bold tabular-nums ${
                  (tier === 'overdue' || tier === 'critical') ? 'text-rose-600' :
                  tier === 'warning' ? 'text-amber-600' : 'text-slate-600'
                }`}>
                  {item.hoursRemaining != null
                    ? item.hoursRemaining < 0
                      ? <span className="text-rose-600">+{Math.abs(item.hoursRemaining).toFixed(0)}h venc.</span>
                      : `${item.hoursRemaining.toFixed(1)} h`
                    : <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>}
                </td>
                <td className={`${cellPadding} text-right font-semibold tabular-nums ${
                  (tier === 'overdue' || tier === 'critical') ? 'text-rose-600' :
                  tier === 'warning' ? 'text-amber-600' : 'text-slate-600'
                }`}>
                  {item.daysRemaining != null
                    ? item.daysRemaining < 0
                      ? <span className="text-rose-600">+{Math.abs(item.daysRemaining)}d venc.</span>
                      : `${item.daysRemaining}d`
                    : <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>}
                </td>
                <td className={`${cellPadding} text-right text-slate-500 text-[11px] tabular-nums`}>
                  {drivingDate ? drivingDate.toLocaleDateString('es-MX') : <span className="text-slate-400">{MISSING_OPERATIONAL_CONTEXT_LABEL}</span>}
                </td>
                <td className={`${cellPadding} text-center`}>
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                    {item.legalSource}
                  </span>
                </td>
                <td className={`${cellPadding} text-center`}>
                  <TierBadge tier={tier} />
                </td>
                <td className={`${cellPadding} text-center`}>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      stInfo.label === 'Sin ST'
                        ? 'bg-slate-100 text-slate-500'
                        : stInfo.label === 'Borrador'
                          ? 'bg-slate-200 text-slate-700'
                          : stInfo.label === 'En proceso'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {stInfo.label}
                  </span>
                </td>
                <td className={`${cellPadding} text-center`}>
                  {stInfo.hasST ? (
                    <div className={actionGap}>
                      <button
                        onClick={() => onOpenST(stInfo.workRequestId, item.taskCode)}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 ${actionButtonPadding} rounded-full`}
                      >
                        Ver ST
                      </button>
                      {stInfo.isOpen && <p className="text-[10px] text-amber-700">ST existente</p>}
                    </div>
                  ) : (
                    <div className={actionGap}>
                      <button
                        onClick={() => onGenerateST(item)}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-brand-600 hover:bg-brand-700 ${actionButtonPadding} rounded-full`}
                      >
                        Agregar a ST
                      </button>
                      {highlightNoST && <p className="text-[10px] text-rose-700">Pendiente de solicitud</p>}
                    </div>
                  )}
                </td>
                <td className={`${cellPadding} text-center`}>
                  {item.lastEvidenceUrl ? (
                    <button
                      onClick={() => window.open(item.lastEvidenceUrl!, '_blank')}
                      className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 text-[11px] font-medium
                                 bg-brand-50 hover:bg-brand-100 px-2 py-0.5 rounded-full transition-colors"
                      title="Ver evidencia OT"
                    >
                      <Paperclip size={10} />
                      Ver OT
                    </button>
                  ) : (
                    <span className="text-slate-300 text-[10px]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Audit history timeline ───────────────────────────────────────────────────
function AuditTimeline({ aircraftId }: { aircraftId: string }) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['aircraft-audit', aircraftId],
    queryFn: () => aircraftApi.getAuditLog(aircraftId),
    staleTime: 60_000,
  });

  const last5 = useMemo(() => [...entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5),
  [entries]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
        <Activity size={13} className="animate-pulse" /> Cargando historial…
      </div>
    );
  }

  if (last5.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-slate-400">
        Sin registros de bitácora para esta aeronave.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {last5.map((entry, i) => {
        const meta  = entry.metadata as Record<string, string> | null;
        const evidenceUrl = meta?.evidenceUrl ?? meta?.evidence_url ?? null;
        const isLast = i === last5.length - 1;

        return (
          <div key={entry.id} className="flex gap-3">
            {/* Timeline spine */}
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${
                entry.action.includes('CLOSE') || entry.action.includes('COMPLY')
                  ? 'bg-emerald-500'
                  : entry.action.includes('DELETE') || entry.action.includes('CANCEL')
                    ? 'bg-rose-400'
                    : 'bg-brand-400'
              }`} />
              {!isLast && <div className="w-[1px] flex-1 bg-slate-200 mt-1" />}
            </div>

            {/* Content */}
            <div className="pb-3 min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-slate-700 truncate max-w-xs">
                  {entry.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                </span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(entry.createdAt).toLocaleString('es-MX', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] text-slate-400 bg-slate-50 rounded-full px-2 py-0.5 border border-slate-200">
                  {entry.userEmail}
                </span>
                {meta?.message && (
                  <span className="text-[10px] text-slate-600 italic">
                    "{meta.message}"
                  </span>
                )}
                {evidenceUrl && (
                  <button
                    onClick={() => window.open(evidenceUrl, '_blank')}
                    className="inline-flex items-center gap-0.5 text-[10px] text-brand-600 hover:text-brand-700
                               bg-brand-50 hover:bg-brand-100 px-2 py-0.5 rounded-full transition-colors"
                  >
                    <Paperclip size={9} /> Respaldo fotográfico
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Smart ST suggestion banner ───────────────────────────────────────────────
function SmartSuggestionBanner({
  plan,
  onCreateST,
}: {
  plan: MaintenancePlanItem[];
  onCreateST: () => void;
}) {
  // Tasks within 20% of their interval (approaching but not yet critical)
  const approaching = useMemo(() => {
    return plan.filter(item => {
      if (!item.intervalHours || !item.hoursRemaining) return false;
      const pct = item.hoursRemaining / item.intervalHours;
      return pct > 0 && pct <= 0.20 && item.status !== 'OVERDUE';
    }).slice(0, 3);
  }, [plan]);

  if (approaching.length === 0) return null;

  return (
    <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center shrink-0 mt-0.5">
        <Zap size={16} className="text-brand-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-brand-800">
          Asesoría inteligente de parada en taller
        </p>
        <p className="text-xs text-brand-600 mt-0.5">
          Aprovechando la próxima entrada a taller, faltan pocas horas para{' '}
          {approaching.length === 1
            ? `la tarea ${approaching[0].taskCode}`
            : `${approaching.length} tareas`}
          . ¿Deseas incluirlas en la siguiente ST?
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {approaching.map(t => (
            <span key={t.taskId} className="text-[10px] font-mono bg-white text-brand-700 border border-brand-200 px-2 py-0.5 rounded-full">
              {t.taskCode} · {t.hoursRemaining?.toFixed(0)}h restantes
            </span>
          ))}
        </div>
      </div>
      <button
        onClick={onCreateST}
        className="btn-primary text-xs shrink-0 flex items-center gap-1"
      >
        <ClipboardList size={12} />
        Incluir en ST
      </button>
    </div>
  );
}

function AircraftUsageHistoryPanel({
  aircraftId,
  registration,
  model,
  currentHours,
  currentCycles,
  onClose,
}: {
  aircraftId: string;
  registration: string;
  model: string;
  currentHours: number;
  currentCycles: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [form, setForm] = useState<{
    date: string;
    totalHours: string;
    totalCycles: string;
    source: AircraftUsageSource;
    notes: string;
  }>({
    date: new Date().toISOString().slice(0, 10),
    totalHours: currentHours.toFixed(1),
    totalCycles: String(currentCycles),
    source: 'manual',
    notes: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['aircraft-usage-history', aircraftId],
    queryFn: () => aircraftApi.getUsageHistory(aircraftId),
    staleTime: 30_000,
  });

  const latest = data?.history[0] ?? null;

  const createUsageMutation = useMutation({
    mutationFn: async () => {
      const totalHours = Number(form.totalHours);
      const totalCycles = Number(form.totalCycles);

      if (!form.date) {
        throw new Error('La fecha es obligatoria');
      }
      if (!Number.isFinite(totalHours) || totalHours < 0) {
        throw new Error('Las horas totales deben ser validas');
      }
      if (!Number.isInteger(totalCycles) || totalCycles < 0) {
        throw new Error('Los ciclos totales deben ser un entero valido');
      }

      if (latest) {
        const latestDate = new Date(latest.date).getTime();
        const newDate = new Date(form.date).getTime();

        if (newDate < latestDate) {
          throw new Error('La fecha no puede ser menor al ultimo registro');
        }
        if (totalHours < Number(latest.totalHours)) {
          throw new Error('Las horas no pueden ser menores al ultimo valor registrado');
        }
        if (totalCycles < Number(latest.totalCycles)) {
          throw new Error('Los ciclos no pueden ser menores al ultimo valor registrado');
        }
      }

      return aircraftApi.createUsageLog(aircraftId, {
        date: form.date,
        totalHours,
        totalCycles,
        source: form.source,
        notes: form.notes.trim() || null,
      });
    },
    onSuccess: async () => {
      setFormError(null);
      setShowForm(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['aircraft', aircraftId] }),
        qc.invalidateQueries({ queryKey: ['aircraft-usage-history', aircraftId] }),
      ]);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (err as { message?: string })?.message
        ?? 'No se pudo registrar las horas';
      setFormError(message);
    },
  });

  const usageData: AircraftUsageHistory['aircraft'] = data?.aircraft ?? {
    totalHours: currentHours,
    totalCycles: currentCycles,
    lastUpdatedAt: new Date().toISOString(),
  };

  const { data: counterReadings = [] } = useQuery({
    queryKey: ['aircraft-counter-readings', aircraftId],
    queryFn: () => aircraftApi.listCounterReadings(aircraftId),
    staleTime: 30_000,
  });

  const counterHistory = useMemo(() => buildCounterHistory(counterReadings), [counterReadings]);

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const blob = await aircraftApi.downloadCounterHistoryReportPdf(aircraftId);
      saveAs(blob, `Registro_Contadores_${registration}.pdf`);
    } catch {
      toast.error('No se pudo generar el informe');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-end">
      <div className="h-full w-full max-w-4xl bg-white shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Historial de uso de aeronave</h2>
            <p className="text-xs text-slate-500">Evolucion de horas y ciclos en el tiempo</p>
          </div>
          <button onClick={onClose} className="btn-secondary text-xs">Cerrar</button>
        </div>

        <div className="px-6 py-4 border-b border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Horas actuales</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums">{Number(usageData.totalHours).toFixed(1)} h</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Ciclos actuales</p>
            <p className="text-xl font-bold text-slate-900 tabular-nums">{Number(usageData.totalCycles)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Ultima actualizacion</p>
            <p className="text-sm font-semibold text-slate-900">
              {usageData.lastUpdatedAt
                ? new Date(usageData.lastUpdatedAt).toLocaleString('es-MX', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })
                : 'Sin registros'}
            </p>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">Historial de registros</p>
          <button
            className="btn-primary text-xs gap-1"
            onClick={() => {
              setFormError(null);
              setShowForm((prev) => !prev);
            }}
          >
            <Plus size={12} /> + Registrar horas
          </button>
        </div>

        {showForm && (
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="form-label">Fecha</label>
                <input
                  type="date"
                  className="input w-full"
                  value={form.date}
                  onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Horas totales</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className="input w-full"
                  value={form.totalHours}
                  onChange={(e) => setForm((prev) => ({ ...prev, totalHours: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Ciclos totales</label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  className="input w-full"
                  value={form.totalCycles}
                  onChange={(e) => setForm((prev) => ({ ...prev, totalCycles: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Fuente</label>
                <select
                  className="input w-full"
                  value={form.source}
                  onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value as AircraftUsageSource }))}
                >
                  <option value="manual">Manual</option>
                  <option value="flight_log">Bitacora de vuelo</option>
                  <option value="ot_close">Cierre OT</option>
                  <option value="import">Importacion</option>
                  <option value="baseline">Linea base</option>
                </select>
              </div>
              <div>
                <label className="form-label">Observacion</label>
                <input
                  className="input w-full"
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
            </div>
            {formError && <p className="text-xs text-rose-600 mt-2">{formError}</p>}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button className="btn-secondary text-xs" onClick={() => setShowForm(false)}>Cancelar</button>
              <button
                className="btn-primary text-xs"
                onClick={() => createUsageMutation.mutate()}
                disabled={createUsageMutation.isPending}
              >
                {createUsageMutation.isPending ? 'Guardando...' : 'Guardar registro'}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="text-sm text-slate-400 flex items-center gap-2">
              <Activity size={13} className="animate-pulse" /> Cargando historial...
            </div>
          ) : (data?.history?.length ?? 0) === 0 ? (
            <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl p-6 text-center">
              Aun no hay registros de uso para esta aeronave.
            </div>
          ) : (
            <div className="overflow-auto max-h-[60vh] rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="table-header">Fecha</th>
                    <th className="table-header text-right">Horas</th>
                    <th className="table-header text-right">Ciclos</th>
                    <th className="table-header">Fuente</th>
                    <th className="table-header">Observacion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data?.history.map((row) => (
                    <tr key={row.id}>
                      <td className="table-cell text-xs text-slate-700">
                        {new Date(row.date).toLocaleDateString('es-MX')}
                      </td>
                      <td className="table-cell text-xs text-slate-700 text-right tabular-nums">{Number(row.totalHours).toFixed(1)}</td>
                      <td className="table-cell text-xs text-slate-700 text-right tabular-nums">{Number(row.totalCycles)}</td>
                      <td className="table-cell text-xs text-slate-700">{USAGE_SOURCE_LABEL[row.source]}</td>
                      <td className="table-cell text-xs text-slate-500">{row.notes ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ConsolidatedCounterHistorySection
          counterHistory={counterHistory}
          isExportingPdf={isExportingPdf}
          onExportPdf={handleExportPdf}
        />
      </div>
    </div>
  );
}

// ─── Registro consolidado de contadores (aeronave y motor) ─────────────────────
function fmtCounter(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}

function ConsolidatedCounterHistorySection({
  counterHistory,
  isExportingPdf,
  onExportPdf,
}: {
  counterHistory: ReturnType<typeof buildCounterHistory>;
  isExportingPdf: boolean;
  onExportPdf: () => void;
}) {
  const { rows, summary, hasCargoData, hasTorqueData } = counterHistory;
  const hasData = rows.length > 0;

  const summaryLines: Array<[string, number | null]> = [
    ['Horas Aeronave', summary.aircraftHours],
    ['Horas Motor', summary.motorHours],
    ['N g', summary.ng],
    ['N f', summary.nf],
    ['Landings', summary.landings],
    ['Cargas', summary.cargo],
    ['Ciclos Aeronave', summary.aircraftCycles],
  ];

  return (
    <div className="border-t border-slate-200 px-6 py-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Registro de horas / ciclos / aterrizajes — aeronave y motor</p>
          <p className="text-xs text-slate-500">Mismo formato que la bitácora física: fecha, folio y efectivo/acumulado por contador</p>
        </div>
        <button
          className="btn-secondary text-xs gap-1"
          onClick={onExportPdf}
          disabled={!hasData || isExportingPdf}
        >
          {isExportingPdf ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
          Generar informe
        </button>
      </div>

      {!hasData ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-xl p-6 text-center">
          Aun no hay lecturas de contadores (Horas Aeronave, Aterrizajes, Horas Motor, NG, NF) para esta aeronave.
          Se cargan desde "Contadores" en la ficha de la aeronave.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mb-3 max-w-2xl">
            {summaryLines.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded border border-blue-100 bg-blue-50 px-2.5 py-1.5">
                <span className="text-[11px] font-semibold text-blue-800">{label} :</span>
                <span className="text-xs font-bold text-blue-950 tabular-nums">{fmtCounter(value)}</span>
              </div>
            ))}
          </div>

          {(!hasCargoData || !hasTorqueData) && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3">
              {!hasCargoData && !hasTorqueData
                ? 'Aún no hay lecturas de Carga Externa ni Ciclos de Torque — esas columnas se completan cuando empieces a registrarlas en "Contadores".'
                : !hasCargoData
                  ? 'Aún no hay lecturas de Carga Externa — esa columna se completa cuando empieces a registrarla en "Contadores".'
                  : 'Aún no hay lecturas de Ciclos de Torque — esa columna se completa cuando empieces a registrarla en "Contadores".'}
            </p>
          )}

          <div className="overflow-auto max-h-[50vh] rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-blue-700 text-white">
                  <th rowSpan={2} className="table-header !text-white px-2 py-1.5 align-bottom">Fecha</th>
                  <th rowSpan={2} className="table-header !text-white px-2 py-1.5 align-bottom border-l border-blue-500">Folio Nº</th>
                  <th colSpan={3} className="table-header !text-white px-2 py-1.5 text-center border-l border-blue-500">Hora Funcionamiento</th>
                  <th colSpan={2} className="table-header !text-white px-2 py-1.5 text-center border-l border-blue-500">Ciclos NG</th>
                  <th colSpan={2} className="table-header !text-white px-2 py-1.5 text-center border-l border-blue-500">Ciclos NF</th>
                  <th colSpan={2} className="table-header !text-white px-2 py-1.5 text-center border-l border-blue-500">Aterrizajes</th>
                  <th colSpan={2} className="table-header !text-white px-2 py-1.5 text-center border-l border-blue-500">Carga Externa</th>
                  <th colSpan={2} className="table-header !text-white px-2 py-1.5 text-center border-l border-blue-500">Ciclos de Torque</th>
                  <th rowSpan={2} className="table-header !text-white px-2 py-1.5 align-bottom border-l border-blue-500">Control Mantto. / Firma Responsable</th>
                </tr>
                <tr className="bg-blue-50">
                  <th className="table-header px-2 py-1 text-right border-l border-blue-200">Efect.</th>
                  <th className="table-header px-2 py-1 text-right">Aeronave</th>
                  <th className="table-header px-2 py-1 text-right">Motor</th>
                  <th className="table-header px-2 py-1 text-right border-l border-blue-200">Efect.</th>
                  <th className="table-header px-2 py-1 text-right">Acumul.</th>
                  <th className="table-header px-2 py-1 text-right border-l border-blue-200">Efect.</th>
                  <th className="table-header px-2 py-1 text-right">Acumul.</th>
                  <th className="table-header px-2 py-1 text-right border-l border-blue-200">Efect.</th>
                  <th className="table-header px-2 py-1 text-right">Acumul.</th>
                  <th className="table-header px-2 py-1 text-right border-l border-blue-200">Hoy</th>
                  <th className="table-header px-2 py-1 text-right">Acumul.</th>
                  <th className="table-header px-2 py-1 text-right border-l border-blue-200">Hoy</th>
                  <th className="table-header px-2 py-1 text-right">Acumul.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row) => (
                  <tr key={row.date}>
                    <td className="table-cell text-slate-700">{formatDateOnly(row.date)}</td>
                    <td className="table-cell text-slate-700 border-l border-slate-100">{row.folio ?? '—'}</td>
                    <td className="table-cell text-right tabular-nums text-slate-600 border-l border-slate-100">{fmtCounter(row.hourEffective)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.aircraftHoursAccum)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.motorHoursAccum)}</td>
                    <td className="table-cell text-right tabular-nums text-slate-600 border-l border-slate-100">{fmtCounter(row.ngEffective)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.ngAccum)}</td>
                    <td className="table-cell text-right tabular-nums text-slate-600 border-l border-slate-100">{fmtCounter(row.nfEffective)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.nfAccum)}</td>
                    <td className="table-cell text-right tabular-nums text-slate-600 border-l border-slate-100">{fmtCounter(row.landingsEffective)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.landingsAccum)}</td>
                    <td className="table-cell text-right tabular-nums text-slate-600 border-l border-slate-100">{fmtCounter(row.cargoToday)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.cargoAccum)}</td>
                    <td className="table-cell text-right tabular-nums text-slate-600 border-l border-slate-100">{fmtCounter(row.torqueToday)}</td>
                    <td className="table-cell text-right tabular-nums font-semibold text-slate-800">{fmtCounter(row.torqueAccum)}</td>
                    <td className="table-cell border-l border-slate-100">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Edit assigned plans modal ─────────────────────────────────────────────────
function EditAssignedPlansModal({
  category,
  templates,
  currentTemplateIds,
  isSaving,
  onSave,
  onClose,
}: {
  category: AssignedPlanCategory;
  templates: MaintenanceTemplate[];
  currentTemplateIds: string[];
  isSaving: boolean;
  onSave: (templateIds: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(currentTemplateIds);

  const toggle = (template: MaintenanceTemplate) => {
    const isSelected = selected.includes(template.id);
    if (!isSelected) {
      const nativeCategory = templateNativeCategory(template);
      if (nativeCategory !== category) {
        const proceed = window.confirm(
          `Esta normativa pertenece a "${ASSIGNED_PLAN_CATEGORY_LABELS[nativeCategory]}". ¿Quieres agregarla igual a "${ASSIGNED_PLAN_CATEGORY_LABELS[category]}"?`,
        );
        if (!proceed) return;
      }
    }
    setSelected((prev) => (prev.includes(template.id) ? prev.filter((id) => id !== template.id) : [...prev, template.id]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">{ASSIGNED_PLAN_CATEGORY_LABELS[category]}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-xs text-slate-400">Se muestran todas las bibliotecas — puedes marcar más de una para esta categoría.</p>
          {templates.length === 0 ? (
            <p className="text-sm text-slate-400">Sin plantillas disponibles</p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {templates.map((template) => {
                const nativeCategory = templateNativeCategory(template);
                const isForeign = nativeCategory !== category;
                return (
                  <label
                    key={template.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(template.id)}
                      onChange={() => toggle(template)}
                      className="rounded border-slate-300"
                    />
                    <span className="flex-1">{template.manufacturer} {template.model} - {template.description ?? template.version}</span>
                    {isForeign && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        {ASSIGNED_PLAN_CATEGORY_LABELS[nativeCategory]}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave(selected)}
            className="btn-primary flex items-center gap-1.5"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AircraftProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showStatusReport, setShowStatusReport] = useState(false);
  const [showUsageHistoryPanel, setShowUsageHistoryPanel] = useState(false);
  const [editingPlanCategory, setEditingPlanCategory] = useState<AssignedPlanCategory | null>(null);
  const workRequests = useWorkRequestStore((s) => s.workRequests);
  const userRole = useAuthStore((s) => s.user?.role);
  const viewDensity = useWorkRequestStore((s) => s.viewDensity);
  const setViewDensity = useWorkRequestStore((s) => s.setViewDensity);
  const selectWorkRequest = useWorkRequestStore((s) => s.selectWorkRequest);

  const { data: aircraft, isLoading: loadingAircraft } = useQuery({
    queryKey: ['aircraft', id],
    queryFn: () => aircraftApi.findById(id!),
    enabled: !!id,
  });

  const { data: plan = [], isLoading: loadingPlan } = useQuery({
    queryKey: ['maintenance-plan', id],
    queryFn: () => maintenancePlanApi.getForAircraft(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: assignedPlansData } = useQuery({
    queryKey: ['aircraft-assigned-plans', id],
    queryFn: () => libraryApi.getAircraftAssignedPlans(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: libraryTemplates = [] } = useQuery({
    queryKey: ['library-templates-for-aircraft-assign'],
    queryFn: libraryApi.findAll,
    staleTime: 5 * 60 * 1000,
  });
  const activeLibraryTemplates = useMemo(
    () => libraryTemplates.filter((t) => t.isActive),
    [libraryTemplates],
  );

  const assignPlansMutation = useMutation({
    mutationFn: (input: { category: AssignedPlanCategory; templateIds: string[] }) =>
      libraryApi.assignBundleToAircraft(id!, [input]),
    onSuccess: () => {
      toast.success('Planes de mantenimiento actualizados');
      qc.invalidateQueries({ queryKey: ['aircraft-assigned-plans', id] });
      setEditingPlanCategory(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al actualizar los planes';
      toast.error(msg);
    },
  });

  const { data: aircraftEngines = [] } = useQuery({
    queryKey: ['aircraft-engines', id],
    queryFn: () => aircraftApi.listEngines(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const { data: workRequestStateMachine, isLoading: loadingWorkRequestStateMachine } = useWorkRequestStateMachine();
  const stMachine = workRequestStateMachine
    ? ensureStateMachine(workRequestStateMachine, 'AircraftProfilePage')
    : null;

  // ── Computed values ───────────────────────────────────────────────────────
  const nearestHoursTask = useMemo(() =>
    [...plan]
      .filter(i => i.hoursRemaining != null && i.intervalHours != null && i.intervalHours > 0)
      .sort((a, b) => (a.hoursRemaining ?? Infinity) - (b.hoursRemaining ?? Infinity))[0] ?? null,
  [plan]);

  const nearestCalTask = useMemo(() =>
    [...plan]
      .filter(i => i.daysRemaining != null && i.intervalCalendarDays != null && i.intervalCalendarDays > 0)
      .sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity))[0] ?? null,
  [plan]);

  const tsnPct = useMemo(() => {
    if (!nearestHoursTask?.intervalHours || nearestHoursTask.hoursRemaining == null) return 0;
    const consumed = nearestHoursTask.intervalHours - nearestHoursTask.hoursRemaining;
    return Math.max(0, Math.min(100, (consumed / nearestHoursTask.intervalHours) * 100));
  }, [nearestHoursTask]);

  const cyclesPct = useMemo(() => {
    if (!nearestCalTask?.intervalCalendarDays || nearestCalTask.daysRemaining == null) return 0;
    const consumed = nearestCalTask.intervalCalendarDays - nearestCalTask.daysRemaining;
    return Math.max(0, Math.min(100, (consumed / nearestCalTask.intervalCalendarDays) * 100));
  }, [nearestCalTask]);

  const tsnTier: AlertTier = nearestHoursTask ? getAlertTier(nearestHoursTask) : 'ok';
  const cyclesTier: AlertTier = nearestCalTask ? getAlertTier(nearestCalTask) : 'ok';
  const aircraftId = aircraft?.id ?? '';
  const aircraftHours = Number(aircraft?.totalFlightHours ?? 0);
  const aircraftCycles = Number(aircraft?.totalCycles ?? 0);

  const coaExpiryDate    = aircraft?.coaExpiryDate ? new Date(aircraft.coaExpiryDate) : null;
  const coaDaysLeft      = coaExpiryDate
    ? Math.ceil((coaExpiryDate.getTime() - Date.now()) / MS_PER_DAY)
    : null;
  const coaTier: AlertTier    = coaDaysLeft == null ? 'ok'
    : coaDaysLeft < 0  ? 'overdue'
    : coaDaysLeft < 15 ? 'critical'
    : coaDaysLeft < 30 ? 'warning'
    : 'ok';

  const overdueCnt = plan.filter(p => p.status === 'OVERDUE').length;
  const dueSoonCnt = plan.filter(p => p.status === 'DUE_SOON').length;

  const assignedPlansByCategory = useMemo(() => {
    const map = new Map<AssignedPlanCategory, AircraftAssignedPlan[]>();
    for (const assignment of assignedPlansData?.assignments ?? []) {
      const list = map.get(assignment.category) ?? [];
      list.push(assignment);
      map.set(assignment.category, list);
    }
    return map;
  }, [assignedPlansData]);

  const enginesByPosition = useMemo(() => {
    const map = new Map<AircraftEngine['position'], AircraftEngine>();
    for (const engine of aircraftEngines) {
      map.set(engine.position, engine);
    }
    return map;
  }, [aircraftEngines]);

  const overdueWithoutST = useMemo(() => (
    !stMachine
      ? 0
      : plan
          .filter((task) => task.status === 'OVERDUE')
          .filter((task) => !resolveTaskSTInfo(task, workRequests, aircraftId, stMachine).hasST)
          .length
  ), [plan, workRequests, aircraftId, stMachine]);

  const openAnyOverdueST = useMemo(() => (
    !stMachine
      ? null
      : plan
          .filter((task) => task.status === 'OVERDUE')
          .map((task) => resolveTaskSTInfo(task, workRequests, aircraftId, stMachine))
          .find((info) => info.isOpen) ?? null
  ), [plan, workRequests, aircraftId, stMachine]);

  const openSTFromProfile = (workRequestId: string | null, taskCode: string) => {
    if (workRequestId) {
      selectWorkRequest(workRequestId, 'general');
      navigate(`/work-requests?aircraftId=${aircraftId}&stId=${workRequestId}`);
      return;
    }
    navigate(`/work-requests?aircraftId=${aircraftId}&search=${encodeURIComponent(taskCode)}`);
  };

  const openWorkRequestsList = (taskCode?: string) => {
    const suffix = taskCode ? `&search=${encodeURIComponent(taskCode)}` : '';
    navigate(`/work-requests?aircraftId=${aircraftId}${suffix}`);
  };

  const createSTForTask = async (task: MaintenancePlanItem) => {
    if (!stMachine) {
      throw new Error('[workflow] ST state machine contract is not loaded in AircraftProfilePage.createSTForTask');
    }
    const taskInfo = resolveTaskSTInfo(task, workRequests, aircraftId, stMachine);
    if (taskInfo.isOpen && taskInfo.workRequestId) {
      openSTFromProfile(taskInfo.workRequestId, task.taskCode);
      return;
    }

    const stId = await createSTFromSource('maintenance_plan', {
      aircraftId,
      sourceId: task.taskId,
      ataCode: task.taskCode,
      title: task.taskTitle,
      description: task.taskTitle,
      aircraftHoursAtRequest: aircraftHours,
      aircraftCyclesAtRequest: aircraftCycles,
      priority: task.status === 'OVERDUE' ? 'alta' : 'media',
    });

    selectWorkRequest(stId, 'general');
    navigate(`/work-requests?aircraftId=${aircraftId}&stId=${stId}`);
  };

  const generateSTFromProfile = async () => {
    if (!stMachine) {
      throw new Error('[workflow] ST state machine contract is not loaded in AircraftProfilePage.generateSTFromProfile');
    }
    const candidate = plan.find((task) => {
      const info = resolveTaskSTInfo(task, workRequests, aircraftId, stMachine);
      return task.status === 'OVERDUE' && !info.hasST;
    }) ?? plan.find((task) => {
      const info = resolveTaskSTInfo(task, workRequests, aircraftId, stMachine);
      return !info.hasST;
    });

    if (!candidate) {
      openWorkRequestsList();
      return;
    }

    await createSTForTask(candidate);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingAircraft) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-400 text-sm">
        <Activity size={16} className="animate-pulse" /> Cargando ficha de aeronave…
      </div>
    );
  }

  if (loadingWorkRequestStateMachine || !stMachine) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-400 text-sm">
        <Activity size={16} className="animate-pulse" /> Cargando contrato de estado ST...
      </div>
    );
  }

  if (!aircraft) {
    return (
      <div className="p-8 text-slate-500 text-sm">
        Aeronave no encontrada.{' '}
        <button className="text-brand-600 underline" onClick={() => navigate('/aircraft')}>
          Volver
        </button>
      </div>
    );
  }

  // Sacar o devolver una aeronave al servicio no es una edición cualquiera.
  const canChangeStatus = userRole === 'ADMIN' || userRole === 'SUPERVISOR' || userRole === 'INSPECTOR';

  const statusCls = STATUS_CLASSES[aircraft.status] ?? 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* ── Breadcrumb & actions ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft size={15} />
          Volver
        </button>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewDensity('comfortable')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                viewDensity === 'comfortable'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Comoda
            </button>
            <button
              type="button"
              onClick={() => setViewDensity('compact')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                viewDensity === 'compact'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Compacta
            </button>
          </div>
          <button
            onClick={() => setShowStatusReport(true)}
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <FileText size={13} />
            Reporte DGAC
          </button>
          <button
            onClick={() => navigate(`/work-requests?aircraftId=${aircraft.id}`)}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <ClipboardList size={13} />
            Nueva Solicitud de Trabajo
          </button>
        </div>
      </div>

      {/* ── Aircraft identity header ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center shrink-0">
            <Plane size={26} className="text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-extrabold font-mono text-slate-900 tracking-tight">
                {aircraft.registration}
              </h1>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusCls}`}>
                {STATUS_LABEL[aircraft.status] ?? aircraft.status}
              </span>
              {overdueCnt > 0 && (
                <span className="text-[11px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full animate-pulse">
                  {overdueCnt} tarea{overdueCnt > 1 ? 's' : ''} vencida{overdueCnt > 1 ? 's' : ''}
                </span>
              )}
              {dueSoonCnt > 0 && (
                <span className="text-[11px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  {dueSoonCnt} próximas
                </span>
              )}
            </div>
            <div className="mt-1.5">
              <AircraftStatusControl
                aircraftId={aircraft.id}
                currentStatus={aircraft.status}
                canEdit={canChangeStatus}
              />
            </div>
            <p className="text-slate-500 mt-1 text-sm">
              {aircraft.manufacturer} · {aircraft.model} · S/N: {aircraft.serialNumber}
            </p>
            {aircraft.engineModel && (
              <p className="text-xs text-slate-400 mt-0.5">
                Motor: {aircraft.engineModel} · {aircraft.engineCount} motor{aircraft.engineCount !== 1 ? 'es' : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Counter cards ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
            <FileText size={14} className="text-brand-600" />
          </div>
          <p className="text-sm font-bold text-slate-900">Planes activos de mantenimiento</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(['manufacturer', 'national_dgac', 'engine_components', 'origin_country'] as AssignedPlanCategory[]).map((category) => {
            const assigned = assignedPlansByCategory.get(category) ?? [];
            return (
              <div key={category} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{ASSIGNED_PLAN_CATEGORY_LABELS[category]}</p>
                  <button
                    type="button"
                    onClick={() => setEditingPlanCategory(category)}
                    className="text-slate-400 hover:text-brand-600 transition-colors shrink-0"
                    title="Editar planes de esta categoría"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
                {assigned.length === 0 ? (
                  <p className="text-sm font-semibold text-slate-900 mt-1">{MISSING_OPERATIONAL_CONTEXT_LABEL}</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {assigned.map((plan) => (
                      <span
                        key={plan.templateId}
                        className="text-xs font-medium bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded-lg"
                      >
                        {plan.templateLabel}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editingPlanCategory && (() => {
        const currentTemplateIds = (assignedPlansByCategory.get(editingPlanCategory) ?? []).map((p) => p.templateId);
        return (
        <EditAssignedPlansModal
          category={editingPlanCategory}
          templates={activeLibraryTemplates}
          currentTemplateIds={currentTemplateIds}
          isSaving={assignPlansMutation.isPending}
          onSave={(templateIds) => assignPlansMutation.mutate({ category: editingPlanCategory, templateIds })}
          onClose={() => setEditingPlanCategory(null)}
        />
        );
      })()}

      <AircraftDetailsCard aircraft={aircraft} canEdit={canChangeStatus} />

      <AircraftCountersPanel
        aircraftId={aircraft.id}
        engines={aircraftEngines}
        canEdit={canChangeStatus}
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
            <Gauge size={14} className="text-slate-600" />
          </div>
          <p className="text-sm font-bold text-slate-900">Motores</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(['N1', 'N2'] as const).map((position) => {
            const engine = enginesByPosition.get(position);
            return (
              <div key={position} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Motor {position}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {engine ? `${engine.manufacturer} ${engine.model}` : MISSING_OPERATIONAL_CONTEXT_LABEL}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  S/N: {engine?.serialNumber ?? MISSING_OPERATIONAL_CONTEXT_LABEL}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Horas</p>
                    <p className="font-semibold text-slate-900 tabular-nums">
                      {engine?.latestUsage ? `${Number(engine.latestUsage.hours).toFixed(1)} h` : MISSING_OPERATIONAL_CONTEXT_LABEL}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Ciclos</p>
                    <p className="font-semibold text-slate-900 tabular-nums">
                      {engine?.latestUsage ? Number(engine.latestUsage.cycles) : MISSING_OPERATIONAL_CONTEXT_LABEL}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
          Contadores Actualizados
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* TSN ring */}
          <button
            type="button"
            onClick={() => setShowUsageHistoryPanel(true)}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center gap-2 hover:border-brand-300 hover:shadow-md transition text-left"
            title="Ver historial de uso de aeronave"
          >
            <ProgressRing
              pct={tsnPct}
              value={Number(aircraft.totalFlightHours).toLocaleString('es-MX', { maximumFractionDigits: 1 })}
              unit="h TSN"
              label="Horas Totales"
              tier={tsnTier}
              sublabel={nearestHoursTask ? `Próx. ATA ${nearestHoursTask.taskCode}` : MISSING_OPERATIONAL_CONTEXT_LABEL}
            />
          </button>

          {/* Cycles ring */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center gap-2">
            <ProgressRing
              pct={cyclesPct}
              value={Number(aircraft.totalCycles).toLocaleString('es-MX')}
              unit="Ciclos"
              label="Ciclos N1"
              tier={cyclesTier}
              sublabel={nearestCalTask ? `Próx. ${nearestCalTask.taskCode}` : MISSING_OPERATIONAL_CONTEXT_LABEL}
            />
          </div>

          {/* Nearest task */}
          <StatCard
            Icon={Clock}
            label="Próxima Tarea"
            value={
              nearestHoursTask
                ? nearestHoursTask.hoursRemaining! < 0
                  ? 'VENCIDA'
                  : `${nearestHoursTask.hoursRemaining!.toFixed(0)} h`
                : MISSING_OPERATIONAL_CONTEXT_LABEL
            }
            sub={nearestHoursTask?.taskTitle ?? MISSING_OPERATIONAL_CONTEXT_LABEL}
            colorClass={
              tsnTier === 'overdue' || tsnTier === 'critical'
                ? 'bg-rose-50 text-rose-500'
                : tsnTier === 'warning'
                  ? 'bg-amber-50 text-amber-500'
                  : 'bg-emerald-50 text-emerald-500'
            }
          />

          {/* CdN expiry */}
          <StatCard
            Icon={Calendar}
            label="Vto. CdN"
            value={
              coaDaysLeft != null
                ? coaDaysLeft < 0
                  ? 'VENCIDO'
                  : `${coaDaysLeft}d`
                : MISSING_OPERATIONAL_CONTEXT_LABEL
            }
            sub={
              coaExpiryDate
                ? coaExpiryDate.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
                : MISSING_OPERATIONAL_CONTEXT_LABEL
            }
            colorClass={
              coaTier === 'overdue' || coaTier === 'critical'
                ? 'bg-rose-50 text-rose-500'
                : coaTier === 'warning'
                  ? 'bg-amber-50 text-amber-500'
                  : 'bg-emerald-50 text-emerald-500'
            }
          />
        </div>
      </div>

      {/* ── Smart ST suggestion ── */}
      <SmartSuggestionBanner
        plan={plan}
        onCreateST={() => generateSTFromProfile()}
      />

      {/* ── Semáforo de próximos vencimientos ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <Gauge size={14} className="text-amber-600" />
          </div>
          <p className="text-sm font-bold text-slate-900">Semáforo de Próximos Vencimientos</p>
          <span className="text-[10px] text-slate-400">
            · top 10 por urgencia (dual: horas y calendario)
          </span>
          {loadingPlan && (
            <Activity size={12} className="text-slate-300 animate-pulse ml-1" />
          )}
        </div>
        <SemaphoreTable
          plan={plan}
          aircraftId={aircraft.id}
          workRequests={workRequests}
          workRequestStateMachine={stMachine}
          viewDensity={viewDensity}
          onOpenST={openSTFromProfile}
          onGenerateST={generateSTFromProfile}
        />
      </div>

      {/* ── Historial reciente ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
            <RotateCcw size={14} className="text-slate-500" />
          </div>
          <p className="text-sm font-bold text-slate-900">Historial Reciente de Bitácora</p>
          <span className="text-[10px] text-slate-400">· últimas 5 acciones con respaldos fotográficos</span>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <AuditTimeline aircraftId={aircraft.id} />
          <div className="mt-4 pt-3 border-t border-slate-100">
            <button
              onClick={() => openWorkRequestsList()}
              className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
            >
              <ExternalLink size={12} />
              Ver todas las Solicitudes de Trabajo de esta aeronave
            </button>
          </div>
        </div>
      </div>

      {/* ── Footer quick action (AOG pulse) ── */}
      {(overdueCnt > 0 || aircraft.status === 'AOG') && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <span className="absolute inset-0 rounded-xl border border-rose-300 animate-ping opacity-50" />
              <AlertTriangle size={18} className="text-rose-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-rose-800">Aeronave requiere atención inmediata</p>
              <p className="text-xs text-rose-600 mt-0.5">
                {overdueWithoutST > 0
                  ? `${overdueWithoutST} tarea${overdueWithoutST > 1 ? 's' : ''} vencida${overdueWithoutST > 1 ? 's' : ''} sin solicitud enviada`
                  : `Estado ${STATUS_LABEL[aircraft.status]} — iniciar proceso de regularización`}
              </p>
              {openAnyOverdueST?.isOpen && (
                <p className="text-[11px] text-amber-700 mt-1">Aviso: ya existe una ST abierta para al menos una tarea vencida.</p>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              if (overdueWithoutST > 0) generateSTFromProfile();
              else if (openAnyOverdueST) openSTFromProfile(openAnyOverdueST.workRequestId, '');
            }}
            className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl
                       flex items-center gap-2 transition-colors shadow-sm animate-pulse"
          >
            <ClipboardList size={14} />
            {overdueWithoutST > 0 ? 'Agregar a ST' : 'Ver ST'}
          </button>
        </div>
      )}

      {/* ── DGAC Report modal ── */}
      {showStatusReport && (
        <AircraftStatusReport
          aircraftId={aircraft.id}
          registration={aircraft.registration}
          model={aircraft.model}
          currentHours={Number(aircraft.totalFlightHours)}
          onClose={() => setShowStatusReport(false)}
        />
      )}

      {showUsageHistoryPanel && (
        <AircraftUsageHistoryPanel
          aircraftId={aircraft.id}
          registration={aircraft.registration}
          model={aircraft.model}
          currentHours={Number(aircraft.totalFlightHours)}
          currentCycles={Number(aircraft.totalCycles)}
          onClose={() => setShowUsageHistoryPanel(false)}
        />
      )}
    </div>
  );
}
