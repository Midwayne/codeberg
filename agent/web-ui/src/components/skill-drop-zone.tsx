import { Upload } from 'lucide-react';

import { type SkillImportView } from './skill-import';
import { buttonClass as button } from './button-styles';

export type SkillDropZoneProps = Pick<
  Parameters<typeof SkillImportView>[0],
  'busy' | 'depth' | 'setDragging' | 'preview' | 'dragging' | 'input'
>;

export function SkillDropZone({ busy, depth, setDragging, preview, dragging, input }: SkillDropZoneProps) {
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (!busy && event.dataTransfer.types.includes('Files')) {
          depth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!busy) void preview(Array.from(event.dataTransfer.files));
      }}
      className={`rounded-xl border border-dashed p-4 sm:p-5 ${dragging ? 'border-ring bg-accent' : 'border-border'}`}
    >
      <SkillDropPrompt busy={busy} dragging={dragging} input={input} />
      <input
        ref={input}
        type="file"
        aria-label="Skill files"
        accept=".md,text/markdown"
        multiple
        hidden
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (selected.length) void preview(selected);
        }}
      />
    </div>
  );
}

export type SkillDropPromptProps = Pick<Parameters<typeof SkillDropZone>[0], 'busy' | 'dragging' | 'input'>;

function SkillDropPrompt({ busy, dragging, input }: SkillDropPromptProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Upload aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            {busy === 'preview'
              ? 'Reading skill files…'
              : dragging
                ? 'Drop to preview skills'
                : 'Drop skill files here'}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            SKILL.md or other .md files · up to 20 files, 256 KB each
          </p>
        </div>
      </div>
      <button type="button" disabled={Boolean(busy)} onClick={() => input.current?.click()} className={button}>
        Choose skill files
      </button>
    </div>
  );
}
