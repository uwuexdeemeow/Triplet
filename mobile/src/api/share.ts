import { useQuery } from '@tanstack/react-query';

import { api, type Schemas } from '@/api/client';

export type SharedTrip = Schemas['SharedTrip'];
export type ShareLink = Schemas['ShareLinkResponse'];

// Opened without signing in, so it's sent without a token
export function useSharedTrip(token: string | undefined) {
  return useQuery({
    queryKey: ['shared', token],
    queryFn: () => api<SharedTrip>(`/shared/${token}`, { auth: false }),
    enabled: !!token,
  });
}
