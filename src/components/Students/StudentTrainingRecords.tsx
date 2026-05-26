import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { TrainingRecord, TrainingSequenceResult } from '../../types';
import { format } from 'date-fns';
import {
  BookOpen,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Save,
  AlertCircle,
  Plane,
} from 'lucide-react';
import toast from 'react-hot-toast';

const competenceColors: Record<string, string> = {
  C: 'bg-green-100 text-green-800 border-green-200',
  S: 'bg-blue-100 text-blue-800 border-blue-200',
  NC: 'bg-red-100 text-red-800 border-red-200',
  '-': 'bg-gray-100 text-gray-600 border-gray-200',
};

const StatusBadge: React.FC<{ status: TrainingRecord['status']; studentAck: boolean }> = ({ status, studentAck }) => {
  if (status === 'submitted' && !studentAck) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
        <AlertCircle className="h-3 w-3" />
        Awaiting Acknowledgement
      </span>
    );
  }
  if (status === 'submitted' && studentAck) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
        <CheckCircle className="h-3 w-3" />
        Acknowledged
      </span>
    );
  }
  if (status === 'locked') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
        <CheckCircle className="h-3 w-3" />
        Locked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
      <Clock className="h-3 w-3" />
      Draft
    </span>
  );
};

interface RecordRowProps {
  record: TrainingRecord;
  instructorName: string;
  onAcknowledge: (id: string, name: string, comments: string) => Promise<void>;
}

const RecordRow: React.FC<RecordRowProps> = ({ record, instructorName, onAcknowledge }) => {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [comments, setComments] = useState(record.studentComments || '');
  const [savingComments, setSavingComments] = useState(false);
  const [commentsChanged, setCommentsChanged] = useState(false);

  const canAcknowledge = record.status === 'submitted' && !record.studentAck;
  const canComment = record.status === 'submitted' || record.status === 'locked';

  const handleAcknowledge = async () => {
    if (!user?.name) return;
    setAcknowledging(true);
    try {
      await onAcknowledge(record.id, user.name, comments);
    } finally {
      setAcknowledging(false);
    }
  };

  const handleSaveComments = async () => {
    setSavingComments(true);
    try {
      const { error } = await supabase
        .from('training_records')
        .update({ student_comments: comments })
        .eq('id', record.id);
      if (error) throw error;
      setCommentsChanged(false);
      toast.success('Comments saved');
    } catch {
      toast.error('Failed to save comments');
    } finally {
      setSavingComments(false);
    }
  };

  const dualHrs = (record.dualTimeMin / 60).toFixed(1);
  const soloHrs = (record.soloTimeMin / 60).toFixed(1);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-shadow hover:shadow-md">
      {/* Row header */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex-shrink-0 h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center">
          <Plane className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">
              {format(record.date, 'dd MMM yyyy')}
            </span>
            <span className="text-gray-400 text-xs">·</span>
            <span className="text-sm text-gray-700">{record.registration || record.aircraftType}</span>
            {instructorName && (
              <>
                <span className="text-gray-400 text-xs">·</span>
                <span className="text-xs text-gray-500">Instr: {instructorName}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-gray-500">Dual {dualHrs}h</span>
            <span className="text-xs text-gray-500">Solo {soloHrs}h</span>
            {record.lessonCodes.length > 0 && (
              <span className="text-xs text-gray-500">{record.lessonCodes.join(', ')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <StatusBadge status={record.status} studentAck={record.studentAck} />
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-5 space-y-5">
          {/* Lesson details grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {record.comments && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Instructor Comments</p>
                <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">{record.comments}</p>
              </div>
            )}
            {record.briefingComments && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Briefing Notes</p>
                <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">{record.briefingComments}</p>
              </div>
            )}
            {record.nextLesson && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Next Lesson</p>
                <p className="text-sm text-gray-800">{record.nextLesson}</p>
              </div>
            )}
            {record.formalBriefing && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Formal Briefing</p>
                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                  <CheckCircle className="h-3.5 w-3.5" /> Conducted
                </span>
              </div>
            )}
          </div>

          {/* Competency sequences */}
          {record.sequences.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Competency Assessment</p>
              <div className="flex flex-wrap gap-2">
                {record.sequences.map((seq: TrainingSequenceResult) => (
                  <div
                    key={seq.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${competenceColors[seq.competence] || competenceColors['-']}`}
                  >
                    <span className="font-bold">{seq.competence}</span>
                    <span className="opacity-80">{seq.sequenceCode}</span>
                    <span className="hidden sm:inline opacity-70">— {seq.sequenceTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sign-off info */}
          {record.instructorSignTimestamp && (
            <div className="text-xs text-gray-500">
              Submitted by instructor on {format(record.instructorSignTimestamp, 'dd MMM yyyy HH:mm')}
              {record.studentAck && record.studentAckTimestamp && (
                <> · Acknowledged {format(record.studentAckTimestamp, 'dd MMM yyyy HH:mm')}</>
              )}
            </div>
          )}

          {/* Student comments section */}
          {canComment && (
            <div className="border-t border-gray-100 pt-4">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">
                <MessageSquare className="h-3.5 w-3.5" />
                Your Comments
              </label>
              <textarea
                value={comments}
                onChange={e => {
                  setComments(e.target.value);
                  setCommentsChanged(e.target.value !== (record.studentComments || ''));
                }}
                rows={3}
                placeholder="Add your own notes or comments about this lesson…"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              {commentsChanged && (
                <button
                  onClick={handleSaveComments}
                  disabled={savingComments}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors"
                >
                  <Save className="h-3 w-3" />
                  {savingComments ? 'Saving…' : 'Save Comments'}
                </button>
              )}
            </div>
          )}

          {/* Acknowledge button */}
          {canAcknowledge && (
            <div className="border-t border-amber-100 pt-4 bg-amber-50 -mx-5 px-5 -mb-5 pb-5 rounded-b-xl">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-900">Action required</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Your instructor has submitted this record. Please review and acknowledge it.
                  </p>
                </div>
                <button
                  onClick={handleAcknowledge}
                  disabled={acknowledging}
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60 transition-colors font-medium"
                >
                  <CheckCircle className="h-4 w-4" />
                  {acknowledging ? 'Saving…' : 'Acknowledge'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const StudentTrainingRecords: React.FC = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [instructorNames, setInstructorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'acknowledged'>('all');

  const fetchRecords = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data: recordsData, error } = await supabase
        .from('training_records')
        .select('*')
        .eq('student_id', user.id)
        .in('status', ['submitted', 'locked'])
        .order('date', { ascending: false });

      if (error) throw error;

      const { data: seqData } = await supabase
        .from('training_sequence_results')
        .select('*')
        .in('training_record_id', (recordsData || []).map(r => r.id));

      const seqMap = new Map<string, TrainingSequenceResult[]>();
      (seqData || []).forEach(sr => {
        const arr = seqMap.get(sr.training_record_id) || [];
        arr.push({
          id: sr.id,
          trainingRecordId: sr.training_record_id,
          sequenceId: sr.sequence_id,
          sequenceCode: sr.sequence_code,
          sequenceTitle: sr.sequence_title,
          competence: sr.competence,
        });
        seqMap.set(sr.training_record_id, arr);
      });

      const mapped: TrainingRecord[] = (recordsData || []).map(r => ({
        id: r.id,
        studentId: r.student_id,
        bookingId: r.booking_id,
        flightLogId: r.flight_log_id,
        courseId: r.course_id,
        lessonId: r.lesson_id,
        date: new Date(r.date),
        aircraftId: r.aircraft_id,
        aircraftType: r.aircraft_type,
        registration: r.registration,
        instructorId: r.instructor_id,
        dualTimeMin: r.dual_time_min,
        soloTimeMin: r.solo_time_min,
        comments: r.comments,
        briefingComments: r.briefing_comments || '',
        formalBriefing: r.formal_briefing,
        criteriaGrades: r.criteria_grades || {},
        lessonCodes: r.lesson_codes || [],
        nextLesson: r.next_lesson,
        status: r.status,
        instructorSignatureUrl: r.instructor_signature_url,
        studentAck: r.student_ack,
        studentAckName: r.student_ack_name,
        studentComments: r.student_comments || '',
        instructorSignTimestamp: r.instructor_sign_timestamp ? new Date(r.instructor_sign_timestamp) : undefined,
        studentAckTimestamp: r.student_ack_timestamp ? new Date(r.student_ack_timestamp) : undefined,
        attachments: r.attachments || [],
        auditLog: [],
        sequences: seqMap.get(r.id) || [],
      }));

      setRecords(mapped);

      // Fetch instructor names
      const instructorIds = [...new Set(mapped.map(r => r.instructorId).filter(Boolean))];
      if (instructorIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name')
          .in('id', instructorIds);
        const nameMap: Record<string, string> = {};
        (usersData || []).forEach(u => { nameMap[u.id] = u.name; });
        setInstructorNames(nameMap);
      }
    } catch (err) {
      console.error('Error fetching training records:', err);
      toast.error('Failed to load training records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [user?.id]);

  const handleAcknowledge = async (id: string, name: string, comments: string) => {
    try {
      const { error } = await supabase
        .from('training_records')
        .update({
          student_ack: true,
          student_ack_name: name,
          student_ack_timestamp: new Date().toISOString(),
          student_comments: comments,
        })
        .eq('id', id);
      if (error) throw error;
      toast.success('Record acknowledged');
      await fetchRecords();
    } catch {
      toast.error('Failed to acknowledge record');
    }
  };

  const pending = records.filter(r => r.status === 'submitted' && !r.studentAck);
  const filtered =
    filter === 'pending' ? pending :
    filter === 'acknowledged' ? records.filter(r => r.studentAck || r.status === 'locked') :
    records;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + filter bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {pending.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                {pending.length} record{pending.length !== 1 ? 's' : ''} awaiting acknowledgement
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['all', 'pending', 'acknowledged'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {f === 'pending' ? 'Awaiting' : f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'all' && ` (${records.length})`}
              {f === 'pending' && ` (${pending.length})`}
              {f === 'acknowledged' && ` (${records.length - pending.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Records list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No training records</p>
          <p className="text-sm text-gray-400 mt-1">
            {filter === 'pending'
              ? 'No records awaiting acknowledgement'
              : 'Your submitted lesson records will appear here'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(record => (
            <RecordRow
              key={record.id}
              record={record}
              instructorName={instructorNames[record.instructorId] || ''}
              onAcknowledge={handleAcknowledge}
            />
          ))}
        </div>
      )}
    </div>
  );
};
