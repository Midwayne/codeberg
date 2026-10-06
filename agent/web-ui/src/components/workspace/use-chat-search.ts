import { useProjectApi } from '../../lib/project-api';
import type { UIMessage } from 'ai';

import { useEffect, useMemo, useRef, useState } from 'react';
import { rankChatResults, searchChats, type ChatSearchResult } from '../../lib/chat-search';

export type ChatSearchOptions = {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, messageId?: string) => void;
  currentId: string;
  currentTitle: string;
  currentMessages: readonly UIMessage[];
  currentFlags: Pick<ChatSearchResult, 'archived' | 'pinned'>;
};

export function useChatSearch({
  open,
  onClose,
  onSelect,
  currentId,
  currentTitle,
  currentMessages,
  currentFlags,
}: ChatSearchOptions) {
  const { fetch: api } = useProjectApi();
  const { query, setRemote, remote, resultsRef, active, dialogRef, setActive, inputRef, setQuery } = useSearchFocus({
    open,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useRemoteSearch({ query, open, setLoading, setError, api, setRemote });
  const { current, others } = useRankedChatResults({
    query,
    currentId,
    currentTitle,
    currentMessages,
    remote,
    currentFlags,
  });

  const all = [...current, ...others];
  useSearchResultScroll({ resultsRef, active, remote, query });

  if (!open) return null;
  const { choose } = createSearchSelection({ onSelect, onClose });

  return {
    onClose,
    dialogRef,
    current,
    setActive,
    all,
    inputRef,
    active,
    choose,
    query,
    setQuery,
    resultsRef,
    loading,
    error,
    others,
  };
}

export type RemoteSearchOptions = Pick<Parameters<typeof useChatSearch>[0], 'open'> & {
  query: string;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  api: typeof fetch;
  setRemote: React.Dispatch<React.SetStateAction<{ query: string; hits: ChatSearchResult[] }>>;
};

export function useRemoteSearch({ query, open, setLoading, setError, api, setRemote }: RemoteSearchOptions) {
  useEffect(() => {
    const term = query.trim();
    if (!open || !term) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void searchChats(term, controller.signal, api)
        .then((hits) => {
          setRemote({ query: term, hits });
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : 'Search failed');
          setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, api]);
}

export type SearchFocusOptions = Pick<Parameters<typeof useChatSearch>[0], 'open'>;

function useSearchFocus({ open }: SearchFocusOptions) {
  const [query, setQuery] = useState('');

  const [remote, setRemote] = useState<{ query: string; hits: ChatSearchResult[] }>({ query: '', hits: [] });

  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const resultsRef = useRef<HTMLDivElement>(null);

  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setRemote({ query: '', hits: [] });
      setActive(0);
    }
  }, [open]);

  return { query, setRemote, remote, resultsRef, active, dialogRef, setActive, inputRef, setQuery };
}

export type RankedChatResultsOptions = Pick<
  Parameters<typeof useChatSearch>[0],
  'currentId' | 'currentTitle' | 'currentMessages' | 'currentFlags'
> & { query: string; remote: { query: string; hits: ChatSearchResult[] } };

function useRankedChatResults({
  query,
  currentId,
  currentTitle,
  currentMessages,
  remote,
  currentFlags,
}: RankedChatResultsOptions) {
  const { current, others } = useMemo(
    () =>
      rankChatResults(
        query,
        currentId,
        currentTitle,
        currentMessages,
        remote.query === query.trim() ? remote.hits : [],
        currentFlags,
      ),
    [query, currentId, currentTitle, currentMessages, remote, currentFlags],
  );

  return { current, others };
}

export type SearchResultScrollOptions = {
  resultsRef: React.RefObject<HTMLDivElement | null>;
  active: number;
  remote: { query: string; hits: ChatSearchResult[] };
  query: string;
};

function useSearchResultScroll({ resultsRef, active, remote, query }: SearchResultScrollOptions) {
  useEffect(() => {
    resultsRef.current?.querySelector(`[data-search-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, remote, query]);
}

function createSearchSelection({
  onSelect,
  onClose,
}: Pick<Parameters<typeof useChatSearch>[0], 'onSelect' | 'onClose'>) {
  const choose = (item: ChatSearchResult) => {
    onSelect(item.id, item.messageId);
    onClose();
  };

  return { choose };
}
