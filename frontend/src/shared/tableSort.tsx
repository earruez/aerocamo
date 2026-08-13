import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Compara dos valores para ordenar una tabla: números por magnitud, fechas
 * por tiempo, todo lo demás alfabéticamente (localeCompare en es, numeric
 * para que "2" quede antes que "10"). null/undefined siempre al final,
 * sin importar la dirección — así "sin datos" no se mezcla arriba al ordenar
 * descendente.
 */
export function compareSortValues(a: unknown, b: unknown): number {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : new Date(a as string).getTime();
    const bt = b instanceof Date ? b.getTime() : new Date(b as string).getTime();
    return at - bt;
  }

  if (typeof a === 'number' && typeof b === 'number') return a - b;

  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true });
}

/** Aplica un SortState (o lo deja pasar tal cual si es null) a un arreglo, sin mutar el original. */
export function applySort<T>(rows: T[], sort: SortState | null, getValue: (row: T, key: string) => unknown): T[] {
  if (!sort) return rows;
  const sorted = [...rows].sort((a, b) => compareSortValues(getValue(a, sort.key), getValue(b, sort.key)));
  return sort.direction === 'desc' ? sorted.reverse() : sorted;
}

/** Ciclo del clic en un encabezado: sin orden → ascendente → descendente → sin orden. */
export function toggleSort(prev: SortState | null, key: string): SortState | null {
  if (!prev || prev.key !== key) return { key, direction: 'asc' };
  if (prev.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'right';
}

/** `<th>` clickeable con indicador de dirección — para usar dentro de un `<thead><tr>`. */
export function SortableHeader({ label, sortKey, sort, onSort, className, align = 'left' }: SortableHeaderProps) {
  const active = sort?.key === sortKey;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-600 transition-colors ${
          align === 'right' ? 'flex-row-reverse' : ''
        }`}
      >
        <span>{label}</span>
        {active ? (
          sort!.direction === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
        ) : (
          <ChevronsUpDown size={11} className="opacity-30" />
        )}
      </button>
    </th>
  );
}
