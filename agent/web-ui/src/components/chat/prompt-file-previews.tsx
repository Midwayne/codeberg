import { FileImage, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PromptFilePreviews({ files }: { files: File[] }) {
  if (!files.length) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none relative ml-6 h-9 sm:ml-8">
      {files.slice(0, 3).map((file, index) => <FilePreview key={`${file.name}-${index}`} file={file} index={index} />)}
    </div>
  );
}

function FilePreview({ file, index }: { file: File; index: number }) {
  const [source, setSource] = useState<string>();

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;

    const url = URL.createObjectURL(file);
    setSource(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="absolute top-0 flex h-20 w-28 flex-col overflow-hidden rounded-lg border border-border bg-card"
      style={{ left: index * 48, transform: `rotate(${(index - 1) * 6}deg)` }}>
      {source ? <img src={source} alt="" className="h-full w-full object-cover" /> : (
        <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
          {file.type.startsWith('image/') ? <FileImage className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
          <span className="truncate text-xs">{file.name}</span>
        </div>
      )}
    </div>
  );
}
