import { useQuery } from '@tanstack/react-query';
import { aircraftApi } from '../../api/aircraft.api';
import { useWorkRequestStore } from '../../store/workRequestStore';
import { WorkRequestVisibleStatus } from '../../shared/workRequestTypes';

export function WorkRequestFilters() {
  const filterAircraftId = useWorkRequestStore((s) => s.filterAircraftId);
  const filterStatus = useWorkRequestStore((s) => s.filterStatus);
  const searchText = useWorkRequestStore((s) => s.searchText);
  const setFilterAircraftId = useWorkRequestStore((s) => s.setFilterAircraftId);
  const setFilterStatus = useWorkRequestStore((s) => s.setFilterStatus);
  const setSearchText = useWorkRequestStore((s) => s.setSearchText);
  const hasActiveFilters = Boolean(filterAircraftId || filterStatus || searchText.trim());
  const { data: aircraftOptions = [], isLoading: loadingAircraft } = useQuery({
    queryKey: ['aircraft'],
    queryFn: aircraftApi.findAll,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
      <div className="lg:col-span-3">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Aeronave</label>
        <select
          className="input w-full"
          value={filterAircraftId || ''}
          onChange={(e) => setFilterAircraftId(e.target.value || null)}
        >
          <option value="">{loadingAircraft ? 'Cargando aeronaves...' : 'Todas'}</option>
          {aircraftOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} - {a.manufacturer} {a.model}
            </option>
          ))}
        </select>
      </div>
      <div className="lg:col-span-3">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Estado</label>
        <select
          className="input w-full"
          value={filterStatus || ''}
          onChange={(e) => setFilterStatus((e.target.value || null) as WorkRequestVisibleStatus || null)}
        >
          <option value="">Todos</option>
          <option value="borrador">Borrador</option>
          <option value="en_proceso">En proceso</option>
          <option value="cancelada">Cancelada</option>
        </select>
      </div>
      <div className="lg:col-span-5">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Buscar</label>
        <input
          className="input w-full"
          type="text"
          placeholder="Buscar por N° ST, referencia o descripcion"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>
      <div className="lg:col-span-1 flex lg:justify-end">
        <button
          type="button"
          className="btn-secondary w-full lg:w-auto"
          onClick={() => {
            setFilterAircraftId(null);
            setFilterStatus(null);
            setSearchText('');
          }}
          disabled={!hasActiveFilters}
        >
          Limpiar filtros
        </button>
      </div>
    </div>
  );
}
