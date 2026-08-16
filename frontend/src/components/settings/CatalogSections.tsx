import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Wrench, Plus, Pencil, Trash2, X, ChevronDown, ChevronRight, Mail, Gauge } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  catalogsApi,
  type MaintenanceManual,
  type ManualKind,
  type RepairShop,
  type RepairShopContact,
  type CounterType,
} from '@api/catalogs.api';
import { useAuthStore } from '../../store/authStore';

const KIND_LABEL: Record<ManualKind, string> = {
  AIRCRAFT: 'Aeronave',
  ENGINE: 'Motor',
  COMPONENT: 'Componente',
  OTHER: 'Otro',
};

function CatalogShell({
  icon: Icon, title, hint, canEdit, onAdd, addLabel, children,
}: {
  icon: typeof BookOpen;
  title: string;
  hint: string;
  canEdit: boolean;
  onAdd: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-start gap-2.5">
          <Icon size={16} className="text-brand-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={onAdd} className="btn-secondary btn-sm flex items-center gap-1 shrink-0">
            <Plus size={13} /> {addLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function RowActions({ onEdit, onRemove, busy }: { onEdit: () => void; onRemove: () => void; busy: boolean }) {
  return (
    <span className="flex justify-end gap-0.5">
      <button onClick={onEdit} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Editar">
        <Pencil size={13} className="text-slate-500" />
      </button>
      <button onClick={onRemove} disabled={busy} className="p-1.5 hover:bg-rose-50 rounded-lg" title="Eliminar">
        <Trash2 size={13} className="text-rose-500" />
      </button>
    </span>
  );
}


// ─── Contactos de un taller ───────────────────────────────────────────────────
// Es a esta persona a quien se envía la Solicitud de Trabajo.
function ShopContacts({ shopId, canEdit }: { shopId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '' });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['shop-contacts', shopId],
    queryFn: () => catalogsApi.listContacts(shopId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['shop-contacts', shopId] });
  const close = () => { setAdding(false); setEditingId(null); setForm({ name: '', role: '', email: '', phone: '' }); };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      };
      return editingId ? catalogsApi.updateContact(editingId, payload) : catalogsApi.createContact(shopId, payload);
    },
    onSuccess: () => { invalidate(); close(); toast.success(editingId ? 'Contacto actualizado' : 'Contacto agregado'); },
    onError: () => toast.error('No se pudo guardar el contacto. Revisa el correo.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogsApi.removeContact(id),
    onSuccess: () => { invalidate(); toast.success('Contacto eliminado'); },
    onError: () => toast.error('No se pudo eliminar el contacto'),
  });

  const openEdit = (c: RepairShopContact) => {
    setEditingId(c.id);
    setAdding(false);
    setForm({ name: c.name, role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '' });
  };

  return (
    <div className="bg-slate-50/70 px-5 py-3 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Contactos {contacts.length > 0 && `(${contacts.length})`}
        </p>
        {canEdit && !adding && !editingId && (
          <button onClick={() => setAdding(true)} className="text-[11px] font-semibold text-brand-700 hover:underline">
            + Agregar contacto
          </button>
        )}
      </div>

      {(adding || editingId) && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) save.mutate(); }}
          className="mb-3 grid grid-cols-1 sm:grid-cols-4 gap-2"
        >
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input text-xs" placeholder="Nombre" autoFocus />
          <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input text-xs" placeholder="Cargo" />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input text-xs" placeholder="Correo" type="email" />
          <div className="flex gap-1.5">
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input text-xs flex-1" placeholder="Teléfono" />
            <button type="submit" className="btn-primary btn-xs shrink-0" disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? '…' : 'OK'}
            </button>
            <button type="button" onClick={close} className="btn-secondary btn-xs shrink-0">✕</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-[11px] text-slate-400">Cargando…</p>
      ) : contacts.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          Sin contactos. Agrega al menos uno para poder enviarle la Solicitud de Trabajo.
        </p>
      ) : (
        <ul className="space-y-1">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-slate-200 px-3 py-1.5">
              <span className="min-w-0 flex-1 text-xs">
                <span className="font-semibold text-slate-800">{c.name}</span>
                {c.role && <span className="text-slate-500"> · {c.role}</span>}
                {c.email ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-slate-600">
                    <Mail size={11} /> {c.email}
                  </span>
                ) : (
                  <span className="ml-2 text-amber-700">sin correo — solo envío manual</span>
                )}
                {c.phone && <span className="ml-2 text-slate-500">{c.phone}</span>}
              </span>
              {canEdit && (
                <RowActions onEdit={() => openEdit(c)} onRemove={() => remove.mutate(c.id)} busy={remove.isPending} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


const SCOPE_LABEL: Record<string, string> = {
  AIRCRAFT: 'Aeronave',
  ENGINE: 'Motor',
  BOTH: 'Ambos',
};

// ─── Contadores ───────────────────────────────────────────────────────────────
export function CounterTypesSection() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'ADMIN' || role === 'SUPERVISOR';

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', unit: 'ciclos', scope: 'BOTH' as CounterType['scope'] });

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['catalog-counter-types'],
    queryFn: catalogsApi.listCounterTypes,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['catalog-counter-types'] });
  const close = () => { setAdding(false); setEditingId(null); setForm({ code: '', name: '', unit: 'ciclos', scope: 'BOTH' }); };

  const save = useMutation({
    mutationFn: () => editingId
      ? catalogsApi.updateCounterType(editingId, { name: form.name.trim(), unit: form.unit.trim() })
      : catalogsApi.createCounterType({ ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() }),
    onSuccess: () => { invalidate(); close(); toast.success(editingId ? 'Contador actualizado' : 'Contador agregado'); },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo guardar el contador');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogsApi.removeCounterType(id),
    onSuccess: () => { invalidate(); toast.success('Contador eliminado'); },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo eliminar el contador', { duration: 6000 });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => catalogsApi.updateCounterType(id, { isActive }),
    onSuccess: () => invalidate(),
    onError: () => toast.error('No se pudo cambiar el estado'),
  });

  return (
    <CatalogShell
      icon={Gauge}
      title="Contadores"
      hint="Lo que mide el avance de cada aeronave y motor. Son los que gobiernan los vencimientos del plan."
      canEdit={canEdit}
      onAdd={() => { setAdding(true); setEditingId(null); setForm({ code: '', name: '', unit: 'ciclos', scope: 'BOTH' }); }}
      addLabel="Agregar contador"
    >
      {(adding || editingId) && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && (editingId || form.code.trim())) save.mutate(); }}
          className="border-b border-slate-100 bg-slate-50 px-5 py-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="input text-sm"
              placeholder="Código (CTL)"
              disabled={!!editingId}
              autoFocus={!editingId}
            />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input text-sm" placeholder="Nombre" />
            <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="input text-sm" placeholder="Unidad" />
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as CounterType['scope'] })}
              className="input text-sm"
              disabled={!!editingId}
            >
              <option value="AIRCRAFT">Aeronave</option>
              <option value="ENGINE">Motor</option>
              <option value="BOTH">Ambos</option>
            </select>
          </div>
          {editingId && (
            <p className="text-[11px] text-slate-500">El código y el alcance no se cambian: los límites ya registrados dependen de ellos.</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary btn-sm">Cancelar</button>
            <button type="submit" className="btn-primary btn-sm" disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? 'Guardando…' : editingId ? 'Guardar' : 'Agregar'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-auto max-h-[60vh]">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
            <tr>
              <th className="text-left px-5 py-2 text-xs font-semibold">Código</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Nombre</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Unidad</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Aplica a</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Ranura</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Estado</th>
              {canEdit && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-5 py-3 text-slate-400 text-xs" colSpan={7}>Cargando…</td></tr>}
            {types.map((t) => (
              <tr key={t.id} className={`border-t border-slate-100 ${t.isActive ? '' : 'opacity-55'}`}>
                <td className="px-5 py-2.5 font-mono text-xs font-semibold text-slate-800">{t.code}</td>
                <td className="px-4 py-2.5 text-slate-700">{t.name}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{t.unit}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{SCOPE_LABEL[t.scope] ?? t.scope}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {t.slot ? `${t.slot}ª` : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => canEdit && toggle.mutate({ id: t.id, isActive: !t.isActive })}
                    disabled={!canEdit}
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      t.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {t.isActive ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <RowActions
                      onEdit={() => { setEditingId(t.id); setAdding(false); setForm({ code: t.code, name: t.name, unit: t.unit, scope: t.scope }); }}
                      onRemove={() => remove.mutate(t.id)}
                      busy={remove.isPending}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CatalogShell>
  );
}

// ─── Manuales de referencia ───────────────────────────────────────────────────
export function ManualsSection() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'ADMIN' || role === 'SUPERVISOR';

  const [editing, setEditing] = useState<MaintenanceManual | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ model: '', reference: '', kind: 'ENGINE' as ManualKind });

  const { data: manuals = [], isLoading } = useQuery({
    queryKey: ['catalog-manuals'],
    queryFn: catalogsApi.listManuals,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['catalog-manuals'] });
  const close = () => { setAdding(false); setEditing(null); setForm({ model: '', reference: '', kind: 'ENGINE' }); };

  const save = useMutation({
    mutationFn: () => editing
      ? catalogsApi.updateManual(editing.id, { ...form, notes: null })
      : catalogsApi.createManual({ ...form, notes: null }),
    onSuccess: () => { invalidate(); close(); toast.success(editing ? 'Manual actualizado' : 'Manual agregado'); },
    onError: () => toast.error('No se pudo guardar el manual'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogsApi.removeManual(id),
    onSuccess: () => { invalidate(); toast.success('Manual eliminado'); },
    onError: () => toast.error('No se pudo eliminar el manual'),
  });

  const openEdit = (m: MaintenanceManual) => {
    setEditing(m);
    setAdding(false);
    setForm({ model: m.model, reference: m.reference, kind: m.kind });
  };

  return (
    <CatalogShell
      icon={BookOpen}
      title="Manuales de referencia"
      hint="Documento vigente por modelo, con su revisión. Es el que se cita al cerrar una orden de trabajo."
      canEdit={canEdit}
      onAdd={() => { setAdding(true); setEditing(null); setForm({ model: '', reference: '', kind: 'ENGINE' }); }}
      addLabel="Agregar manual"
    >
      {(adding || editing) && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (form.model.trim() && form.reference.trim()) save.mutate(); }}
          className="border-b border-slate-100 bg-slate-50 px-5 py-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="input text-sm"
              placeholder="Modelo (ARRIEL 2B1)"
              autoFocus
            />
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as ManualKind })}
              className="input text-sm"
            >
              {(Object.keys(KIND_LABEL) as ManualKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
            <input
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              className="input text-sm sm:col-span-1"
              placeholder="MM ARRIEL 2B1 Update No. 51: 15-JUN-2024"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary btn-sm">Cancelar</button>
            <button type="submit" className="btn-primary btn-sm" disabled={save.isPending || !form.model.trim() || !form.reference.trim()}>
              {save.isPending ? 'Guardando…' : editing ? 'Guardar' : 'Agregar'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-auto max-h-[60vh]">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
            <tr>
              <th className="text-left px-5 py-2 text-xs font-semibold">Modelo</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Tipo</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Documento y revisión</th>
              {canEdit && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-5 py-3 text-slate-400 text-xs" colSpan={4}>Cargando…</td></tr>}
            {!isLoading && manuals.length === 0 && (
              <tr><td className="px-5 py-3 text-slate-400 text-xs" colSpan={4}>Sin manuales registrados.</td></tr>
            )}
            {manuals.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-5 py-2.5 font-medium text-slate-800">{m.model}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{KIND_LABEL[m.kind]}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{m.reference}</td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <RowActions onEdit={() => openEdit(m)} onRemove={() => remove.mutate(m.id)} busy={remove.isPending} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CatalogShell>
  );
}

// ─── Talleres (CMA) ───────────────────────────────────────────────────────────
export function RepairShopsSection() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'ADMIN' || role === 'SUPERVISOR';

  const [editing, setEditing] = useState<RepairShop | null>(null);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', country: '' });

  const { data: shops = [], isLoading } = useQuery({
    queryKey: ['catalog-shops'],
    queryFn: catalogsApi.listShops,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['catalog-shops'] });
  const close = () => { setAdding(false); setEditing(null); setForm({ code: '', name: '', country: '' }); };

  const save = useMutation({
    mutationFn: () => {
      const payload = { code: form.code.trim() || null, name: form.name.trim(), country: form.country.trim() || null, notes: null, isActive: true };
      return editing ? catalogsApi.updateShop(editing.id, payload) : catalogsApi.createShop(payload);
    },
    onSuccess: () => { invalidate(); close(); toast.success(editing ? 'Taller actualizado' : 'Taller agregado'); },
    onError: () => toast.error('No se pudo guardar el taller'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogsApi.removeShop(id),
    onSuccess: () => { invalidate(); toast.success('Taller eliminado'); },
    onError: () => toast.error('No se pudo eliminar el taller'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => catalogsApi.updateShop(id, { isActive }),
    onSuccess: () => invalidate(),
    onError: () => toast.error('No se pudo cambiar el estado'),
  });

  const openEdit = (s: RepairShop) => {
    setEditing(s);
    setAdding(false);
    setForm({ code: s.code ?? '', name: s.name, country: s.country ?? '' });
  };

  return (
    <CatalogShell
      icon={Wrench}
      title="Talleres (CMA)"
      hint="Centros de mantenimiento que ejecutan trabajo. El código CMA puede quedar vacío en talleres extranjeros."
      canEdit={canEdit}
      onAdd={() => { setAdding(true); setEditing(null); setForm({ code: '', name: '', country: '' }); }}
      addLabel="Agregar taller"
    >
      {(adding || editing) && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) save.mutate(); }}
          className="border-b border-slate-100 bg-slate-50 px-5 py-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input text-sm" placeholder="CMA 492 (opcional)" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input text-sm" placeholder="Nombre del taller" autoFocus />
            <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className="input text-sm" placeholder="País (opcional)" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary btn-sm">Cancelar</button>
            <button type="submit" className="btn-primary btn-sm" disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? 'Guardando…' : editing ? 'Guardar' : 'Agregar'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-auto max-h-[60vh]">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
            <tr>
              <th className="text-left px-5 py-2 text-xs font-semibold">Código</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Taller</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">País</th>
              <th className="text-left px-4 py-2 text-xs font-semibold">Estado</th>
              {canEdit && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-5 py-3 text-slate-400 text-xs" colSpan={5}>Cargando…</td></tr>}
            {!isLoading && shops.length === 0 && (
              <tr><td className="px-5 py-3 text-slate-400 text-xs" colSpan={5}>Sin talleres registrados.</td></tr>
            )}
            {shops.map((s) => (
              <Fragment key={s.id}>
              <tr className={`border-t border-slate-100 ${s.isActive ? '' : 'opacity-55'}`}>
                <td className="px-5 py-2.5 font-mono text-xs text-slate-600">{s.code ?? '—'}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">
                  <button
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    className="inline-flex items-center gap-1 hover:text-brand-700"
                    title="Ver contactos"
                  >
                    {expandedId === s.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {s.name}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{s.country ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => canEdit && toggleActive.mutate({ id: s.id, isActive: !s.isActive })}
                    disabled={!canEdit}
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    } ${canEdit ? 'hover:opacity-80' : ''}`}
                  >
                    {s.isActive ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <RowActions onEdit={() => openEdit(s)} onRemove={() => remove.mutate(s.id)} busy={remove.isPending} />
                  </td>
                )}
              </tr>
              {expandedId === s.id && (
                <tr>
                  <td colSpan={canEdit ? 5 : 4} className="p-0">
                    <ShopContacts shopId={s.id} canEdit={canEdit} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </CatalogShell>
  );
}
