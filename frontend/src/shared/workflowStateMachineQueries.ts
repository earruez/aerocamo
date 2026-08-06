import { useQuery } from '@tanstack/react-query';
import { workOrdersApi, type WorkOrderStatus } from '../api/workOrders.api';
import { workRequestsApi, type WorkRequestStatus, type WorkflowStateMachine } from '../api/workRequests.api';

const WORK_REQUEST_STATE_MACHINE_QUERY_KEY = ['work-request-state-machine'] as const;
const WORK_ORDER_STATE_MACHINE_QUERY_KEY = ['work-order-state-machine'] as const;

const LONG_LIVED_CACHE_MS = 1000 * 60 * 60;

export function useWorkRequestStateMachine() {
  return useQuery<WorkflowStateMachine<WorkRequestStatus>>({
    queryKey: WORK_REQUEST_STATE_MACHINE_QUERY_KEY,
    queryFn: workRequestsApi.getStateMachine,
    staleTime: LONG_LIVED_CACHE_MS,
    gcTime: LONG_LIVED_CACHE_MS,
  });
}

export function useWorkOrderStateMachine() {
  return useQuery<WorkflowStateMachine<WorkOrderStatus>>({
    queryKey: WORK_ORDER_STATE_MACHINE_QUERY_KEY,
    queryFn: workOrdersApi.getStateMachine,
    staleTime: LONG_LIVED_CACHE_MS,
    gcTime: LONG_LIVED_CACHE_MS,
  });
}
