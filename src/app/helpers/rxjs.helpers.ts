import { filter, Observable, OperatorFunction, pipe, scan, UnaryFunction } from "rxjs";

export function filterNull<T>(): UnaryFunction<Observable<T | null | undefined>, Observable<T>> {
  return pipe(
    filter((x) => x != null) as OperatorFunction<T | null | undefined, T>,
  )
};

export type RequestResult = {
  id: string,
  status: 'Success' | 'Error',
}
// export type RequestResult<T, TId = string> =
// | { id: TId; status: 'success'; value: T }
// | { id: TId; status: 'error'; error: unknown };

export interface ProgressState {
  total: number;
  completed: number;
  successes: number;
  errors: number;
  percentage: number;
  results: RequestResult[];
}

export function trackRequestProgress(
  total: number
): OperatorFunction<RequestResult, ProgressState> {
  return scan<RequestResult, ProgressState>(
    (state, result) => ({
      total: state.total,
      completed: state.completed + 1,
      // percentage: Math.round((state.completed + 1 / total) * 100),
      percentage: ((state.completed + 1) / total) * 100,
      successes: state.successes + (result.status === 'Success' ? 1 : 0),
      errors: state.errors + (result.status === 'Error' ? 1 : 0),
      results: [...state.results, result],
    }),
    {
      total,
      completed: 0,
      percentage: 0,
      successes: 0,
      errors: 0,
      results: [],
    }
  );
}