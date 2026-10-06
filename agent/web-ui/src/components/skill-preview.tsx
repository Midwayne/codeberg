import { FileText, X } from 'lucide-react';

import { type SkillImportView, type SkillPreviewRowProps } from './skill-import';
import { buttonClass as button } from './button-styles';

export type SkillPreviewListProps = Pick<
  Parameters<typeof SkillImportView>[0],
  'files' | 'scopeLabel' | 'busy' | 'setFiles' | 'ready' | 'importFiles'
>;

export function SkillPreviewList({ files, scopeLabel, busy, setFiles, ready, importFiles }: SkillPreviewListProps) {
  return (
    files.length > 0 && (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Review files before importing into {scopeLabel}.</p>
        <ul className="divide-y divide-border">
          {files.map((file, index) => (
            <SkillPreviewRow
              key={`${index}:${file.filename}`}
              index={index}
              file={file}
              busy={busy}
              setFiles={setFiles}
            />
          ))}
        </ul>
        <button
          type="button"
          disabled={Boolean(busy) || !ready}
          onClick={() => void importFiles()}
          className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          {busy === 'import' ? 'Importing…' : `Import ${ready} ${ready === 1 ? 'skill' : 'skills'}`}
        </button>
      </div>
    )
  );
}

export function SkillPreviewRow({ index, file, busy, setFiles }: SkillPreviewRowProps) {
  return (
    <li key={`${index}:${file.filename}`} className="flex items-start gap-3 py-3">
      <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{file.name ?? file.filename}</p>
        {file.name && <p className="mt-1 break-words text-xs text-muted-foreground">{file.filename}</p>}
        {file.description && <p className="mt-1 break-words text-sm text-muted-foreground">{file.description}</p>}
        {(file.error || file.importError) && (
          <p role="alert" className="mt-1 break-words text-sm text-destructive">
            {file.error ?? file.importError}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={`Remove ${file.name ?? file.filename}`}
        disabled={Boolean(busy)}
        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}
