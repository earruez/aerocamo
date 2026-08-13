import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { organizationApi } from '@api/organization.api';
import { useAuthStore } from '@store/authStore';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_SIZE_MB = 2;

export function OrganizationBrandingSection() {
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'ADMIN';
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: organization, isLoading } = useQuery({
    queryKey: ['organization'],
    queryFn: organizationApi.getCurrent,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => organizationApi.uploadLogo(file),
    onSuccess: (org) => {
      qc.setQueryData(['organization'], org);
      toast.success('Logo actualizado');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'No se pudo subir el logo');
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => organizationApi.removeLogo(),
    onSuccess: (org) => {
      qc.setQueryData(['organization'], org);
      toast.success('Logo eliminado');
    },
    onError: () => toast.error('No se pudo eliminar el logo'),
  });

  const validateAndUpload = (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('El logo debe ser una imagen PNG o JPG');
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`El logo no puede superar los ${MAX_SIZE_MB}MB`);
      return;
    }
    uploadMutation.mutate(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndUpload(file);
  };

  const isBusy = uploadMutation.isPending || removeMutation.isPending;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700">Logo de la empresa</h3>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-xs text-slate-500">
          Aparece en el encabezado de todos los PDF generados (Solicitudes de Trabajo, Órdenes de Trabajo e informes de Remanentes).
          Formatos PNG o JPG, máximo {MAX_SIZE_MB}MB.
        </p>

        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0 overflow-hidden">
            {isLoading ? (
              <Loader2 size={18} className="animate-spin text-slate-300" />
            ) : organization?.logoDataUri ? (
              <img src={organization.logoDataUri} alt="Logo de la empresa" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon size={22} className="text-slate-300" />
            )}
          </div>

          {canEdit ? (
            <div className="flex-1 space-y-2">
              <div
                className={`border-2 border-dashed rounded-lg px-4 py-3 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {uploadMutation.isPending ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Loader2 size={13} className="animate-spin" /> Subiendo…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Upload size={13} /> Arrastra o haz clic para {organization?.logoDataUri ? 'reemplazar' : 'subir'} el logo
                  </span>
                )}
              </div>
              {organization?.logoDataUri && (
                <button
                  type="button"
                  onClick={() => removeMutation.mutate()}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                >
                  <Trash2 size={12} /> Quitar logo
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              {organization?.logoDataUri ? 'Logo configurado.' : 'No hay logo configurado.'} Solo un administrador puede cambiarlo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
