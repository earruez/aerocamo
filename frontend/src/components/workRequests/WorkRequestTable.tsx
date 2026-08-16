import { useQuery } from '@tanstack/react-query';
import { useWorkRequestStore } from '../../store/workRequestStore';
import { WorkRequestBadge } from './WorkRequestBadges';
import { saveAs } from 'file-saver';
import { FolderOpen, SearchX } from 'lucide-react';
import toast from 'react-hot-toast';
import { workRequestsApi } from '../../api/workRequests.api';
import { aircraftApi } from '../../api/aircraft.api';
import { adaptApiWorkRequest, upsertWorkRequestCache } from '../../shared/workRequestApiAdapter';
import { canTransitionTo, getVisibleState } from '../../shared/workflowVisibleState';
import { useWorkRequestStateMachine } from '../../shared/workflowStateMachineQueries';

const SOURCE_LABELS: Record<string, string> = {
  maintenance_plan: 'Plan',
  component_inspection: 'Componentes',
  discrepancy: 'Discrepancia',
  compliance_due: 'Vencimiento',
  manual: 'Manual',
};

function getOriginLabel(sourceKinds: string[]): string {
  if (sourceKinds.length === 0) return '-';
  const unique = Array.from(new Set(sourceKinds));
  if (unique.length === 1) return SOURCE_LABELS[unique[0]] ?? 'Manual';
  return 'Mixto';
}

export function WorkRequestTable() {
  const workRequests = useWorkRequestStore((s) => s.workRequests);
  const viewDensity = useWorkRequestStore((s) => s.viewDensity);
  const filterAircraftId = useWorkRequestStore((s) => s.filterAircraftId);
  const filterStatus = useWorkRequestStore((s) => s.filterStatus);
  const searchText = useWorkRequestStore((s) => s.searchText).toLowerCase();
  const selectWorkRequest = useWorkRequestStore((s) => s.selectWorkRequest);
  const setWorkRequests = useWorkRequestStore((s) => s.setWorkRequests);
  const setFilterAircraftId = useWorkRequestStore((s) => s.setFilterAircraftId);
  const setFilterStatus = useWorkRequestStore((s) => s.setFilterStatus);
  const setSearchText = useWorkRequestStore((s) => s.setSearchText);
  const { data: stateMachine } = useWorkRequestStateMachine();
  const { data: aircraftList = [] } = useQuery({ queryKey: ['aircraft'], queryFn: aircraftApi.findAll });
  const aircraftById = new Map(aircraftList.map((a) => [a.id, a]));

  if (!stateMachine) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        Cargando estado de flujo...
      </div>
    );
  }

  const toVisible = (status: (typeof workRequests)[number]['status']) => {
    const visible = getVisibleState(stateMachine, status);
    if (visible === 'draft') return 'borrador';
    if (visible === 'cancelled') return 'cancelada';
    return 'en_proceso';
  };

  const handleSend = async (workRequestId: string) => {
    const wr = workRequests.find((item) => item.id === workRequestId);
    if (!wr) return;
    const canSend = canTransitionTo(stateMachine, wr.status, 'SENT');
    if (!canSend) return;
    try {
      const sent = await workRequestsApi.send(workRequestId);
      const adapted = adaptApiWorkRequest(sent);
      setWorkRequests(upsertWorkRequestCache(useWorkRequestStore.getState().workRequests, adapted));
      toast.success('ST enviada correctamente');
    } catch {
      toast.error('No se pudo enviar la ST');
    }
  };

  const handleDownloadPdf = async (workRequestId: string) => {
    const wr = workRequests.find((item) => item.id === workRequestId);
    if (!wr) return;
    try {
      const blob = await workRequestsApi.downloadPdf(workRequestId);
      saveAs(blob, `${wr.folio}.pdf`);
    } catch {
      toast.error('No se pudo descargar el PDF');
    }
  };

  const filtered = workRequests.filter((wr) => {
    if (filterAircraftId && wr.aircraftId !== filterAircraftId) return false;
    if (filterStatus && toVisible(wr.status) !== filterStatus) return false;
    if (searchText) {
      const text = [
        wr.folio,
        wr.items.map((i) => i.referenceCode).join(','),
        wr.items.map((i) => i.title).join(','),
        wr.generalNotes,
      ].join(' ').toLowerCase();
      if (!text.includes(searchText)) return false;
    }
    return true;
  });

  const cellPadding = viewDensity === 'compact' ? 'px-3 py-2' : 'px-3 py-3';
  const actionsGap = viewDensity === 'compact' ? 'gap-1' : 'gap-1.5';

  return (
    <div className="overflow-auto max-h-[70vh] rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50/90 sticky top-0 z-10 border-b border-slate-200">
          <tr>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">N° ST</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Aeronave</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Origen</th>
            <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Items</th>
            <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prioridad</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estado</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actualizada</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filtered.map((wr) => (
            <tr key={wr.id} className="hover:bg-slate-50/70 transition-colors">
              <td className={`${cellPadding} font-mono text-slate-800`}>{wr.folio}</td>
              <td className={`${cellPadding} text-slate-600`}>{wr.createdAt.slice(0, 10)}</td>
              <td className={`${cellPadding} text-slate-700`}>{aircraftById.get(wr.aircraftId)?.registration ?? wr.aircraftId}</td>
              <td className={`${cellPadding} text-slate-600`}>{getOriginLabel(wr.items.map((i) => i.sourceKind))}</td>
              <td className={`${cellPadding} text-center font-semibold text-slate-700`}>{wr.items.length}</td>
              <td className={`${cellPadding} text-center capitalize text-slate-700`}>{wr.priority}</td>
              <td className={cellPadding}><WorkRequestBadge status={wr.status} /></td>
              <td className={`${cellPadding} text-slate-600`}>{wr.updatedAt.slice(0, 10)}</td>
              <td className={cellPadding}>
                <div className={`flex flex-wrap ${actionsGap}`}>
                  <button className="btn-xs btn-primary inline-flex items-center justify-center gap-1 text-center" onClick={() => selectWorkRequest(wr.id, 'general')}>
                    <FolderOpen size={11} /> Abrir
                  </button>
                  <button
                    className="btn-xs btn-outline inline-flex items-center justify-center text-center"
                    onClick={() => selectWorkRequest(wr.id, 'general')}
                    disabled={toVisible(wr.status) !== 'borrador'}
                    title={toVisible(wr.status) !== 'borrador' ? 'Solo disponible en borrador' : 'Abrir borrador'}
                  >
                    Abrir borrador
                  </button>
                  <button
                    className="btn-xs btn-outline inline-flex items-center justify-center text-center"
                    onClick={() => selectWorkRequest(wr.id, 'general')}
                    disabled={toVisible(wr.status) !== 'borrador'}
                    title={toVisible(wr.status) !== 'borrador' ? 'Solo editable en Borrador' : 'Editar ST'}
                  >
                    Editar
                  </button>
                  <button
                    className="btn-xs btn-outline inline-flex items-center justify-center text-center"
                    onClick={() => handleSend(wr.id)}
                    disabled={toVisible(wr.status) !== 'borrador'}
                    title={toVisible(wr.status) !== 'borrador' ? 'Solo se puede enviar en Borrador' : 'Enviar ST'}
                  >
                    Enviar
                  </button>
                  <button className="btn-xs btn-outline inline-flex items-center justify-center text-center" onClick={() => handleDownloadPdf(wr.id)}>Descargar PDF</button>
                  <button className="btn-xs btn-outline inline-flex items-center justify-center text-center" onClick={() => selectWorkRequest(wr.id, 'history')}>Ver historial</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <div className="py-12 px-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
            <SearchX size={18} className="text-slate-500" />
          </div>
          <p className="text-sm font-semibold text-slate-700">No encontramos solicitudes con ese filtro</p>
          <p className="text-xs text-slate-500 mt-1">Prueba limpiando los filtros para ver toda la bandeja.</p>
          <button
            className="btn-xs btn-outline mt-4 inline-flex items-center justify-center text-center"
            onClick={() => {
              setFilterAircraftId(null);
              setFilterStatus(null);
              setSearchText('');
            }}
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}
