import { USAGE_KINDS, type UsageKind } from '@agent/core/usage';

export const usageActivityLabels: Record<UsageKind, string> = {
  chat: 'Chat',
  learning: 'Learning',
  decisions: 'Decisions',
};

export const usageActivities = USAGE_KINDS.map((kind) => [kind, usageActivityLabels[kind]] as const);
