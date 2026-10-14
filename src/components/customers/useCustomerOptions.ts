'use client';

import { useEffect, useState } from 'react';
import type { TenantMembership } from '@/lib/auth/authorization';
import { getAllTenantDataCloud } from '@/lib/dbService';
import { customerChoices, isCurrentCustomerSource, type CustomerChoice } from '@/lib/customers/selection';

type Source = { userId: string; membership: TenantMembership; status: 'ready' | 'unavailable'; choices: CustomerChoice[] };

// Read-only and separate from the manager's aggregate. Never use its shared cache.
export function useCustomerOptions(userId: string | undefined, membership: TenantMembership | null) {
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    if (!userId || !membership) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getAllTenantDataCloud(membership.tenant_id);
        const valid = Array.isArray(payload?.customers);
        if (!cancelled) setSource({ userId, membership, status: valid ? 'ready' : 'unavailable', choices: valid ? customerChoices(payload.customers) : [] });
      } catch {
        if (!cancelled) setSource({ userId, membership, status: 'unavailable', choices: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [userId, membership]);
  if (!isCurrentCustomerSource(source, userId, membership)) return { status: 'loading' as const, choices: [] };
  return { status: source!.status, choices: source!.choices };
}
