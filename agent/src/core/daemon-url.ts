/** The daemon namespace for a project. Idempotent, so a URL that already
 *  addresses the project is left as is. */
export function projectDaemonUrl(daemonUrl: string, projectId: string | undefined): string {
  if (!projectId) return daemonUrl;

  const base = daemonUrl.replace(/\/$/, '');
  const suffix = `/projects/${projectId}`;

  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}
