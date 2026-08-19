export type OptionalOperationResult<T> =
  | { status: 'available'; value: T }
  | { status: 'rejected'; error: unknown }
  | { status: 'timeout' };

export async function settleOptionalOperation<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onLateSuccess?: (value: T) => void | Promise<unknown>,
): Promise<OptionalOperationResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const settled: Promise<OptionalOperationResult<T>> = operation.then(
    (value): OptionalOperationResult<T> => ({ status: 'available', value }),
    (error: unknown): OptionalOperationResult<T> => ({
      status: 'rejected',
      error,
    }),
  );
  const timeout = new Promise<OptionalOperationResult<T>>((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
  });

  const result = await Promise.race([settled, timeout]);
  if (result.status !== 'timeout') {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return result;
  }

  // A timed-out transport can still finish in the background. Release it as
  // soon as it does so degraded-mode calls never leak a late connection.
  if (onLateSuccess) {
    void settled.then((lateResult) => {
      if (lateResult.status !== 'available') return;
      return onLateSuccess(lateResult.value);
    }).catch(() => {
      // Optional cleanup must not surface as an unhandled rejection.
    });
  }

  return result;
}
