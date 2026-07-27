-- Membership classes and lifecycle settings are reference data used throughout
-- the member portal. Staff can briefly have an AAL1 session while completing an
-- MFA challenge, so restricting SELECT hides otherwise-current memberships and
-- leaves the UI with incomplete labels.
--
-- Privileged writes remain protected: the existing admin management policies use
-- current_user_is_admin(), which requires an AAL2 session.
drop policy if exists require_staff_aal2 on public.membership_classes;
drop policy if exists require_staff_aal2 on public.membership_settings;
