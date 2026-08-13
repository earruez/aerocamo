import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { User, Loader2, CheckCircle2, Mail } from 'lucide-react';
import { workOrdersApi } from '@api/workOrders.api';

interface TechnicianAssignmentModalProps {
  workOrderId: string;
  workOrderNumber: string;
  organizationId: string;
  onClose: () => void;
  onAssigned: () => void;
}

export function TechnicianAssignmentModal({
  workOrderId,
  workOrderNumber,
  organizationId,
  onClose,
  onAssigned,
}: TechnicianAssignmentModalProps) {
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>('');
  const [sendEmail, setSendEmail] = useState(true);
  const queryClient = useQueryClient();

  const { data: technicians = [], isLoading } = useQuery({
    queryKey: ['users', organizationId, 'technicians'],
    queryFn: workOrdersApi.getAvailableTechnicians,
    staleTime: 30_000,
  });

  const assignMutation = useMutation({
    mutationFn: () => workOrdersApi.assign(workOrderId, selectedTechnicianId, sendEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-order', workOrderId] });
      toast.success('Técnico asignado exitosamente');
      onAssigned();
      onClose();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || 'Error al asignar técnico');
    },
  });

  const selectedTechnician = technicians.find(t => t.id === selectedTechnicianId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Asignar Técnico</h3>
              <p className="text-sm text-slate-500">OT {workOrderNumber}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Cargando técnicos...</span>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Seleccionar Técnico
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {technicians.length === 0 ? (
                    <p className="text-sm text-slate-500 py-2">No hay técnicos disponibles</p>
                  ) : (
                    technicians.map((technician) => (
                      <button
                        key={technician.id}
                        onClick={() => setSelectedTechnicianId(technician.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                          selectedTechnicianId === technician.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                          {technician.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 text-sm truncate">{technician.name}</div>
                          <div className="text-xs text-slate-500 truncate">{technician.email}</div>
                          {technician.licenseNumber && (
                            <div className="text-xs text-blue-600 mt-0.5">Lic: {technician.licenseNumber}</div>
                          )}
                        </div>
                        {selectedTechnicianId === technician.id && (
                          <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="sendEmail"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="sendEmail" className="text-sm text-slate-700 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  Enviar notificación por email al técnico
                </label>
              </div>

              {selectedTechnician && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                  Asignarás a <strong>{selectedTechnician.name}</strong>
                  {sendEmail ? ' con notificación por email.' : ' sin notificación por email.'}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            disabled={!selectedTechnicianId || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {assignMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Asignando...</>
            ) : (
              <><User className="w-4 h-4" /> Asignar Técnico</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
