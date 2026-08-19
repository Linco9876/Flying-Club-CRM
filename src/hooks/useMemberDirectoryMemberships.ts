import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MemberDirectoryMembershipSummary } from '../utils/memberCardSummary';

interface MemberDirectoryMembershipRow {
  user_id: string;
  legal_status: string | null;
  membership_class_name: string | null;
  membership_class_code: string | null;
  application_status: string | null;
  application_class_name: string | null;
}

export const useMemberDirectoryMemberships = () => {
  const [summaries, setSummaries] = useState<MemberDirectoryMembershipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error: queryError } = await supabase.rpc('get_member_directory_membership_summaries');

    if (queryError) {
      console.error('Could not load member directory membership summaries:', queryError);
      setSummaries([]);
      setError(queryError.message || 'Membership summaries could not be loaded');
      setLoading(false);
      return;
    }

    setSummaries(((data || []) as MemberDirectoryMembershipRow[]).map(row => ({
      userId: row.user_id,
      legalStatus: row.legal_status,
      membershipClassName: row.membership_class_name,
      membershipClassCode: row.membership_class_code,
      applicationStatus: row.application_status,
      applicationClassName: row.application_class_name,
    })));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const summariesByUserId = useMemo(
    () => new Map(summaries.map(summary => [summary.userId, summary])),
    [summaries],
  );

  return { summariesByUserId, loading, error, refetch };
};
