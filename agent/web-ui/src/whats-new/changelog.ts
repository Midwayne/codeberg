import changelog from '../../../../CHANGELOG.md?raw';

import { parseReleases } from './releases';

/** Release notes bundled with this build, so they work offline and match the UI. */
export const bundledReleases = parseReleases(changelog);
