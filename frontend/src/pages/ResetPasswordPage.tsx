import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { authApi } from '@api/auth.api';
import { Lock, ArrowLeft } from 'lucide-react';
import AerocamoMark from '@components/AerocamoMark';

type TokenState = 'checking' | 'valid' | 'invalid';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [tokenState, setTokenState] = useState<TokenState>('checking');
  const [name, setName] = useState('');
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ password: '', confirmPassword: '' });

  useEffect(() => {
    if (!token) {
      setTokenState('invalid');
      return;
    }
    authApi.verifyResetToken(token)
      .then((result) => {
        if (result.valid) {
          setTokenState('valid');
          setName(result.name ?? '');
          setIsNewAccount(Boolean(result.isNewAccount));
        } else {
          setTokenState('invalid');
        }
      })
      .catch(() => setTokenState('invalid'));
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword({ token, password: form.password });
      toast.success(isNewAccount ? 'Cuenta activada. Ya puedes ingresar.' : 'Contraseña actualizada.');
      navigate('/login');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'No se pudo actualizar la contraseña';
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
            {isNewAccount ? 'Activa tu cuenta' : 'Restablece tu contraseña'}
          </p>
          <p className="text-slate-500 text-sm mb-10">
            Elige una contraseña segura que uses solo para Aerocamo.
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center px-8 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8">
            <AerocamoMark size={48} />
          </div>

          {tokenState === 'checking' && (
            <p className="text-slate-500 text-sm text-center">Verificando enlace…</p>
          )}

          {tokenState === 'invalid' && (
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Enlace no válido</h2>
              <p className="text-slate-500 mt-2 text-sm leading-relaxed">
                Este enlace ya expiró o no es válido. Solicita uno nuevo para continuar.
              </p>
              <Link to="/forgot-password" className="btn-primary w-full py-2.5 mt-6 inline-flex items-center justify-center">
                Solicitar nuevo enlace
              </Link>
            </div>
          )}

          {tokenState === 'valid' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">
                  {isNewAccount ? `¡Bienvenido, ${name}!` : `Hola, ${name}`}
                </h2>
                <p className="text-slate-500 mt-1 text-sm">
                  {isNewAccount ? 'Define la contraseña con la que vas a ingresar de aquí en adelante.' : 'Elige tu nueva contraseña.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nueva contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      name="password" type="password" required autoComplete="new-password"
                      className="input pl-9"
                      value={form.password}
                      onChange={handleChange}
                      minLength={8}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmar contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      name="confirmPassword" type="password" required autoComplete="new-password"
                      className="input pl-9"
                      value={form.confirmPassword}
                      onChange={handleChange}
                      minLength={8}
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
                  {loading ? 'Guardando…' : isNewAccount ? 'Activar cuenta' : 'Restablecer contraseña'}
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
