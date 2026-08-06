import { dueEngineUtils } from './DueEngineService';

describe('DueEngineService utilities', () => {
  it('calculates hour status correctly', () => {
    expect(dueEngineUtils.computeDimensionStatus('H', -1)).toBe('OVERDUE');
    expect(dueEngineUtils.computeDimensionStatus('H', 10)).toBe('DUE_SOON');
    expect(dueEngineUtils.computeDimensionStatus('H', 200)).toBe('OK');
  });

  it('calculates calendar status correctly', () => {
    expect(dueEngineUtils.computeDimensionStatus('M', -1)).toBe('OVERDUE');
    expect(dueEngineUtils.computeDimensionStatus('M', 7)).toBe('DUE_SOON');
    expect(dueEngineUtils.computeDimensionStatus('M', 90)).toBe('OK');
  });

  it('calculates cycle status correctly', () => {
    expect(dueEngineUtils.computeDimensionStatus('C', -1)).toBe('OVERDUE');
    expect(dueEngineUtils.computeDimensionStatus('C', 10)).toBe('DUE_SOON');
    expect(dueEngineUtils.computeDimensionStatus('C', 200)).toBe('OK');
  });

  it('returns NO_CONTEXT when required context is missing', () => {
    expect(dueEngineUtils.computeDimensionStatus('H', null)).toBe('NO_CONTEXT');
    expect(dueEngineUtils.computeDimensionStatus('M', null)).toBe('NO_CONTEXT');
    expect(dueEngineUtils.computeDimensionStatus('C', null)).toBe('NO_CONTEXT');
  });

  it('chooses most restrictive dimension in multi-interval', () => {
    const worst = dueEngineUtils.pickWorstDimension([
      {
        method: 'H',
        intervalValue: 100,
        intervalUnit: 'FH',
        nextDueValue: 2000,
        nextDueDate: null,
        remainingValue: 80,
        remainingUnit: 'FH',
        status: 'OK',
      },
      {
        method: 'M',
        intervalValue: 12,
        intervalUnit: 'MONTHS',
        nextDueValue: null,
        nextDueDate: new Date(),
        remainingValue: 4,
        remainingUnit: 'DAYS',
        status: 'DUE_SOON',
      },
    ]);

    expect(worst.method).toBe('M');
    expect(worst.status).toBe('DUE_SOON');
  });

  it('maps dual interval tasks into separate dimensions', () => {
    const dims = dueEngineUtils.toIntervalDimensions({
      intervalType: 'FLIGHT_HOURS_OR_CALENDAR',
      intervalHours: 100,
      intervalCycles: null,
      intervalCalendarDays: 365,
      intervalCalendarMonths: null,
    } as any);

    expect(dims.find((d) => d.method === 'H')).toBeTruthy();
    expect(dims.find((d) => d.method === 'M')).toBeTruthy();
  });

  it('classifies AD source type from reference', () => {
    const source = dueEngineUtils.mapSourceType({
      referenceType: 'AD',
      referenceNumber: '2024-15-01',
      taskCode: 'AD-2024-15-01',
      taskTitle: 'AD test',
      executionType: 'maintenance',
      requiresComponentTracking: false,
    } as any);

    expect(source).toBe('AD');
  });

  it('baseline does not imply real compliance in status util path', () => {
    // In Due Engine this is represented by missing real compliance data, therefore NO_CONTEXT when due values are null.
    expect(dueEngineUtils.computeDimensionStatus('H', null)).toBe('NO_CONTEXT');
  });
});
