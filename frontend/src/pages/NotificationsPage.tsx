import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bell, AlertOctagon, Clock, ClipboardList, Check, CheckCheck,
  Loader2, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { aircraftApi } from '@api/aircraft.api';
import type { Aircraft } from '@api/aircraft.api';
import { maintenancePlanApi } from '@api/maintenancePlan.api';
import type { MaintenancePlanItem } from '@api/maintenancePlan.api';
import { workOrdersApi } from '@api/workOrders.api';
import type { WorkOrder } from '@api/workOrders.api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TipoNotificacion = 'critica' | 'proxima' | 'gestion';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  descripcion: string;
  link: string;
  fecha: Date;
  leida: boolean;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const READ_KEY = 'griselle-notif-read';
const READ_CHANGED_EVENT = 'griselle-notif-read-changed';

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>): void {
  localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new Event(READ_CHANGED_EVENT));
}

// ─── Alert generator ──────────────────────────────────────────────────────────

const DAILY_HOURS    = 2.5;
const CRITICAL_HOURS = 5;
const ALERT_HOURS    = 15;
const CRITICAL_DAYS  = 5;
const ALERT_DAYS     = 15;

export function generarAlertas(
  aircraft: Aircraft[],
  planMap: Record<string, MaintenancePlanItem[]>,
  workOrders: WorkOrder[],
  readIds: Set<string>,
): Notificacion[] {
  const now = new Date();
  const alerts: Notificacion[] = [];

  // ── Aircraft status alerts ────────────────────────────────────────────────
  for (const a of aircraft) {
    if (a.status === 'AOG') {
      const id = `aog-${a.id}`;
      alerts.push({
        id, tipo: 'critica',
        titulo: `Aeronave AOG: ${a.registration}`,
        descripcion: `${a.manufacturer} ${a.model} está fuera de servicio. Se requiere atención inmediata.`,
        link: '/aircraft', fecha: now, leida: readIds.has(id),
      });
    }

    // CdN expiry
    if (a.coaExpiryDate) {
      const daysLeft = Math.ceil((new Date(a.coaExpiryDate).getTime() - now.getTime()) / 864e5);
      if (daysLeft <= 30) {
        const id = `coa-${a.id}`;
        alerts.push({
          id,
          tipo: daysLeft <= 7 ? 'critica' : 'proxima',
          titulo: `CdN por vencer: ${a.registration}`,
          descripcion: `Certificado de Navegabilidad vence ${daysLeft <= 0 ? '¡VENCIDO!' : `en ${daysLeft} días`} · ${new Date(a.coaExpiryDate).toLocaleDateString('es-MX')}`,
          link: '/aircraft', fecha: now, leida: readIds.has(id),
        });
      }
    }

    // Seguro por vencer
    if (a.insuranceExpiryDate) {
      const daysLeft = Math.ceil((new Date(a.insuranceExpiryDate).getTime() - now.getTime()) / 864e5);
      if (daysLeft <= 30) {
        const id = `insurance-${a.id}`;
        alerts.push({
          id,
          tipo: daysLeft <= 7 ? 'critica' : 'proxima',
          titulo: `Seguro por vencer: ${a.registration}`,
          descripcion: `Póliza de seguro vence ${daysLeft <= 0 ? '¡VENCIDA!' : `en ${daysLeft} días`} · ${new Date(a.insuranceExpiryDate).toLocaleDateString('es-MX')}`,
          link: '/aircraft', fecha: now, leida: readIds.has(id),
        });
      }
    }
  }

  // ── Maintenance plan alerts ───────────────────────────────────────────────
  for (const [aircraftId, plan] of Object.entries(planMap)) {
    const ac = aircraft.find(a => a.id === aircraftId);
    const reg = ac?.registration ?? '—';

    for (const item of plan) {
      if (item.status === 'OVERDUE') {
        const id = `plan-overdue-${item.taskId}-${aircraftId}`;
        const overdueStr = item.hoursRemaining != null
          ? `${Math.abs(item.hoursRemaining).toFixed(0)}h vencida`
          : item.daysRemaining != null
          ? `${Math.abs(item.daysRemaining)}d vencida`
          : 'vencida';
        alerts.push({
          id, tipo: 'critica',
          titulo: `Tarea vencida: ${item.taskCode}`,
          descripcion: `[${reg}] ${item.taskTitle} · ${overdueStr}`,
          link: '/maintenance-plan', fecha: now, leida: readIds.has(id),
        });
        continue; // don't double-count as critical
      }

      // Critical hours (< 5h)
      if (item.hoursRemaining != null && item.hoursRemaining < CRITICAL_HOURS) {
        const id = `plan-crit-h-${item.taskId}-${aircraftId}`;
        const projDate = new Date(now.getTime() + (item.hoursRemaining / DAILY_HOURS) * 864e5);
        alerts.push({
          id, tipo: 'critica',
          titulo: `Crítico: ${item.taskCode}`,
          descripcion: `[${reg}] ${item.taskTitle} · ${item.hoursRemaining.toFixed(1)}h restantes · vence ~${projDate.toLocaleDateString('es-MX')}`,
          link: '/maintenance-plan', fecha: now, leida: readIds.has(id),
        });
        continue;
      }

      // Critical calendar days (< 5d, only if no hour-limit)
      if (item.hoursRemaining == null && item.daysRemaining != null && item.daysRemaining < CRITICAL_DAYS) {
        const id = `plan-crit-d-${item.taskId}-${aircraftId}`;
        alerts.push({
          id, tipo: 'critica',
          titulo: `Crítico (fecha): ${item.taskCode}`,
          descripcion: `[${reg}] ${item.taskTitle} · ¡Solo ${item.daysRemaining}d restantes! · ${item.nextDueDate ? new Date(item.nextDueDate).toLocaleDateString('es-MX') : ''}`,
          link: '/maintenance-plan', fecha: now, leida: readIds.has(id),
        });
        continue;
      }

      // Warning hours (5h–15h)
      if (item.hoursRemaining != null && item.hoursRemaining < ALERT_HOURS) {
        const id = `plan-warn-h-${item.taskId}-${aircraftId}`;
        const projDate = new Date(now.getTime() + (item.hoursRemaining / DAILY_HOURS) * 864e5);
        alerts.push({
          id, tipo: 'proxima',
          titulo: `Próx. vencer: ${item.taskCode}`,
          descripcion: `[${reg}] ${item.taskTitle} · ${item.hoursRemaining.toFixed(1)}h restantes · ~${projDate.toLocaleDateString('es-MX')}`,
          link: '/maintenance-plan', fecha: now, leida: readIds.has(id),
        });
        continue;
      }

      // Warning calendar days (5d–15d, only if no hour-limit)
      if (item.hoursRemaining == null && item.daysRemaining != null && item.daysRemaining < ALERT_DAYS) {
        const id = `plan-warn-d-${item.taskId}-${aircraftId}`;
        alerts.push({
          id, tipo: 'proxima',
          titulo: `Próx. vencer (fecha): ${item.taskCode}`,
          descripcion: `[${reg}] ${item.taskTitle} · ${item.daysRemaining}d restantes · ${item.nextDueDate ? new Date(item.nextDueDate).toLocaleDateString('es-MX') : ''}`,
          link: '/maintenance-plan', fecha: now, leida: readIds.has(id),
        });
      }
    }
  }

  // ── Work order alerts ─────────────────────────────────────────────────────
  for (const wo of workOrders) {
    const woRef = `OT ${wo.number}`;

    if (wo.status === 'QUALITY') {
      const id = `wo-quality-${wo.id}`;
      alerts.push({
        id, tipo: 'gestion',
        titulo: `OT pendiente de revisión de calidad`,
        descripcion: `${woRef} — "${wo.title}" · ${wo.aircraft.registration} · Esperando firma de calidad.`,
        link: `/work-orders/${wo.id}`,
        fecha: wo.createdAt ? new Date(wo.createdAt) : now,
        leida: readIds.has(id),
      });
    }

    if (wo.status === 'DRAFT') {
      const id = `wo-draft-${wo.id}`;
      alerts.push({
        id, tipo: 'gestion',
        titulo: `OT en borrador sin abrir`,
        descripcion: `${woRef} — "${wo.title}" · ${wo.aircraft.registration} · Pendiente de apertura.`,
        link: `/work-orders/${wo.id}`,
        fecha: wo.createdAt ? new Date(wo.createdAt) : now,
        leida: readIds.has(id),
      });
    }

    // Open WO past planned start date
    if (wo.status === 'OPEN' && wo.plannedStartDate) {
      const planned = new Date(wo.plannedStartDate);
      if (planned < now) {
        const id = `wo-late-${wo.id}`;
        alerts.push({
          id, tipo: 'proxima',
          titulo: `OT abierta sin iniciar`,
          descripcion: `${woRef} — "${wo.title}" debió iniciar el ${planned.toLocaleDateString('es-MX')} · ${wo.aircraft.registration}`,
          link: `/work-orders/${wo.id}`,
          fecha: planned,
          leida: readIds.has(id),
        });
      }
    }

    // WO with open (unresolved) discrepancies that is IN_PROGRESS
    if (wo.status === 'IN_PROGRESS') {
      const openDisc = wo.discrepancies?.filter(d => d.status === 'OPEN').length ?? 0;
      if (openDisc > 0) {
        const id = `wo-disc-${wo.id}`;
        alerts.push({
          id, tipo: 'gestion',
          titulo: `Hallazgos sin resolver`,
          descripcion: `${woRef} — "${wo.title}" · ${openDisc} hallazgo${openDisc > 1 ? 's' : ''} sin acción correctiva.`,
          link: `/work-orders/${wo.id}`,
          fecha: wo.createdAt ? new Date(wo.createdAt) : now,
          leida: readIds.has(id),
        });
      }
    }
  }

  // Sort: unread first, then critica → proxima → gestion
  const ORDER: Record<TipoNotificacion, number> = { critica: 0, proxima: 1, gestion: 2 };
  return alerts.sort((a, b) => {
    if (a.leida !== b.leida) return a.leida ? 1 : -1;
    return ORDER[a.tipo] - ORDER[b.tipo];
  });
}

// ─── UI configuration ─────────────────────────────────────────────────────────

export const TIPO_CONFIG: Record<TipoNotificacion, {
  label: string;
  icon: typeof AlertOctagon;
  iconColor: string;
  bgColor: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
}> = {
  critica: {
    label: 'Crítica',
    icon: AlertOctagon,
    iconColor: 'text-rose-500',
    bgColor:   'bg-rose-50',
    badgeBg:   'bg-rose-100',
    badgeText: 'text-rose-700',
    dotColor:  'bg-rose-500',
  },
  proxima: {
    label: 'Próxima',
    icon: Clock,
    iconColor: 'text-amber-500',
    bgColor:   'bg-amber-50',
    badgeBg:   'bg-amber-100',
    badgeText: 'text-amber-700',
    dotColor:  'bg-amber-500',
  },
  gestion: {
    label: 'Gestión',
    icon: ClipboardList,
    iconColor: 'text-blue-500',
    bgColor:   'bg-blue-50',
    badgeBg:   'bg-blue-100',
    badgeText: 'text-blue-700',
    dotColor:  'bg-blue-500',
  },
};

type FilterTab = 'todas' | TipoNotificacion;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);
  const [filter, setFilter] = useState<FilterTab>('todas');

  // Mantiene el estado sincronizado si el badge del header marca algo como leído
  useEffect(() => {
    const onReadChanged = () => setReadIds(loadReadIds());
    window.addEventListener(READ_CHANGED_EVENT, onReadChanged);
    return () => window.removeEventListener(READ_CHANGED_EVENT, onReadChanged);
  }, []);

  // Persiste cambios locales fuera del render/actualizador de estado. Compara
  // contenido (no solo referencia) para no re-disparar el evento que un
  // cambio externo (del header) acaba de aplicar — eso causaría un loop.
  const lastSavedRef = useRef<string>(JSON.stringify([...readIds].sort()));
  useEffect(() => {
    const serialized = JSON.stringify([...readIds].sort());
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;
    saveReadIds(readIds);
  }, [readIds]);

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: aircraft = [], isLoading: loadingAc } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
    staleTime: 2 * 60 * 1000,
  });

  const { data: planMap = {} as Record<string, MaintenancePlanItem[]>, isLoading: loadingPlans } = useQuery<Record<string, MaintenancePlanItem[]>>({
    queryKey: ['all-maintenance-plans-notif', aircraft.map(a => a.id).join(',')],
    queryFn: async () => {
      if (aircraft.length === 0) return {} as Record<string, MaintenancePlanItem[]>;
      const results = await Promise.all(
        aircraft.map(a => maintenancePlanApi.getForAircraft(a.id).catch(() => [] as MaintenancePlanItem[]))
      );
      return Object.fromEntries(aircraft.map((a, i) => [a.id, results[i]])) as Record<string, MaintenancePlanItem[]>;
    },
    enabled: aircraft.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  const { data: workOrders = [], isLoading: loadingWOs } = useQuery({
    queryKey: ['work-orders-all'],
    queryFn: () => workOrdersApi.list(),
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = loadingAc || loadingPlans || loadingWOs;

  // ── Compute alerts ──────────────────────────────────────────────────────────
  const allAlerts = useMemo(
    () => generarAlertas(aircraft, planMap, workOrders, readIds),
    [aircraft, planMap, workOrders, readIds],
  );

  const visibleAlerts = useMemo(
    () => filter === 'todas' ? allAlerts : allAlerts.filter(n => n.tipo === filter),
    [allAlerts, filter],
  );

  const counts = useMemo(() => ({
    todas:   allAlerts.length,
    critica: allAlerts.filter(n => n.tipo === 'critica').length,
    proxima: allAlerts.filter(n => n.tipo === 'proxima').length,
    gestion: allAlerts.filter(n => n.tipo === 'gestion').length,
    unread:  allAlerts.filter(n => !n.leida).length,
  }), [allAlerts]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const markRead = useCallback((id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds(prev => {
      const next = new Set(prev);
      allAlerts.forEach(n => next.add(n.id));
      return next;
    });
  }, [allAlerts]);

  const handleClick = (notif: Notificacion) => {
    markRead(notif.id);
    navigate(notif.link);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">

      {/* ── Header ── */}
      <div className="px-8 pt-8 pb-5 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center shrink-0">
              <Bell size={18} className="text-brand-600" />
              {counts.unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1 ring-2 ring-white tabular-nums">
                  {counts.unread > 99 ? '99+' : counts.unread}
                </span>
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Centro de Notificaciones</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {isLoading
                  ? 'Calculando alertas…'
                  : `${counts.unread} sin leer · ${counts.todas} alerta${counts.todas !== 1 ? 's' : ''} total${counts.todas !== 1 ? 'es' : ''}`}
              </p>
            </div>
          </div>

          {counts.unread > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 border border-brand-200 rounded-lg px-3 py-1.5 hover:bg-brand-50 transition-colors shrink-0"
            >
              <CheckCheck size={13} />
              Marcar todo como leído
            </button>
          )}
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="px-8 pb-5 shrink-0">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {(['todas', 'critica', 'proxima', 'gestion'] as const).map(tab => {
            const count = counts[tab];
            const isActive = filter === tab;
            const cfg = tab !== 'todas' ? TIPO_CONFIG[tab] : null;
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-white shadow-sm text-slate-900'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {cfg && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />}
                <span>{tab === 'todas' ? 'Todas' : cfg!.label}</span>
                {count > 0 && (
                  <span className={`min-w-[18px] text-center tabular-nums text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                    isActive
                      ? tab === 'critica' ? 'bg-rose-100 text-rose-700'
                        : tab === 'proxima' ? 'bg-amber-100 text-amber-700'
                        : tab === 'gestion' ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-200 text-slate-700'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 px-8 pb-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-sm">Analizando flota y órdenes de trabajo…</p>
          </div>
        ) : visibleAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-slate-600">
              {filter === 'todas'
                ? 'Todo en orden — sin alertas activas'
                : `Sin alertas de tipo "${TIPO_CONFIG[filter as TipoNotificacion]?.label}"`}
            </p>
            <p className="text-xs text-slate-400">El sistema está al día</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {visibleAlerts.map(n => {
              const cfg = TIPO_CONFIG[n.tipo];
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleClick(n)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(n); } }}
                  className={`w-full text-left flex items-start gap-4 p-4 rounded-xl border transition-all duration-150 group hover:shadow-sm cursor-pointer ${
                    n.leida
                      ? 'bg-white border-slate-200 opacity-60 hover:opacity-90 hover:border-slate-300'
                      : 'bg-white border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  {/* Icon with unread dot */}
                  <div className="relative shrink-0 mt-0.5">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cfg.bgColor}`}>
                      <Icon size={17} className={cfg.iconColor} />
                    </div>
                    {!n.leida && (
                      <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${cfg.dotColor}`} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-semibold ${n.leida ? 'text-slate-500' : 'text-slate-900'}`}>
                        {n.titulo}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${cfg.badgeBg} ${cfg.badgeText}`}>
                          {cfg.label}
                        </span>
                        <ChevronRight size={13} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 text-left pr-2">
                      {n.descripcion}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      {n.fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Inline mark-read button (only for unread) */}
                  {!n.leida && (
                    <button
                      onClick={e => { e.stopPropagation(); markRead(n.id); }}
                      className="shrink-0 mt-1 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-emerald-600 transition-colors"
                      title="Marcar como leída"
                    >
                      <Check size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
