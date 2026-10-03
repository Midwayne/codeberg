import { afterEach, expect, it, vi } from 'vitest';
import { projectFetch } from './project-api';
afterEach(()=>vi.unstubAllGlobals());
it('captures each tab/project ID and retains it for delayed writes',async()=>{
 const calls:RequestInit[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{calls.push(init);return new Response('{}');}));
 const a=projectFetch('A');const b=projectFetch('B');
 await b('/api/chat',{method:'POST'});
 await a('/api/sessions/old',{method:'PUT',headers:{'Content-Type':'application/json'}});
 expect(new Headers(calls[0]?.headers).get('X-Codeberg-Project')).toBe('B');
 expect(new Headers(calls[1]?.headers).get('X-Codeberg-Project')).toBe('A');
 expect(new Headers(calls[1]?.headers).get('Content-Type')).toBe('application/json');
});
