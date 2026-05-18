export type LazyImport<T> = () => Promise<T>;

export function createRetryableLazyImport<T>(load: LazyImport<T>): LazyImport<T> {
  let promise: Promise<T> | null = null;

  return () => {
    if (!promise) {
      try {
        promise = load().catch(error => {
          promise = null;
          throw error;
        });
      } catch (error) {
        promise = null;
        return Promise.reject(error);
      }
    }
    return promise;
  };
}
