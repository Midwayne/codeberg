import { Download } from 'lucide-react';
import { buttonClass } from './button-styles';
import { exclusiveEnd, inclusiveEnd, usagePresets, type UsageRange } from '../lib/model-usage';

export type UsageControlsProps = {
  range: UsageRange;
  preset: string;
  onRange: (range: UsageRange) => void;
  onPreset: (preset: string) => void;
  onExport: () => void;
  exporting: boolean;
};

export function UsageControls({ range, preset, onRange, onPreset, onExport, exporting }: UsageControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <DateRange range={range} onRange={onRange} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Usage period">
          {usagePresets.map(([id, label]) => (
            <button type="button" key={id} aria-pressed={preset === id} onClick={() => onPreset(id)}
              className={`min-h-11 rounded-lg px-3 text-sm ${preset === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onExport} disabled={exporting} className={`${buttonClass} flex items-center gap-2`}>
        <Download className="size-4" aria-hidden="true" />{exporting ? 'Exporting…' : 'Export CSV'}
      </button>
    </div>
  );
}

function DateRange({ range, onRange }: Pick<UsageControlsProps, 'range' | 'onRange'>) {
  const inputClass = 'min-h-11 min-w-0 w-full bg-transparent px-2 text-sm';

  return (
    <fieldset className="flex w-full min-w-0 items-center rounded-lg border border-border sm:w-auto">
      <legend className="sr-only">Custom UTC date range</legend>
      <label className="min-w-0 flex-1"><span className="sr-only">Start date (UTC)</span>
        <input type="date" aria-label="Start date (UTC)" value={range.start} className={inputClass}
          onChange={(event) => { if (event.target.value) onRange({ ...range, start: event.target.value }); }} />
      </label>
      <span className="text-muted-foreground" aria-hidden="true">–</span>
      <label className="min-w-0 flex-1"><span className="sr-only">End date (UTC)</span>
        <input type="date" aria-label="End date (UTC)" value={inclusiveEnd(range.end)} className={inputClass}
          onChange={(event) => { if (event.target.value) onRange({ ...range, end: exclusiveEnd(event.target.value) }); }} />
      </label>
    </fieldset>
  );
}
