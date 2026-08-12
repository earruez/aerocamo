import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { authApi } from '@api/auth.api';
import { useAuthStore } from '@store/authStore';
import { Lock, Mail, Building2 } from 'lucide-react';
import AerocamoMark from '@components/AerocamoMark';

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', organization: '' });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await authApi.login({ email: form.email, password: form.password, organizationId: form.organization });
      setAuth(result.token, result.user);
      navigate(result.user.role === 'SUPER_ADMIN' ? '/platform' : '/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al iniciar sesión';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex lg:w-[45%] bg-slate-950 flex-col items-center justify-center px-16 relative overflow-hidden shrink-0">
        {/* Subtle radial gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_30%_40%,_rgb(79_70_229_/_0.15),_transparent)]" />
        <div className="relative z-10 w-full max-w-sm">
          {/* Logo */}
          <div className="flex items-center gap-4 mb-10">
            <AerocamoMark size={48} className="shadow-2xl" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Aerocamo</h1>
              <p className="text-xs text-slate-500">MRO Platform</p>
            </div>
          </div>
          <p className="text-slate-300 text-lg font-medium leading-snug mb-2">
            Gestión de Mantenimiento Aeronáutico
          </p>
          <p className="text-slate-500 text-sm mb-10">
            Control integral de su flota, cumplimientos y trazabilidad de componentes.
          </p>
          <div className="space-y-3">
            {[
              'Semáforo de flota en tiempo real',
              'Trazabilidad de componentes EQ',
              'Control de cumplimientos regulatorios',
              'Registro de órdenes de trabajo',
            ].map(f => (
              <div key={f} className="flex items-center gap-3 text-sm text-slate-400">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center px-8 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <AerocamoMark size={48} />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Bienvenido</h2>
            <p className="text-slate-500 mt-1 text-sm">Inicia sesión en tu cuenta</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Organización</label>
              <div className="relative">
                <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  name="organization" type="text" required
                  className="input pl-9"
                  placeholder="ej. demo-airlines"
                  value={form.organization}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Correo electrónico</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  name="email" type="email" required autoComplete="email"
                  className="input pl-9"
                  value={form.email}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  name="password" type="password" required autoComplete="current-password"
                  className="input pl-9"
                  value={form.password}
                  onChange={handleChange}
                />
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
              {loading ? 'Iniciando…' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
