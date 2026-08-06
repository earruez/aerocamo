// Store centralizado para Solicitud de Trabajo (ST) usando Zustand
import { create } from 'zustand';
import {
  WorkRequest,
  WorkRequestVisibleStatus,
  WorkRequestOrigin,
  findOpenWorkRequestByItem,
} from '../shared/workRequestTypes';

const ST_DENSITY_STORAGE_KEY = 'st:viewDensity';

function readInitialDensity(): 'comfortable' | 'compact' {
  if (typeof window === 'undefined') return 'comfortable';
  const savedDensity = window.localStorage.getItem(ST_DENSITY_STORAGE_KEY);
  if (savedDensity === 'compact' || savedDensity === 'comfortable') return savedDensity;
  return 'comfortable';
}

interface WorkRequestStoreState {
  workRequests: WorkRequest[];
  selectedWorkRequestId: string | null;
  selectedDetailSection: 'general' | 'history';
  viewDensity: 'comfortable' | 'compact';
  filterAircraftId: string | null;
  filterStatus: WorkRequestVisibleStatus | null;
  searchText: string;
  setWorkRequests: (reqs: WorkRequest[]) => void;
  selectWorkRequest: (id: string | null, section?: 'general' | 'history') => void;
  setViewDensity: (density: 'comfortable' | 'compact') => void;
  setFilterAircraftId: (id: string | null) => void;
  setFilterStatus: (status: WorkRequestVisibleStatus | null) => void;
  setSearchText: (text: string) => void;
  getDraftWorkRequestByAircraft: (aircraftId: string) => WorkRequest | null;
  itemAlreadyInOpenWorkRequest: (sourceKind: WorkRequestOrigin, sourceId: string, excludeWorkRequestId?: string) => WorkRequest | null;
}

export const useWorkRequestStore = create<WorkRequestStoreState>((set, get) => ({
  workRequests: [],
  selectedWorkRequestId: null,
  selectedDetailSection: 'general',
  viewDensity: readInitialDensity(),
  filterAircraftId: null,
  filterStatus: null,
  searchText: '',
  setWorkRequests: (reqs) => set({ workRequests: reqs }),
  selectWorkRequest: (id, section = 'general') => set({ selectedWorkRequestId: id, selectedDetailSection: section }),
  setViewDensity: (density) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ST_DENSITY_STORAGE_KEY, density);
    }
    set({ viewDensity: density });
  },
  setFilterAircraftId: (id) => set({ filterAircraftId: id }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setSearchText: (text) => set({ searchText: text }),
  getDraftWorkRequestByAircraft: (aircraftId) => (
    get().workRequests.find((wr) => wr.aircraftId === aircraftId && wr.status === 'DRAFT') ?? null
  ),
  itemAlreadyInOpenWorkRequest: (sourceKind, sourceId, excludeWorkRequestId) => {
    return findOpenWorkRequestByItem({
      workRequests: get().workRequests,
      sourceKind,
      sourceId,
      excludeWorkRequestId,
    });
  },
}));
