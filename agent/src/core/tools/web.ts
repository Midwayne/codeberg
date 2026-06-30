import type { ToolSet } from "ai";

import { webTools } from "../web/tools.js";
import type { WebConfig } from "../web/types.js";
import type { ToolSource } from "./source.js";

/**
 * The agent's web tools (`web_search` + `fetch_url`), as a tool source. Gating —
 * web use on/off, whether a search backend is configured — lives in `webTools`;
 * this adapter just places those tools in the composition order.
 */
export function webToolSource(config: WebConfig): ToolSource {
  return {
    name: "web",
    tools: (): ToolSet => webTools(config),
  };
}
