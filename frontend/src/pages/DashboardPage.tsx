import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { aircraftApi, Aircraft, AircraftStatus } from '@api/aircraft.api';
import { complianceApi } from '@api/compliance.api';
import { workOrdersApi } from '@api/workOrders.api';
import { maintenancePlanApi } from '@api/maintenancePlan.api';
import type { MaintenancePlanItem } from '@api/maintenancePlan.api';
import {
  Plane, AlertTriangle, Wrench, ChevronRight, X,
  Clock, Search, SlidersHorizontal, TrendingUp,
  CheckCircle2, ClipboardList, Activity, BarChart2,
  LayoutGrid, List, User, Gauge,
} from 'lucide-react';

// ─── Semaphore configuration ─────────────────────────────────────────────────
type SemColor = 'green' | 'yellow' | 'red';

const SEM_CONFIG: Record<SemColor, {
  statuses: AircraftStatus[];
  label: string;
  sublabel: string;
  accent: string;     // left border colour
  iconBg: string;
  iconColor: string;
  bar: string;
  countColor: string;
  Icon: typeof Plane;
}> = {
  green: {
    statuses: ['OPERATIONAL'],
    label: 'Operacional',
    sublabel: 'Disponible para vuelo',
    accent:    'border-l-emerald-500',
    iconBg:    'bg-emerald-50',
    iconColor: 'text-emerald-600',
    bar:       'bg-emerald-400',
    countColor:'text-emerald-700',
    Icon: Plane,
  },
  yellow: {
    statuses: ['IN_MAINTENANCE', 'GROUNDED'],
    label: 'En Mantenimiento',
    sublabel: 'Mantenimiento / En tierra',
    accent:    'border-l-amber-400',
    iconBg:    'bg-amber-50',
    iconColor: 'text-amber-600',
    bar:       'bg-amber-400',
    countColor:'text-amber-700',
    Icon: Wrench,
  },
  red: {
    statuses: ['AOG', 'DECOMMISSIONED'],
    label: 'Crítico / AOG',
    sublabel: 'Fuera de servicio',
    accent:    'border-l-rose-500',
    iconBg:    'bg-rose-50',
    iconColor: 'text-rose-600',
    bar:       'bg-rose-400',
    countColor:'text-rose-700',
    Icon: AlertTriangle,
  },
};

const STATUS_BADGE: Record<AircraftStatus, string> = {
  OPERATIONAL:    'badge-operational',
  AOG:            'badge-aog',
  IN_MAINTENANCE: 'badge-maintenance',
  GROUNDED:       'badge-grounded',
  DECOMMISSIONED: 'badge-decommissioned',
};

const STATUS_LABEL: Record<AircraftStatus, string> = {
  OPERATIONAL:    'Operacional',
  AOG:            'AOG',
  IN_MAINTENANCE: 'En Mantenimiento',
  GROUNDED:       'En Tierra',
  DECOMMISSIONED: 'Retirada',
};

// ─── Predictive alert helpers ───────────────────────────────────────────────────────────────────
const FLEET_DAILY_HOURS    = 2.5;
const FLEET_ALERT_HOURS    = 15;   // < 15h → orange
const FLEET_CRITICAL_HOURS = 5;    // < 5h  → red + blink
const FLEET_ALERT_DAYS     = 15;   // < 15d → orange
const FLEET_CRITICAL_DAYS  = 5;    // < 5d  → red + blink

type FleetAlertTier = 'overdue' | 'critical' | 'warning' | 'ok';

function computeFleetAlertTier(plan: MaintenancePlanItem[]): FleetAlertTier {
  if (plan.some(p => p.status === 'OVERDUE')) return 'overdue';
  const nearest = plan
    .filter(p => p.hoursRemaining != null || p.daysRemaining != null)
    .map(p => ({
      ...p,
      urgencyDays: Math.min(
        p.hoursRemaining != null ? p.hoursRemaining / FLEET_DAILY_HOURS : Infinity,
        p.daysRemaining  != null ? p.daysRemaining                       : Infinity,
      ),
    }))
    .sort((a, b) => a.urgencyDays - b.urgencyDays)[0];
  if (!nearest) return 'ok';
  if (
    (nearest.hoursRemaining != null && nearest.hoursRemaining < FLEET_CRITICAL_HOURS) ||
    (nearest.daysRemaining  != null && nearest.daysRemaining  < FLEET_CRITICAL_DAYS)
  ) return 'critical';
  if (
    (nearest.hoursRemaining != null && nearest.hoursRemaining < FLEET_ALERT_HOURS) ||
    (nearest.daysRemaining  != null && nearest.daysRemaining  < FLEET_ALERT_DAYS)
  ) return 'warning';
  return 'ok';
}

function getFleetNearestTask(plan: MaintenancePlanItem[]) {
  return plan
    .filter(p => p.hoursRemaining != null || p.daysRemaining != null)
    .map(p => ({
      ...p,
      urgencyDays: Math.min(
        p.hoursRemaining != null ? p.hoursRemaining / FLEET_DAILY_HOURS : Infinity,
        p.daysRemaining  != null ? p.daysRemaining                       : Infinity,
      ),
    }))
    .sort((a, b) => a.urgencyDays - b.urgencyDays)[0] ?? null;
}

function calcFleetEstimatedDate(hoursRemaining: number): Date {
  return new Date(Date.now() + (hoursRemaining / FLEET_DAILY_HOURS) * 24 * 60 * 60 * 1000);
}

// ─── Semaphore card ───────────────────────────────────────────────────────────
function SemaphoreCard({ color, count, total }: { color: SemColor; count: number; total: number }) {
  const { label, sublabel, accent, iconBg, iconColor, bar, countColor, Icon } = SEM_CONFIG[color];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-card flex overflow-hidden`}>
      {/* Left accent strip */}
      <div className={`w-[3px] shrink-0 border-l-4 ${accent} rounded-l-xl`} />
      <div className="flex-1 p-5 flex items-start gap-4">
        {/* Icon */}
        <div className={`relative w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
          {color === 'red' && count > 0 && (
            <span className="absolute inset-0 rounded-xl border border-rose-300 opacity-50 animate-ping" />
          )}
          <Icon size={17} className={iconColor} />
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-3xl font-bold tabular-nums leading-none ${countColor}`}>{count}</p>
          <p className="text-[13px] font-semibold text-slate-700 mt-1 leading-snug">{label}</p>
          <p className="text-xs text-slate-400 leading-snug">{sublabel}</p>
          <div className="mt-3 h-[3px] bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{pct}% de la flota</p>
        </div>
      </div>
    </div>
  );
}

// ─── Fleet card ─────────────────────────────────────────────────────────────
const CARD_RADIUS = 36;
const CARD_CIRC   = 2 * Math.PI * CARD_RADIUS;

function FleetCard({
  aircraft, plan, navigate,
}: {
  aircraft: Aircraft;
  plan: MaintenancePlanItem[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const tier     = computeFleetAlertTier(plan);
  const nearest  = getFleetNearestTask(plan);

  // Progress ring: % consumed of nearest hours-based task's interval
  const pct = useMemo(() => {
    const t = plan
      .filter(i => i.hoursRemaining != null && i.intervalHours != null && (i.intervalHours as number) > 0)
      .sort((a, b) => (a.hoursRemaining ?? Infinity) - (b.hoursRemaining ?? Infinity))[0];
    if (!t || !t.intervalHours || t.hoursRemaining == null) return 0;
    const consumed = (t.intervalHours as number) - t.hoursRemaining;
    return Math.max(0, Math.min(100, (consumed / (t.intervalHours as number)) * 100));
  }, [plan]);

  const ringColor = tier === 'overdue' ? '#ef4444'
    : tier === 'critical'  ? '#f87171'
    : tier === 'warning'   ? '#f59e0b'
    : '#10b981';

  const offset   = CARD_CIRC * (1 - pct / 100);
  const coaExp   = aircraft.coaExpiryDate ? new Date(aircraft.coaExpiryDate) : null;
  const coaSoon  = coaExp && (coaExp.getTime() - Date.now()) < 30 * 864e5;

  const borderCls = tier === 'overdue' || tier === 'critical'
    ? 'border-rose-300 shadow-rose-100'
    : tier === 'warning'
      ? 'border-amber-200 shadow-amber-50'
      : 'border-slate-200';

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden ${borderCls}`}
    >
      {/* Top strip */}
      <div className={`h-1 w-full ${
        tier === 'overdue' || tier === 'critical' ? 'bg-rose-500' :
        tier === 'warning'  ? 'bg-amber-400' : 'bg-emerald-400'
      }`} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-extrabold font-mono text-slate-900">{aircraft.registration}</span>
              {(tier === 'overdue' || tier === 'critical') && (
                <AlertTriangle size={14} className="text-rose-500 animate-pulse shrink-0" />
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{aircraft.manufacturer} · {aircraft.model}</p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${
            STATUS_BADGE[aircraft.status] ?? 'badge-grounded'
          }`}>
            {STATUS_LABEL[aircraft.status]}
          </span>
        </div>

        {/* Ring + stats */}
        <div className="flex items-center gap-4">
          {/* SVG Ring */}
          <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
            <svg width={88} height={88} style={{ transform: 'rotate(-90deg)' }}>
              <circle r={CARD_RADIUS} cx={44} cy={44} fill="none" stroke="#e2e8f0" strokeWidth={7} />
              <circle
                r={CARD_RADIUS} cx={44} cy={44}
                fill="none"
                stroke={ringColor}
                strokeWidth={7}
                strokeDasharray={`${CARD_CIRC} ${CARD_CIRC}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-extrabold tabular-nums text-slate-900 leading-none">
                {Number(aircraft.totalFlightHours).toFixed(0)}
              </span>
              <span className="text-[9px] text-slate-400 mt-0.5">h TSN</span>
            </div>
          </div>

          {/* Side stats */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Gauge size={11} className="text-slate-400 shrink-0" />
              <span className="text-[11px] text-slate-500">
                {aircraft.totalCycles.toLocaleString('es-MX')} ciclos
              </span>
            </div>
            {coaExp && (
              <div className={`flex items-center gap-1.5 ${ coaSoon ? 'text-rose-500' : 'text-slate-500' }`}>
                <Clock size={11} className="shrink-0" />
                <span className="text-[11px]">
                  CdN: {coaExp.toLocaleDateString('es-MX')}
                </span>
              </div>
            )}
            {nearest && (
              <div className={`flex items-start gap-1.5 ${tier !== 'ok' ? 'text-amber-600' : 'text-slate-500'}`}>
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span className="text-[11px] leading-tight">
                  <span className="font-mono font-bold">{nearest.taskCode}</span>
                  {' '}·{' '}
                  {nearest.hoursRemaining != null
                    ? `${nearest.hoursRemaining.toFixed(0)}h rest.`
                    : nearest.daysRemaining != null
                      ? `${nearest.daysRemaining}d cal.`
                      : '—'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* CTA buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => navigate(`/aircraft/${aircraft.id}`)}
            className="flex-1 btn-secondary text-xs flex items-center justify-center gap-1"
          >
            <User size={11} />
            Ver Ficha
          </button>
          <button
            onClick={() => navigate(`/work-requests?aircraftId=${aircraft.id}`)}
            className={`flex-1 text-xs flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 font-semibold transition-all ${
              tier === 'overdue' || tier === 'critical'
                ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse shadow-sm'
                : 'btn-primary'
            }`}
          >
            <ClipboardList size={11} />
            Generar ST
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Task breakdown side panel ────────────────────────────────────────────────
function TaskPanel({ aircraft, onClose }: { aircraft: Aircraft; onClose: () => void }) {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['compliance', aircraft.id],
    queryFn: () => complianceApi.latestForAircraft(aircraft.id),
  });

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const urgency = (s: string) => (s === 'OVERDUE' ? 0 : s === 'DEFERRED' ? 1 : 2);
      const uDiff = urgency(a.status) - urgency(b.status);
      if (uDiff !== 0) return uDiff;
      const aDate = a.nextDueDate ? new Date(a.nextDueDate).getTime() : Infinity;
      const bDate = b.nextDueDate ? new Date(b.nextDueDate).getTime() : Infinity;
      return aDate - bDate;
    });
  }, [tasks]);

  const overdue  = tasks.filter(t => t.status === 'OVERDUE').length;
  const deferred = tasks.filter(t => t.status === 'DEFERRED').length;

  const coaExp = aircraft.coaExpiryDate ? new Date(aircraft.coaExpiryDate) : null;
  const coaDaysLeft = coaExp ? Math.ceil((coaExp.getTime() - Date.now()) / 864e5) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Aeronave seleccionada</p>
          <h3 className="text-xl font-bold text-slate-900 font-mono mt-0.5">{aircraft.registration}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{aircraft.manufacturer} · {aircraft.model}</p>
          <span className={`mt-2 inline-block ${STATUS_BADGE[aircraft.status]}`}>
            {STATUS_LABEL[aircraft.status]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="mt-1 p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Quick stats */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
            <p className="text-xl font-bold text-slate-900 tabular-nums">
              {Number(aircraft.totalFlightHours).toFixed(0)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Horas totales</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
            <p className="text-xl font-bold text-slate-900 tabular-nums">{aircraft.totalCycles}</p>
            <p className="text-xs text-slate-400 mt-0.5">Ciclos totales</p>
          </div>
        </div>
        {coaDaysLeft !== null && (
          <div className={`rounded-lg border p-2 flex items-center gap-2 ${coaDaysLeft <= 30 ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-200'}`}>
            <Clock size={13} className={coaDaysLeft <= 30 ? 'text-rose-500 shrink-0' : 'text-slate-400 shrink-0'} />
            <span className={`text-xs font-medium ${coaDaysLeft <= 30 ? 'text-rose-700' : 'text-slate-600'}`}>
              CdN vence {coaDaysLeft <= 0 ? '¡VENCIDO!' : `en ${coaDaysLeft}d`} · {coaExp!.toLocaleDateString('es-MX')}
            </span>
          </div>
        )}
        {overdue > 0 && (
          <div className="mt-2 rounded-lg border bg-rose-50 border-rose-200 p-2 flex items-center gap-2">
            <AlertTriangle size={13} className="text-rose-600 shrink-0" />
            <span className="text-xs font-semibold text-rose-700">
              {overdue} tarea{overdue > 1 ? 's' : ''} vencida{overdue > 1 ? 's' : ''}
            </span>
          </div>
        )}
        {deferred > 0 && (
          <div className="mt-2 rounded-lg border bg-amber-50 border-amber-200 p-2 flex items-center gap-2">
            <Clock size={13} className="text-amber-600 shrink-0" />
            <span className="text-xs font-medium text-amber-700">
              {deferred} tarea{deferred > 1 ? 's' : ''} diferida{deferred > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
          Tareas de cumplimiento
        </p>
        {isLoading && (
          <p className="text-center py-10 text-sm text-slate-400">Cargando tareas…</p>
        )}
        {!isLoading && sorted.length === 0 && (
          <p className="text-center py-10 text-sm text-slate-400">Sin registros de cumplimiento</p>
        )}
        <div className="space-y-2">
          {sorted.map((t) => {
            const isOverdue  = t.status === 'OVERDUE';
            const isDeferred = t.status === 'DEFERRED';
            const rowCls = isOverdue
              ? 'bg-rose-50 border-rose-200'
              : isDeferred
              ? 'bg-amber-50 border-amber-200'
              : 'bg-white border-slate-200';
            const badgeCls = isOverdue ? 'badge-overdue' : isDeferred ? 'badge-deferred' : 'badge-completed';

            return (
              <div key={t.id} className={`rounded-lg border p-3 ${rowCls}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-rose-800' : 'text-slate-900'}`}>
                      {t.task?.code ?? 'Sin código'}
                    </p>
                    {t.task?.referenceType && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {t.task.referenceType}
                        {t.task.referenceNumber ? ` · ${t.task.referenceNumber}` : ''}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 ${badgeCls}`}>{t.status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {t.nextDueDate && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(t.nextDueDate).toLocaleDateString('es-MX')}
                    </span>
                  )}
                  {t.nextDueHours != null && (
                    <span>{Number(t.nextDueHours).toFixed(0)} h</span>
                  )}
                  {t.nextDueCycles != null && (
                    <span>{t.nextDueCycles} cic.</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── KPI 1: Disponibilidad de flota ──────────────────────────────────────────
function AvailabilityKPI({ aircraft, onClick }: { aircraft: Aircraft[]; onClick: (status: AircraftStatus | '') => void }) {
  const total = aircraft.length;
  const operational = aircraft.filter(a => a.status === 'OPERATIONAL').length;
  const maintenance = aircraft.filter(a => a.status === 'IN_MAINTENANCE' || a.status === 'GROUNDED').length;
  const critical    = aircraft.filter(a => a.status === 'AOG' || a.status === 'DECOMMISSIONED').length;

  const pctOp = total > 0 ? (operational / total) * 100 : 0;
  const pctMn = total > 0 ? (maintenance / total) * 100 : 0;
  const pctCr = total > 0 ? (critical    / total) * 100 : 0;

  const circumference = 2 * Math.PI * 38; // r=38

  // Stacked ring: operational (emerald) → maintenance (amber) → critical (rose)
  const segments = [
    { pct: pctOp, color: '#10b981', label: 'Operacional',    status: 'OPERATIONAL' as AircraftStatus, count: operational },
    { pct: pctMn, color: '#f59e0b', label: 'Mantenimiento',  status: 'IN_MAINTENANCE' as AircraftStatus, count: maintenance },
    { pct: pctCr, color: '#f43f5e', label: 'Crítico / AOG',  status: 'AOG' as AircraftStatus, count: critical },
  ];

  // Build stacked dashes — each segment starts where the previous ended
  let offset = 0;
  const rings = segments.map(seg => {
    const dash = (seg.pct / 100) * circumference;
    const gap  = circumference - dash;
    const ringOffset = offset;
    offset += dash;
    return { ...seg, dash, gap, ringOffset };
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
          <TrendingUp size={14} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-xs font-bold text-slate-900">Disponibilidad de Flota</p>
          <p className="text-[10px] text-slate-400">KPI 1 · % aeronaves operacionales</p>
        </div>
      </div>

      <div className="flex items-center gap-5">
        {/* Ring chart */}
        <div className="relative shrink-0 w-24 h-24">
          <svg width="96" height="96" className="-rotate-90">
            {/* Track */}
            <circle cx="48" cy="48" r="38" fill="none" stroke="#f1f5f9" strokeWidth="10" />
            {total === 0 ? (
              <circle cx="48" cy="48" r="38" fill="none" stroke="#e2e8f0" strokeWidth="10"
                strokeDasharray={`${circumference}`} strokeDashoffset="0" />
            ) : rings.map((r, i) => (
              <circle
                key={i}
                cx="48" cy="48" r="38"
                fill="none"
                stroke={r.color}
                strokeWidth="10"
                strokeDasharray={`${r.dash} ${r.gap}`}
                strokeDashoffset={-r.ringOffset}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                onClick={() => onClick(r.status)}
                onMouseOver={e => (e.currentTarget as SVGCircleElement).style.opacity = '0.7'}
                onMouseOut={e => (e.currentTarget as SVGCircleElement).style.opacity = '1'}
              />
            ))}
          </svg>
          {/* Centre label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-slate-900 tabular-nums leading-none">
              {Math.round(pctOp)}%
            </span>
            <span className="text-[9px] text-slate-400 font-medium">activas</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          {segments.map(seg => (
            <button
              key={seg.status}
              onClick={() => onClick(seg.status)}
              className="flex items-center gap-2 text-left w-full group hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-colors"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="text-xs text-slate-600 flex-1 truncate">{seg.label}</span>
              <span className="text-xs font-bold tabular-nums text-slate-800 shrink-0">{seg.count}</span>
              <ChevronRight size={11} className="text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 text-center">
        Haz clic en un segmento para filtrar la flota
      </p>
    </div>
  );
}

// ─── KPI 2: Vencimientos próximos ─────────────────────────────────────────────
function ExpiryKPI({
  allPlan,
  isLoading,
  onBarClick,
}: {
  allPlan: MaintenancePlanItem[];
  isLoading: boolean;
  onBarClick: (days: 7 | 15 | 30) => void;
}) {
  const today = Date.now();

  // For each bucket: tasks whose nextDueDate falls within the window
  // OR whose daysRemaining is ≤ window
  const buckets = useMemo(() => {
    const d7  = allPlan.filter(i => {
      if (i.daysRemaining != null && i.daysRemaining >= 0 && i.daysRemaining <= 7)  return true;
      if (i.nextDueDate) {
        const diff = Math.ceil((new Date(i.nextDueDate).getTime() - today) / 864e5);
        return diff >= 0 && diff <= 7;
      }
      return false;
    });
    const d15 = allPlan.filter(i => {
      if (i.daysRemaining != null && i.daysRemaining >= 0 && i.daysRemaining <= 15) return true;
      if (i.nextDueDate) {
        const diff = Math.ceil((new Date(i.nextDueDate).getTime() - today) / 864e5);
        return diff >= 0 && diff <= 15;
      }
      return false;
    });
    const d30 = allPlan.filter(i => {
      if (i.daysRemaining != null && i.daysRemaining >= 0 && i.daysRemaining <= 30) return true;
      if (i.nextDueDate) {
        const diff = Math.ceil((new Date(i.nextDueDate).getTime() - today) / 864e5);
        return diff >= 0 && diff <= 30;
      }
      return false;
    });
    const overdue = allPlan.filter(i => i.status === 'OVERDUE');
    return [
      { label: 'Vencidas',    count: overdue.length, color: 'bg-rose-500',  text: 'text-rose-700',  days: 7 as const,  urgency: 'overdue' },
      { label: '7 días',      count: d7.length,      color: 'bg-amber-500', text: 'text-amber-700', days: 7 as const },
      { label: '15 días',     count: d15.length,     color: 'bg-amber-400', text: 'text-amber-600', days: 15 as const },
      { label: '30 días',     count: d30.length,     color: 'bg-yellow-400',text: 'text-yellow-700',days: 30 as const },
    ];
  }, [allPlan, today]);

  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
          <BarChart2 size={14} className="text-amber-600" />
        </div>
        <div>
          <p className="text-xs font-bold text-slate-900">Vencimientos Próximos</p>
          <p className="text-[10px] text-slate-400">KPI 2 · tareas del plan de mantenimiento</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-24 text-xs text-slate-400 gap-2">
          <Activity size={14} className="animate-pulse" /> Cargando planes…
        </div>
      ) : (
        <div className="flex items-end gap-3 h-28 px-1">
          {buckets.map(bucket => {
            const heightPct = (bucket.count / maxCount) * 100;
            const isEmpty = bucket.count === 0;
            return (
              <button
                key={bucket.label}
                onClick={() => !isEmpty && onBarClick(bucket.days)}
                disabled={isEmpty}
                className={`flex flex-col items-center flex-1 gap-1 group transition-opacity ${isEmpty ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                title={isEmpty ? undefined : `Ver ${bucket.count} tarea(s) — ${bucket.label}`}
              >
                {/* Count label */}
                <span className={`text-xs font-bold tabular-nums ${bucket.text}`}>
                  {bucket.count}
                </span>
                {/* Bar */}
                <div className="w-full rounded-t-lg overflow-hidden bg-slate-100 flex-1 flex items-end">
                  <div
                    className={`w-full rounded-t-md transition-all duration-500 group-hover:brightness-110 ${bucket.color}`}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                </div>
                {/* X-axis label */}
                <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">{bucket.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-slate-400 text-center">
        Haz clic en una barra para ir al plan filtrado
      </p>
    </div>
  );
}

// ─── KPI 3: Carga de trabajo OTs ─────────────────────────────────────────────
const WO_STATUSES = [
  { status: 'DRAFT',       label: 'Borrador',     color: 'bg-slate-200 text-slate-700',   dot: 'bg-slate-400',    border: 'border-slate-200' },
  { status: 'OPEN',        label: 'Abierta',      color: 'bg-blue-50 text-blue-700',      dot: 'bg-blue-500',     border: 'border-blue-200' },
  { status: 'IN_PROGRESS', label: 'En Ejecución', color: 'bg-brand-50 text-brand-700',    dot: 'bg-brand-500',    border: 'border-brand-200' },
  { status: 'QUALITY',     label: 'Calidad',      color: 'bg-purple-50 text-purple-700',  dot: 'bg-purple-400',   border: 'border-purple-200' },
  { status: 'CLOSED',      label: 'Cerrada',      color: 'bg-emerald-50 text-emerald-700',dot: 'bg-emerald-500',  border: 'border-emerald-200' },
] as const;

function WorkloadKPI({
  isLoading,
  counts,
  onStatusClick,
}: {
  isLoading: boolean;
  counts: Record<string, number>;
  onStatusClick: (status: string) => void;
}) {
  const openCount = (counts['OPEN'] ?? 0) + (counts['IN_PROGRESS'] ?? 0) + (counts['QUALITY'] ?? 0);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
            <ClipboardList size={14} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-900">Carga de Trabajo</p>
            <p className="text-[10px] text-slate-400">KPI 3 · órdenes de trabajo activas</p>
          </div>
        </div>
        {!isLoading && (
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums text-brand-700 leading-none">{openCount}</p>
            <p className="text-[10px] text-slate-400">OTs en curso</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-24 text-xs text-slate-400 gap-2">
          <Activity size={14} className="animate-pulse" /> Cargando OTs…
        </div>
      ) : (
        <div className="space-y-1.5">
          {WO_STATUSES.map(ws => {
            const count = counts[ws.status] ?? 0;
            const barPct = total > 0 ? (count / total) * 100 : 0;
            return (
              <button
                key={ws.status}
                onClick={() => count > 0 && onStatusClick(ws.status)}
                disabled={count === 0}
                className={`w-full flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all group ${
                  count > 0 ? `${ws.border} hover:shadow-sm cursor-pointer` : 'border-slate-100 opacity-40 cursor-default'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${ws.dot}`} />
                <span className="text-xs text-slate-600 flex-1 truncate">{ws.label}</span>
                {/* Mini bar */}
                <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${ws.dot}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <span className="text-xs font-bold tabular-nums text-slate-800 w-4 text-right shrink-0">{count}</span>
                <ChevronRight size={11} className={`shrink-0 transition-colors ${count > 0 ? 'text-slate-300 group-hover:text-slate-500' : 'opacity-0'}`} />
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-slate-400 text-center">
        Haz clic en un estado para ver las OTs filtradas
      </p>
    </div>
  );
}

// ─── Main Dashboard page ──────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode]       = useState<'table' | 'cards'>('table');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState<AircraftStatus | ''>('');

  const { data: result, isLoading } = useQuery({
    queryKey: ['aircraft'],
    queryFn: () => aircraftApi.findAll(),
  });
  const aircraft: Aircraft[] = result ?? [];

  // ── KPI data ──────────────────────────────────────────────────────────────

  const { data: allWOs = [], isLoading: loadingWOs } = useQuery({
    queryKey: ['work-orders-all'],
    queryFn: () => workOrdersApi.list(),
    staleTime: 2 * 60 * 1000,
  });

  const woCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const wo of allWOs) {
      counts[wo.status] = (counts[wo.status] ?? 0) + 1;
    }
    return counts;
  }, [allWOs]);

  const { data: planMap = {} as Record<string, MaintenancePlanItem[]>, isLoading: loadingPlans } = useQuery<Record<string, MaintenancePlanItem[]>>({
    queryKey: ['all-maintenance-plans', aircraft.map(a => a.id).join(',')],
    queryFn: async () => {
      if (aircraft.length === 0) return {} as Record<string, MaintenancePlanItem[]>;
      const results = await Promise.all(
        aircraft.map(a => maintenancePlanApi.getForAircraft(a.id).catch(() => [] as MaintenancePlanItem[]))
      );
      // El plan incluye las tareas marcadas "no aplica" (isApplicable=false) para
      // que la UI pueda mostrarlas y revertirlas. Nada de lo que cuelga de aquí
      // —semáforo, vencimientos, KPI de vencidas— debe contarlas: no están en el
      // plan vigente de la aeronave. Se filtra una sola vez, en el origen.
      return Object.fromEntries(
        aircraft.map((a, i) => [a.id, results[i].filter(item => item.isApplicable)]),
      ) as Record<string, MaintenancePlanItem[]>;
    },
    enabled: aircraft.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  // Flat list for ExpiryKPI (expects all plan items in a single array)
  const plansByAircraft = useMemo(
    () => Object.values(planMap).flat(),
    [planMap],
  );

  // ── Filters ───────────────────────────────────────────────────────────────

  const owners = useMemo(
    () => Array.from(new Set(aircraft.map(a => a.manufacturer))).sort(),
    [aircraft],
  );
  const models = useMemo(() => {
    const base = filterOwner ? aircraft.filter(a => a.manufacturer === filterOwner) : aircraft;
    return Array.from(new Set(base.map(a => a.model))).sort();
  }, [aircraft, filterOwner]);

  const filtered = useMemo(() => {
    return aircraft.filter(a => {
      if (filterStatus && a.status !== filterStatus) return false;
      if (filterOwner && a.manufacturer !== filterOwner) return false;
      if (filterModel && a.model !== filterModel) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.registration.toLowerCase().includes(q) ||
          a.model.toLowerCase().includes(q) ||
          a.manufacturer.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [aircraft, filterOwner, filterModel, search, filterStatus]);

  const semCounts = useMemo(() => ({
    green:  aircraft.filter(a => SEM_CONFIG.green.statuses.includes(a.status)).length,
    yellow: aircraft.filter(a => SEM_CONFIG.yellow.statuses.includes(a.status)).length,
    red:    aircraft.filter(a => SEM_CONFIG.red.statuses.includes(a.status)).length,
  }), [aircraft]);

  const selectedAircraft = aircraft.find(a => a.id === selectedId) ?? null;

  const clearFilters = () => { setFilterOwner(''); setFilterModel(''); setSearch(''); setFilterStatus(''); };
  const hasFilters = filterOwner || filterModel || search || filterStatus;

  // ── KPI navigation ────────────────────────────────────────────────────────
  const handleAvailabilityClick = (status: AircraftStatus | '') => {
    setFilterStatus(status);
    document.getElementById('fleet-table')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleExpiryBarClick = (days: 7 | 15 | 30) => {
    const status = days === 30 ? 'DUE_SOON' : 'DUE_SOON';
    navigate(`/maintenance-plan?status=${status}&days=${days}`);
  };

  const handleWOStatusClick = (status: string) => {
    navigate(`/work-orders?status=${status}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Page header */}
      <div className="px-8 pt-8 pb-5 shrink-0">
        <h1 className="text-xl font-bold text-slate-900">Dashboard de Flota</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {aircraft.length} aeronave{aircraft.length !== 1 ? 's' : ''} registradas en la flota
        </p>
      </div>

      {/* ── KPI Row ── */}
      <div className="px-8 pb-6 shrink-0">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
          Indicadores Gerenciales
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <AvailabilityKPI aircraft={aircraft} onClick={handleAvailabilityClick} />
          <ExpiryKPI allPlan={plansByAircraft} isLoading={loadingPlans} onBarClick={handleExpiryBarClick} />
          <WorkloadKPI isLoading={loadingWOs} counts={woCounts} onStatusClick={handleWOStatusClick} />
        </div>
      </div>

      {/* ── Semaphore ── */}
      <div className="px-8 pb-6 shrink-0">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
          Vista de Semáforo
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SemaphoreCard color="green"  count={semCounts.green}  total={aircraft.length} />
          <SemaphoreCard color="yellow" count={semCounts.yellow} total={aircraft.length} />
          <SemaphoreCard color="red"    count={semCounts.red}    total={aircraft.length} />
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="px-8 pb-4 shrink-0">
        <div className="filter-bar">
          <SlidersHorizontal size={14} className="text-slate-400 shrink-0" />
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mr-1">Filtros</span>

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar matrícula…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="filter-input pl-8 w-44"
            />
          </div>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as AircraftStatus | '')}
            className="filter-input cursor-pointer"
          >
            <option value="">Todos los estados</option>
            <option value="OPERATIONAL">Operacional</option>
            <option value="IN_MAINTENANCE">En Mantenimiento</option>
            <option value="GROUNDED">En Tierra</option>
            <option value="AOG">AOG</option>
            <option value="DECOMMISSIONED">Retirada</option>
          </select>

          {/* Owner filter */}
          <select
            value={filterOwner}
            onChange={e => { setFilterOwner(e.target.value); setFilterModel(''); }}
            className="filter-input cursor-pointer"
          >
            <option value="">Todos los propietarios</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          {/* Model filter */}
          <select
            value={filterModel}
            onChange={e => setFilterModel(e.target.value)}
            className="filter-input cursor-pointer"
          >
            <option value="">Todos los modelos</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
            >
              Limpiar
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </span>
          {/* ─ View toggle ─ */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden ml-2 shrink-0">
            <button
              onClick={() => setViewMode('table')}
              title="Vista de tabla"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${
                viewMode === 'table'
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <List size={13} />
            </button>
            <button
              onClick={() => { setViewMode('cards'); setSelectedId(null); }}
              title="Vista de tarjetas"
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors ${
                viewMode === 'cards'
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Table + Side panel / Fleet Cards ── */}
      <div id="fleet-table" className="flex flex-1 px-8 pb-8 gap-5 min-h-[400px]">
        {/* ─ Cards grid ─ */}
        {viewMode === 'cards' && (
          <div className="w-full">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                {hasFilters ? 'No hay aeronaves que coincidan con los filtros' : 'No hay aeronaves registradas'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map(a => (
                  <FleetCard
                    key={a.id}
                    aircraft={a}
                    plan={planMap[a.id] ?? []}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Data table */}
        {viewMode === 'table' && (
        <div className={`bg-white rounded-xl shadow-sm overflow-hidden flex flex-col transition-all duration-300 ${selectedAircraft ? 'flex-1 min-w-0' : 'w-full'}`}>
          <div className="overflow-auto flex-1">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                <tr>
                  <th className="table-header">Matrícula</th>
                  <th className="table-header">Fabricante</th>
                  <th className="table-header">Modelo</th>
                  <th className="table-header text-right">Horas</th>
                  <th className="table-header text-right">Ciclos</th>
                  <th className="table-header">Vto. CdN</th>
                  <th className="table-header">Mantenimiento</th>
                  <th className="table-header">Estado</th>
                  <th className="px-4 py-3 w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="table-cell text-center text-slate-400 py-16">
                      Cargando aeronaves…
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="table-cell text-center text-slate-400 py-16">
                      {hasFilters ? 'No hay aeronaves que coincidan con los filtros' : 'No hay aeronaves registradas'}
                    </td>
                  </tr>
                )}
                {filtered.map(a => {
                  const isSelected = a.id === selectedId;
                  const coaExp = a.coaExpiryDate ? new Date(a.coaExpiryDate) : null;
                  const coaSoon = coaExp && (coaExp.getTime() - Date.now()) < 30 * 864e5;
                  const aircraftPlan = planMap[a.id] ?? [];
                  const fleetTier = computeFleetAlertTier(aircraftPlan);
                  const nearestFleetTask = getFleetNearestTask(aircraftPlan);

                  return (
                    <tr
                      key={a.id}
                      onClick={() => setSelectedId(isSelected ? null : a.id)}
                      className={`cursor-pointer transition-colors group ${
                        isSelected
                          ? 'bg-brand-50 border-l-2 border-brand-500'
                          : fleetTier === 'overdue' || fleetTier === 'critical'
                          ? 'hover:bg-slate-50 border-l-2 border-l-rose-500'
                          : fleetTier === 'warning'
                          ? 'hover:bg-slate-50 border-l-2 border-l-amber-400'
                          : 'hover:bg-slate-50 border-l-2 border-transparent'
                      }`}
                    >
                      <td className="table-cell font-mono font-bold text-slate-900">{a.registration}</td>
                      <td className="table-cell text-slate-600">{a.manufacturer}</td>
                      <td className="table-cell text-slate-600">{a.model}</td>
                      <td className="table-cell text-right tabular-nums text-slate-600">
                        {Number(a.totalFlightHours).toFixed(1)}
                      </td>
                      <td className="table-cell text-right tabular-nums text-slate-600">{a.totalCycles}</td>
                      <td className={`table-cell text-xs ${coaSoon ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                        {coaExp ? coaExp.toLocaleDateString('es-MX') : '—'}
                      </td>
                      <td className="table-cell">
                        {fleetTier !== 'ok' && nearestFleetTask ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <AlertTriangle
                                size={11}
                                className={`shrink-0 animate-pulse ${
                                  fleetTier === 'overdue' || fleetTier === 'critical' ? 'text-rose-500' : 'text-amber-500'
                                }`}
                              />
                              <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                                fleetTier === 'overdue' || fleetTier === 'critical'
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-amber-100 text-amber-700'
                              }`}>
                                {fleetTier === 'overdue' ? 'Vencida' :
                                 fleetTier === 'critical' ? '< 5h / 5d' : '< 15h / 15d'}
                              </span>
                            </div>
                            {nearestFleetTask.hoursRemaining != null && nearestFleetTask.hoursRemaining > 0 && (
                              <span className="text-[10px] text-slate-400 tabular-nums ml-3.5">
                                {calcFleetEstimatedDate(nearestFleetTask.hoursRemaining).toLocaleDateString('es-MX')}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <span className={STATUS_BADGE[a.status]}>{STATUS_LABEL[a.status]}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-400">
                        <ChevronRight
                          size={15}
                          className={`transition-transform duration-200 ${isSelected ? 'rotate-90 text-brand-500' : 'group-hover:text-slate-600'}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* Task breakdown panel */}
        {viewMode === 'table' && selectedAircraft && (
          <div className="w-80 shrink-0 bg-white rounded-xl shadow-card overflow-hidden flex flex-col border border-slate-200 animate-in slide-in-from-right-4 duration-200">
            <TaskPanel aircraft={selectedAircraft} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
