import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAuthStore } from '@store/authStore';
import {
  Plane, Wrench, LayoutDashboard, LogOut, Settings,
  ClipboardList, BarChart2, Package, ChevronRight, ClipboardCheck, Bell, FileText, FileCheck2, Repeat, BookOpen,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { aircraftApi } from '@api/aircraft.api';
import { maintenancePlanApi, type MaintenancePlanItem } from '@api/maintenancePlan.api';
import { workOrdersApi } from '@api/workOrders.api';
import { generarAlertas, TIPO_CONFIG, type Notificacion } from '@pages/NotificationsPage';

const NAV_SECTIONS = [
  {
    title: 'Control de Mantenimiento',
    items: [
      { to: '/aircraft', label: 'Aeronaves', icon: Plane },
      { to: '/components', label: 'Componentes', icon: Package },
      { to: '/compliance', label: 'Cumplimientos', icon: Wrench },
      { to: '/maintenance-plan', label: 'Plan de Mantenimiento', icon: ClipboardCheck },
      { to: '/library', label: 'Biblioteca de Mantenimiento', icon: BookOpen },
      { to: '/work-requests', label: 'Solicitud de Trabajo', icon: FileText },
      { to: '/aircraft-alterations', label: 'Alteraciones por Aeronave', icon: Repeat },
      { to: '/remanentes', label: 'Remanentes', icon: BarChart2 },
    ],
  },
  {
    title: 'Oficina Técnica',
    items: [
      { to: '/work-orders', label: 'Órdenes de Trabajo', icon: ClipboardList },
      { to: '/conformities', label: 'Conformidades', icon: FileCheck2 },
    ],
  },
  {
    title: 'General',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/reports', label: 'Reportes', icon: BarChart2 },
      { to: '/notificaciones', label: 'Notificaciones', icon: Bell },
      { to: '/settings', label: 'Configuración', icon: Settings },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':        'Dashboard de Flota',
  '/aircraft':         'Aeronaves',
  '/components':       'Componentes',
  '/compliance':       'Cumplimientos',
  '/maintenance-plan': 'Plan de Mantenimiento',
  '/library':          'Biblioteca de Mantenimiento',
  '/work-requests':    'Solicitud de Trabajo',
  '/aircraft-alterations': 'Alteraciones por Aeronave',
  '/work-orders':      'Órdenes de Trabajo',
  '/conformities':     'Conformidades',
  '/reports':          'Reportes',
  '/remanentes':       'Remanentes Operacionales',
  '/notificaciones':   'Centro de Notificaciones',
  '/settings':         'Configuración',
};

function initials(name?: string) {
  if (!name) return 'U';
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('');
}

/** Provides notifications list + unread count, reactive to markRead calls */
const NOTIF_READ_KEY = 'griselle-notif-read';

function useHeaderNotifications() {
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(NOTIF_READ_KEY) ?? '[]') as string[]); }
    catch { return new Set(); }
  });

  const { data: aircraft = [] } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
    staleTime: 2 * 60 * 1000,
  });

  const { data: planMap = {} as Record<string, MaintenancePlanItem[]> } = useQuery<Record<string, MaintenancePlanItem[]>>({
    queryKey: ['sidebar-plans', aircraft.map(a => a.id).join(',')],
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

  const { data: wos = [] } = useQuery({
    queryKey: ['work-orders-all'],
    queryFn: () => workOrdersApi.list(),
    staleTime: 2 * 60 * 1000,
  });

  const notifications = useMemo(
    () => generarAlertas(aircraft, planMap, wos, readIds),
    [aircraft, planMap, wos, readIds],
  );

  const unreadCount = useMemo(() => notifications.filter(n => !n.leida).length, [notifications]);

  const markRead = useCallback((id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(NOTIF_READ_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  return { notifications, unreadCount, markRead };
}

function TopBar({ notifications, unreadCount, markRead }: {
  notifications: Notificacion[];
  unreadCount: number;
  markRead: (id: string) => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const title = PAGE_TITLES[pathname] ?? 'Griselle';
  const today = new Date().toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const topNotifs = notifications.slice(0, 6);

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-8 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="font-medium text-slate-500">Griselle</span>
        <ChevronRight size={11} className="text-slate-300" />
        <span className="font-semibold text-slate-700">{title}</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Bell dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setOpen(prev => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors ${
              open ? 'bg-slate-100 text-slate-700' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-700'
            }`}
            title="Notificaciones"
          >
            <Bell size={15} className={unreadCount > 0 ? 'text-rose-500' : ''} />
            {unreadCount > 0 && (
              <span className="text-xs font-bold tabular-nums text-rose-600">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
              {/* Dropdown header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-bold text-slate-700">Notificaciones</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full tabular-nums">
                    {unreadCount} sin leer
                  </span>
                )}
              </div>

              {/* Items list */}
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                {topNotifs.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-400">Sin alertas activas</p>
                ) : topNotifs.map(n => {
                  const cfg = TIPO_CONFIG[n.tipo];
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => { markRead(n.id); navigate(n.link); setOpen(false); }}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors border-l-2 ${
                        !n.leida ? 'border-l-rose-400' : 'border-l-transparent opacity-60 hover:opacity-90'
                      }`}
                    >
                      <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${cfg.bgColor}`}>
                        <Icon size={12} className={cfg.iconColor} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold truncate ${n.leida ? 'text-slate-500' : 'text-slate-800'}`}>
                          {n.titulo}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{n.descripcion}</p>
                      </div>
                      {!n.leida && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 mt-1.5" />}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-100">
                <button
                  onClick={() => { setOpen(false); navigate('/notificaciones'); }}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 transition-colors"
                >
                  Ver todas las notificaciones
                  <ChevronRight size={11} />
                </button>
              </div>
            </div>
          )}
        </div>

        <span className="text-[11px] text-slate-400 capitalize tracking-wide">{today}</span>
      </div>
    </header>
  );
}

export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { notifications, unreadCount, markRead } = useHeaderNotifications();

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      {/* ── Sidebar ── */}
      <aside className="w-56 bg-slate-950 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center shrink-0 shadow-md">
              <Plane size={14} className="text-white" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-white leading-none tracking-tight">Griselle</p>
              <p className="text-[9.5px] text-slate-500 mt-0.5 leading-none">MRO Platform</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-slate-800" />

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-px overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-3">
              <p className="px-2.5 pt-1 pb-2 text-[9.5px] font-bold text-slate-600 uppercase tracking-[0.12em]">
                {section.title}
              </p>
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-100 ${
                      isActive
                        ? 'bg-brand-600/12 text-brand-400 '
                        : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={14} className={isActive ? 'text-brand-400' : ''} />
                      <span className="flex-1">{label}</span>
                      {to === '/notificaciones' && unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1 tabular-nums">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer: user */}
        <div className="mx-4 h-px bg-slate-800" />
        <div className="p-3">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 bg-brand-700 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0">
              {initials(user?.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-slate-300 truncate leading-tight">{user?.name}</p>
              <p className="text-[10px] text-slate-600 capitalize leading-tight">{user?.role?.toLowerCase()}</p>
            </div>
            <button
              onClick={logout}
              className="p-1 rounded text-slate-600 hover:text-slate-200 hover:bg-slate-700 transition-colors shrink-0"
              title="Cerrar sesión"
            >
              <LogOut size={12} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar notifications={notifications} unreadCount={unreadCount} markRead={markRead} />
        <main className="flex-1 overflow-y-auto bg-zinc-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
