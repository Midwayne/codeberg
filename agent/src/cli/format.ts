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
}
