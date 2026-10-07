import { createContext } from 'react';
import type { UIMessage } from 'ai';
import type { ToolView } from '../components/chat/message';

export const CanvasConversation = createContext<{ chatId: string; anchor?: string; editing?: boolean }>({ chatId: '' });

export function isCanvasDrawing(part: ToolView): boolean {
  const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5);
  return ['canvas_add', 'canvas_update', 'canvas_delete', 'canvas_clear', 'canvas_layout'].includes(name ?? '');
}

export function canvasAnchor(messages: UIMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    for (const part of message.parts) {
      const tool = part as ToolView;
      if (isCanvasDrawing(tool) && tool.state === 'output-available' &&
        tool.output && typeof tool.output === 'object' && 'kind' in tool.output && tool.output.kind === 'canvas') {
        return tool.toolCallId;
      }
    }
  }
  return undefined;
}

export function canvasEditing(messages: UIMessage[]): boolean {
  const latest = messages.at(-1);
  if (latest?.role !== 'assistant') return false;

  return latest.parts.some((part) => {
    const tool = part as ToolView;

    return isCanvasDrawing(tool) && ['input-streaming', 'input-available'].includes(tool.state ?? '');
  });
}
