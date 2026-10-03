import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createProjectRequestHandler } from './projects.js';
import { createRequestHandler } from './server.js';
import { WebSessionStore } from './sessions/store.js';
import type { ToolLoopAgent } from 'ai';
import type { ProjectCatalog } from '../core/projects.js';

const catalog: ProjectCatalog={version:1,defaultId:'p-0123456789abcdef',legacyId:'p-0123456789abcdef',projects:[{id:'p-0123456789abcdef',name:'A',roots:[{key:'a',root:'/a'}]},{id:'p-abcdef0123456789',name:'B',roots:[{key:'b',root:'/b'}]}]};
const servers:Server[]=[];const dirs:string[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})));await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
it('isolates simultaneous tabs, chat search and branches; legacy requests use the default project',async()=>{
 const home=await mkdtemp(join(tmpdir(),'project-web-'));dirs.push(home);
 const server=createServer(createProjectRequestHandler({catalog,daemonUrl:'http://unused',build:async(project)=>createRequestHandler({agent:{} as ToolLoopAgent,title:project.name,sessionStore:new WebSessionStore(join(home,project.id)),respond:async(res)=>{res.end(project.id);}})}));servers.push(server);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
 const headers=(id:string)=>({'Content-Type':'application/json','X-Codeberg-Project':id});
 await Promise.all(catalog.projects.map((project)=>fetch(`${base}/api/sessions/same-id`,{method:'PUT',headers:headers(project.id),body:JSON.stringify({title:project.name,messages:[]})})));
 for(const project of catalog.projects){const res=await fetch(`${base}/api/sessions/same-id`,{headers:headers(project.id)});expect((await res.json()).title).toBe(project.name);}
 expect((await (await fetch(`${base}/api/sessions/same-id`)).json()).title).toBe('A');
 expect(await (await fetch(`${base}/api/chat`,{method:'POST',headers:headers(catalog.projects[1]!.id),body:'{}'})).text()).toBe(catalog.projects[1]!.id);
 expect((await fetch(`${base}/api/sessions`,{headers:headers('missing')})).status).toBe(404);
 const owner = catalog.projects[0]!.id; const sibling = catalog.projects[1]!.id;
 await fetch(`${base}/api/sessions/only-in-a`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ title: 'Alpha private conversation', messages: [] }) });
 const branch = await fetch(`${base}/api/sessions/cross-project-branch`, { method: 'PUT', headers: headers(sibling), body: JSON.stringify({ parentId: 'only-in-a', messages: [] }) });
 expect(branch.status).toBe(404);
 expect(await (await fetch(`${base}/api/sessions?q=Alpha`, { headers: headers(sibling) })).json()).toEqual([]);

});

it('opens the global config directory without initializing a project or accepting an arbitrary path', async () => {
 const home=await mkdtemp(join(tmpdir(),'config-open-'));dirs.push(home);
 const opened:string[]=[];
 const server=createServer(createProjectRequestHandler({ catalog, home, daemonUrl:'http://unused',
  openConfigDirectory: async (path) => { opened.push(path); if (opened.length > 1) throw new Error('No desktop session'); },
  build:async()=>{throw new Error('Opening config must not initialize a project');} }));servers.push(server);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const headers={'Content-Type':'application/json'};
 const result=await fetch(`${base}/api/config/open-directory`,{method:'POST',headers,body:JSON.stringify({path:'/untrusted'})});
 expect(result.status).toBe(200);expect(await result.json()).toEqual({path:home});expect(opened).toEqual([home]);
 const unavailable=await fetch(`${base}/api/config/open-directory`,{method:'POST',headers,body:'{}'});
 expect(unavailable.status).toBe(503);expect(await unavailable.json()).toMatchObject({path:home,message:expect.stringContaining('manually')});
 expect((await fetch(`${base}/api/config/open-directory`)).status).toBe(405);
 expect((await fetch(`${base}/api/config/open-directory`,{method:'POST',headers:{...headers,Origin:'https://other.example'}})).status).toBe(403);
 expect((await fetch(`${base}/api/config/open-directory`,{method:'POST',body:'{}'})).status).toBe(415);
 expect(opened).toHaveLength(2);
});

it('routes skill previews to the extension service in the selected project and rejects cross-origin imports', async () => {
 const calls:string[]=[];
 const server=createServer(createProjectRequestHandler({ catalog,daemonUrl:'http://unused',
  extensions:async(_req,res,project)=>{calls.push(project.id);res.end('preview');},
  build:async()=>{throw new Error('Preview must not initialize a project');} }));servers.push(server);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const result=await fetch(`${base}/api/extensions/skills/preview`,{method:'POST',headers:{'Content-Type':'application/json','X-Codeberg-Project':catalog.projects[1]!.id},body:'{}'});
 expect(await result.text()).toBe('preview');expect(calls).toEqual([catalog.projects[1]!.id]);
 expect((await fetch(`${base}/api/extensions/skills/preview`,{method:'POST',headers:{Origin:'https://other.example'}})).status).toBe(403);
 expect(calls).toHaveLength(1);
});

it('proxies the native picker without starting a project and preserves cancellation and errors', async () => {
  const pickerServer = createServer(async (req, res) => {
    expect(req.url).toBe('/projects/pick-directory');
    expect(req.method).toBe('POST');
    let body = '';
    for await (const part of req) body += part;
    const { initialPath } = JSON.parse(body);
    res.writeHead(initialPath === '/unavailable' ? 501 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(initialPath === '/unavailable' ? { message: 'Enter the directory path manually' }
      : initialPath === '/cancel' ? { cancelled: true } : { path: initialPath }));
  });
  servers.push(pickerServer);
  await new Promise<void>((done) => pickerServer.listen(0, '127.0.0.1', done));
  const daemonUrl = `http://127.0.0.1:${(pickerServer.address() as { port: number }).port}`;
  const proxy = createServer(createProjectRequestHandler({ catalog, daemonUrl,
    build: async () => { throw new Error('Picking a directory must not initialize a project'); } }));
  servers.push(proxy);
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  const pick = (initialPath: string) => fetch(`${base}/api/projects/pick-directory`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initialPath }),
  });
  const path = '/folder with spaces & symbols';
  expect(await (await pick(path)).json()).toEqual({ path });
  expect(await (await pick('/cancel')).json()).toEqual({ cancelled: true });
  const unavailable = await pick('/unavailable');
  expect(unavailable.status).toBe(501);
  expect(await unavailable.json()).toEqual({ message: 'Enter the directory path manually' });
  expect((await fetch(`${base}/api/projects/pick-directory`)).status).toBe(405);
  expect((await fetch(`${base}/api/projects/pick-directory`, { method: 'POST', headers: { Origin: 'https://other.example' } })).status).toBe(403);
  expect((await fetch(`${base}/api/projects/pick-directory`, { method: 'POST', body: '{}' })).status).toBe(415);
});
