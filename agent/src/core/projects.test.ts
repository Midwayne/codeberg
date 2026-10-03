import { mkdtemp, mkdir, readFile, writeFile, realpath, stat, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextStore, defaultContextRoot } from './context/store.js';
import { defaultLearningRoot } from './learning/store.js';
import { codebergDataHome } from './paths.js';
import { mcpConfigFromEnv } from './mcp/config.js';
import { rm } from 'node:fs/promises';
import { prepareProjectStorage, currentProjectEnvironment, migrateProjectData, projectEnvironment, projectDataHome, type ProjectCatalog } from './projects.js';

const homes: string[]=[];
async function home(){const dir=await mkdtemp(join(tmpdir(),'cberg-project-'));homes.push(dir);return dir;}
afterEach(async()=>{await Promise.all(homes.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
const catalog: ProjectCatalog={version:1,defaultId:'p-0123456789abcdef',legacyId:'p-0123456789abcdef',projects:[{id:'p-0123456789abcdef',name:'Old',roots:[{key:'old',root:'/repo/old'}]},{id:'p-abcdef0123456789',name:'New',roots:[{key:'new',root:'/repo/new'}]}]};
describe('project storage',()=>{
 it('migrates existing chats, learning and context once, keeping absolute context references usable',async()=>{
  const dir=await home();
  for(const name of ['web-sessions','learning','context']){await mkdir(join(dir,name));await writeFile(join(dir,name,'existing.json'),'old');}
  await writeFile(join(dir,'models.yml'),'global');await writeFile(join(dir,'mcp.json'),'global');await writeFile(join(dir,'spec.yml'),'project spec');
  await migrateProjectData(dir,catalog);await migrateProjectData(dir,catalog);
  const data=projectDataHome(dir,catalog.defaultId);
  expect(await readFile(join(data,'web-sessions','existing.json'),'utf8')).toBe('old');
  expect(await realpath(join(dir,'context'))).toBe(await realpath(join(data,'context')));
  expect(await readFile(join(data,'spec.yml'),'utf8')).toBe('project spec');
  expect(await readFile(join(dir,'mcp.json'),'utf8')).toBe('global');
  expect(await stat(join(dir,'learning')).catch(()=>null)).toBeNull();
  expect(await stat(join(projectDataHome(dir,catalog.projects[1]!.id),'learning')).catch(()=>null)).toBeNull();
 });
 it('refuses conflicting migrations without overwriting data',async()=>{
  const dir=await home();await mkdir(join(dir,'learning'));await mkdir(join(projectDataHome(dir,catalog.defaultId),'learning'),{recursive:true});
  await expect(migrateProjectData(dir,catalog)).rejects.toThrow('conflict');
 });
 it('binds roots, skills, MCPs and database specs without modifying process environment',()=>{
  const original={CODEBERG_HOME:'/data',CODEBERG_ROOTS:'other\t/other',CODEBERG_DBMCP_SPEC:'/old/spec.yml'};
  const env=projectEnvironment(original,catalog.projects[1]!,catalog);
  expect(env.CODEBERG_ROOTS).toBe('new\t/repo/new');expect(env.CODEBERG_ROOT).toBe('/repo/new');expect(original.CODEBERG_ROOTS).toBe('other\t/other');
  expect(env.CODEBERG_DBMCP_SPEC).toBe('/data/projects/p-abcdef0123456789/spec.yml');
  expect(env.CBERG_INDEX_PATH).toBe('/data/projects/p-abcdef0123456789/index/codeberg.usearch');
  expect(()=>projectDataHome('/data','../bad')).toThrow();
 });
});

it('serializes simultaneous upgrades without conflicting with its own moves', async () => {
 const dir = await home(); await mkdir(join(dir, 'learning')); await writeFile(join(dir, 'learning', 'old'), 'data');
 await Promise.all([migrateProjectData(dir, catalog), migrateProjectData(dir, catalog)]);
 expect(await readFile(join(projectDataHome(dir, catalog.legacyId), 'learning', 'old'), 'utf8')).toBe('data');
});
it('moves an existing external context symlink into its owning project', async () => {
 const dir = await home(); const external = await home(); await writeFile(join(external, 'old'), 'context');
 await symlink(external, join(dir, 'context'), 'dir');
 await migrateProjectData(dir, catalog);
 expect(await readFile(join(projectDataHome(dir, catalog.legacyId), 'context', 'old'), 'utf8')).toBe('context');
 expect(await realpath(join(dir, 'context'))).toBe(await realpath(external));
});

it('upgrades CLI storage and isolates context and learning defaults by canonical project roots', async () => {
 const dir = await home(); const firstRoot = await home(); const secondRoot = await home();
 const projects = { ...catalog, projects: catalog.projects.map((project, i) => ({ ...project, roots: [{ key: project.name, root: i === 0 ? firstRoot : secondRoot }] })) };
 projects.projects[0]!.roots[0]!.root = await realpath(firstRoot);
 projects.projects[1]!.roots[0]!.root = await realpath(secondRoot);
 await writeFile(join(dir, 'projects.json'), JSON.stringify(projects));
 await mkdir(join(dir, 'learning')); await writeFile(join(dir, 'learning', 'old'), 'legacy');
 await prepareProjectStorage({ CODEBERG_HOME: dir });
 const a = currentProjectEnvironment({ CODEBERG_HOME: dir, CODEBERG_ROOT: firstRoot });
 const b = currentProjectEnvironment({ CODEBERG_HOME: dir, CODEBERG_ROOT: secondRoot });
 expect(defaultLearningRoot(a)).not.toBe(defaultLearningRoot(b));
 expect(await readFile(join(defaultLearningRoot(a), 'old'), 'utf8')).toBe('legacy');
 const first = ContextStore.open(defaultContextRoot(a)); const second = ContextStore.open(defaultContextRoot(b));
 const saved = await first.writeRel('old.txt', 'legacy context');
 expect(first.resolve(saved)).not.toBeNull(); expect(second.resolve(saved)).toBeNull();
});

it('preserves relative legacy context links when moving them into project storage', async () => {
 const dir = await home(); await mkdir(join(dir, 'external-context'));
 await writeFile(join(dir, 'external-context', 'old'), 'relative context');
 await symlink('external-context', join(dir, 'context'), 'dir');
 await migrateProjectData(dir, catalog);
 expect(await readFile(join(projectDataHome(dir, catalog.legacyId), 'context', 'old'), 'utf8')).toBe('relative context');
});

it('preserves external and remote legacy index namespaces while scoping new indexes', () => {
 const legacy = { ...catalog.projects[0]!, legacyIndex: '/data/index/codeberg.usearch' };
 expect(projectEnvironment({ CODEBERG_HOME: '/data' }, legacy, catalog).CBERG_INDEX_PATH).toBe('/data/projects/p-0123456789abcdef/index/codeberg.usearch');
 expect(projectEnvironment({ CODEBERG_HOME: '/data', CBERG_INDEX_BACKEND: 'qdrant' }, legacy, catalog).CBERG_INDEX_PATH).toBe('/data/index/codeberg.usearch');
 expect(projectEnvironment({ CODEBERG_HOME: '/data' }, { ...legacy, legacyIndex: '/external/cache' }, catalog).CBERG_INDEX_PATH).toBe('/external/cache');
});

it('resolves upgraded CLI storage when the daemon skipped a deleted root', async () => {
 const dir = await home(); const root = await realpath(await home());
 const project = { ...catalog.projects[0]!, roots: [{ key: 'live', root }] };
 const projects = { ...catalog, projects: [project] };
 const deleted = join(dir, 'deleted-repository');
 const env = { CODEBERG_HOME: dir, CODEBERG_ROOTS: `live\t${root}\ndead\t${deleted}` };
 await writeFile(join(dir, 'projects.json'), JSON.stringify(projects));
 await mkdir(join(dir, 'learning')); await writeFile(join(dir, 'learning', 'old'), 'legacy');
 await prepareProjectStorage(env);
 const selected = currentProjectEnvironment(env);
 expect(selected.CODEBERG_PROJECT_ID).toBe(project.id);
 expect(selected.CODEBERG_ROOTS).toBe(`live\t${root}`);
 expect(await readFile(join(defaultLearningRoot(selected), 'old'), 'utf8')).toBe('legacy');
 expect(() => codebergDataHome({ ...env, CODEBERG_ROOTS: `dead\t${deleted}` })).toThrow('not registered');
 expect(() => codebergDataHome({ ...env, CODEBERG_ROOTS: `other\t${dir}\ndead\t${deleted}` })).toThrow('not registered');
});

it('keeps old context references readable with a relative home and resumes interrupted migration', async () => {
 const cwd = process.cwd(); const directory = await home();
 try {
  process.chdir(directory);
  const relativeHome = '.codeberg';
  await mkdir(join(relativeHome, 'context'), { recursive: true });
  await writeFile(join(relativeHome, 'context', 'old.txt'), 'legacy context');
  const oldReference = resolve(relativeHome, 'context', 'old.txt');
  await migrateProjectData(relativeHome, catalog);
  expect(await readFile(oldReference, 'utf8')).toBe('legacy context');
  const context = ContextStore.open(join(projectDataHome(relativeHome, catalog.legacyId), 'context'));
  expect(context.resolve(oldReference)).not.toBeNull();
  // Simulate interruption after creating the compatibility link, before marking completion.
  await rm(join(relativeHome, 'projects-migrated.json'));
  await migrateProjectData(relativeHome, catalog);
  await migrateProjectData(relativeHome, catalog);
  expect(await readFile(oldReference, 'utf8')).toBe('legacy context');
 } finally { process.chdir(cwd); }
});

it.each(['relative', 'tilde', 'normalized'])('remaps a %s managed database spec path after migration', async (kind) => {
 const dir = await home(); const spec = join(dir, 'spec.yaml'); const binary = join(dir, 'dbmcp');
 await writeFile(spec, 'selected yaml'); await writeFile(join(dir, 'spec.yml'), 'other spec');
 await writeFile(binary, '');
 const configured = kind === 'relative' ? relative(process.cwd(), spec)
  : kind === 'tilde' ? `~/${relative(homedir(), spec)}` : `${dir}/./spec.yaml`;
 await migrateProjectData(dir, catalog);
 const env = projectEnvironment({ CODEBERG_HOME: dir, CODEBERG_DBMCP_SPEC: configured,
  CODEBERG_DBMCP_USE: 'true', CODEBERG_DBMCP_BIN: binary }, catalog.projects[0]!, catalog);
 const migrated = join(projectDataHome(dir, catalog.legacyId), 'spec.yaml');
 expect(env.CODEBERG_DBMCP_SPEC).toBe(migrated);
 expect(await readFile(migrated, 'utf8')).toBe('selected yaml');
 expect(mcpConfigFromEnv(env).servers.find((server) => server.name === 'databases')).toMatchObject({ args: ['-spec', migrated] });
 const external = projectEnvironment({ CODEBERG_HOME: dir, CODEBERG_DBMCP_SPEC: binary }, catalog.projects[0]!, catalog);
 expect(external.CODEBERG_DBMCP_SPEC).toBe(binary);
});
