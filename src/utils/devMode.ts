export function isChorusDevMode() {
  return typeof process !== 'undefined'
    && typeof process.env !== 'undefined'
    && process.env.NODE_ENV !== 'production';
}
