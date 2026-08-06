import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  ClipboardList, Plus, Search, ChevronDown, Plane, User,
  AlertCircle, Clock, Loader2, CheckCircle2, ShieldCheck, X, Package,
  Bell,
} from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { aircraftApi } from '@api/aircraft.api';
import { componentApi } from '@api/component.api';
import {
  workOrdersApi,
  type WorkOrder,
  type WorkOrderStatus,
  type CreateWorkOrderInput,
} from '@api/workOrders.api';
import { ensureStateMachine, getOrderedStatuses, getStatusBadgeClass, getStatusLabel } from '../shared/workflowVisibleState';
import { useWorkOrderStateMachine } from '../shared/workflowStateMachineQueries';

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_ICONS: Record<WorkOrderStatus, React.ElementType> = {
  DRAFT:       ClipboardList,
  OPEN:        AlertCircle,
  IN_PROGRESS: Loader2,
  QUALITY:     ShieldCheck,
  CLOSED:      CheckCircle2,
};

// ── Create Modal ───────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
}

function CreateWorkOrderModal({ onClose }: CreateModalProps) {
  const qc = useQueryClient();

  const { data: aircraft = [] } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
  });

  const [form, setForm] = useState<Partial<CreateWorkOrderInput>>({
    aircraftId: '',
    title: '',
    description: '',
    plannedStartDate: null,
    plannedEndDate: null,
    notes: '',
  });

  // Inventory check: fetch components for selected aircraft
  const { data: components = [], isLoading: loadingComponents } = useQuery({
    queryKey: ['components', form.aircraftId],
    queryFn: () => componentApi.findByAircraft(form.aircraftId!),
    enabled: !!form.aircraftId,
    staleTime: 5 * 60 * 1000,
  });

  // Derive inventory health: warn if components list is sparse
  const lowInventoryParts = components.filter(c => c.aircraftId !== null);
  const hasInventoryWarning = !!form.aircraftId && !loadingComponents && lowInventoryParts.length === 0;

  const mutation = useMutation({
    mutationFn: (input: CreateWorkOrderInput) => workOrdersApi.create(input),
    onSuccess: (wo) => {
      toast.success(`OT ${wo.number} creada`);
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear OT';
      toast.error(msg);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.aircraftId?.trim()) { toast.error('Selecciona una aeronave'); return; }
    if (!form.title?.trim())      { toast.error('El título es requerido');  return; }
    mutation.mutate({
      aircraftId:       form.aircraftId!,
      title:            form.title!,
      description:      form.description || null,
      plannedStartDate: form.plannedStartDate || null,
      plannedEndDate:   form.plannedEndDate   || null,
      notes:            form.notes           || null,
    });
  }

  function set(key: keyof CreateWorkOrderInput, value: unknown) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center">
              <ClipboardList size={16} className="text-brand-600" />
            </div>
            <h2 className="text-base font-bold text-slate-900">Nueva Orden de Trabajo</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Aircraft */}
          <div>
            <label className="form-label">Aeronave <span className="text-rose-500">*</span></label>
            <div className="relative">
              <select
                value={form.aircraftId}
                onChange={e => set('aircraftId', e.target.value)}
                className="filter-input w-full pr-8 appearance-none"
              >
                <option value="">Seleccionar aeronave…</option>
                {aircraft.map(a => (
                  <option key={a.id} value={a.id}>{a.registration} — {a.model}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Inventory alert */}
          {loadingComponents && form.aircraftId && (
            <div className="flex items-center gap-2 text-xs text-slate-400 -mt-1">
              <Loader2 size={12} className="animate-spin" /> Verificando inventario…
            </div>
          )}
          {hasInventoryWarning && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl -mt-1">
              <Package size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 leading-relaxed">
                <strong>Alerta de inventario:</strong> esta aeronave no tiene componentes registrados en el sistema.
                Verifica el stock de partes requeridas <em>antes de abrir la OT</em> para evitar retrasos.
                <a
                  href="/components"
                  className="ml-1 underline font-semibold hover:text-amber-900"
                  onClick={e => { e.preventDefault(); onClose(); window.location.href = '/components'; }}
                >
                  Ir a Inventario →
                </a>
              </div>
            </div>
          )}
          {!hasInventoryWarning && !loadingComponents && form.aircraftId && components.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 -mt-1">
              <Package size={12} className="text-emerald-500" />
              {components.length} componente{components.length !== 1 ? 's' : ''} registrado{components.length !== 1 ? 's' : ''} en inventario
            </div>
          )}

          {/* Title */}
          <div>
            <label className="form-label">Título <span className="text-rose-500">*</span></label>
            <input
              type="text"
              value={form.title ?? ''}
              onChange={e => set('title', e.target.value)}
              placeholder="Ej: Inspección de 200 horas"
              className="filter-input w-full"
            />
          </div>

          {/* Description */}
          <div>
            <label className="form-label">Descripción</label>
            <textarea
              value={form.description ?? ''}
              onChange={e => set('description', e.target.value)}
              rows={2}
              className="filter-input w-full resize-none"
              placeholder="Detalles adicionales…"
            />
          </div>

          {/* Planned dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Fecha inicio planificada</label>
              <input
                type="date"
                value={form.plannedStartDate ?? ''}
                onChange={e => set('plannedStartDate', e.target.value || null)}
                className="filter-input w-full"
              />
            </div>
            <div>
              <label className="form-label">Fecha fin planificada</label>
              <input
                type="date"
                value={form.plannedEndDate ?? ''}
                onChange={e => set('plannedEndDate', e.target.value || null)}
                className="filter-input w-full"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="form-label">Notas</label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="filter-input w-full resize-none"
              placeholder="Instrucciones especiales…"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-1.5">
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Crear OT
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function WorkOrdersListPage() {
  const user = useAuthStore(s => s.user);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<WorkOrderStatus | ''>(searchParams.get('status') as WorkOrderStatus | '' ?? '');
  const [filterAircraft, setFilterAircraft] = useState('');
  const [aircraftSearch, setAircraftSearch] = useState('');
  const [showAircraftDropdown, setShowAircraftDropdown] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Sync URL → filter when navigating here from Dashboard
  useEffect(() => {
    const s = searchParams.get('status') as WorkOrderStatus | '';
    if (s) setFilterStatus(s);
  }, [searchParams]);

  const { data: aircraft = [] } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
  });

  // Filter aircraft by search term
  const filteredAircraft = aircraftSearch
    ? aircraft.filter(a =>
        a.registration.toLowerCase().includes(aircraftSearch.toLowerCase()) ||
        a.model.toLowerCase().includes(aircraftSearch.toLowerCase())
      )
    : aircraft;

  const selectedAircraft = aircraft.find(a => a.id === filterAircraft);

  const { data: workOrders = [], isLoading } = useQuery({
    queryKey: ['work-orders', filterStatus, filterAircraft],
    queryFn: () =>
      workOrdersApi.list({
        status:     filterStatus   || undefined,
        aircraftId: filterAircraft || undefined,
      }),
  });

  const { data: workOrderStateMachine } = useWorkOrderStateMachine();

  if (!workOrderStateMachine) {
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando contrato de estado OT...
        </div>
      </div>
    );
  }

  const machine = ensureStateMachine(workOrderStateMachine, 'WorkOrdersListPage');

  const allStatuses = getOrderedStatuses(machine);

  // Client-side text search
  const filtered = search
    ? workOrders.filter(wo => {
        const q = search.toLowerCase();
        return (
          wo.number.toLowerCase().includes(q) ||
          wo.title.toLowerCase().includes(q)  ||
          wo.aircraft.registration.toLowerCase().includes(q)
        );
      })
    : workOrders;

  // Summary counts
  const counts = allStatuses.reduce((acc, s) => {
    acc[s] = workOrders.filter(w => w.status === s).length;
    return acc;
  }, {} as Record<WorkOrderStatus, number>);

  const canCreate = user?.role && ['ADMIN', 'SUPERVISOR'].includes(user.role);

  const canManage = user?.role && ['ADMIN', 'SUPERVISOR'].includes(user.role);

  const { data: pendingList = [] } = useQuery({
    queryKey: ['work-orders-pending-assignment'],
    queryFn: workOrdersApi.getPendingAssignment,
    enabled: !!canManage,
    refetchInterval: 60_000,
  });
  const pendingCount = pendingList.length;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <ClipboardList size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Órdenes de Trabajo</h1>
            <p className="text-sm text-slate-500">Gestión del ciclo de vida de OTs de mantenimiento</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} />
            Nueva OT
          </button>
        )}
      </div>

      {/* Selector de Aeronave Prominente */}
            {/* Pending Assignment Alert */}
            {canManage && pendingCount > 0 && (
              <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 text-amber-800">
                  <Bell size={16} className="shrink-0 text-amber-500" />
                  <span className="text-sm font-medium">
                    {pendingCount} Orden{pendingCount > 1 ? 'es' : ''} de Trabajo pendiente{pendingCount > 1 ? 's' : ''} de asignación
                  </span>
                </div>
                <button
                  onClick={() => setFilterStatus('OPEN')}
                  className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900 whitespace-nowrap"
                >
                  Ver OTs abiertas
                </button>
              </div>
            )}

      <div className="relative">
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700 mb-2">Filtrar por Aeronave</p>
              <div className="relative">
                <button
                  onClick={() => setShowAircraftDropdown(!showAircraftDropdown)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-inset"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedAircraft ? (
                      <>
                        <Plane size={14} className="text-slate-400 shrink-0" />
                        <div className="text-left min-w-0">
                          <p className="font-mono font-bold text-slate-800 text-sm">{selectedAircraft.registration}</p>
                          <p className="text-xs text-slate-400">{selectedAircraft.model}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <Plane size={14} className="text-slate-400" />
                        <span className="text-slate-500">Todas las aeronaves</span>
                      </>
                    )}
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${showAircraftDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown con búsqueda */}
                {showAircraftDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-20">
                    {/* Search input */}
                    <div className="p-3 border-b border-slate-100">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Buscar matrícula o modelo…"
                          value={aircraftSearch}
                          onChange={e => setAircraftSearch(e.target.value)}
                          autoFocus
                          className="filter-input pl-8 w-full"
                        />
                      </div>
                    </div>

                    {/* Aircraft list */}
                    <div className="max-h-64 overflow-y-auto">
                      {/* Opción "Todas" */}
                      <button
                        onClick={() => {
                          setFilterAircraft('');
                          setAircraftSearch('');
                          setShowAircraftDropdown(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors flex items-center gap-2 border-b border-slate-100 ${
                          !filterAircraft ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700'
                        }`}
                      >
                        <Plane size={12} className={!filterAircraft ? 'text-brand-600' : 'text-slate-400'} />
                        <span>Todas las aeronaves</span>
                      </button>

                      {/* Aircraft options */}
                      {filteredAircraft.length > 0 ? (
                        filteredAircraft.map(a => (
                          <button
                            key={a.id}
                            onClick={() => {
                              setFilterAircraft(a.id);
                              setAircraftSearch('');
                              setShowAircraftDropdown(false);
                            }}
                            className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors flex items-center gap-2 border-b border-slate-100 last:border-0 ${
                              filterAircraft === a.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700'
                            }`}
                          >
                            <Plane size={12} className={filterAircraft === a.id ? 'text-brand-600' : 'text-slate-400'} />
                            <div className="min-w-0">
                              <p className="font-mono font-bold text-sm">{a.registration}</p>
                              <p className="text-xs text-slate-400">{a.model}</p>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-center text-slate-400 text-sm">
                          No se encontraron aeronaves
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Close dropdown when clicking outside */}
      {showAircraftDropdown && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowAircraftDropdown(false)}
        />
      )}

      {/* Status summary cards */}
      <div className="grid grid-cols-5 gap-3">
        {allStatuses.map(s => {
          const Icon = STATUS_ICONS[s];
          const count = counts[s];
          const badgeClass = getStatusBadgeClass(machine, s);
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
              className={`rounded-xl border shadow-card p-4 flex items-center gap-3 text-left transition-all duration-100 ${
                filterStatus === s ? 'ring-2 ring-brand-500 border-transparent' : 'hover:border-slate-300'
              } bg-white`}
            >
              <div className={`p-2 rounded-lg text-xs ${badgeClass}`}>
                <Icon size={16} />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-slate-900">{count}</p>
                <p className="text-[11px] text-slate-500 font-medium leading-tight">{getStatusLabel(machine, s)}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar OT o título…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="filter-input pl-8 w-48"
          />
        </div>
        <div className="relative">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as WorkOrderStatus | '')}
            className="filter-input pr-8 appearance-none cursor-pointer"
          >
            <option value="">Todos los estados</option>
            {allStatuses.map(s => <option key={s} value={s}>{getStatusLabel(machine, s)}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        {(search || filterStatus || filterAircraft) && (
          <button
            onClick={() => { setSearch(''); setFilterStatus(''); setFilterAircraft(''); }}
            className="text-xs text-brand-600 hover:text-brand-700 font-semibold transition-colors"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {filtered.length} OT{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-header w-32">N° OT</th>
              <th className="table-header">Título</th>
              <th className="table-header">Estado</th>
              <th className="table-header">Técnico</th>
              <th className="table-header">Inspector</th>
              <th className="table-header text-center">Tareas</th>
              <th className="table-header text-center">Discrepancias</th>
              <th className="table-header">Inicio plan.</th>
              <th className="table-header">Fin plan.</th>
              <th className="table-header w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={10} className="table-cell text-center text-slate-400 py-12">
                  <Loader2 size={18} className="inline animate-spin mr-2" />
                  Cargando órdenes…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="table-cell text-center text-slate-400 py-12">
                  No hay órdenes de trabajo
                </td>
              </tr>
            )}
            {filtered.map(wo => {
              const Icon = STATUS_ICONS[wo.status];
              const completed = wo.tasks.filter(t => t.isCompleted).length;
              const total     = wo.tasks.length;
              const badgeClass = getStatusBadgeClass(machine, wo.status);
              return (
                <tr key={wo.id} className="hover:bg-slate-50 transition-colors">
                  <td className="table-cell font-mono font-bold text-slate-800 whitespace-nowrap">{wo.number}</td>
                  <td className="table-cell font-medium text-slate-700 max-w-xs truncate">{wo.title}</td>
                  <td className="table-cell">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
                      <Icon size={10} />
                      {getStatusLabel(machine, wo.status)}
                    </span>
                  </td>
                  <td className="table-cell text-xs text-slate-500">
                    {wo.assignedTechnician
                      ? <div className="flex items-center gap-1"><User size={11} />{wo.assignedTechnician.name}</div>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="table-cell text-xs text-slate-500">
                    {wo.inspector
                      ? <div className="flex items-center gap-1"><User size={11} />{wo.inspector.name}</div>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="table-cell text-center">
                    {total > 0
                      ? <span className={`text-xs font-semibold tabular-nums ${completed === total ? 'text-emerald-600' : 'text-amber-600'}`}>{completed}/{total}</span>
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="table-cell text-center">
                    {(wo._count?.discrepancies ?? wo.discrepancies?.length ?? 0) > 0
                      ? <span className="text-xs font-semibold text-rose-600 tabular-nums">{wo._count?.discrepancies ?? wo.discrepancies?.length}</span>
                      : <span className="text-slate-300 text-xs">0</span>}
                  </td>
                  <td className="table-cell text-xs text-slate-500">
                    {wo.plannedStartDate ? new Date(wo.plannedStartDate).toLocaleDateString('es-MX') : '—'}
                  </td>
                  <td className="table-cell text-xs text-slate-500">
                    {wo.plannedEndDate ? new Date(wo.plannedEndDate).toLocaleDateString('es-MX') : '—'}
                  </td>
                  <td className="table-cell">
                    <Link
                      to={`/work-orders/${wo.id}`}
                      className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors whitespace-nowrap"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateWorkOrderModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
