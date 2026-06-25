import type { AskResult } from "../core/types.js";
import { formatSource } from "../core/format.js";

export function printResult(result: AskResult): void {
  console.log(result.answer);
  if (result.sources.length > 0) {
    console.error("\n--- sources ---");
    for (const s of result.sources) {
      console.error(formatSource(s));
    }
  }
  const perf = formatPerformance(result.performance);
  if (perf) {
    console.error(`\n${perf}`);
  }
}

function formatPerformance(perf: AskResult["performance"]): string | undefined {
  if (!perf) {
    return undefined;
  }
  const parts: string[] = [];
  if (perf.outputTokensPerSecond != null) {
    parts.push(`${perf.outputTokensPerSecond.toFixed(1)} tok/s`);
  }
  if (perf.responseTimeMs != null) {
    parts.push(`${(perf.responseTimeMs / 1000).toFixed(1)}s`);
  }
  return parts.length > 0 ? `--- ${parts.join(" · ")} ---` : undefined;
}
