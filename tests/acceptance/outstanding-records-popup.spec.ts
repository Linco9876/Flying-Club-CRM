import { expect, test, type Page, type Route } from '@playwright/test';

const ids = {
  instructor: '11111111-1111-4111-8111-111111111111',
  student: '22222222-2222-4222-8222-222222222222',
  otherInstructor: '33333333-3333-4333-8333-333333333333',
  flightLog: '44444444-4444-4444-8444-444444444444',
  aircraft: '55555555-5555-4555-8555-555555555555',
  course: '66666666-6666-4666-8666-666666666666',
  preSoloLesson: '77777777-7777-4777-8777-777777777777',
  soloLesson: '88888888-8888-4888-8888-888888888888',
  testLesson: '99999999-9999-4999-8999-999999999999',
  deficiency: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  enrolment: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  criterion: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

const instructor = {
  id: ids.instructor,
  email: 'cfi@example.test',
  name: 'Test CFI',
  role: 'instructor',
  is_active: true,
  portal_access_scope: 'full',
};

const student = {
  id: ids.student,
  email: 'student@example.test',
  name: 'Alex Student',
  role: 'student',
  is_active: true,
  portal_access_scope: 'full',
};

const otherInstructor = {
  id: ids.otherInstructor,
  email: 'other@example.test',
  name: 'Other Instructor',
  role: 'instructor',
  is_active: true,
  portal_access_scope: 'full',
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: { 'content-range': Array.isArray(body) ? `0-${Math.max(0, body.length - 1)}/${body.length}` : '0-0/1' },
  body: JSON.stringify(body),
});

const installMockSession = async (page: Page) => {
  const now = Math.floor(Date.now() / 1000);
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    sub: ids.instructor,
    role: 'authenticated',
    aal: 'aal2',
    amr: [{ method: 'totp', timestamp: now }],
  })}.test-signature`;
  const session = {
    access_token: accessToken,
    refresh_token: 'test-refresh-token',
    expires_at: now + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: ids.instructor,
      aud: 'authenticated',
      role: 'authenticated',
      email: instructor.email,
      app_metadata: { provider: 'email', providers: ['email'], roles: ['instructor', 'cfi'] },
      user_metadata: { name: instructor.name },
      created_at: new Date().toISOString(),
    },
  };

  await page.addInitScript(({ storageKey, storedSession }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedSession));
  }, {
    storageKey: 'sb-kcfjnpngnouyvcuvfleu-auth-token',
    storedSession: session,
  });
};

const installApiMocks = async (page: Page) => {
  await page.route('**/functions/v1/**', route => {
    if (route.request().url().includes('/financial-provider-status')) {
      return json(route, {
        mode: 'disabled',
        financeEnabled: false,
        stripe: { linked: false, configured: false, connected: false, status: 'disconnected', reason: null, paymentsAvailable: false, mode: 'test' },
        xero: { linked: false, configured: false, connected: false, status: 'disconnected', reason: null, accountingAvailable: false, postingAvailable: false, connectionMode: 'disconnected' },
        combined: { paymentReconciliationAvailable: false },
      });
    }
    return json(route, {});
  });
  await page.route('**/auth/v1/**', route => json(route, sessionUserResponse(route)));
  await page.route('**/rest/v1/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/').pop() || '';
    const wantsObject = request.headers().accept?.includes('application/vnd.pgrst.object+json');

    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      return json(route, wantsObject ? {} : []);
    }

    if (table === 'users') {
      const isSingleProfileLookup = url.searchParams.get('id')?.startsWith('eq.');
      return json(route, wantsObject || isSingleProfileLookup ? instructor : [instructor, student, otherInstructor]);
    }
    if (table === 'user_roles') {
      const roles = url.searchParams.has('user_id')
        ? [{ role: 'instructor' }, { role: 'cfi' }]
        : [
            { user_id: ids.instructor, role: 'instructor' },
            { user_id: ids.instructor, role: 'cfi' },
            { user_id: ids.student, role: 'student' },
            { user_id: ids.otherInstructor, role: 'instructor' },
          ];
      return json(route, roles);
    }
    if (table === 'flight_logs') {
      if (url.search.includes('training_record_status=eq.dismissed')) return json(route, []);
      return json(route, [{
        id: ids.flightLog,
        booking_id: null,
        aircraft_id: ids.aircraft,
        student_id: ids.student,
        instructor_id: ids.instructor,
        start_time: '2026-08-15T00:00:00.000Z',
        end_time: '2026-08-15T01:10:00.000Z',
        dual_time: 1.1,
        solo_time: 0,
        training_record_status: 'pending',
      }]);
    }
    if (table === 'training_records') return json(route, []);
    if (table === 'training_courses') return json(route, [{
      id: ids.course,
      title: 'RAAus Ab-Initio',
      description: 'Test training course',
      category: 'RAAus',
      version: '1.0',
      status: 'published',
      course_purpose: 'training',
      assessment_criteria: [{ id: ids.criterion, name: 'Aircraft handling', gradingSystem: 'NC/S/C/-' }],
      requires_student_acknowledgement: true,
      two_occasion_competency_rule_enabled: false,
      last_updated: '2026-08-15T00:00:00.000Z',
    }]);
    if (table === 'training_lessons') return json(route, [
      {
        id: ids.preSoloLesson,
        course_id: ids.course,
        sort_order: 1,
        name: 'Circuit introduction',
        sequence_title: 'Circuit introduction',
        objective: 'Prepare for solo circuits',
        stage: 'flight',
        pass_marks: { [ids.criterion]: 'S' },
        is_flight_test: false,
      },
      {
        id: ids.soloLesson,
        course_id: ids.course,
        sort_order: 2,
        name: 'First Solo',
        sequence_title: 'First Solo',
        objective: 'First supervised solo',
        stage: 'flight',
        pass_marks: { [ids.criterion]: 'S' },
        is_flight_test: false,
      },
      {
        id: ids.testLesson,
        course_id: ids.course,
        sort_order: 3,
        name: 'Pilot Certificate Flight Test',
        sequence_title: 'Pilot Certificate Flight Test',
        objective: 'Official flight test',
        stage: 'flight',
        pass_marks: { [ids.criterion]: 'C' },
        is_flight_test: true,
      },
    ]);
    if (table === 'training_deficiencies') return json(route, [{
      id: ids.deficiency,
      student_id: ids.student,
      course_id: ids.course,
      source_lesson_id: ids.preSoloLesson,
      source_training_record_id: null,
      stage: 'pre_solo',
      description: 'Maintain centreline and directional control during the landing roll.',
      status: 'open',
      created_by: ids.instructor,
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
    }]);
    if (table === 'student_course_enrolments') return json(route, [{
      id: ids.enrolment,
      student_id: ids.student,
      course_id: ids.course,
      enrolled_by: ids.instructor,
      status: 'active',
      notes: '',
      enrolled_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }]);
    if (table === 'aircraft') return json(route, [{
      id: ids.aircraft,
      registration: '24-9999',
      make: 'Tecnam',
      model: 'P92',
      type: 'single-engine',
      status: 'serviceable',
      active: true,
    }]);
    if (table === 'training_syllabus_settings') return json(route, wantsObject ? {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      require_flight_comments: true,
      require_briefing_comments_when_formal: true,
      default_formal_briefing: false,
      prefill_highest_grades: true,
      next_lesson_rule: 'advance_on_pass',
      auto_notify_student_on_submit: true,
      auto_mark_flight_log_recorded: true,
      show_pass_mark_guidance: true,
      show_best_grade_guidance: true,
    } : []);

    return json(route, wantsObject ? {} : []);
  });
};

const sessionUserResponse = (route: Route) => route.request().url().includes('/auth/v1/user')
  ? { id: ids.instructor, email: instructor.email, app_metadata: { roles: ['instructor', 'cfi'] }, user_metadata: {} }
  : {};

test('CFI outstanding record pop-out is usable on desktop and phone widths', async ({ page }, testInfo) => {
  await installMockSession(page);
  await installApiMocks(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto('http://127.0.0.1:4178/training/outstanding-records');
  await expect(page.getByRole('heading', { name: 'Outstanding Records' })).toBeVisible();
  await page.getByRole('button', { name: /Create Record/ }).click();

  await expect(page.getByRole('dialog', { name: 'Choose outstanding record type' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Lesson/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Review \/ Test/ })).toBeVisible();

  await page.getByRole('button', { name: /Lesson/ }).click();
  await expect(page.getByRole('dialog', { name: 'Lesson training record' })).toBeVisible();
  await page.getByRole('button', { name: /Recommended next lesson/ }).click();

  await expect(page.getByText('Training deficiencies')).toBeVisible();
  await expect(page.getByText('Instructor only')).toBeVisible();
  await expect(page.getByText(/Maintain centreline and directional control/)).toBeVisible();

  const deficiencyItem = page.getByText(/Maintain centreline and directional control/).locator('..').locator('..');
  await deficiencyItem.getByRole('checkbox').check();
  await expect(deficiencyItem.getByText('Fixed', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Before pilot test' }).click();
  await page.getByPlaceholder(/One specific issue/).fill('Use a stable approach speed without instructor prompting.');
  await page.getByRole('button', { name: 'Add deficiency' }).click();
  await expect(page.getByText('Use a stable approach speed without instructor prompting.')).toBeVisible();

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('desktop-deficiency-form.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: 'Lesson training record' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText('Training deficiencies')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('phone-deficiency-form.png') });
});
