/*
  Add a Bendigo Flying Club RAAus ab-initio training course.

  The course maps to RAAus Group A (3-axis) ab-initio training themes from the
  RAAus Syllabus of Flight Training and the Flight Operations Manual theory /
  solo / Pilot Certificate requirements. It is intentionally structured as a
  local training course with lesson records and grading, not as a replacement
  for current RAAus source documents or CFI judgement.
*/

DO $$
DECLARE
  course_id uuid;
  criteria jsonb := '[
    {"id":"gsp-knowledge","name":"Knowledge and briefing preparation","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"gsp-handling","name":"Aircraft handling and procedure","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"gsp-airmanship","name":"Airmanship, lookout and situational awareness","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"gsp-tem","name":"Threat and error management / decision making","gradingSystem":"NC/S/C/-","passingGrade":"S"},
    {"id":"gsp-records","name":"Logbook, training record and authorisation discipline","gradingSystem":"NC/S/C/-","passingGrade":"S"}
  ]'::jsonb;
BEGIN
  DELETE FROM public.training_courses
  WHERE title = 'RAAus Ab-Initio RPC - Group A (3-Axis)';

  INSERT INTO public.training_courses (
    title,
    description,
    category,
    version,
    status,
    estimated_duration_hours,
    prerequisites,
    objectives,
    evaluation_criteria,
    tags,
    assessment_criteria,
    last_updated
  )
  VALUES (
    'RAAus Ab-Initio RPC - Group A (3-Axis)',
    'Structured ab-initio course for the RAAus Recreational Pilot Certificate in Group A 3-axis aircraft. Built for Bendigo Flying Club lesson records and mapped to RAAus flight syllabus themes, pre-solo requirements, theory checkpoints and CFI flight test readiness.',
    'RAAus Ab Initio',
    '1.0',
    'published',
    25,
    ARRAY[
      'Current RAAus membership or student eligibility recorded',
      'Student pilot file opened with risk advice and local induction complete',
      'Medical fitness equivalent to private motor vehicle driver licence standard, or higher if required',
      'Photo ID, emergency contact and club induction completed before flight training',
      'CFI approval required before solo authorisation'
    ],
    ARRAY[
      'Develop a safe ab-initio pilot from first lesson through first solo and RPC flight test readiness',
      'Cover RAAus Group A 3-axis core competencies: preparation, controls, straight and level, climb and descent, turns, stalls, circuits, forced landings, training area operations and abnormal situations',
      'Record progress using consistent NC/S/C/- grading and instructor notes',
      'Integrate required theory milestones: pre-solo air legislation, BAK, Human Factors and Radio Operator knowledge',
      'Prepare the student for CFI or approved examiner assessment in accordance with current RAAus documents'
    ],
    ARRAY[
      'All mandatory pre-solo items marked S or C before first solo',
      'Pre-solo air legislation and local aerodrome questions completed before solo',
      'All certificate theory requirements completed before RPC recommendation',
      'Final lessons demonstrate safe, repeatable aircraft control, procedures, airmanship and decision making',
      'CFI confirms readiness for solo and later Pilot Certificate flight test'
    ],
    ARRAY['RAAus', 'RPC', 'ab-initio', 'Group A', '3-axis', 'Bendigo Flying Club'],
    criteria,
    now()
  )
  RETURNING id INTO course_id;

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
  (course_id, 1, 'Course induction, student file and RAAus pathway',
   'Confirm student eligibility, explain the RPC pathway, local operating expectations, risk advice and training record standards.',
   '<ul><li>Club and aircraft area induction.</li><li>Discuss student file, authorisations, logbook and lesson grading.</li><li>Review local Bendigo procedures, emergency contacts and fitness for flight expectations.</li></ul>',
   '<p>RAAus membership, medical self-declaration, training risks, student pilot limitations, local rules, GSP/NC/S/C grading and required examinations.</p>',
   'RAAUS-GA-00', 'RAAUS-GA-00', 'Induction and student pilot administration',
   'ground', 60, 'Introduce',
   ARRAY['Student file opened', 'Risk advice recorded', 'Training record and grading explained', 'Local procedures introduced'],
   'Bring ID, RAAus/member details if available, emergency contact, logbook if already issued, and any prior aviation records.',
   'Do not commence solo pathway until file prerequisites are complete. Confirm parent/guardian records for minors where applicable.',
   '{"gsp-knowledge":"S","gsp-records":"S"}'::jsonb),

  (course_id, 2, 'Aircraft familiarisation, daily inspection, fuel and taxi',
   'Introduce the aircraft, cockpit, fuel system, pre-flight/post-flight administration, ground handling and taxi control.',
   '<ul><li>Daily inspection and defect awareness.</li><li>Cockpit layout, controls and limitations.</li><li>Fuel planning, fuel checks and contamination checks.</li><li>Engine start, taxi, braking and shutdown.</li></ul>',
   '<p>POH limitations, fuel system, checklists, aircraft documents, hand signals, propeller safety and runway incursion prevention.</p>',
   'RAAUS-GA-01', '1.01-1', 'Flight preparation and ground handling',
   'flight', 90, 'Introduce',
   ARRAY['Pre-flight inspection', 'Cockpit familiarisation', 'Fuel planning and checks', 'Taxi and braking', 'Post-flight actions'],
   'Read the aircraft checklist and POH normal procedures. Review local taxi routes and run-up bay procedures.',
   'Require disciplined checklist use from lesson one. Record any weak aircraft knowledge items for later review.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-records":"S"}'::jsonb),

  (course_id, 3, 'Effects of controls and straight and level',
   'Develop basic aircraft handling, attitude reference, trim, lookout and straight and level flight.',
   '<ul><li>Primary, secondary and further effects of controls.</li><li>Power, attitude, trim and balance.</li><li>Straight and level at selected attitudes and airspeeds.</li><li>Lookout and clearances before manoeuvres.</li></ul>',
   '<p>Principles of flight, stability, control, trim, slipstream effects and relationship between attitude, power and performance.</p>',
   'RAAUS-GA-03-04', '1.01-3/4', 'Effects of controls / straight and level',
   'flight', 90, 'Introduce',
   ARRAY['Primary and secondary effects', 'Use of trim', 'Straight and level', 'Airspeed control', 'Lookout habit'],
   'Revise four forces, axes of movement, trim and attitude-power-performance.',
   'Emphasise small corrections and outside reference. Avoid instrument fixation.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S"}'::jsonb),

  (course_id, 4, 'Climbing, descending and medium turns',
   'Teach normal climb, descent and turn procedures using coordinated control and accurate lookout.',
   '<ul><li>Entry, maintenance and recovery from climbs and descents.</li><li>Level, climbing and descending turns.</li><li>Balanced flight, rudder coordination and lookout cycle.</li></ul>',
   '<p>Best rate/best angle concepts, glide attitude, load factor, balance, power changes and level-off planning.</p>',
   'RAAUS-GA-05-06', '1.01-5/6', 'Climbing, descending and turning',
   'flight', 90, 'Practice',
   ARRAY['Climb and descent checks', 'Level-off anticipation', 'Coordinated turns', 'Lookout before and during turns'],
   'Review climb/descent speeds, engine management and local training area boundaries.',
   'Student should begin verbalising lookout, clearances and intended actions.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S"}'::jsonb),

  (course_id, 5, 'Slow flight, stalls and upset prevention awareness',
   'Introduce slow flight, stall symptoms, stall recovery and safe recovery mindset within aircraft and CFI limitations.',
   '<ul><li>Slow flight and symptoms approaching the stall.</li><li>Stall entry and recovery in approved configurations.</li><li>Wing-drop discussion or demonstration only where aircraft and CFI limits permit.</li><li>UPRT awareness: unload, roll wings level, recover.</li></ul>',
   '<p>Angle of attack, load factor, stall speed variables, flap and power effects, minimum safe heights and aircraft-specific stall limitations.</p>',
   'RAAUS-GA-07', '1.01-7', 'Stalling',
   'flight', 90, 'Practice',
   ARRAY['Slow flight', 'Stall recognition', 'Stall recovery', 'Minimum height discipline', 'UPRT awareness'],
   'Read POH stall speeds and limitations. Revise HASELL or club equivalent pre-manoeuvre checks.',
   'Conduct stalls in accordance with current FOM, CFI approval and aircraft limitations. No engine-stopped exercise except under authorised conditions.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 6, 'Circuit introduction, take-off, approach, landing and go-around',
   'Introduce normal circuit pattern, take-off, approach, landing, after-landing actions and go-around.',
   '<ul><li>Runway entry and take-off.</li><li>Climb-out, crosswind, downwind, base and final.</li><li>Approach path, flare and landing roll.</li><li>Go-around from a safe height and configuration.</li></ul>',
   '<p>Circuit procedures, wind assessment, runway selection, radio calls, spacing, stable approach criteria and go-around decision points.</p>',
   'RAAUS-GA-08', '1.01-8', 'Circuits',
   'flight', 90, 'Introduce',
   ARRAY['Take-off', 'Circuit tracking', 'Downwind checks', 'Approach and landing', 'Go-around'],
   'Review Bendigo circuit directions, radio calls, runway markings and local noise abatement.',
   'Keep workload controlled. Instructor to retain safety-critical calls until student capacity improves.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 7, 'Circuit consolidation and circuit emergencies',
   'Build repeatable circuit performance and introduce engine failure and abnormal situations in the circuit.',
   '<ul><li>Normal and flapless approaches where applicable.</li><li>Crosswind considerations.</li><li>Engine failure after take-off briefing and actions.</li><li>Engine failure in circuit and rejected landing/go-around.</li></ul>',
   '<p>Pre-take-off safety brief, circuit emergency priorities, glide judgement, wind correction and radio workload management.</p>',
   'RAAUS-GA-08E', '1.01-8.5/8.6', 'Circuit emergencies and precautions',
   'flight', 90, 'Practice',
   ARRAY['Consistent circuits', 'Stable approaches', 'Emergency brief', 'EFATO actions', 'Go-around judgement'],
   'Prepare the standard pre-take-off safety brief and local forced landing options.',
   'Before pre-solo, student must demonstrate safe go-around judgement and emergency priorities without prompting.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 8, 'Pre-solo knowledge, local procedures and solo readiness check',
   'Confirm the student has met local and RAAus pre-solo knowledge and handling standards before any first solo authorisation.',
   '<ul><li>Dual check of circuit standard.</li><li>Normal and abnormal circuit events.</li><li>Radio calls and runway change awareness.</li><li>Solo limitations and instructor brief.</li></ul>',
   '<p>Pre-solo Air Legislation, at least five local aerodrome/procedure questions, student pilot limitations, weather minima and authorisation process.</p>',
   'RAAUS-SOLO', 'PRE-SOLO', 'Pre-solo air legislation and competency check',
   'flight', 90, 'Assess',
   ARRAY['Pre-solo air law passed', 'Local questions passed', 'Circuit standard achieved', 'Solo limitations understood', 'CFI/instructor authorisation'],
   'Complete pre-solo air legislation study and local procedures quiz before this lesson.',
   'No solo release unless air law/local requirements, weather, aircraft status and CFI/instructor authorisation are all recorded.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S","gsp-records":"S"}'::jsonb),

  (course_id, 9, 'First solo and supervised solo circuit consolidation',
   'Conduct first solo if authorised, then consolidate safe solo circuit performance under close supervision.',
   '<ul><li>Authorised first solo circuit or dual remedial circuit as required.</li><li>Solo debrief and logbook/training record update.</li><li>Subsequent supervised solo circuits within set limits.</li></ul>',
   '<p>Solo responsibilities, weather and runway limits, radio discipline, go-around authority and post-flight reporting.</p>',
   'RAAUS-SOLO-CCT', 'SOLO-1', 'First solo and supervised solo circuits',
   'flight', 60, 'Assess',
   ARRAY['Solo authorisation', 'Normal solo circuit', 'Go-around decision', 'Post solo debrief', 'Logbook discipline'],
   'Review solo brief, emergency actions and personal minimums.',
   'If first solo is not conducted, record specific remedial items and do not mark complete.',
   '{"gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S","gsp-records":"S"}'::jsonb),

  (course_id, 10, 'Training area operations and radio procedures',
   'Teach safe transit to/from the training area, local area orientation, radio procedures and airspace awareness.',
   '<ul><li>Departure and arrival procedures.</li><li>Training area boundaries and landmarks.</li><li>Radio calls, listening watch and traffic integration.</li><li>Rejoin and circuit integration.</li></ul>',
   '<p>Radio Operator knowledge, Class G/CTAF procedures, traffic information, frequencies, lost procedures and local airspace.</p>',
   'RAAUS-GA-10-R', '1.01-10 / 2.04', 'Training area operations and radio',
   'flight', 90, 'Practice',
   ARRAY['Area departure', 'Area orientation', 'Radio phraseology', 'Traffic integration', 'Rejoin procedure'],
   'Study Bendigo VTC/VNC/ERSA entries, CTAF procedures and standard radio calls.',
   'Use this lesson to identify students needing separate Radio Operator endorsement preparation.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 11, 'Forced landing, glide approaches and sideslip awareness',
   'Develop forced landing judgement, field selection, glide profile management and sideslip where aircraft approved.',
   '<ul><li>Engine failure away from circuit.</li><li>Field selection and high/low key planning.</li><li>Restart checks, passenger brief, mayday and shutdown checks.</li><li>Sideslip awareness or practice if fitted and approved.</li></ul>',
   '<p>Best glide, wind assessment, field suitability, emergency communication, survival considerations and aircraft-specific sideslip limitations.</p>',
   'RAAUS-GA-09', '1.01-9.2/9.3', 'Forced landings and sideslip',
   'flight', 90, 'Practice',
   ARRAY['Immediate actions', 'Field selection', 'Glide profile', 'Emergency checks', 'Airmanship under pressure'],
   'Revise forced landing checklist, best glide speed and local practice areas.',
   'Maintain safe heights and avoid normalising low-level manoeuvring outside approved exercise parameters.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 12, 'Precautionary search and landing',
   'Teach precautionary search planning and decision making for deteriorating conditions or uncertain landing areas.',
   '<ul><li>Reasons for precautionary landing.</li><li>Inspection passes at safe heights as applicable.</li><li>Obstacle, slope, surface and wind assessment.</li><li>Decision to continue, divert or land.</li></ul>',
   '<p>Weather deterioration, fuel state, daylight, landing area assessment, passenger management and avoidance of pressing on.</p>',
   'RAAUS-GA-09.4', '1.01-9.4', 'Precautionary search and landing',
   'flight', 90, 'Practice',
   ARRAY['Early decision making', 'Landing area inspection', 'Wind and obstacle assessment', 'Passenger brief', 'Diversion mindset'],
   'Read club guidance on precautionary landing and weather decision triggers.',
   'Emphasise conservative judgement. This is not a low-level endorsement lesson.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 13, 'Abnormal situations and emergency management',
   'Consolidate abnormal and emergency management across aircraft systems, flight controls, instruments and operational threats.',
   '<ul><li>Engine, fuel, electrical and instrument abnormalities.</li><li>Control restriction or trim issues discussion.</li><li>Fire, door/canopy, radio failure and passenger illness scenarios.</li><li>Decision making and diversion planning.</li></ul>',
   '<p>POH abnormal/emergency procedures, memory items, checklist use, prioritisation and post-event reporting.</p>',
   'RAAUS-GA-11', '1.01-11', 'Manage abnormal situations and emergencies',
   'flight', 90, 'Practice',
   ARRAY['Aviate-navigate-communicate', 'Checklist discipline', 'Diversion decisions', 'Emergency communication', 'Incident reporting'],
   'Review POH emergency procedures and club safety reporting process.',
   'Assess calm prioritisation, not rote recitation only.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S"}'::jsonb),

  (course_id, 14, 'BAK theory integration and systems review',
   'Prepare the student for RAAus BAK and integrate theory into practical flying decisions.',
   '<ul><li>Ground briefing and oral questioning.</li><li>Aircraft performance, aerodynamics and systems review.</li><li>Weight, balance, weather, documents and operational limitations.</li></ul>',
   '<p>RAAus Unit 2.01 BAK topics: aerodynamics, stability and control, manoeuvring, take-off/landing, wake turbulence, emergency procedures, systems and instruments.</p>',
   'RAAUS-BAK', '2.01', 'Basic Aeronautical Knowledge',
   'ground', 120, 'Assess',
   ARRAY['Principles of flight', 'Aircraft systems', 'Performance and limitations', 'Emergency theory', 'BAK exam readiness'],
   'Complete BAK study set and bring questions for instructor review.',
   'Record BAK exam result separately in student file before RPC recommendation.',
   '{"gsp-knowledge":"S","gsp-tem":"S","gsp-records":"S"}'::jsonb),

  (course_id, 15, 'Human Factors and operational decision making',
   'Develop human performance awareness and practical TEM behaviours for solo and certificate operations.',
   '<ul><li>Fitness for flight and IMSAFE style checks.</li><li>Stress, fatigue, workload and communication.</li><li>Visual scanning, collision avoidance and illusions.</li><li>Threat and error management scenarios.</li></ul>',
   '<p>RAAus Unit 2.05 Human Factors: aviation medicine, vision, scanning, collision avoidance, illusions, fatigue, stress and decision making.</p>',
   'RAAUS-HF', '2.05', 'Human Factors',
   'ground', 90, 'Assess',
   ARRAY['Fitness for flight', 'Workload management', 'Collision avoidance', 'Visual illusions', 'TEM scenarios'],
   'Complete Human Factors reading/course material before the lesson.',
   'Human Factors must be completed by approved course or exam pathway before Pilot Certificate recommendation.',
   '{"gsp-knowledge":"S","gsp-airmanship":"S","gsp-tem":"S","gsp-records":"S"}'::jsonb),

  (course_id, 16, 'RPC consolidation: flight test profile practice',
   'Consolidate all Group A RPC competencies in a representative flight test profile.',
   '<ul><li>Pre-flight planning and briefing.</li><li>Departure, area manoeuvres, stalls, forced landing, circuits and emergencies.</li><li>Post-flight self-critique and records.</li></ul>',
   '<p>Integrated review of all Unit 1.01 flight elements, air legislation, BAK, radio and Human Factors requirements.</p>',
   'RAAUS-RPC-CONSOL', 'RPC-CONSOL', 'RPC consolidation',
   'flight', 120, 'Assess',
   ARRAY['Complete flight profile', 'Independent checks', 'Accurate handling', 'Sound judgement', 'Self-critique'],
   'Prepare as for a flight test. Bring logbook, completed exams and student records.',
   'Use CFI or senior instructor review if readiness is uncertain. Identify exact remedial items.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S","gsp-records":"S"}'::jsonb),

  (course_id, 17, 'CFI recommendation and Pilot Certificate readiness review',
   'Complete final readiness review, documentation audit and recommendation decision for RAAus Pilot Certificate flight test.',
   '<ul><li>Student file audit: hours, PIC, lessons, exams and endorsements.</li><li>Oral review of limitations, privileges and local operations.</li><li>Final dual check or remedial plan.</li><li>CFI recommendation or hold point.</li></ul>',
   '<p>RAAus FOM Pilot Certificate requirements, privileges, recency, medical, membership, flight review and production of certificate obligations.</p>',
   'RAAUS-RPC-REVIEW', 'RPC-REVIEW', 'Pilot Certificate readiness review',
   'ground', 90, 'Assess',
   ARRAY['Minimum experience checked', 'Theory exams checked', 'Training records complete', 'Privileges and limitations understood', 'CFI recommendation decision'],
   'Bring logbook, student file, exam evidence and any outstanding records.',
   'Do not recommend until records, theory and flight standard meet current RAAus requirements and local CFI expectations.',
   '{"gsp-knowledge":"S","gsp-handling":"S","gsp-airmanship":"S","gsp-tem":"S","gsp-records":"S"}'::jsonb);
END $$;
