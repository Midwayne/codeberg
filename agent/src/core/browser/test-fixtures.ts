import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FAKE_BROWSER = String.raw`
def store(state):
    temporary = marker.with_suffix('.next')
    temporary.write_text(json.dumps(state))
    temporary.replace(marker)

module = types.ModuleType('browser_use')
class Model:
    def __init__(self, **kwargs):
        assert kwargs['model'] == 'test-model'
class Browser:
    def __init__(self, **kwargs):
        assert kwargs['use_cloud'] is False
        assert kwargs['keep_alive'] is True
        assert kwargs['enable_default_extensions'] is False
        store({'cwd': str(Path.cwd()), 'pid': os.getpid(), 'state': 'created', 'tasks': []})
        self.cdp_client = types.SimpleNamespace(send=types.SimpleNamespace(Browser=types.SimpleNamespace(getVersion=self.get_version)))
    async def get_version(self):
        if json.loads(marker.read_text()).get('manually_closed'):
            raise RuntimeError('Browser was closed')
        return {'product': 'test-browser'}
    async def kill(self):
        state = json.loads(marker.read_text())
        state['state'] = 'closed'
        store(state)
class Agent:
    def __init__(self, task, **kwargs):
        self.task = task
        state = json.loads(marker.read_text())
        state.setdefault('visions', []).append(kwargs.get('use_vision'))
        store(state)
    def add_new_task(self, task):
        self.task = task
    async def run(self, max_steps):
        state = json.loads(marker.read_text())
        state['max_steps'] = max_steps
        state['tasks'].append(self.task)
        store(state)
        if self.task == 'wait-for-release':
            loop = asyncio.get_running_loop()
            clock = loop.time
            loop.time = lambda: clock() + 3600
            while not (Path.cwd() / 'release').exists():
                await asyncio.sleep(0.01)
        if self.task == 'wait':
            await asyncio.sleep(60)
        if self.task == 'fail':
            raise ValueError('SECRET error must not be exposed')
        return self
    def is_successful(self):
        return self.task != 'incomplete'
    def final_result(self):
        return 'Browser task result'
    def urls(self):
        return ['https://example.com', 'https://example.com']
module.Agent, module.Browser = Agent, Browser
module.ChatOpenAI = module.ChatAnthropic = module.ChatGoogle = Model
sys.modules['browser_use'] = module
exec(sys.argv[-1])
`;

export async function writeFakeBrowserWorker(home: string): Promise<string> {
  const uv = join(home, 'fake-uv');
  await writeFile(join(home, 'models.yml'), JSON.stringify({ providers: { openai: { models: {
    'test-model': { context_window: 32000, efforts: ['provider-default'], inputs: ['text', 'vision'] },
  } } } }));

  await writeFile(uv, '#!/usr/bin/env python3\nimport asyncio, json, os, sys, types\nfrom pathlib import Path\n' +
    `marker = Path(${JSON.stringify(join(home, 'lifecycle'))})\n` + FAKE_BROWSER);
  await chmod(uv, 0o700);

  return uv;
}
