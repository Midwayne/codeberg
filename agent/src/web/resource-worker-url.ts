// Resolved beside the bundled entry point, so this module must stay directly under src/web/.
export const RESOURCE_WORKER_URL = new URL('./resource-worker.js', import.meta.url);
