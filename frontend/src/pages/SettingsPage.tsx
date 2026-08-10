import { useAuthStore } from '@store/authStore';
import { User, Shield, Bell, Palette, Info } from 'lucide-react';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900 font-mono">{value}</span>
    </div>
  );
}

import { CounterTypesSection, ManualsSection, RepairShopsSection } from '../components/settings/CatalogSections';

export default function SettingsPage() {
  const user = useAuthStore(s => s.user);

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
          <Palette size={18} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
          <p className="text-sm text-slate-500">Preferencias de la cuenta y del sistema</p>
        </div>
      </div>

      {/* Perfil */}
      <Section title="Perfil de usuario">
        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
            <User size={22} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">{user?.name}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>
        <Field label="Rol" value={user?.role ?? '—'} />
        <Field label="ID de Organización" value={user?.organizationId ?? '—'} />
      </Section>

      <CounterTypesSection />
      <ManualsSection />
      <RepairShopsSection />

      {/* Seguridad */}
      <Section title="Seguridad">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-brand-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">Contraseña</p>
            <p className="text-xs text-slate-500 mt-0.5">Para cambiar tu contraseña contacta al administrador del sistema.</p>
          </div>
        </div>
      </Section>

      {/* Notificaciones */}
      <Section title="Notificaciones">
        <div className="flex items-start gap-3">
          <Bell size={18} className="text-brand-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">Alertas de vencimiento</p>
            <p className="text-xs text-slate-500 mt-0.5">
              El sistema alerta automáticamente sobre tareas vencidas (AOG y críticas) en el Dashboard.
            </p>
          </div>
        </div>
      </Section>

      {/* Apariencia */}
      <Section title="Apariencia">
        <div className="flex items-start gap-3">
          <Palette size={18} className="text-brand-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">Tema</p>
            <div className="flex gap-2 mt-2">
              <button className="px-4 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold">Claro</button>
              <button className="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-400 text-xs font-medium opacity-50 cursor-not-allowed" disabled>
                Oscuro (próximamente)
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Versión */}
      <Section title="Acerca de">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-brand-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-slate-800">Griselle · Gestión de Mantenimiento Aeronáutico</p>
            <p className="text-xs text-slate-500 mt-0.5">Versión 1.0.0 · Plataforma SaaS</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
