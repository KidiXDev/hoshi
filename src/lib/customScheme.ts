export function customSchemeUrl(scheme: string, path: string): string {
  return typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Windows')
    ? `http://${scheme}.localhost/${path}`
    : `${scheme}://localhost/${path}`;
}
