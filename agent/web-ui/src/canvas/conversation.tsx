import { createContext } from 'react';
import type { UIMessage } from 'ai';
import type { ToolView } from '../components/chat/message';

export const CanvasConversation = createContext<{ chatId: string; anchor?: string }>({ chatId: '' });

export function isCanvasDrawing(part: ToolView): boolean {
  const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5);
  return ['canvas_add', 'canvas_update', 'canvas_delete', 'canvas_clear', 'canvas_layout'].includes(name ?? '');
}

export function canvasAnchor(messages: UIMessage[]): string | undefined {
  for (const message of [...messages].reverse()) {
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
