import { useState } from 'react';

/**
 * Pull-to-refresh that only spins when the person pulled.
 *
 * Screens also refetch quietly (coming back to a screen, polling while a post is processed,
 * after an edit). Tying the spinner to those made iOS pull the list down on its own, as if it
 * had been dragged, every time you came back to a screen.
 */
export function usePullToRefresh(refresh: () => Promise<unknown> | unknown) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, onRefresh };
}
