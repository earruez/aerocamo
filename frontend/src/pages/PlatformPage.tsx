import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Building2, ChevronDown, ChevronRight, Copy, Pencil, Plane, Plus, ShieldCheck, Trash2, Users as UsersIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  platformApi,
  type MaintenanceTaskModelGroup,
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

// ─── Eliminar empresa ───────────────────────────────────────────────────────
function DeleteOrganizationModal({ org, onClose }: { org: PlatformOrganization; onClose: () => void }) {
  const qc = useQueryClient();
  const [confirmText, setConfirmText] = useState('');

  const del = useMutation({
    mutationFn: () => platformApi.deleteOrganization(org.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-organizations'] });
      toast.success(`${org.name} fue eliminada.`);
      onClose();
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo eliminar la empresa');
    },
  });

  const canDelete = confirmText.trim() === org.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-bold text-rose-700">Eliminar empresa</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X size={15} className="text-slate-500" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Esto elimina <strong>{org.name}</strong> y <strong>toda su información de forma permanente</strong>: aeronaves,
            usuarios ({org.userCount}), cumplimientos, órdenes de trabajo e historial completo. No se puede deshacer.
          </p>
          <p className="text-sm text-slate-600">
            Si solo quieres bloquear el acceso, considera <strong>desactivar</strong> la empresa en vez de eliminarla.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Escribe <strong>{org.name}</strong> para confirmar
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="input text-sm"
              autoFocus
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button
            type="button"
            onClick={() => canDelete && del.mutate()}
            disabled={!canDelete || del.isPending}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
          >
            {del.isPending ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
      if (data.emailSent) {
        toast.success(`${form.name} creada. Le enviamos un correo de bienvenida al administrador.`);
      } else {
        toast.success(`${form.name} creada.`, { duration: 6000 });
        toast.error('No se pudo enviar el correo de bienvenida — comunícale la contraseña manualmente.', { duration: 8000 });
      }
      onClose();
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
    onSuccess: (data) => {
      invalidate();
      setAdding(false);
      setForm({ name: '', email: '', password: '', role: 'TECHNICIAN' });
      if (data.emailSent) {
        toast.success('Usuario agregado. Le enviamos un correo de bienvenida.');
      } else {
        toast.success('Usuario agregado.', { duration: 6000 });
        toast.error('No se pudo enviar el correo de bienvenida — comunícale la contraseña manualmente.', { duration: 8000 });
      }
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

// ─── Copiar biblioteca de mantenimiento ────────────────────────────────────────
function CopyLibraryModal({
  targetOrg, orgs, onClose,
}: { targetOrg: PlatformOrganization; orgs: PlatformOrganization[]; onClose: () => void }) {
  const qc = useQueryClient();
  const sourceOptions = orgs.filter((o) => o.id !== targetOrg.id);
  const [sourceOrgId, setSourceOrgId] = useState(sourceOptions[0]?.id ?? '');
  const [selectedModels, setSelectedModels] = useState<Set<string | null>>(new Set());

  const { data: modelGroups = [], isLoading } = useQuery({
    queryKey: ['platform-org-task-models', sourceOrgId],
    queryFn: () => platformApi.listMaintenanceTaskModels(sourceOrgId),
    enabled: !!sourceOrgId,
  });

  const toggle = (model: string | null) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model); else next.add(model);
      return next;
    });
  };

  const selectedCount = modelGroups
    .filter((g) => selectedModels.has(g.applicableModel))
    .reduce((sum, g) => sum + g.taskCount, 0);

  const copy = useMutation({
    mutationFn: () => platformApi.copyMaintenanceTasks(targetOrg.id, {
      sourceOrganizationId: sourceOrgId,
      applicableModels: [...selectedModels],
    }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['platform-org-task-models', targetOrg.id] });
      if (result.copied > 0) {
        toast.success(`${result.copied} tarea(s) copiada(s) a ${targetOrg.name}.`);
      }
      if (result.skipped.length > 0) {
        toast.error(`${result.skipped.length} tarea(s) ya existían en ${targetOrg.name} (mismo código) y no se copiaron.`, { duration: 8000 });
      }
      if (result.copied > 0) onClose();
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(detail ?? 'No se pudo copiar la biblioteca');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Copiar biblioteca a {targetOrg.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Copia independiente — cada empresa puede editarla después sin afectar a la otra.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 shrink-0">
            <X size={15} className="text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Copiar desde</label>
            <select
              value={sourceOrgId}
              onChange={(e) => { setSourceOrgId(e.target.value); setSelectedModels(new Set()); }}
              className="input text-sm"
            >
              {sourceOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-slate-500">
            Elige qué modelos de aeronave copiar (según cómo están etiquetadas las tareas de origen — modelos con distinta escritura del mismo avión aparecen por separado).
          </p>

          {isLoading && <p className="text-xs text-slate-400">Cargando biblioteca…</p>}
          {!isLoading && modelGroups.length === 0 && (
            <p className="text-xs text-slate-400">Esa empresa no tiene tareas en su biblioteca.</p>
          )}
          {!isLoading && modelGroups.length > 0 && (
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {modelGroups.map((g) => (
                <label key={g.applicableModel ?? '__null__'} className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedModels.has(g.applicableModel)}
                    onChange={() => toggle(g.applicableModel)}
                    className="rounded border-slate-300"
                  />
                  <span className="flex-1">
                    <span className="font-medium text-slate-800">{g.applicableModel ?? 'Sin modelo específico'}</span>
                    <span className="text-xs text-slate-400 ml-2">{g.taskCount} tareas</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button
            type="button"
            onClick={() => selectedModels.size > 0 && copy.mutate()}
            disabled={selectedModels.size === 0 || copy.isPending}
            className="btn-primary text-sm disabled:opacity-40"
          >
            {copy.isPending ? 'Copiando…' : `Copiar ${selectedCount > 0 ? `(${selectedCount} tareas)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrganizationLibrary({ org, orgs }: { org: PlatformOrganization; orgs: PlatformOrganization[] }) {
  const [showCopy, setShowCopy] = useState(false);

  const { data: modelGroups = [], isLoading } = useQuery<MaintenanceTaskModelGroup[]>({
    queryKey: ['platform-org-task-models', org.id],
    queryFn: () => platformApi.listMaintenanceTaskModels(org.id),
  });

  const totalTasks = modelGroups.reduce((sum, g) => sum + g.taskCount, 0);

  return (
    <div className="bg-slate-50/70 px-5 py-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Biblioteca de mantenimiento {totalTasks > 0 && `(${totalTasks} tareas)`}
        </p>
        <button onClick={() => setShowCopy(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline">
          <Copy size={11} /> Copiar desde otra empresa
        </button>
      </div>

      {isLoading ? (
        <p className="text-[11px] text-slate-400">Cargando…</p>
      ) : modelGroups.length === 0 ? (
        <p className="text-[11px] text-slate-400">Sin tareas propias en la biblioteca.</p>
      ) : (
        <ul className="space-y-1">
          {modelGroups.map((g) => (
            <li key={g.applicableModel ?? '__null__'} className="flex items-center gap-2 text-xs text-slate-600 bg-white rounded-lg px-3 py-1.5 border border-slate-100">
              <BookOpen size={12} className="text-slate-400 shrink-0" />
              <span className="font-medium text-slate-800">{g.applicableModel ?? 'Sin modelo específico'}</span>
              <span className="ml-auto text-slate-400">{g.taskCount} tareas</span>
            </li>
          ))}
        </ul>
      )}

      {showCopy && <CopyLibraryModal targetOrg={org} orgs={orgs} onClose={() => setShowCopy(false)} />}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function PlatformPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingOrg, setDeletingOrg] = useState<PlatformOrganization | null>(null);

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
        <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
              <tr>
                <th className="text-left px-5 py-2.5 text-xs font-semibold">Empresa</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Plan</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold">Suscripción</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold">Estado</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className="px-5 py-4 text-slate-400 text-xs" colSpan={5}>Cargando…</td></tr>}
              {!isLoading && orgs.length === 0 && (
                <tr><td className="px-5 py-4 text-slate-400 text-xs" colSpan={5}>Sin empresas registradas.</td></tr>
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
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        o.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {o.isActive ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => toggleOrgActive.mutate({ id: o.id, isActive: !o.isActive })}
                          disabled={toggleOrgActive.isPending}
                          title={o.isActive ? 'Desactivar empresa' : 'Activar empresa'}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ShieldCheck size={14} />
                        </button>
                        <button
                          onClick={() => setDeletingOrg(o)}
                          title="Eliminar empresa"
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === o.id && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <OrganizationUsers orgId={o.id} />
                        <OrganizationLibrary org={o} orgs={orgs} />
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
      {deletingOrg && <DeleteOrganizationModal org={deletingOrg} onClose={() => setDeletingOrg(null)} />}
    </div>
  );
}
