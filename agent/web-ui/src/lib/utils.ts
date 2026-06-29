import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  go: "go", py: "python", rs: "rust", java: "java", kt: "kotlin",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp",
  rb: "ruby", php: "php", swift: "swift", scala: "scala", sql: "sql",
  sh: "bash", bash: "bash", zsh: "bash", json: "json", yml: "yaml",
  yaml: "yaml", toml: "toml", md: "markdown", html: "html", css: "css",
  proto: "proto", dockerfile: "dockerfile",
};

/** Best-effort shiki language id from a file path, for snippet highlighting. */
export function langFromPath(path: string): string {
  const name = path.split("/").pop() ?? "";
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "";
}
