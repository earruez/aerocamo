import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { authApi } from '@api/auth.api';
import { Mail, Building2, ArrowLeft } from 'lucide-react';
import AerocamoMark from '@components/AerocamoMark';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ email: '', organization: '' });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword({ email: form.email, organization: form.organization });
      setSent(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al procesar la solicitud';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex lg:w-[45%] bg-slate-950 flex-col items-center justify-center px-16 relative overflow-hidden shrink-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_30%_40%,_rgb(79_70_229_/_0.15),_transparent)]" />
        <div className="relative z-10 w-full max-w-sm">
          <div className="flex items-center gap-4 mb-10">
            <AerocamoMark size={48} className="shadow-2xl" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Aerocamo</h1>
              <p className="text-xs text-slate-500">MRO Platform</p>
            </div>
          </div>
          <p className="text-slate-300 text-lg font-medium leading-snug mb-2">
            Recupera el acceso a tu cuenta
          </p>
          <p className="text-slate-500 text-sm mb-10">
            Te enviaremos un enlace seguro para que definas una nueva contraseña.
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center px-8 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8">
            <AerocamoMark size={48} />
          </div>

          {sent ? (
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Revisa tu correo</h2>
              <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                Si <strong>{form.email}</strong> está registrado en esa organización, te enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada (y spam).
              </p>
              <button onClick={() => navigate('/login')} className="btn-primary w-full py-2.5 mt-6">
                Volver a inicio de sesión
              </button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">¿Olvidaste tu contraseña?</h2>
                <p className="text-slate-500 mt-1 text-sm">Ingresa tu organización y correo para recibir un enlace de restablecimiento.</p>
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
                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
                  {loading ? 'Enviando…' : 'Enviar enlace de restablecimiento'}
                </button>
              </form>

              <Link to="/login" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mt-6 justify-center">
                <ArrowLeft size={14} /> Volver a inicio de sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
