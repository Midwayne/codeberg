const scenarios = {
  recent: { label: 'Recent ↔ Recent', order: [0, 1], pinned: [] as number[] },
  pinned: { label: 'Pinned ↔ Pinned', order: [0, 1], pinned: [0, 1] },
  mixed: { label: 'Pinned ↔ Recent', order: [0, 2], pinned: [0, 1] },
  pinnedCycle: { label: 'Four pinned chats', order: [0, 1, 3, 4], pinned: [0, 1, 3, 4] },
  mixedCycle: { label: 'Four chats across both groups', order: [0, 1, 2, 3], pinned: [0, 1] },
};

export function switchingScenario() {
  const requested = new URL(location.href).searchParams.get('scenario');
  const key = requested && Object.hasOwn(scenarios, requested) ? requested as keyof typeof scenarios : 'recent';

  return scenarios[key];
}
