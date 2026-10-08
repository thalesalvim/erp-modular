'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { clearIdentityCaches, loadIdentityContext, signInWithEmail, signOutAndClearIdentity } from '@/lib/auth/authService';
import type { TenantMembership } from '@/lib/auth/authorization';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  user: User | null;
  memberships: TenantMembership[];
  selectedMembership: TenantMembership | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectTenant: (tenantId: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: authError } = await supabase.auth.getUser();
    setError(null);
    if (authError || !data.user) {
      setUser(null);
      setMemberships([]);
      setSelectedTenantId(null);
      setLoading(false);
      return;
    }

    try {
      const identity = await loadIdentityContext(supabase, data.user);
      setUser(identity.user);
      setMemberships(identity.memberships);
      setSelectedTenantId((current) => {
        if (current && identity.memberships.some((membership) => membership.tenant_id === current)) return current;
        return identity.memberships.length === 1 ? identity.memberships[0].tenant_id : null;
      });
    } catch {
      setUser(data.user);
      setMemberships([]);
      setSelectedTenantId(null);
      setError('Não foi possível confirmar as associações empresariais da conta.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Defer network verification until the SDK finishes its auth callback.
      void Promise.resolve().then(() => refresh());
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const identity = await signInWithEmail(supabase, email, password);
      clearIdentityCaches();
      setUser(identity.user);
      setMemberships(identity.memberships);
      setSelectedTenantId(identity.memberships.length === 1 ? identity.memberships[0].tenant_id : null);
    } catch (caught) {
      setUser(null);
      setMemberships([]);
      setSelectedTenantId(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir a autenticação.');
      throw caught;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await signOutAndClearIdentity(supabase);
    } finally {
      setUser(null);
      setMemberships([]);
      setSelectedTenantId(null);
      setError(null);
      setLoading(false);
    }
  }, []);

  const selectTenant = useCallback((tenantId: string) => {
    const authorized = memberships.some((membership) => membership.tenant_id === tenantId);
    if (!authorized) return false;
    setSelectedTenantId(tenantId);
    return true;
  }, [memberships]);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.tenant_id === selectedTenantId) ?? null,
    [memberships, selectedTenantId],
  );

  const value = useMemo<AuthContextValue>(() => ({
    user, memberships, selectedMembership, loading, error, signIn, signOut, selectTenant, refresh,
  }), [user, memberships, selectedMembership, loading, error, signIn, signOut, selectTenant, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de AuthProvider.');
  return value;
}
