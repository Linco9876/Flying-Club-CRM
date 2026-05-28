/*
  Refine the Bendigo Flying Club RAAus ab-initio course lesson structure.

  Changes:
  - Split combined effects/straight-and-level and climb/turn lessons.
  - Remove induction and aircraft familiarisation as standalone lessons.
  - Split initial circuits from go-around / continued circuits.
  - Remove standalone exam lessons from the flying lesson list and keep exam
    prompts inside the relevant lesson descriptions and instructor notes.
*/

DO $$
DECLARE
  target_course_id uuid;
  pass_all jsonb := '{
    "gsp-knowledge":"S",
    "gsp-handling":"S",
    "gsp-airmanship":"S",
    "gsp-tem":"S",
    "gsp-records":"S"
  }'::jsonb;
BEGIN
  SELECT id INTO target_course_id
  FROM public.training_courses
  WHERE title = 'RAAus Ab-Initio RPC - Group A (3-Axis)'
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_course_id IS NULL THEN
    RAISE NOTICE 'RAAus ab-initio course not found; skipping refinement.';
    RETURN;
  END IF;

  UPDATE public.training_courses
  SET
    estimated_duration_hours = 22,
    description = 'Structured ab-initio course for the RAAus Recreational Pilot Certificate in Group A 3-axis aircraft. Flying lessons are kept separate from exam recording; exam requirements are called out in the relevant lesson descriptions so they are not missed.',
    objectives = ARRAY[
      'Develop a safe ab-initio pilot from first effects-of-controls lesson through first solo and RPC flight test readiness',
      'Cover RAAus Group A 3-axis core competencies: controls, straight and level, climb and descent, turns, stalls, circuits, forced landings, training area operations and abnormal situations',
      'Record flying progress using consistent NC/S/C/- grading and instructor notes',
      'Prompt required theory milestones without mixing exam records into the flying lesson list',
      'Prepare the student for CFI or approved examiner assessment in accordance with current RAAus documents'
    ],
    evaluation_criteria = ARRAY[
      'All mandatory pre-solo flying items marked S or C before first solo',
      'Pre-solo exam and local aerodrome/procedure questions completed before first solo',
      'Radio, BAK and pre-certificate Air Law exam requirements tracked separately before RPC recommendation',
      'Final lessons demonstrate safe, repeatable aircraft control, procedures, airmanship and decision making',
      'CFI confirms readiness for solo and later Pilot Certificate flight test'
    ],
    last_updated = now()
  WHERE id = target_course_id;

  DELETE FROM public.training_lessons
  WHERE course_id = target_course_id;

  INSERT INTO public.training_lessons (
    course_id,
    sort_order,
    name,
    objective,
    flight_exercises,
    theory,
    sequence_id,
    sequence_code,
    sequence_title,
    stage,
    duration_minutes,
    min_competency,
    key_exercises,
    student_preparation,
    instructor_notes,
    pass_marks
  )
  VALUES
  (target_course_id, 1, 'Effects of controls',
   'Introduce the primary, secondary and further effects of controls, trim, balance and coordinated handling.',
   '<ul><li>Primary effects of elevator, aileron and rudder.</li><li>Secondary and further effects.</li><li>Power effects and trim.</li><li>Balanced flight and lookout before manoeuvres.</li></ul>',
   '<p>RAAus Unit 1.01 effects of controls. Include cockpit, checklist and aircraft familiarisation where needed inside this first aircraft-handling lesson rather than as a separate course item.</p>',
   'raaus-abinitio-01', '1.01-3', 'Effects of controls',
   'flight', 60, 'Introduce',
   ARRAY['Primary effects', 'Secondary effects', 'Trim', 'Balanced flight', 'Lookout before manoeuvres'],
   'Review aircraft checklist, cockpit controls, trim, primary flight controls and four forces.',
   'Fold any aircraft familiarisation gaps into this lesson. Do not mark complete until the student can identify controls and use checklists safely.',
   pass_all),

  (target_course_id, 2, 'Straight and level',
   'Develop attitude reference, power setting, trim and altitude/heading/airspeed maintenance in straight and level flight.',
   '<ul><li>Set and maintain straight and level attitude.</li><li>Use power and trim correctly.</li><li>Maintain altitude, heading and airspeed.</li><li>Recover from small deviations.</li></ul>',
   '<p>RAAus Unit 1.01 straight and level. Relate attitude, power and performance to the aircraft POH.</p>',
   'raaus-abinitio-02', '1.01-4', 'Straight and level',
   'flight', 75, 'Introduce',
   ARRAY['Attitude reference', 'Power setting', 'Trim', 'Altitude/heading/airspeed control', 'Deviation correction'],
   'Revise attitude-power-performance and local training area orientation.',
   'Watch for instrument fixation. Require outside reference and a structured lookout cycle.',
   pass_all),

  (target_course_id, 3, 'Climbing and descending',
   'Teach normal climb and descent entries, maintenance, checks, engine management and level-off anticipation.',
   '<ul><li>Normal climb entry and maintenance.</li><li>Normal descent and glide descent.</li><li>Level-off from climb and descent.</li><li>Engine management and lookout.</li></ul>',
   '<p>RAAus Unit 1.01 climbing and descending. Cover best rate/best angle concepts, glide attitude and aircraft limitations.</p>',
   'raaus-abinitio-03', '1.01-5', 'Climbing and descending',
   'flight', 75, 'Practice',
   ARRAY['Climb checks', 'Descent checks', 'Level-off anticipation', 'Engine management', 'Lookout'],
   'Review climb/descent speeds, power settings and engine limitations.',
   'Student should verbalise checks and anticipate level-offs without chasing instruments.',
   pass_all),

  (target_course_id, 4, 'Medium turns',
   'Teach coordinated level, climbing and descending turns with correct lookout, balance and altitude control.',
   '<ul><li>Lookout and clearing turns.</li><li>Medium level turns.</li><li>Climbing and descending turns.</li><li>Roll-out anticipation and balance.</li></ul>',
   '<p>RAAus Unit 1.01 turning. Include balance, load factor awareness and overbanking tendencies.</p>',
   'raaus-abinitio-04', '1.01-6', 'Turning',
   'flight', 75, 'Practice',
   ARRAY['Lookout before turn', 'Coordinated entry', 'Maintaining altitude', 'Roll-out anticipation', 'Climbing/descending turns'],
   'Revise angle of bank, rudder coordination and lookout technique.',
   'Do not progress until lookout is habitual before and during turns.',
   pass_all),

  (target_course_id, 5, 'Slow flight, stalls and upset prevention awareness',
   'Introduce slow flight, stall symptoms, stall recovery and safe recovery mindset within aircraft and CFI limitations.',
   '<ul><li>Slow flight and symptoms approaching the stall.</li><li>Stall entry and recovery in approved configurations.</li><li>Wing-drop discussion or demonstration only where aircraft and CFI limits permit.</li><li>UPRT awareness: unload, roll wings level, recover.</li></ul>',
   '<p>RAAus Unit 1.01 stalling. Cover angle of attack, load factor, stall speed variables and minimum safe heights.</p>',
   'raaus-abinitio-05', '1.01-7', 'Stalling',
   'flight', 90, 'Practice',
   ARRAY['Slow flight', 'Stall recognition', 'Stall recovery', 'Minimum height discipline', 'UPRT awareness'],
   'Read POH stall speeds and limitations. Revise HASELL or club equivalent pre-manoeuvre checks.',
   'Conduct stalls in accordance with current FOM, CFI approval and aircraft limitations.',
   pass_all),

  (target_course_id, 6, 'Circuit introduction, take-off, approach and landing',
   'Introduce the normal circuit pattern, take-off, downwind/base/final procedures, approach and landing.',
   '<ul><li>Runway entry and normal take-off.</li><li>Climb-out and circuit tracking.</li><li>Downwind checks and spacing.</li><li>Base/final approach, flare and landing roll.</li></ul>',
   '<p>RAAus Unit 1.01 circuits. Cover local Bendigo circuit procedures, wind assessment, runway selection and stable approach criteria.</p>',
   'raaus-abinitio-06', '1.01-8.1/8.3', 'Circuit introduction',
   'flight', 90, 'Introduce',
   ARRAY['Take-off', 'Circuit tracking', 'Downwind checks', 'Approach path', 'Landing'],
   'Review Bendigo circuit directions, radio calls, runway markings and local noise abatement.',
   'Initial circuit lesson excludes detailed go-around consolidation; introduce go-around only as required for safety.',
   pass_all),

  (target_course_id, 7, 'Go-around and continued circuits',
   'Consolidate circuits and teach decisive go-around procedures from approach or landing.',
   '<ul><li>Continued normal circuits.</li><li>Recognise unstable approach or unsafe landing cues.</li><li>Go-around power, attitude, configuration and tracking.</li><li>Rejoin circuit after go-around.</li></ul>',
   '<p>RAAus Unit 1.01 circuits and go-around. Tie go-around decisions to stable approach criteria and student command judgement.</p>',
   'raaus-abinitio-07', '1.01-8.6', 'Go-around procedures',
   'flight', 90, 'Practice',
   ARRAY['Circuit consistency', 'Go-around decision', 'Power/attitude/configuration', 'Tracking after go-around', 'Radio call'],
   'Prepare go-around callouts and review reasons for discontinuing an approach.',
   'Student must treat go-around as a normal safe decision, not a failure.',
   pass_all),

  (target_course_id, 8, 'Circuit consolidation and circuit emergencies',
   'Build repeatable circuit performance and introduce engine failure and abnormal situations in the circuit.',
   '<ul><li>Normal and flapless approaches where applicable.</li><li>Crosswind considerations.</li><li>Engine failure after take-off briefing and actions.</li><li>Engine failure in circuit and rejected landing/go-around.</li></ul>',
   '<p>Pre-solo exam: schedule and record the pre-solo exam separately before first solo. Include required local aerodrome/procedure questions in accordance with club/RAAus requirements.</p>',
   'raaus-abinitio-08', '1.01-8.5', 'Circuit emergencies and precautions',
   'flight', 90, 'Practice',
   ARRAY['Consistent circuits', 'Stable approaches', 'Emergency brief', 'EFATO actions', 'Go-around judgement'],
   'Prepare the standard pre-take-off safety brief and local forced landing options.',
   'Before solo, confirm the pre-solo exam/local questions are recorded outside the flying lesson list.',
   pass_all),

  (target_course_id, 9, 'First solo and supervised solo circuit consolidation',
   'Conduct first solo if authorised, then consolidate safe solo circuit performance under close supervision.',
   '<ul><li>Authorised first solo circuit or dual remedial circuit as required.</li><li>Solo debrief and logbook/training record update.</li><li>Subsequent supervised solo circuits within set limits.</li></ul>',
   '<p>Solo responsibilities, weather and runway limits, radio discipline, go-around authority and post-flight reporting.</p>',
   'raaus-abinitio-09', 'SOLO-1', 'First solo and supervised solo circuits',
   'flight', 60, 'Assess',
   ARRAY['Solo authorisation', 'Normal solo circuit', 'Go-around decision', 'Post solo debrief', 'Logbook discipline'],
   'Review solo brief, emergency actions and personal minimums.',
   'If first solo is not conducted, record specific remedial items and do not mark complete.',
   pass_all),

  (target_course_id, 10, 'Training area operations and radio procedures',
   'Teach safe transit to/from the training area, local area orientation, radio procedures and airspace awareness.',
   '<ul><li>Departure and arrival procedures.</li><li>Training area boundaries and landmarks.</li><li>Radio calls, listening watch and traffic integration.</li><li>Rejoin and circuit integration.</li></ul>',
   '<p>Radio Exam: record the Radio Exam separately for this course. Do not display it as a flying lesson, but ensure it is completed before Radio Operator endorsement or certificate recommendation as applicable.</p>',
   'raaus-abinitio-10', '1.01-10 / 2.04', 'Training area operations and radio',
   'flight', 90, 'Practice',
   ARRAY['Area departure', 'Area orientation', 'Radio phraseology', 'Traffic integration', 'Rejoin procedure'],
   'Study Bendigo VTC/VNC/ERSA entries, CTAF procedures and standard radio calls.',
   'Prompt Radio Exam completion in the separate exam record area.',
   pass_all),

  (target_course_id, 11, 'Forced landing, glide approaches and sideslip awareness',
   'Develop forced landing judgement, field selection, glide profile management and sideslip where aircraft approved.',
   '<ul><li>Engine failure away from circuit.</li><li>Field selection and high/low key planning.</li><li>Restart checks, passenger brief, mayday and shutdown checks.</li><li>Sideslip awareness or practice if fitted and approved.</li></ul>',
   '<p>RAAus Unit 1.01 forced landings and sideslip. Cover best glide, wind assessment and aircraft-specific sideslip limitations.</p>',
   'raaus-abinitio-11', '1.01-9.2/9.3', 'Forced landings and sideslip',
   'flight', 90, 'Practice',
   ARRAY['Immediate actions', 'Field selection', 'Glide profile', 'Emergency checks', 'Airmanship under pressure'],
   'Revise forced landing checklist, best glide speed and local practice areas.',
   'Maintain safe heights and avoid normalising low-level manoeuvring outside approved exercise parameters.',
   pass_all),

  (target_course_id, 12, 'Precautionary search and landing',
   'Teach precautionary search planning and decision making for deteriorating conditions or uncertain landing areas.',
   '<ul><li>Reasons for precautionary landing.</li><li>Inspection passes at safe heights as applicable.</li><li>Obstacle, slope, surface and wind assessment.</li><li>Decision to continue, divert or land.</li></ul>',
   '<p>RAAus Unit 1.01 precautionary search and landing. This is not a low-level endorsement lesson.</p>',
   'raaus-abinitio-12', '1.01-9.4', 'Precautionary search and landing',
   'flight', 90, 'Practice',
   ARRAY['Early decision making', 'Landing area inspection', 'Wind and obstacle assessment', 'Passenger brief', 'Diversion mindset'],
   'Read club guidance on precautionary landing and weather decision triggers.',
   'Emphasise conservative judgement and early diversion decisions.',
   pass_all),

  (target_course_id, 13, 'Abnormal situations and emergency management',
   'Consolidate abnormal and emergency management across aircraft systems, flight controls, instruments and operational threats.',
   '<ul><li>Engine, fuel, electrical and instrument abnormalities.</li><li>Control restriction or trim issues discussion.</li><li>Fire, door/canopy, radio failure and passenger illness scenarios.</li><li>Decision making and diversion planning.</li></ul>',
   '<p>RAAus Unit 1.01 abnormal and emergency situations. Include club safety reporting process.</p>',
   'raaus-abinitio-13', '1.01-11', 'Manage abnormal situations and emergencies',
   'flight', 90, 'Practice',
   ARRAY['Aviate-navigate-communicate', 'Checklist discipline', 'Diversion decisions', 'Emergency communication', 'Incident reporting'],
   'Review POH emergency procedures and club safety reporting process.',
   'Assess calm prioritisation, not rote recitation only.',
   pass_all),

  (target_course_id, 14, 'RPC consolidation: flight test profile practice',
   'Consolidate all Group A RPC competencies in a representative flight test profile.',
   '<ul><li>Pre-flight planning and briefing.</li><li>Departure, area manoeuvres, stalls, forced landing, circuits and emergencies.</li><li>Post-flight self-critique and records.</li></ul>',
   '<p>BAK Exam: record the BAK Exam separately for this course before certificate recommendation. This lesson should identify any remaining BAK-linked knowledge gaps.</p>',
   'raaus-abinitio-14', 'RPC-CONSOL', 'RPC consolidation',
   'flight', 120, 'Assess',
   ARRAY['Complete flight profile', 'Independent checks', 'Accurate handling', 'Sound judgement', 'Self-critique'],
   'Prepare as for a flight test. Bring logbook, completed exam evidence and student records.',
   'Confirm BAK Exam has been recorded separately or list it as an outstanding item.',
   pass_all),

  (target_course_id, 15, 'CFI recommendation and Pilot Certificate readiness review',
   'Complete final readiness review, documentation audit and recommendation decision for RAAus Pilot Certificate flight test.',
   '<ul><li>Student file audit: hours, PIC, lessons, exams and endorsements.</li><li>Oral review of limitations, privileges and local operations.</li><li>Final dual check or remedial plan.</li><li>CFI recommendation or hold point.</li></ul>',
   '<p>Pre Certificate Airlaw Exam: record this exam separately for this course before RPC recommendation. Confirm Radio and BAK exam records are also complete.</p>',
   'raaus-abinitio-15', 'RPC-REVIEW', 'Pilot Certificate readiness review',
   'flight', 90, 'Assess',
   ARRAY['Minimum experience checked', 'Theory exams checked', 'Training records complete', 'Privileges and limitations understood', 'CFI recommendation decision'],
   'Bring logbook, student file, exam evidence and any outstanding records.',
   'Do not recommend until flying records, Radio Exam, BAK Exam and Pre Certificate Airlaw Exam records are complete.',
   pass_all);
END $$;
