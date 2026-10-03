import { expect, it } from 'vitest';
import { configDirectoryCommand } from './config-directory.js';

it('opens only the configured directory, without interpolating it into scripts', () => {
 const path = `/config with 'quotes' & $(something)`;
 expect(configDirectoryCommand(path, 'darwin')).toMatchObject({ command: '/usr/bin/open', args: [path] });
 expect(configDirectoryCommand(path, 'linux')).toMatchObject({ command: 'xdg-open', args: [path] });
 const windows = configDirectoryCommand(path, 'win32');
 expect(windows.args.join(' ')).not.toContain(path);
 expect(windows.env?.CODEBERG_CONFIG_DIRECTORY).toBe(path);
 expect(() => configDirectoryCommand(path, 'unknown')).toThrow('file manager');
});
