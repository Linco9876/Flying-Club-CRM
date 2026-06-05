/*
  Allow staff to maintain member profile/contact records.

  The app allows admins, instructors and senior instructors to edit student/member
  profile details. These policies keep that UI in sync with RLS while leaving
  destructive archive/remove actions admin-only.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Staff can update member profile rows'
  ) THEN
    CREATE POLICY "Staff can update member profile rows"
      ON public.users
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_roles
          WHERE user_roles.user_id = (SELECT auth.uid())
            AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.user_roles
          WHERE user_roles.user_id = (SELECT auth.uid())
            AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'students'
      AND policyname = 'Staff can insert student profile rows'
  ) THEN
    CREATE POLICY "Staff can insert student profile rows"
      ON public.students
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.user_roles
          WHERE user_roles.user_id = (SELECT auth.uid())
            AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'students'
      AND policyname = 'Staff can update student profile rows'
  ) THEN
    CREATE POLICY "Staff can update student profile rows"
      ON public.students
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_roles
          WHERE user_roles.user_id = (SELECT auth.uid())
            AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.user_roles
          WHERE user_roles.user_id = (SELECT auth.uid())
            AND user_roles.role IN ('admin', 'instructor', 'senior_instructor')
        )
      );
  END IF;
END $$;
