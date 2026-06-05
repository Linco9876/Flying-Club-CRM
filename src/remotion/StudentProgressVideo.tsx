import React from 'react';
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { StudentProgressVideoProps } from '../types/studentProgressVideo';

const colors = {
  ink: '#101827',
  muted: '#607085',
  blue: '#2563eb',
  sky: '#dbeafe',
  green: '#059669',
  amber: '#d97706',
  red: '#dc2626',
  panel: '#ffffff',
  bg: '#eef3f8',
  line: '#d6dde8',
};

const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fit = (text: string, max = 34) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

const Scene: React.FC<{ children: React.ReactNode; from: number; duration: number }> = ({ children, from, duration }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [from, from + 18, from + duration - 18, from + duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const y = interpolate(frame, [from, from + 24], [26, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <Sequence from={from} durationInFrames={duration}>
      <AbsoluteFill style={{ opacity, transform: `translateY(${y}px)` }}>{children}</AbsoluteFill>
    </Sequence>
  );
};

const FrameShell: React.FC<{ props: StudentProgressVideoProps; eyebrow: string; children: React.ReactNode }> = ({ props, eyebrow, children }) => (
  <AbsoluteFill style={{ background: colors.bg, fontFamily: 'Inter, Arial, sans-serif', color: colors.ink }}>
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(37,99,235,.16), transparent 38%, rgba(5,150,105,.12))' }} />
    <div style={{ position: 'absolute', left: 86, right: 86, top: 58, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 58, height: 58, borderRadius: 18, background: colors.blue, display: 'grid', placeItems: 'center', color: 'white', fontSize: 28, fontWeight: 900 }}>BFC</div>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800 }}>{props.clubName}</div>
          <div style={{ color: colors.muted, fontSize: 20 }}>Flight Training Management System</div>
        </div>
      </div>
      <div style={{ color: colors.muted, fontSize: 22 }}>{eyebrow}</div>
    </div>
    <div style={{ position: 'absolute', left: 86, right: 86, top: 146, bottom: 74 }}>{children}</div>
  </AbsoluteFill>
);

const Stat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = colors.blue }) => (
  <div style={{ background: colors.panel, border: `2px solid ${colors.line}`, borderRadius: 28, padding: 30, boxShadow: '0 18px 50px rgba(16,24,39,.10)' }}>
    <div style={{ color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.4, fontSize: 21, fontWeight: 800 }}>{label}</div>
    <div style={{ color: tone, fontSize: 58, lineHeight: 1.05, fontWeight: 900, marginTop: 12 }}>{value}</div>
  </div>
);

const CourseBar: React.FC<{ title: string; percent: number; index: number }> = ({ title, percent, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - index * 7, fps, config: { damping: 20, stiffness: 80 } });
  const width = Math.max(4, percent * progress);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr 110px', gap: 26, alignItems: 'center', marginBottom: 24 }}>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{fit(title, 32)}</div>
      <div style={{ height: 28, borderRadius: 999, background: '#dce6f2', overflow: 'hidden' }}>
        <div style={{ width: `${width}%`, height: '100%', borderRadius: 999, background: percent >= 100 ? colors.green : colors.blue }} />
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: percent >= 100 ? colors.green : colors.blue, textAlign: 'right' }}>{percent}%</div>
    </div>
  );
};

export const StudentProgressVideo: React.FC<StudentProgressVideoProps> = (props) => {
  const topCourse = props.courses[0];
  const generated = formatDate(props.generatedAt);

  return (
    <AbsoluteFill>
      <Scene from={0} duration={360}>
        <FrameShell props={props} eyebrow={`Generated ${generated}`}>
          <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 46, alignItems: 'center' }}>
            <div>
              <div style={{ color: colors.blue, fontSize: 30, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 2 }}>Student Progress</div>
              <div style={{ fontSize: 92, lineHeight: 1.02, fontWeight: 950, marginTop: 20 }}>{props.student.name}</div>
              <div style={{ color: colors.muted, fontSize: 32, marginTop: 22 }}>
                {props.student.role.toUpperCase()} {props.student.raausId ? `- RAAus ${props.student.raausId}` : ''}
              </div>
              <div style={{ marginTop: 52, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                <Stat label="Hours" value={props.stats.totalHours.toFixed(1)} />
                <Stat label="Records" value={String(props.stats.recordsCount)} tone={colors.green} />
                <Stat label="Exams Passed" value={String(props.stats.examsPassed)} tone={colors.amber} />
              </div>
            </div>
            <div style={{ background: colors.panel, borderRadius: 34, padding: 40, boxShadow: '0 28px 70px rgba(16,24,39,.12)', border: `2px solid ${colors.line}` }}>
              <div style={{ color: colors.muted, fontSize: 24, fontWeight: 800, textTransform: 'uppercase' }}>Most advanced course</div>
              <div style={{ fontSize: 42, fontWeight: 900, marginTop: 18 }}>{topCourse?.title || 'No course selected'}</div>
              <div style={{ marginTop: 46, width: 360, height: 360, borderRadius: 999, background: `conic-gradient(${colors.blue} ${(topCourse?.percentage || 0) * 3.6}deg, #dce6f2 0deg)`, display: 'grid', placeItems: 'center' }}>
                <div style={{ width: 260, height: 260, borderRadius: 999, background: colors.panel, display: 'grid', placeItems: 'center' }}>
                  <div style={{ fontSize: 76, fontWeight: 950, color: colors.blue }}>{topCourse?.percentage || 0}%</div>
                </div>
              </div>
            </div>
          </div>
        </FrameShell>
      </Scene>

      <Scene from={330} duration={420}>
        <FrameShell props={props} eyebrow="Training Progress">
          <div style={{ background: colors.panel, borderRadius: 34, padding: 52, boxShadow: '0 28px 70px rgba(16,24,39,.12)', border: `2px solid ${colors.line}` }}>
            <div style={{ fontSize: 58, fontWeight: 950, marginBottom: 46 }}>Course progress</div>
            {(props.courses.length ? props.courses : [{ title: 'No course progress yet', percentage: 0 }]).slice(0, 5).map((course, index) => (
              <CourseBar key={course.title} title={course.title} percent={course.percentage} index={index} />
            ))}
            <div style={{ marginTop: 54, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22 }}>
              <Stat label="Dual" value={`${props.stats.dualHours.toFixed(1)}h`} />
              <Stat label="Solo" value={`${props.stats.soloHours.toFixed(1)}h`} tone={colors.green} />
              <Stat label="Competent" value={String(props.stats.competentSequences)} tone={colors.green} />
              <Stat label="Complete" value={String(props.stats.coursesCompleted)} tone={colors.amber} />
            </div>
          </div>
        </FrameShell>
      </Scene>

      <Scene from={720} duration={390}>
        <FrameShell props={props} eyebrow="Recent Activity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 34 }}>
            <div style={{ background: colors.panel, borderRadius: 34, padding: 44, border: `2px solid ${colors.line}`, boxShadow: '0 28px 70px rgba(16,24,39,.12)' }}>
              <div style={{ fontSize: 48, fontWeight: 950, marginBottom: 30 }}>Latest training</div>
              {(props.recentActivity.length ? props.recentActivity : [{ date: props.generatedAt, title: 'No training records yet', detail: 'Progress will appear once records are added.' }]).slice(0, 5).map((item) => (
                <div key={`${item.date}-${item.title}`} style={{ borderTop: `2px solid ${colors.line}`, padding: '22px 0' }}>
                  <div style={{ color: colors.muted, fontSize: 20, fontWeight: 800 }}>{formatDate(item.date)}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{fit(item.title, 30)}</div>
                  <div style={{ color: colors.muted, fontSize: 22, marginTop: 4 }}>{fit(item.detail, 42)}</div>
                </div>
              ))}
            </div>
            <div style={{ background: colors.panel, borderRadius: 34, padding: 44, border: `2px solid ${colors.line}`, boxShadow: '0 28px 70px rgba(16,24,39,.12)' }}>
              <div style={{ fontSize: 48, fontWeight: 950, marginBottom: 30 }}>Exam snapshot</div>
              {(props.exams.length ? props.exams : [{ name: 'No exams logged yet', score: 0, passMark: 0, result: 'fail' as const, date: props.generatedAt }]).slice(0, 5).map((exam) => (
                <div key={`${exam.date}-${exam.name}`} style={{ borderTop: `2px solid ${colors.line}`, padding: '22px 0', display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 900 }}>{fit(exam.name, 27)}</div>
                    <div style={{ color: colors.muted, fontSize: 20, marginTop: 5 }}>{formatDate(exam.date)} - pass {exam.passMark}%</div>
                  </div>
                  <div style={{ color: exam.result === 'pass' ? colors.green : colors.red, fontSize: 34, fontWeight: 950 }}>{exam.score}%</div>
                </div>
              ))}
            </div>
          </div>
        </FrameShell>
      </Scene>

      <Scene from={1080} duration={720}>
        <FrameShell props={props} eyebrow="Summary">
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 72, fontWeight: 950 }}>{props.student.name}</div>
              <div style={{ fontSize: 42, color: colors.muted, marginTop: 20 }}>
                {topCourse ? `${topCourse.percentage}% progress in ${topCourse.title}` : 'Training journey ready to begin'}
              </div>
              <div style={{ margin: '62px auto 0', width: 880, height: 20, borderRadius: 999, background: '#dce6f2', overflow: 'hidden' }}>
                <div style={{ width: `${topCourse?.percentage || 0}%`, height: '100%', background: topCourse?.isComplete ? colors.green : colors.blue }} />
              </div>
              <div style={{ marginTop: 70, fontSize: 30, color: colors.muted }}>Generated by {props.clubName} CRM</div>
            </div>
          </div>
        </FrameShell>
      </Scene>
    </AbsoluteFill>
  );
};
