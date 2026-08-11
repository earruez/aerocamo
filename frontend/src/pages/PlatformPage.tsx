import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronRight, Pencil, Plane, Plus, ShieldCheck, Trash2, Users as UsersIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  platformApi,
  type PlatformOrganization,
  type PlatformUser,
} from '@api/platform.api';

const PLAN_LABEL: Record<PlatformOrganization['subscriptionPlan'], string> = {
  FREE: 'Gratis', PROFESSIONAL: 'Profesional', ENTERPRISE: 'Empresarial',
};
const STATUS_LABEL: Record<PlatformOrganization['subscriptionStatus'], string> = {
  ACTIVE: 'Activa', TRIALING: 'En prueba', PAST_DUE: 'Pago pendiente', CANCELLED: 'Cancelada', SUSPENDED: 'Suspendida',
};
const STATUS_TONE: Record<PlatformOrganization['subscriptionStatus'], string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700', TRIALING: 'bg-sky-50 text-sky-700',
  PAST_DUE: 'bg-amber-50 text-amber-700', CANCELLED: 'bg-slate-100 text-slate-600', SUSPENDED: 'bg-rose-50 text-rose-700',
};
const ROLE_LABEL: Record<PlatformUser['role'], string> = {
  ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', TECHNICIAN: 'Técnico', INSPECTOR: 'Inspector', READONLY: 'Solo lectura',
};

// ─── Nueva empresa ──────────────────────────────────────────────────────────
function NewOrganizationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', legalName: '', country: 'CL',
    subscriptionPlan: 'FREE' as PlatformOrganization['subscriptionPlan'],
    adminName: '', adminEmail: '', adminPassword: '',
  });

  const create = useMutation({
    mutationFn: () => platformApi.createOrganization({
      name: form.name.trim(),
      legalName: form.legalName.trim() || null,
      country: form.country.trim().toUpperCase(),
      subscriptionPlan: form.subscriptionPlan,
      admin: { name: form.adminName.trim(), email: form.adminEmail.trim(), password: form.adminPassword },
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['platform-organizations'] });
      toast.success(`${form.name} creada. El administrador ya puede ingresar.`);
      onClose();
      void data;
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo crear la empresa');
    },
  });

  const canSubmit = form.name.trim() && form.country.trim().length === 2
    && form.adminName.trim() && form.adminEmail.trim() && form.adminPassword.length >= 8;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-bold text-slate-900">Nueva empresa</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X size={15} className="text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Nombre de la empresa <span className="text-rose-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input text-sm"
                placeholder="Helicópteros del Sur SPA"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">País (ISO-2)</label>
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                className="input text-sm"
                placeholder="CL"
                maxLength={2}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Razón social</label>
            <input
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              className="input text-sm"
              placeholder="Opcional"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Plan</label>
            <select
              value={form.subscriptionPlan}
              onChange={(e) => setForm({ ...form, subscriptionPlan: e.target.value as PlatformOrganization['subscriptionPlan'] })}
              className="input text-sm"
            >
              {(Object.keys(PLAN_LABEL) as PlatformOrganization['subscriptionPlan'][]).map((p) => (
                <option key={p} value={p}>{PLAN_LABEL[p]}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">Primer usuario (queda como Administrador)</p>
            <div className="space-y-3">
              <input
                value={form.adminName}
                onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                className="input text-sm"
                placeholder="Nombre completo"
              />
              <input
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                className="input text-sm"
                placeholder="correo@empresa.cl"
                type="email"
              />
              <input
                value={form.adminPassword}
                onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                className="input text-sm"
                placeholder="Contraseña inicial (mínimo 8 caracteres)"
                type="text"
              />
              <p className="text-[11px] text-slate-500">
                Compártela con la empresa por un canal que no sea este chat de soporte.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3.5">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary" disabled={create.isPending || !canSubmit}>
            {create.isPending ? 'Creando…' : 'Crear empresa'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Fila de usuario, con edición inline ───────────────────────────────────
function UserRow({ user, invalidate }: { user: PlatformUser; invalidate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user.name, email: user.email, role: user.role, password: '' });

  const toggle = useMutation({
    mutationFn: ({ isActive }: { isActive: boolean }) => platformApi.updateUser(user.id, { isActive }),
    onSuccess: invalidate,
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo cambiar el estado');
    },
  });

  const save = useMutation({
    mutationFn: () => platformApi.updateUser(user.id, {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
    }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
      toast.success('Usuario actualizado');
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo actualizar el usuario');
    },
  });

  const remove = useMutation({
    mutationFn: () => platformApi.deleteUser(user.id),
    onSuccess: () => {
      invalidate();
      toast.success('Usuario eliminado');
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo eliminar el usuario');
    },
  });

  if (editing) {
    return (
      <li className="rounded-lg bg-white border border-brand-200 px-3 py-2">
        <form
          onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && form.email.trim()) save.mutate(); }}
          className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center"
        >
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input text-xs" placeholder="Nombre" autoFocus />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input text-xs" placeholder="Correo" type="email" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PlatformUser['role'] })} className="input text-xs">
            {(Object.keys(ROLE_LABEL) as PlatformUser['role'][]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="input text-xs"
            placeholder="Nueva contraseña (opcional)"
          />
          <span className="flex gap-1">
            <button
              type="submit"
              className="flex-1 inline-flex items-center justify-center rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
              disabled={save.isPending}
            >
              {save.isPending ? '…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              ✕
            </button>
          </span>
        </form>
      </li>
    );
  }

  return (
    <li className={`flex items-center justify-between gap-2 rounded-lg bg-white border border-slate-200 px-3 py-1.5 ${user.isActive ? '' : 'opacity-55'}`}>
      <span className="min-w-0 flex-1 text-xs">
        <span className="font-semibold text-slate-800">{user.name}</span>
        <span className="text-slate-500"> · {ROLE_LABEL[user.role]}</span>
        <span className="ml-2 text-slate-500">{user.email}</span>
      </span>
      <span className="shrink-0 flex items-center gap-1.5">
        <button
          onClick={() => toggle.mutate({ isActive: !user.isActive })}
          disabled={toggle.isPending}
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            user.isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {user.isActive ? 'Activo' : 'Inactivo'}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded-md text-slate-400 hover:text-brand-700 hover:bg-brand-50"
          title="Editar usuario"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={() => { if (window.confirm(`¿Eliminar a ${user.name}? Esta acción no se puede deshacer.`)) remove.mutate(); }}
          disabled={remove.isPending}
          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
          title="Eliminar usuario"
        >
          <Trash2 size={12} />
        </button>
      </span>
    </li>
  );
}

// ─── Usuarios de una empresa ────────────────────────────────────────────────
function OrganizationUsers({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'TECHNICIAN' as PlatformUser['role'] });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['platform-org-users', orgId],
    queryFn: () => platformApi.listOrganizationUsers(orgId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['platform-org-users', orgId] });
    qc.invalidateQueries({ queryKey: ['platform-organizations'] });
  };

  const create = useMutation({
    mutationFn: () => platformApi.createUser(orgId, { ...form, name: form.name.trim(), email: form.email.trim() }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setForm({ name: '', email: '', password: '', role: 'TECHNICIAN' });
      toast.success('Usuario agregado');
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo agregar el usuario');
    },
  });

  const canSubmit = form.name.trim() && form.email.trim() && form.password.length >= 8;

  return (
    <div className="bg-slate-50/70 px-5 py-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Usuarios {users.length > 0 && `(${users.length})`}
        </p>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-[11px] font-semibold text-brand-700 hover:underline">
            + Agregar usuario
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}
          className="mb-3 grid grid-cols-1 sm:grid-cols-5 gap-2"
        >
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input text-xs" placeholder="Nombre" autoFocus />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input text-xs" placeholder="Correo" type="email" />
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input text-xs" placeholder="Contraseña" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PlatformUser['role'] })} className="input text-xs">
            {(Object.keys(ROLE_LABEL) as PlatformUser['role'][]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <span className="flex gap-1">
            <button
              type="submit"
              className="flex-1 inline-flex items-center justify-center rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
              disabled={create.isPending || !canSubmit}
            >
              {create.isPending ? '…' : 'Agregar'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              ✕
            </button>
          </span>
        </form>
      )}

      {isLoading ? (
        <p className="text-[11px] text-slate-400">Cargando…</p>
      ) : users.length === 0 ? (
        <p className="text-[11px] text-slate-400">Sin usuarios registrados.</p>
      ) : (
        <ul className="space-y-1">
          {users.map((u) => (
            <UserRow key={u.id} user={u} invalidate={invalidate} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function PlatformPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: platformApi.listOrganizations,
  });

  const toggleOrgActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformApi.updateOrganization(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-organizations'] }),
    onError: () => toast.error('No se pudo cambiar el estado de la empresa'),
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
            <ShieldCheck size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Plataforma</h1>
            <p className="text-sm text-slate-500">Empresas dadas de alta en Aerocamo y sus usuarios</p>
          </div>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-1.5">
          <Plus size={15} /> Nueva empresa
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Building2 size={14} className="text-slate-400" /> {orgs.length} empresas
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-5 py-2.5 text-xs font-semibold">Empresa</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Plan</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Suscripción</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold">Activa</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className="px-5 py-4 text-slate-400 text-xs" colSpan={4}>Cargando…</td></tr>}
              {!isLoading && orgs.length === 0 && (
                <tr><td className="px-5 py-4 text-slate-400 text-xs" colSpan={4}>Sin empresas registradas.</td></tr>
              )}
              {orgs.map((o) => (
                <Fragment key={o.id}>
                  <tr className={`border-t border-slate-100 ${o.isActive ? '' : 'opacity-55'}`}>
                    <td className="px-5 py-2.5">
                      <button
                        onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                        className="inline-flex items-center gap-1 font-medium text-slate-800 hover:text-brand-700"
                      >
                        {expandedId === o.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        {o.name}
                      </button>
                      <div className="pl-[18px] flex items-center gap-2.5 text-[11px] text-slate-400">
                        <span>{o.slug}</span>
                        <span>·</span>
                        <span>{o.country}</span>
                        <span className="inline-flex items-center gap-0.5"><UsersIcon size={10} /> {o.userCount}</span>
                        <span className="inline-flex items-center gap-0.5"><Plane size={10} /> {o.aircraftCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{PLAN_LABEL[o.subscriptionPlan]}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[o.subscriptionStatus]}`}>
                        {STATUS_LABEL[o.subscriptionStatus]}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        onClick={() => toggleOrgActive.mutate({ id: o.id, isActive: !o.isActive })}
                        disabled={toggleOrgActive.isPending}
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          o.isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {o.isActive ? 'Activa' : 'Inactiva'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === o.id && (
                    <tr>
                      <td colSpan={4} className="p-0">
                        <OrganizationUsers orgId={o.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && <NewOrganizationModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
