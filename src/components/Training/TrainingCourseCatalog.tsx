import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowDown,
  ArrowUp,
  Award,
  Bold,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  BookOpenCheck,
  ClipboardList,
  Clock3,
  FilePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Layers,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Underline,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  LessonAssessmentCriterion,
  LessonGradingSystem,
  SyllabusMatrixRequirement,
  SyllabusMatrixRow,
  TrainingExam,
  TrainingLesson,
  TrainingModule
} from '../../types';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { useAuth } from '../../context/AuthContext';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';
import { formatSyllabusMatrixText, matrixStandardLabel, useSyllabusMatrix } from '../../hooks/useSyllabusMatrix';
import { supabase } from '../../lib/supabase';

interface NewCourseState {
  title: string;
  category: string;
  description: string;
  estimatedDurationHours: number;
  requiresStudentAcknowledgement: boolean;
  requiresFlyingDeclaration: boolean;
  flyingDeclarationTitle: string;
  flyingDeclarationText: string;
  requiresGuardianDeclarationForMinors: boolean;
  guardianDeclarationTitle: string;
  guardianDeclarationText: string;
  completionEndorsementEnabled: boolean;
  completionEndorsementType: string;
  completionEndorsementExpiryMonths: string;
  tags: string;
  objectives: string;
  evaluationFocus: string;
}

type CourseBuildMode = 'simple' | 'advanced';

interface NewLessonState {
  name: string;
  objective: string;
  flightExercises: string;
  theory: string;
  isFlightTest: boolean;
}

type CourseFormState = NewCourseState;

type EditableCriterion = {
  id: string;
  name: string;
  gradingSystem: LessonGradingSystem;
  passingGrade: string;
};

type EditableExam = TrainingExam;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeRichText = (html: string): string => {
  if (!html) return '';

  // Use a real DOM parser so we walk the actual tree — much more reliable than regex
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const allowed = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a']);

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // Normalize legacy tags
    const norm = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;

    // Replace block-level wrappers with p
    const blockTags = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    if (blockTags.has(norm)) {
      const inner = Array.from(el.childNodes).map(walk).join('');
      return `<p>${inner}</p>`;
    }

    // Strip span/font/other inline wrappers but keep children
    const stripWrappers = new Set(['span', 'font', 'code', 'pre', 'mark', 'small', 'sub', 'sup']);
    if (stripWrappers.has(norm)) {
      return Array.from(el.childNodes).map(walk).join('');
    }

    if (!allowed.has(norm)) {
      return Array.from(el.childNodes).map(walk).join('');
    }

    if (norm === 'br') return '<br />';

    const inner = Array.from(el.childNodes).map(walk).join('');

    if (norm === 'a') {
      const href = el.getAttribute('href') ?? '';
      // Only allow safe URLs
      const safe = /^https?:\/\//i.test(href) ? href : '';
      if (!safe) return inner;
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }

    // Drop empty block tags
    if ((norm === 'p' || norm === 'li') && !inner.trim()) return '';

    return `<${norm}>${inner}</${norm}>`;
  };

  const result = Array.from(doc.body.childNodes).map(walk).join('').replace(/\u00a0/g, ' ').trim();
  return result;
};

const decodeHtmlEntities = (text: string) =>
  text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const formatRichTextContent = (content: string) => {
  if (!content) {
    return '';
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);
  if (looksLikeHtml) {
    return sanitizeRichText(trimmed);
  }

  const escaped = escapeHtml(trimmed);
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
};

const richTextToPlainText = (content: string) => {
  if (!content) {
    return '';
  }

  const source = sanitizeRichText(content) || content;
  const withoutTags = source
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/(li|p|ol|ul)>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '');

  return decodeHtmlEntities(withoutTags).replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
};

const getPassingGradeOptions = (system: LessonGradingSystem) => {
  switch (system) {
    case 'NC/S/C/-':
      return ['NC', 'S', 'C', '-'];
    case 'Pass or Fail':
      return ['Pass', 'Fail'];
    default:
      return [];
  }
};

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({ label, value, onChange, placeholder }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  // Track whether this editor is the active one
  const isFocused = useRef(false);
  // Keep onChange stable without stale closures
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Saved selection range for restoring after toolbar clicks
  const savedRange = useRef<Range | null>(null);
  // Link popover state
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Initialise / reset: only write to DOM when not focused
  useEffect(() => {
    if (isFocused.current || !editorRef.current) return;
    const next = value ? sanitizeRichText(value) : '';
    if (editorRef.current.innerHTML !== next) {
      editorRef.current.innerHTML = next;
    }
  }, [value]);

  // Focus link input when popover opens
  useEffect(() => {
    if (showLinkPopover) {
      setTimeout(() => linkInputRef.current?.focus(), 0);
    }
  }, [showLinkPopover]);

  const flushToParent = useCallback(() => {
    if (!editorRef.current) return;
    const sanitised = sanitizeRichText(editorRef.current.innerHTML);
    onChangeRef.current(sanitised);
  }, []);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    if (!savedRange.current || !editorRef.current) return;
    editorRef.current.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  }, []);

  const handleFocus = useCallback(() => {
    isFocused.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    // Save selection just before focus leaves the editor
    saveSelection();
    isFocused.current = false;
    flushToParent();
  }, [flushToParent, saveSelection]);

  const handleInput = useCallback(() => {
    flushToParent();
  }, [flushToParent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl/Cmd + B/I/U keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); document.execCommand('bold', false); flushToParent(); }
      if (e.key === 'i') { e.preventDefault(); document.execCommand('italic', false); flushToParent(); }
      if (e.key === 'u') { e.preventDefault(); document.execCommand('underline', false); flushToParent(); }
    }
  }, [flushToParent]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    flushToParent();
  }, [flushToParent]);

  const execFormat = useCallback((command: string, value?: string) => {
    restoreSelection();
    document.execCommand(command, false, value);
    flushToParent();
    // Re-save updated selection
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, [restoreSelection, flushToParent]);

  const handleToolbarMouseDown = useCallback((
    e: React.MouseEvent,
    command: string,
    value?: string
  ) => {
    e.preventDefault(); // don't steal focus from editor
    // If editor has focus, selection is live — execute immediately
    if (isFocused.current) {
      document.execCommand(command, false, value);
      flushToParent();
    } else {
      // Restore saved selection then execute
      execFormat(command, value);
    }
  }, [execFormat, flushToParent]);

  const openLinkPopover = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    saveSelection();
    // Pre-fill URL if selection is already a link
    const sel = window.getSelection();
    let existingUrl = '';
    if (sel && sel.rangeCount > 0) {
      const anchor = sel.anchorNode?.parentElement?.closest('a');
      if (anchor) existingUrl = anchor.getAttribute('href') ?? '';
    }
    setLinkUrl(existingUrl);
    setShowLinkPopover(true);
  }, [saveSelection]);

  const insertLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    restoreSelection();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // If no text selected, insert the URL as link text
      const selectedText = range.toString() || href;
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = selectedText;
      range.deleteContents();
      range.insertNode(anchor);
      // Move cursor after the link
      range.setStartAfter(anchor);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    flushToParent();
    setShowLinkPopover(false);
    setLinkUrl('');
  }, [linkUrl, restoreSelection, flushToParent]);

  const showPlaceholder = !value || value.trim().length === 0;

  return (
    <div className="flex flex-col text-sm font-medium text-blue-900 md:col-span-2">
      <span>{label}</span>
      <div className="mt-1 rounded-md border border-blue-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border-b border-blue-100 bg-blue-50 px-2 py-1">
          <button
            type="button"
            onMouseDown={(e) => handleToolbarMouseDown(e, 'bold')}
            className="rounded p-1.5 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-3.5 w-3.5 stroke-[2.5]" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => handleToolbarMouseDown(e, 'italic')}
            className="rounded p-1.5 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
            title="Italic (Ctrl+I)"
          >
            <Italic className="h-3.5 w-3.5 stroke-[2.5]" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => handleToolbarMouseDown(e, 'underline')}
            className="rounded p-1.5 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
            title="Underline (Ctrl+U)"
          >
            <Underline className="h-3.5 w-3.5 stroke-[2.5]" />
          </button>
          <div className="mx-1 h-4 w-px bg-blue-200" />
          <button
            type="button"
            onMouseDown={(e) => handleToolbarMouseDown(e, 'insertUnorderedList')}
            className="rounded p-1.5 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
            title="Bullet list"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => handleToolbarMouseDown(e, 'insertOrderedList')}
            className="rounded p-1.5 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
            title="Numbered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-blue-200" />
          <div className="relative">
            <button
              type="button"
              onMouseDown={openLinkPopover}
              className="rounded p-1.5 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
              title="Insert link"
            >
              <Link className="h-3.5 w-3.5" />
            </button>
            {showLinkPopover && (
              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-blue-200 bg-white p-3 shadow-lg">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-900">Insert link</span>
                  <button
                    type="button"
                    onClick={() => setShowLinkPopover(false)}
                    className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  ref={linkInputRef}
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setShowLinkPopover(false); }}
                  placeholder="https://example.com"
                  className="w-full rounded-md border border-blue-200 px-2 py-1.5 text-xs text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                />
                <button
                  type="button"
                  onClick={insertLink}
                  className="mt-2 w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Insert
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Editable area */}
        <div className="relative">
          {showPlaceholder && placeholder && (
            <div className="pointer-events-none absolute inset-0 select-none px-3 py-2 text-sm text-gray-400">
              {placeholder}
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onFocus={handleFocus}
            onBlur={handleBlur}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="min-h-[120px] px-3 py-2 text-sm text-gray-900 focus:outline-none [&_a]:text-blue-600 [&_a]:underline [&_a]:cursor-pointer [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          />
        </div>
      </div>
    </div>
  );
};

const gradingOptions: LessonGradingSystem[] = ['NC/S/C/-', 'Pass or Fail', 'Out of 100'];

const getDefaultPassingGrade = (system: LessonGradingSystem) => {
  switch (system) {
    case 'Pass or Fail':
      return 'Pass';
    case 'Out of 100':
      return '75';
    default:
      return 'C';
  }
};

const createEmptyCriterion = (system: LessonGradingSystem = 'NC/S/C/-'): EditableCriterion => ({
  id: `criterion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  gradingSystem: system,
  passingGrade: getDefaultPassingGrade(system)
});

const createAdvancedCriterion = (name: string): EditableCriterion => ({
  id: `criterion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name,
  gradingSystem: 'Pass or Fail',
  passingGrade: 'Pass',
});

const defaultAdvancedCriteria = () => [
  createAdvancedCriterion('Practical flying standard'),
  createAdvancedCriterion('Airmanship, human factors and decision making'),
  createAdvancedCriterion('Knowledge and preparation'),
];

const defaultFlyingDeclarationText = [
  'Persons undertaking flying training and other types of flying in recreational aircraft are advised that there are risks involved.',
  'These risks cannot be specifically quantified; however, recreational aircraft used for pilot training and private flight are constructed, operated and maintained under exemptions from the regulations.',
  'These exemptions are from the regulations that apply to CASA registered aircraft. Whilst similar rule sets apply to our organisation and replace those that we are exempt from, it must be accepted that the overall safety of recreational flying is generally below the well-known commercial air transport standards in Australia.',
  'I, ________________________________, Member Number: __________________ declare that I am aware of and understand the risks involved in recreational flying training.',
].join('\n\n');

const defaultGuardianDeclarationText = [
  'I, ____________________________________ (the parent or legal guardian of the applicant named above) declare that I am aware of and understand the risks involved in recreational flying training.',
  'I give consent for the above applicant to undertake such training. I am aware RAAus has a policy in place for working with children and vulnerable people. This policy is available from RAAus on request.',
  'Parent/Guardian Signature: ______________________________, Date: _______________________',
  '*Only required to be filled in when member is under the age of 18 years.',
].join('\n\n');

const createEmptyExam = (): EditableExam => ({
  id: `exam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  passMark: 80
});

const pilotCertificateFlightTestTemplate: NewLessonState = {
  name: 'Pilot Certificate Flight Test',
  objective: 'Complete the RAAus Pilot Certificate Flight Test and record the result against the student file as the certificate flight review / test outcome.',
  flightExercises: '<ul><li>Pre-flight planning, aircraft documents and operational decision making.</li><li>Normal and abnormal handling across the RPC flight test profile.</li><li>Circuit, forced landing, training area, emergency and undesired-state management.</li><li>Post-flight debrief, result, limitations and next actions.</li></ul>',
  theory: '<p>Confirm Presolo, Radio, BAK and Pre Certificate Airlaw exam results are recorded before the certificate test result is finalised.</p>',
  isFlightTest: true,
};

const normaliseKeyExercises = (content: string) =>
  richTextToPlainText(content)
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

const emptyCourseForm = (): CourseFormState => ({
  title: '',
  category: '',
  description: '',
  estimatedDurationHours: 6,
  requiresStudentAcknowledgement: true,
  requiresFlyingDeclaration: false,
  flyingDeclarationTitle: 'Flying Declaration',
  flyingDeclarationText: defaultFlyingDeclarationText,
  requiresGuardianDeclarationForMinors: true,
  guardianDeclarationTitle: 'Under 18 Years - Parent/Guardian Declaration',
  guardianDeclarationText: defaultGuardianDeclarationText,
  completionEndorsementEnabled: false,
  completionEndorsementType: '',
  completionEndorsementExpiryMonths: '',
  tags: '',
  objectives: '',
  evaluationFocus: '',
});

const parseListLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

const matrixCellClass = (standard?: number) => {
  if (standard === 1) return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
  if (standard === 2) return 'bg-blue-100 text-blue-800 ring-blue-200';
  if (standard === 3) return 'bg-amber-100 text-amber-800 ring-amber-200';
  return 'bg-transparent text-slate-300';
};

interface CourseMatrixPanelProps {
  course: TrainingModule;
  rows: SyllabusMatrixRow[];
  requirements: SyllabusMatrixRequirement[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  onMatrixChanged: () => Promise<void>;
}

const CourseMatrixPanel: React.FC<CourseMatrixPanelProps> = ({
  course,
  rows,
  requirements,
  loading,
  error,
  canEdit,
  onMatrixChanged,
}) => {
  const [selectedLessonId, setSelectedLessonId] = useState(course.lessons[0]?.id ?? '');
  const [rowSearch, setRowSearch] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedOverview, setExpandedOverview] = useState(false);
  const [newMatrixRow, setNewMatrixRow] = useState({
    code: '',
    unitCode: '',
    elementCode: '',
    description: '',
  });

  useEffect(() => {
    if (!course.lessons.some((lesson) => lesson.id === selectedLessonId)) {
      setSelectedLessonId(course.lessons[0]?.id ?? '');
    }
  }, [course.lessons, selectedLessonId]);

  const selectedLesson = course.lessons.find((lesson) => lesson.id === selectedLessonId) ?? course.lessons[0];
  const selectedLessonRequirements = selectedLesson
    ? requirements
        .filter((requirement) =>
          requirement.lessonId === selectedLesson.id ||
          requirement.lessonSequenceCode === selectedLesson.sequenceCode
        )
        .map((requirement) => ({
          requirement,
          row: rows.find((item) => item.id === requirement.matrixRowId),
        }))
        .filter((item): item is { requirement: SyllabusMatrixRequirement; row: SyllabusMatrixRow } => Boolean(item.row))
        .sort((a, b) => a.row.sortOrder - b.row.sortOrder)
    : [];

  const selectedRequirementRowIds = new Set(selectedLessonRequirements.map(({ row }) => row.id));
  const addableRows = rows
    .filter((row) => row.rowType === 'criterion' && !selectedRequirementRowIds.has(row.id))
    .filter((row) => {
      const term = rowSearch.trim().toLowerCase();
      if (!term) return true;
      return [
        row.code,
        row.parentCode,
        row.unitCode,
        row.elementCode,
        row.description,
      ].filter(Boolean).join(' ').toLowerCase().includes(term);
    })
    .slice(0, 25);

  const standardCounts = requirements.reduce<Record<number, number>>((acc, requirement) => {
    acc[requirement.requiredStandard] = (acc[requirement.requiredStandard] ?? 0) + 1;
    return acc;
  }, {});

  const lessonRequirementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    course.lessons.forEach((lesson) => {
      const count = requirements.filter((requirement) =>
        requirement.lessonId === lesson.id ||
        requirement.lessonSequenceCode === lesson.sequenceCode
      ).length;
      counts.set(lesson.id, count);
    });
    return counts;
  }, [course.lessons, requirements]);

  const handleUpdateRequirementStandard = async (requirement: SyllabusMatrixRequirement, standard?: 1 | 2 | 3) => {
    if (!canEdit) return;
    setSavingKey(`req-${requirement.id}`);
    try {
      if (!standard) {
        const { error: deleteError } = await supabase
          .from('syllabus_matrix_requirements')
          .delete()
          .eq('id', requirement.id);
        if (deleteError) throw deleteError;
      } else {
        const { error: updateError } = await supabase
          .from('syllabus_matrix_requirements')
          .update({ required_standard: standard })
          .eq('id', requirement.id);
        if (updateError) throw updateError;
      }
      await onMatrixChanged();
      toast.success(standard ? 'Matrix standard updated' : 'Requirement removed from lesson');
    } catch (err) {
      console.error('Failed to update matrix requirement:', err);
      toast.error('Failed to update matrix requirement');
    } finally {
      setSavingKey(null);
    }
  };

  const handleUpdateRequirementCriterion = async (requirement: SyllabusMatrixRequirement, assessmentCriterionId: string) => {
    if (!canEdit) return;
    setSavingKey(`criterion-${requirement.id}`);
    try {
      const { error: updateError } = await supabase
        .from('syllabus_matrix_requirements')
        .update({ assessment_criterion_id: assessmentCriterionId || null })
        .eq('id', requirement.id);
      if (updateError) throw updateError;

      await onMatrixChanged();
      toast.success(assessmentCriterionId ? 'Assessment criterion linked' : 'Assessment criterion link removed');
    } catch (err) {
      console.error('Failed to link matrix requirement to criterion:', err);
      toast.error('Failed to link assessment criterion');
    } finally {
      setSavingKey(null);
    }
  };

  const handleUpdateRowDescription = async (row: SyllabusMatrixRow, nextDescription: string) => {
    const trimmed = nextDescription.trim();
    if (!canEdit || !trimmed || trimmed === row.description) return;

    setSavingKey(`row-${row.id}`);
    try {
      const { error: updateError } = await supabase
        .from('syllabus_matrix_rows')
        .update({ description: trimmed })
        .eq('id', row.id);
      if (updateError) throw updateError;

      await onMatrixChanged();
      toast.success('Matrix wording updated');
    } catch (err) {
      console.error('Failed to update matrix row:', err);
      toast.error('Failed to update matrix wording');
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddRequirement = async (row: SyllabusMatrixRow, standard: 1 | 2 | 3 = 3) => {
    if (!canEdit) return;
    if (!selectedLesson) {
      toast.error('Add at least one lesson before linking matrix requirements');
      return;
    }
    setSavingKey(`add-${row.id}`);
    try {
      const lessonSequenceCode = selectedLesson.sequenceCode || selectedLesson.id;
      const { error: insertError } = await supabase
        .from('syllabus_matrix_requirements')
        .insert({
          course_id: course.id,
          lesson_id: selectedLesson.id,
          matrix_row_id: row.id,
          lesson_sequence_code: lessonSequenceCode,
          lesson_column_title: selectedLesson.name || selectedLesson.sequenceTitle || lessonSequenceCode,
          required_standard: standard,
          assessment_criterion_id: null,
        });
      if (insertError) throw insertError;

      setRowSearch('');
      await onMatrixChanged();
      toast.success('Requirement added to lesson');
    } catch (err) {
      console.error('Failed to add matrix requirement:', err);
      toast.error('Failed to add matrix requirement');
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddMatrixRow = async () => {
    if (!canEdit) return;
    const description = newMatrixRow.description.trim();
    if (!description) {
      toast.error('Add matrix wording first');
      return;
    }

    const code = newMatrixRow.code.trim() || `M${rows.length + 1}`;
    const unitCode = newMatrixRow.unitCode.trim() || null;
    const elementCode = newMatrixRow.elementCode.trim() || unitCode || code;
    setSavingKey('new-matrix-row');
    try {
      const { error: insertError } = await supabase
        .from('syllabus_matrix_rows')
        .insert({
          course_id: course.id,
          code,
          row_type: 'criterion',
          unit_code: unitCode,
          element_code: elementCode,
          parent_code: elementCode,
          description,
          source_row_number: rows.length + 1,
          sort_order: rows.reduce((max, row) => Math.max(max, row.sortOrder ?? 0), 0) + 1,
        });
      if (insertError) throw insertError;

      setNewMatrixRow({ code: '', unitCode: '', elementCode: '', description: '' });
      await onMatrixChanged();
      toast.success('Matrix row added');
    } catch (err) {
      console.error('Failed to add matrix row:', err);
      toast.error('Failed to add matrix row');
    } finally {
      setSavingKey(null);
    }
  };

  const matrixRowCreator = canEdit ? (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-950">Add matrix item</p>
          <p className="mt-1 text-xs text-indigo-700">
            Use this for advanced syllabus courses. Add each competency item once, then attach it to the lessons where it must be assessed.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[120px_120px_140px_minmax(0,1fr)_auto]">
        <input
          value={newMatrixRow.code}
          onChange={(event) => setNewMatrixRow((current) => ({ ...current, code: event.target.value }))}
          placeholder="Code"
          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <input
          value={newMatrixRow.unitCode}
          onChange={(event) => setNewMatrixRow((current) => ({ ...current, unitCode: event.target.value }))}
          placeholder="Unit"
          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <input
          value={newMatrixRow.elementCode}
          onChange={(event) => setNewMatrixRow((current) => ({ ...current, elementCode: event.target.value }))}
          placeholder="Element"
          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <textarea
          value={newMatrixRow.description}
          onChange={(event) => setNewMatrixRow((current) => ({ ...current, description: event.target.value }))}
          placeholder="Plain-English competency wording"
          rows={2}
          className="min-h-10 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="button"
          disabled={savingKey === 'new-matrix-row'}
          onClick={handleAddMatrixRow}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Matrix could not load: {error}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          No syllabus matrix is attached to this course yet. Add matrix items below, then attach them to lessons with the required pass standard.
        </div>
        {matrixRowCreator}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5 sm:p-6">
      {matrixRowCreator}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Matrix rows</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lesson checks</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{requirements.length}</p>
        </div>
        {[3, 2].map((standard) => (
          <div key={standard} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standard {standard}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{standardCounts[standard] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold">CASA standard key</p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {[3, 2, 1].map((standard) => (
            <span key={standard} className={`rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${matrixCellClass(standard)}`}>
              {matrixStandardLabel(standard as 1 | 2 | 3)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Lessons</p>
          <div className="max-h-[36rem] space-y-1 overflow-y-auto pr-1">
            {course.lessons.map((lesson, index) => {
              const isActive = lesson.id === selectedLesson?.id;
              return (
                <button
                  key={lesson.id}
                  type="button"
                  onClick={() => setSelectedLessonId(lesson.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition ${
                    isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-xs font-semibold opacity-80">{index + 1}. {lesson.sequenceCode || 'Lesson'}</span>
                  <span className="mt-0.5 block truncate text-sm font-semibold">{lesson.name || lesson.sequenceTitle}</span>
                  <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {lessonRequirementCounts.get(lesson.id) ?? 0} checks
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Editing lesson</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{selectedLesson?.name || selectedLesson?.sequenceTitle || 'Select a lesson'}</h3>
                <p className="mt-1 text-sm text-slate-500">{selectedLessonRequirements.length} matrix requirements attached to this lesson</p>
              </div>
              {!canEdit && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                  Read only
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {selectedLessonRequirements.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                  No matrix requirements are attached to this lesson yet.
                </div>
              ) : (
                selectedLessonRequirements.map(({ row, requirement }) => (
                  <div key={requirement.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {row.elementCode || row.unitCode || row.code}
                        </p>
                        {canEdit ? (
                          <textarea
                            defaultValue={formatSyllabusMatrixText(row.description)}
                            onBlur={(event) => handleUpdateRowDescription(row, event.target.value)}
                            rows={2}
                            className="mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium leading-5 text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        ) : (
                          <p className="mt-1 text-sm font-medium text-slate-900">{formatSyllabusMatrixText(row.description)}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {[3, 2, 1].map((standard) => (
                          <button
                            key={standard}
                            type="button"
                            disabled={!canEdit || savingKey === `req-${requirement.id}`}
                            onClick={() => handleUpdateRequirementStandard(requirement, standard as 1 | 2 | 3)}
                            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-bold ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              requirement.requiredStandard === standard
                                ? matrixCellClass(standard)
                                : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-100'
                            }`}
                            title={matrixStandardLabel(standard as 1 | 2 | 3)}
                          >
                            {standard}
                          </button>
                        ))}
                        {canEdit && (
                          <button
                            type="button"
                            disabled={savingKey === `req-${requirement.id}`}
                            onClick={() => handleUpdateRequirementStandard(requirement, undefined)}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {course.assessmentCriteria.length > 0 && (
                      <div className="mt-3">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Contributes to assessment criterion
                        </label>
                        <select
                          disabled={!canEdit || savingKey === `criterion-${requirement.id}`}
                          value={requirement.assessmentCriterionId || ''}
                          onChange={(event) => handleUpdateRequirementCriterion(requirement, event.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          <option value="">No broad criterion link</option>
                          {course.assessmentCriteria.map((criterion) => (
                            <option key={criterion.id} value={criterion.id}>
                              {criterion.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">
                          If this matrix item is below its required standard, the linked criterion is treated as below pass for that lesson.
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {canEdit && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Add matrix requirement</p>
                  <p className="mt-1 text-xs text-slate-500">Search unused CASA rows and attach them to the selected lesson.</p>
                </div>
                <input
                  value={rowSearch}
                  onChange={(event) => setRowSearch(event.target.value)}
                  placeholder="Search code or wording"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:w-72"
                />
              </div>
              {rowSearch.trim() && (
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {addableRows.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No matching unused matrix rows.</p>
                  ) : (
                    addableRows.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {row.elementCode || row.unitCode || row.code}
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{formatSyllabusMatrixText(row.description)}</p>
                        </div>
                        <div className="flex gap-1">
                          {[3, 2, 1].map((standard) => (
                            <button
                              key={standard}
                              type="button"
                              disabled={savingKey === `add-${row.id}`}
                              onClick={() => handleAddRequirement(row, standard as 1 | 2 | 3)}
                              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-bold ring-1 disabled:cursor-not-allowed disabled:opacity-60 ${matrixCellClass(standard)}`}
                              title={`Add as ${matrixStandardLabel(standard as 1 | 2 | 3)}`}
                            >
                              {standard}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <button
          type="button"
          onClick={() => setExpandedOverview((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <p className="text-sm font-semibold text-slate-950">Course coverage overview</p>
            <p className="mt-1 text-xs text-slate-500">Compact reference by lesson. Use the editor above for changes.</p>
          </div>
          {expandedOverview ? <ChevronDown className="h-5 w-5 text-slate-500" /> : <ChevronRight className="h-5 w-5 text-slate-500" />}
        </button>
        {expandedOverview && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {course.lessons.map((lesson, index) => {
              const lessonRequirements = requirements.filter((requirement) =>
                requirement.lessonId === lesson.id ||
                requirement.lessonSequenceCode === lesson.sequenceCode
              );
              return (
                <button
                  key={lesson.id}
                  type="button"
                  onClick={() => setSelectedLessonId(lesson.id)}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:border-blue-200 hover:bg-blue-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-500">{index + 1}. {lesson.sequenceCode || 'Lesson'}</p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{lesson.name || lesson.sequenceTitle}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                      {lessonRequirements.length}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[3, 2, 1].map((standard) => (
                      <span key={standard} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${matrixCellClass(standard)}`}>
                        {standard}: {lessonRequirements.filter((requirement) => requirement.requiredStandard === standard).length}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        This matrix is imported from 00_RPL(A) Planning Matrix.DOCX and is used by CASA RPL(A) lesson records.
      </p>
    </div>
  );
};

export const TrainingCourseCatalog: React.FC = () => {
  const { modules, loading: modulesLoading, addModule, updateModule, reorderLessons, deleteModule } = useTrainingModules();
  const { settings: trainingSettings } = useTrainingSettings();
  const { user } = useAuth();
  const endorsementTypes = trainingSettings.endorsementTypes || [];
  const editCourseFormRef = useRef<HTMLDivElement | null>(null);
  const lessonFormRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTargetRef = useRef<'edit-course' | 'lesson' | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(() => modules[0]?.id ?? null);
  const [courseDetailTab, setCourseDetailTab] = useState<'overview' | 'matrix'>('overview');

  // Create course form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourseMode, setNewCourseMode] = useState<CourseBuildMode>('simple');
  const [newCourse, setNewCourse] = useState<CourseFormState>(emptyCourseForm);
  // Course-level criteria (shared across all lessons)
  const [courseCriteria, setCourseCriteria] = useState<EditableCriterion[]>([]);

  // Edit course form
  const [showEditCourseForm, setShowEditCourseForm] = useState(false);
  const [editCourse, setEditCourse] = useState<CourseFormState>(emptyCourseForm);
  const [editCourseCriteria, setEditCourseCriteria] = useState<EditableCriterion[]>([]);
  const [editCourseExams, setEditCourseExams] = useState<EditableExam[]>([]);

  // Delete course confirm
  const [showDeleteCourseConfirm, setShowDeleteCourseConfirm] = useState(false);

  // Lesson form
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [newLesson, setNewLesson] = useState<NewLessonState>({
    name: '',
    objective: '',
    flightExercises: '',
    theory: '',
    isFlightTest: false
  });
  // Per-lesson pass marks: criterionId → passingGrade
  const [lessonPassMarks, setLessonPassMarks] = useState<Record<string, string>>({});
  const [expandedLessons, setExpandedLessons] = useState<Record<string, boolean>>({});
  const [deletingLessonId, setDeletingLessonId] = useState<string | null>(null);

  useEffect(() => {
    if (modules.length === 0) {
      setSelectedModuleId(null);
      setShowLessonForm(false);
      setNewLesson({ name: '', objective: '', flightExercises: '', theory: '', isFlightTest: false });
      setLessonPassMarks({});
      return;
    }

    if (!selectedModuleId || !modules.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(modules[0].id);
      setShowLessonForm(false);
      setNewLesson({ name: '', objective: '', flightExercises: '', theory: '', isFlightTest: false });
      setLessonPassMarks({});
    }
  }, [modules, selectedModuleId]);

  const filteredModules = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const tagFilters = selectedTagFilters.map((tag) => tag.toLowerCase());
    const sorted = [...modules].sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());

    if (!term && tagFilters.length === 0) {
      return sorted;
    }

    return sorted.filter((module) => {
      const tagString = module.tags.join(' ').toLowerCase();
      const moduleTags = module.tags.map((tag) => tag.toLowerCase());
      const matchesSearch =
        !term ||
        module.title.toLowerCase().includes(term) ||
        module.category.toLowerCase().includes(term) ||
        tagString.includes(term);
      const matchesTag =
        tagFilters.length === 0 ||
        tagFilters.every((tagFilter) => moduleTags.includes(tagFilter));

      return matchesSearch && matchesTag;
    });
  }, [modules, searchTerm, selectedTagFilters]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    modules.forEach((module) => {
      module.tags.forEach((tag) => {
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
      });
    });

    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [modules]);

  useEffect(() => {
    if (selectedTagFilters.length === 0) return;

    const availableTagSet = new Set(availableTags.map((tag) => tag.toLowerCase()));
    const nextFilters = selectedTagFilters.filter((tag) => availableTagSet.has(tag.toLowerCase()));
    if (nextFilters.length !== selectedTagFilters.length) {
      setSelectedTagFilters(nextFilters);
    }
  }, [availableTags, selectedTagFilters]);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;
  const {
    rows: selectedMatrixRows,
    requirements: selectedMatrixRequirements,
    loading: selectedMatrixLoading,
    error: selectedMatrixError,
    refetch: refetchSelectedMatrix,
  } = useSyllabusMatrix(selectedModule?.id);
  const courseStats = useMemo(() => {
    const published = modules.filter((module) => module.status === 'published').length;
    const draft = modules.length - published;
    const lessonCount = modules.reduce((sum, module) => sum + module.lessons.length, 0);
    const testFlightCount = modules.reduce(
      (sum, module) => sum + module.lessons.filter((lesson) => lesson.isFlightTest).length,
      0
    );

    return { published, draft, lessonCount, testFlightCount };
  }, [modules]);
  const selectedLessonStats = useMemo(() => {
    if (!selectedModule) {
      return { flightTests: 0, exams: 0, criteria: 0 };
    }

    return {
      flightTests: selectedModule.lessons.filter((lesson) => lesson.isFlightTest).length,
      exams: (selectedModule.exams || []).length,
      criteria: selectedModule.assessmentCriteria.length,
    };
  }, [selectedModule]);
  const selectedMatrixRowsById = useMemo(
    () => new Map(selectedMatrixRows.map((row) => [row.id, row])),
    [selectedMatrixRows]
  );
  const getLessonMatrixRequirements = useCallback((lesson?: TrainingLesson | null) => {
    if (!lesson) return [];
    return selectedMatrixRequirements
      .filter((requirement) =>
        requirement.lessonId === lesson.id ||
        requirement.lessonSequenceCode === lesson.sequenceCode
      )
      .map((requirement) => ({
        requirement,
        row: selectedMatrixRowsById.get(requirement.matrixRowId),
      }))
      .filter((item): item is { requirement: SyllabusMatrixRequirement; row: SyllabusMatrixRow } => Boolean(item.row))
      .sort((a, b) => a.row.sortOrder - b.row.sortOrder);
  }, [selectedMatrixRequirements, selectedMatrixRowsById]);
  const getMatrixStandardCounts = (items: Array<{ requirement: SyllabusMatrixRequirement }>) =>
    items.reduce<Record<number, number>>((acc, item) => {
      acc[item.requirement.requiredStandard] = (acc[item.requirement.requiredStandard] ?? 0) + 1;
      return acc;
    }, {});

  const queueFormScroll = (target: 'edit-course' | 'lesson') => {
    pendingScrollTargetRef.current = target;
  };

  const toggleTagFilter = (tag: string) => {
    setSelectedTagFilters((current) =>
      current.some((selectedTag) => selectedTag.toLowerCase() === tag.toLowerCase())
        ? current.filter((selectedTag) => selectedTag.toLowerCase() !== tag.toLowerCase())
        : [...current, tag]
    );
  };

  useEffect(() => {
    const target = pendingScrollTargetRef.current;
    if (!target) return;

    const node = target === 'edit-course' ? editCourseFormRef.current : lessonFormRef.current;
    if (!node) return;

    pendingScrollTargetRef.current = null;
    window.requestAnimationFrame(() => {
      const top = node.getBoundingClientRect().top + window.scrollY - 16;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }, [editingLessonId, selectedModuleId, showEditCourseForm, showLessonForm]);

  useEffect(() => {
    if (!selectedModule) {
      setExpandedLessons({});
      return;
    }

    setExpandedLessons((prev) => {
      const next: Record<string, boolean> = {};
      let hasDifference = false;

      selectedModule.lessons.forEach((lesson) => {
        const existing = prev[lesson.id];
        next[lesson.id] = existing ?? false;
        if (existing === undefined) {
          hasDifference = true;
        }
      });

      if (!hasDifference) {
        const prevKeys = Object.keys(prev);
        if (prevKeys.length !== selectedModule.lessons.length) {
          hasDifference = true;
        } else {
          hasDifference = prevKeys.some((key) => !(key in next));
        }
      }

      return hasDifference ? next : prev;
    });
  }, [selectedModule]);

  const resetLessonForm = () => {
    setNewLesson({ name: '', objective: '', flightExercises: '', theory: '', isFlightTest: false });
    setLessonPassMarks({});
    setEditingLessonId(null);
  };

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModuleId(moduleId);
    setCourseDetailTab('overview');
    setShowLessonForm(false);
    setShowEditCourseForm(false);
    setShowDeleteCourseConfirm(false);
    setDeletingLessonId(null);
    resetLessonForm();
  };

  // Permission: can the current user edit/delete this course?
  const canManageCourse = (module: TrainingModule) => {
    if (!user) return false;
    return user.role === 'admin' || module.createdBy === user.id;
  };

  const handleOpenEditCourse = () => {
    if (!selectedModule) return;
    queueFormScroll('edit-course');
    setEditCourse({
      title: selectedModule.title,
      category: selectedModule.category,
      description: selectedModule.description,
      estimatedDurationHours: selectedModule.estimatedDurationHours,
      requiresStudentAcknowledgement: selectedModule.requiresStudentAcknowledgement ?? true,
      requiresFlyingDeclaration: selectedModule.requiresFlyingDeclaration ?? false,
      flyingDeclarationTitle: selectedModule.flyingDeclarationTitle || 'Flying Declaration',
      flyingDeclarationText: selectedModule.flyingDeclarationText || defaultFlyingDeclarationText,
      requiresGuardianDeclarationForMinors: selectedModule.requiresGuardianDeclarationForMinors ?? true,
      guardianDeclarationTitle: selectedModule.guardianDeclarationTitle || 'Under 18 Years - Parent/Guardian Declaration',
      guardianDeclarationText: selectedModule.guardianDeclarationText || defaultGuardianDeclarationText,
      completionEndorsementEnabled: selectedModule.completionEndorsementEnabled ?? false,
      completionEndorsementType: selectedModule.completionEndorsementType ?? '',
      completionEndorsementExpiryMonths: selectedModule.completionEndorsementExpiryMonths ? String(selectedModule.completionEndorsementExpiryMonths) : '',
      tags: selectedModule.tags.join(', '),
      objectives: selectedModule.objectives.join('\n'),
      evaluationFocus: selectedModule.evaluationCriteria.join('\n'),
    });
    setEditCourseCriteria(selectedModule.assessmentCriteria.map((c) => ({ ...c })));
    setEditCourseExams((selectedModule.exams || []).map((exam) => ({ ...exam })));
    setShowEditCourseForm(true);
    setShowLessonForm(false);
  };

  const handleSaveEditCourse = async () => {
    if (!selectedModule) return;
    const title = editCourse.title.trim();
    const category = editCourse.category.trim();
    if (!title) { toast.error('Course title is required'); return; }
    if (!category) { toast.error('Category is required'); return; }
    if (editCourse.completionEndorsementEnabled && !editCourse.completionEndorsementType.trim()) {
      toast.error('Select the endorsement granted by this course');
      return;
    }
    if (editCourse.completionEndorsementEnabled && endorsementTypes.length === 0) {
      toast.error('Add endorsement options in Training / Syllabus Settings first');
      return;
    }

    // Validate criteria
    const criteria: LessonAssessmentCriterion[] = [];
    for (const c of editCourseCriteria) {
      if (!c.name.trim()) { toast.error('Each criterion needs a name'); return; }
      criteria.push({ id: c.id, name: c.name.trim(), gradingSystem: c.gradingSystem, passingGrade: c.passingGrade });
    }

    if (editCourse.requiresFlyingDeclaration && !editCourse.flyingDeclarationText.trim()) {
      toast.error('Add the flying declaration wording, or turn off the declaration requirement');
      return;
    }
    if (editCourse.requiresFlyingDeclaration && editCourse.requiresGuardianDeclarationForMinors && !editCourse.guardianDeclarationText.trim()) {
      toast.error('Add the parent/guardian declaration wording, or turn off the minor declaration requirement');
      return;
    }

    const tags = editCourse.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const objectives = parseListLines(editCourse.objectives);
    const evaluationCriteria = parseListLines(editCourse.evaluationFocus);
    const exams: TrainingExam[] = [];
    for (const exam of editCourseExams) {
      const name = exam.name.trim();
      if (!name) {
        toast.error('Each exam needs a name');
        return;
      }
      const passMark = Number(exam.passMark);
      if (Number.isNaN(passMark) || passMark < 0 || passMark > 100) {
        toast.error(`Pass mark for "${name}" must be between 0 and 100`);
        return;
      }
      exams.push({
        id: exam.id || `exam-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        passMark: Math.round(passMark)
      });
    }
    try {
      const declarationChanged =
        (selectedModule.flyingDeclarationTitle || 'Flying Declaration') !== (editCourse.flyingDeclarationTitle.trim() || 'Flying Declaration') ||
        (selectedModule.flyingDeclarationText || '') !== editCourse.flyingDeclarationText.trim() ||
        (selectedModule.guardianDeclarationTitle || 'Under 18 Years - Parent/Guardian Declaration') !== (editCourse.guardianDeclarationTitle.trim() || 'Under 18 Years - Parent/Guardian Declaration') ||
        (selectedModule.guardianDeclarationText || '') !== editCourse.guardianDeclarationText.trim();

      await updateModule(selectedModule.id, (cur) => ({
        ...cur,
        title,
        category,
        description: editCourse.description.trim() || cur.description,
        estimatedDurationHours: Math.max(1, Number(editCourse.estimatedDurationHours) || 1),
        requiresStudentAcknowledgement: editCourse.requiresStudentAcknowledgement,
        requiresFlyingDeclaration: editCourse.requiresFlyingDeclaration,
        flyingDeclarationTitle: editCourse.flyingDeclarationTitle.trim() || 'Flying Declaration',
        flyingDeclarationText: editCourse.flyingDeclarationText.trim(),
        flyingDeclarationVersion: declarationChanged ? (cur.flyingDeclarationVersion ?? 1) + 1 : (cur.flyingDeclarationVersion ?? 1),
        requiresGuardianDeclarationForMinors: editCourse.requiresGuardianDeclarationForMinors,
        guardianDeclarationTitle: editCourse.guardianDeclarationTitle.trim() || 'Under 18 Years - Parent/Guardian Declaration',
        guardianDeclarationText: editCourse.guardianDeclarationText.trim(),
        completionEndorsementEnabled: editCourse.completionEndorsementEnabled,
        completionEndorsementType: editCourse.completionEndorsementType.trim(),
        completionEndorsementExpiryMonths: editCourse.completionEndorsementEnabled && editCourse.completionEndorsementExpiryMonths
          ? Math.max(1, Number(editCourse.completionEndorsementExpiryMonths) || 1)
          : null,
        tags: tags.length > 0 ? tags : cur.tags,
        objectives,
        evaluationCriteria,
        assessmentCriteria: criteria,
        exams,
        lastUpdated: new Date(),
      }));
      toast.success('Course updated');
      setShowEditCourseForm(false);
    } catch { /* handled in context */ }
  };

  const handleDeleteCourse = async () => {
    if (!selectedModule) return;
    try {
      await deleteModule(selectedModule.id);
      setShowDeleteCourseConfirm(false);
      toast.success('Course deleted');
    } catch { /* handled in context */ }
  };

  const handleEditLesson = (lesson: TrainingLesson) => {
    queueFormScroll('lesson');
    setNewLesson({
      name: lesson.name,
      objective: lesson.objective,
      flightExercises: lesson.flightExercises,
      theory: lesson.theory,
      isFlightTest: lesson.isFlightTest ?? false,
    });
    // Populate pass marks from existing lesson data
    setLessonPassMarks(lesson.passMarks ?? {});
    setEditingLessonId(lesson.id);
    setShowLessonForm(true);
    setShowEditCourseForm(false);
    setExpandedLessons((prev) => ({ ...prev, [lesson.id]: false }));
  };

  const handleDeleteLesson = async (lessonId: string) => {
    if (!selectedModule) return;
    try {
      await updateModule(selectedModule.id, (current) => ({
        ...current,
        lessons: current.lessons.filter((l) => l.id !== lessonId),
        lastUpdated: new Date(),
      }));
      setDeletingLessonId(null);
      toast.success('Lesson removed from course');
    } catch {
      // error toast handled in context
    }
  };

  const handleMoveLesson = async (lessonId: string, direction: 'up' | 'down') => {
    if (!selectedModule) return;

    const currentIndex = selectedModule.lessons.findIndex((lesson) => lesson.id === lessonId);
    if (currentIndex === -1) return;

    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= selectedModule.lessons.length) return;

    const nextLessons = [...selectedModule.lessons];
    [nextLessons[currentIndex], nextLessons[nextIndex]] = [nextLessons[nextIndex], nextLessons[currentIndex]];

    try {
      await reorderLessons(selectedModule.id, nextLessons.map((lesson) => lesson.id));
      toast.success('Lesson order updated');
    } catch {
      // error toast handled in context
    }
  };

  const handleToggleLessonExpansion = (lessonId: string) => {
    setExpandedLessons((prev) => ({
      ...prev,
      [lessonId]: !prev[lessonId]
    }));
  };

  const handleExpandCollapseAll = (expand: boolean) => {
    if (!selectedModule) return;
    const next: Record<string, boolean> = {};
    selectedModule.lessons.forEach((lesson) => {
      next[lesson.id] = expand;
    });
    setExpandedLessons(next);
  };

  const allLessonsExpanded =
    selectedModule?.lessons.length
      ? selectedModule.lessons.every((lesson) => expandedLessons[lesson.id])
      : false;

  const handleCourseModeChange = (mode: CourseBuildMode) => {
    setNewCourseMode(mode);
    if (mode === 'advanced') {
      setCourseCriteria((current) => current.length > 0 ? current : defaultAdvancedCriteria());
      setNewCourse((current) => ({
        ...current,
        category: current.category || 'Advanced Matrix',
        tags: current.tags || 'advanced, matrix',
        description: current.description || 'A structured syllabus course where individual matrix items are assessed against each lesson.',
        objectives: current.objectives || [
          'Track lesson progress against detailed syllabus matrix items.',
          'Show clearly which items have been met and which need to be carried forward.',
          'Use pass/fail broad criteria backed by detailed matrix evidence.',
        ].join('\n'),
        evaluationFocus: current.evaluationFocus || [
          'Has each required matrix item been assessed at the required standard?',
          'Are any not-yet-met items clearly carried forward?',
          'Does the student meet the broad course criteria for this lesson?',
        ].join('\n'),
      }));
    } else {
      setCourseCriteria((current) => current.length > 0 ? current : [createEmptyCriterion(trainingSettings.defaultGradingSystem)]);
      setNewCourse((current) => ({
        ...current,
        category: current.category === 'Advanced Matrix' ? '' : current.category,
      }));
    }
  };

  const handleCreateCourse = async () => {
    const title = newCourse.title.trim();
    const description = newCourse.description.trim();
    const category = newCourse.category.trim();

    if (!title) {
      toast.error('Please provide a course title');
      return;
    }

    if (!category) {
      toast.error('Please assign the course to a category');
      return;
    }

    if (newCourse.completionEndorsementEnabled && !newCourse.completionEndorsementType.trim()) {
      toast.error('Select the endorsement granted by this course');
      return;
    }
    if (newCourse.completionEndorsementEnabled && endorsementTypes.length === 0) {
      toast.error('Add endorsement options in Training / Syllabus Settings first');
      return;
    }
    if (newCourse.requiresFlyingDeclaration && !newCourse.flyingDeclarationText.trim()) {
      toast.error('Add the flying declaration wording, or turn off the declaration requirement');
      return;
    }
    if (newCourse.requiresFlyingDeclaration && newCourse.requiresGuardianDeclarationForMinors && !newCourse.guardianDeclarationText.trim()) {
      toast.error('Add the parent/guardian declaration wording, or turn off the minor declaration requirement');
      return;
    }

    const tags = newCourse.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const objectives = parseListLines(newCourse.objectives);
    const evaluationCriteria = parseListLines(newCourse.evaluationFocus);

    // Validate course criteria
    const builtCriteria: LessonAssessmentCriterion[] = [];
    for (const c of courseCriteria) {
      if (!c.name.trim()) { toast.error('Each criterion needs a name'); return; }
      builtCriteria.push({ id: c.id, name: c.name.trim(), gradingSystem: c.gradingSystem, passingGrade: c.passingGrade });
    }

    const module: TrainingModule = {
      id: '',
      title,
      description: description || 'Add a course overview for instructors and students.',
      category: category || 'Custom',
      version: '1.0',
      status: 'draft',
      estimatedDurationHours: Math.max(1, Number(newCourse.estimatedDurationHours) || 1),
      requiresStudentAcknowledgement: newCourse.requiresStudentAcknowledgement,
      requiresFlyingDeclaration: newCourse.requiresFlyingDeclaration,
      flyingDeclarationTitle: newCourse.flyingDeclarationTitle.trim() || 'Flying Declaration',
      flyingDeclarationText: newCourse.flyingDeclarationText.trim(),
      flyingDeclarationVersion: 1,
      requiresGuardianDeclarationForMinors: newCourse.requiresGuardianDeclarationForMinors,
      guardianDeclarationTitle: newCourse.guardianDeclarationTitle.trim() || 'Under 18 Years - Parent/Guardian Declaration',
      guardianDeclarationText: newCourse.guardianDeclarationText.trim(),
      completionEndorsementEnabled: newCourse.completionEndorsementEnabled,
      completionEndorsementType: newCourse.completionEndorsementType.trim(),
      completionEndorsementExpiryMonths: newCourse.completionEndorsementEnabled && newCourse.completionEndorsementExpiryMonths
        ? Math.max(1, Number(newCourse.completionEndorsementExpiryMonths) || 1)
        : null,
      prerequisites: [],
      objectives,
      evaluationCriteria,
      tags: tags.length > 0 ? tags : ['draft'],
      assessmentCriteria: builtCriteria,
      exams: [],
      lessons: [],
      resources: [],
      lastUpdated: new Date()
    };

    try {
      const createdModule = await addModule(module);
      setSelectedModuleId(createdModule.id);
      setCourseDetailTab(newCourseMode === 'advanced' ? 'matrix' : 'overview');
      setShowCreateForm(false);
      setNewCourse(emptyCourseForm());
      setNewCourseMode('simple');
      setCourseCriteria([]);
      toast.success('New course created');
    } catch {
      // error toast handled in context
    }
  };

  const handleCancelCreate = () => {
    setShowCreateForm(false);
    setNewCourse(emptyCourseForm());
    setNewCourseMode('simple');
    setCourseCriteria([]);
  };

  const handleOpenLessonForm = () => {
    if (!selectedModule) {
      toast.error('Please select a course first');
      return;
    }
    queueFormScroll('lesson');
    resetLessonForm();
    setShowLessonForm(true);
    setShowEditCourseForm(false);
  };

  const handleOpenFlightTestLessonForm = () => {
    if (!selectedModule) {
      toast.error('Please select a course first');
      return;
    }

    const existingFlightTest = selectedModule.lessons.find((lesson) =>
      lesson.name.toLowerCase().includes('pilot certificate flight test') ||
      lesson.sequenceCode === 'RPC-FLT-TEST'
    );

    if (existingFlightTest) {
      handleEditLesson(existingFlightTest);
      toast('Pilot Certificate Flight Test already exists. Opening it for editing.');
      return;
    }

    setNewLesson(pilotCertificateFlightTestTemplate);
    queueFormScroll('lesson');
    setLessonPassMarks(
      Object.fromEntries(
        selectedModule.assessmentCriteria.map((criterion) => [
          criterion.id,
          criterion.gradingSystem === 'NC/S/C/-' ? 'C' : getDefaultPassingGrade(criterion.gradingSystem)
        ])
      )
    );
    setEditingLessonId(null);
    setShowLessonForm(true);
    setShowEditCourseForm(false);
  };

  const handleCancelLesson = () => {
    setShowLessonForm(false);
    resetLessonForm();
  };

  const handleCreateLesson = async () => {
    if (!selectedModule) {
      toast.error('Please select a course first');
      return;
    }

    const name = newLesson.name.trim();
    const objective = newLesson.objective.trim();
    const flightExercisesHtml = sanitizeRichText(newLesson.flightExercises);
    const theoryHtml = sanitizeRichText(newLesson.theory);
    const flightExercisesPlain = richTextToPlainText(flightExercisesHtml);
    const theoryPlain = richTextToPlainText(theoryHtml);

    if (!name) { toast.error('Please provide a lesson name'); return; }
    if (!objective) { toast.error('Please provide a lesson objective'); return; }
    if (!flightExercisesPlain) { toast.error('Please outline the flight exercises for this lesson'); return; }
    if (!theoryPlain) { toast.error('Please describe the supporting theory content'); return; }

    // Validate pass marks for course criteria
    const passMarks: Record<string, string> = {};
    for (const criterion of selectedModule.assessmentCriteria) {
      const grade = lessonPassMarks[criterion.id]?.trim() || getDefaultPassingGrade(criterion.gradingSystem);
      if (criterion.gradingSystem === 'Out of 100') {
        const num = Number(grade);
        if (Number.isNaN(num) || num < 0 || num > 100) {
          toast.error(`Pass mark for "${criterion.name}" must be 0–100`);
          return;
        }
        passMarks[criterion.id] = String(Math.round(num));
      } else {
        const allowed = getPassingGradeOptions(criterion.gradingSystem);
        const validated = allowed.includes(grade) ? grade : getDefaultPassingGrade(criterion.gradingSystem);
        passMarks[criterion.id] = validated;
      }
    }

    const lessonBase = {
      name,
      objective,
      flightExercises: flightExercisesHtml,
      theory: theoryHtml,
      keyExercises: normaliseKeyExercises(flightExercisesHtml || flightExercisesPlain),
      studentPreparation: theoryPlain,
      instructorNotes: flightExercisesPlain,
      assessmentCriteria: [] as LessonAssessmentCriterion[],
      passMarks,
      isFlightTest: newLesson.isFlightTest,
    };

    if (editingLessonId) {
      const existing = selectedModule.lessons.find((l) => l.id === editingLessonId);
      if (!existing) return;
      const updatedLesson: TrainingLesson = { ...existing, ...lessonBase };
      try {
        await updateModule(selectedModule.id, (current) => ({
          ...current,
          lessons: current.lessons.map((l) => l.id === editingLessonId ? updatedLesson : l),
          lastUpdated: new Date(),
        }));
        toast.success('Lesson updated');
        setShowLessonForm(false);
        resetLessonForm();
        setExpandedLessons((prev) => ({ ...prev, [editingLessonId]: true }));
      } catch { /* handled in context */ }
      return;
    }

    const timestamp = Date.now();
    const lesson: TrainingLesson = {
      id: `lesson-${timestamp}`,
      sequenceId: `custom-${timestamp}`,
      sequenceCode: '',
      sequenceTitle: name,
      stage: 'flight',
      durationMinutes: 60,
      minCompetency: 'Introduce',
      ...lessonBase,
    };

    try {
      await updateModule(selectedModule.id, (current) => ({
        ...current,
        lessons: [...current.lessons, lesson],
        lastUpdated: new Date()
      }));
      toast.success('Lesson added to course');
      setShowLessonForm(false);
      resetLessonForm();
      setExpandedLessons((prev) => ({ ...prev, [lesson.id]: true }));
    } catch { /* handled in context */ }
  };

  const handlePublishCourse = async () => {
    if (!selectedModule) {
      toast.error('Select a course to publish');
      return;
    }

    if (selectedModule.status === 'published') {
      toast.success('Course is already published');
      return;
    }

    try {
      await updateModule(selectedModule.id, (current) => ({
        ...current,
        status: 'published',
        lastUpdated: new Date()
      }));
      toast.success('Course published');
    } catch {
      // error toast handled in context
    }
  };

  if (modulesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mr-2" />
        <span className="text-gray-500 text-sm">Loading courses...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-5 py-6 text-white sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-100">
                <BookOpenCheck className="h-3.5 w-3.5" />
                Syllabus library
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Training Courses</h1>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                Build the course structure students see, set lesson pass marks, manage exams, and keep instructors working from the same syllabus.
              </p>
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Course
            </button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Published', value: courseStats.published, icon: CheckCircle2 },
              { label: 'Drafts', value: courseStats.draft, icon: Pencil },
              { label: 'Lessons', value: courseStats.lessonCount, icon: ClipboardList },
              { label: 'Test flights', value: courseStats.testFlightCount, icon: Award },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{label}</p>
                  <Icon className="h-4 w-4 text-blue-200" />
                </div>
                <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 bg-slate-50 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(260px,420px)_minmax(0,1fr)] lg:items-start">
          <div className="flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Search className="mr-2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by course, category or tag"
              className="w-full border-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Tag className="h-3.5 w-3.5" />
              Tags
            </span>
            {availableTags.length === 0 ? (
              <span className="text-sm text-slate-400">No tags yet</span>
            ) : (
              availableTags.map((tag) => {
                const isSelected = selectedTagFilters.some((selectedTag) => selectedTag.toLowerCase() === tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTagFilter(tag)}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })
            )}
            {selectedTagFilters.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTagFilters([])}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
            <span className="ml-auto text-sm font-medium text-slate-500">
              {filteredModules.length} course{filteredModules.length === 1 ? '' : 's'} found
            </span>
          </div>
        </div>
      </div>

      {showCreateForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-inner">
          <div className="mb-4 flex items-center gap-2 text-blue-900">
            <BookOpenCheck className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Create new course</h2>
          </div>
          <div className="mb-5 grid gap-3 md:grid-cols-2">
            {[
              {
                id: 'simple' as const,
                title: 'Simple course',
                body: 'Best for RAAus RPC-style courses. Lessons use broad assessment criteria such as NC/S/C, Pass/Fail or percentages.',
              },
              {
                id: 'advanced' as const,
                title: 'Advanced matrix course',
                body: 'Best for CASA RPL-style syllabuses. Build detailed matrix items, link them to lessons, and let the matrix drive pass/fail outcomes.',
              },
            ].map((option) => {
              const selected = newCourseMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleCourseModeChange(option.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? 'border-blue-500 bg-white shadow-sm ring-2 ring-blue-200'
                      : 'border-blue-200 bg-blue-100/50 hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                    {option.id === 'advanced' ? <ClipboardList className="h-4 w-4" /> : <BookOpenCheck className="h-4 w-4" />}
                    {option.title}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-blue-800">{option.body}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col text-sm font-medium text-blue-900">
              Course title
              <input
                type="text"
                value={newCourse.title}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, title: event.target.value }))}
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-blue-900">
              Category
              <input
                type="text"
                value={newCourse.category}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, category: event.target.value }))}
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-blue-900 md:col-span-2">
              Course overview
              <textarea
                value={newCourse.description}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, description: event.target.value }))}
                rows={3}
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-blue-900">
              Objectives
              <textarea
                value={newCourse.objectives}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, objectives: event.target.value }))}
                rows={4}
                placeholder="One objective per line"
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-blue-900">
              Evaluation focus
              <textarea
                value={newCourse.evaluationFocus}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, evaluationFocus: event.target.value }))}
                rows={4}
                placeholder="One focus item per line"
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-blue-900">
              Estimated hours
              <input
                type="number"
                min={1}
                value={newCourse.estimatedDurationHours}
                onChange={(event) =>
                  setNewCourse((prev) => ({ ...prev, estimatedDurationHours: Number(event.target.value) }))
                }
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex flex-col text-sm font-medium text-blue-900">
              Tags
              <input
                type="text"
                value={newCourse.tags}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, tags: event.target.value }))}
                placeholder="Comma separated e.g. navigation, advanced"
                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-blue-200 bg-white p-4 text-sm text-blue-900 md:col-span-2">
              <input
                type="checkbox"
                checked={newCourse.requiresStudentAcknowledgement}
                onChange={(event) => setNewCourse((prev) => ({ ...prev, requiresStudentAcknowledgement: event.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block font-semibold">Require student acknowledgement for this course</span>
                <span className="mt-1 block text-xs text-blue-700">
                  Submitted lesson records for this course will ask the student to review and acknowledge unless the organisation setting is forcing all courses anyway.
                </span>
              </span>
            </label>
            <div className="rounded-lg border border-amber-200 bg-white p-4 text-sm text-amber-950 md:col-span-2">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={newCourse.requiresFlyingDeclaration}
                  onChange={(event) => setNewCourse((prev) => ({ ...prev, requiresFlyingDeclaration: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <span>
                  <span className="block font-semibold">Require a flying declaration before training</span>
                  <span className="mt-1 block text-xs text-amber-700">
                    Students enrolled in this course will be asked to digitally sign this declaration when they log in until it has been signed.
                  </span>
                </span>
              </label>
              {newCourse.requiresFlyingDeclaration && (
                <div className="mt-4 grid gap-3">
                  <label className="flex flex-col text-xs font-medium text-amber-950">
                    Declaration title
                    <input
                      type="text"
                      value={newCourse.flyingDeclarationTitle}
                      onChange={(event) => setNewCourse((prev) => ({ ...prev, flyingDeclarationTitle: event.target.value }))}
                      className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                  <label className="flex flex-col text-xs font-medium text-amber-950">
                    Declaration wording
                    <textarea
                      rows={8}
                      value={newCourse.flyingDeclarationText}
                      onChange={(event) => setNewCourse((prev) => ({ ...prev, flyingDeclarationText: event.target.value }))}
                      className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    />
                    <span className="mt-1 text-[11px] font-normal text-amber-700">
                      The typed student name, member number and date are saved with the exact wording shown here.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950">
                    <input
                      type="checkbox"
                      checked={newCourse.requiresGuardianDeclarationForMinors}
                      onChange={(event) => setNewCourse((prev) => ({ ...prev, requiresGuardianDeclarationForMinors: event.target.checked }))}
                      className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>
                      <span className="block font-semibold">Require parent/guardian declaration if student is under 18</span>
                      <span className="mt-1 block text-amber-700">
                        The CRM checks the student's date of birth and asks for a parent/legal guardian electronic signature when required.
                      </span>
                    </span>
                  </label>
                  {newCourse.requiresGuardianDeclarationForMinors && (
                    <>
                      <label className="flex flex-col text-xs font-medium text-amber-950">
                        Parent/guardian declaration title
                        <input
                          type="text"
                          value={newCourse.guardianDeclarationTitle}
                          onChange={(event) => setNewCourse((prev) => ({ ...prev, guardianDeclarationTitle: event.target.value }))}
                          className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        />
                      </label>
                      <label className="flex flex-col text-xs font-medium text-amber-950">
                        Parent/guardian declaration wording
                        <textarea
                          rows={7}
                          value={newCourse.guardianDeclarationText}
                          onChange={(event) => setNewCourse((prev) => ({ ...prev, guardianDeclarationText: event.target.value }))}
                          className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-4 text-sm text-emerald-950 md:col-span-2">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={newCourse.completionEndorsementEnabled}
                  onChange={(event) => setNewCourse((prev) => ({ ...prev, completionEndorsementEnabled: event.target.checked }))}
                  className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  <span className="block font-semibold">Grant an endorsement at 100% course completion</span>
                  <span className="mt-1 block text-xs text-emerald-700">
                    When enabled, staff can grant the configured endorsement once the course reaches 100%.
                  </span>
                </span>
              </label>
              {newCourse.completionEndorsementEnabled && (
                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <label className="flex flex-col text-xs font-medium text-emerald-950">
                    Endorsement name
                    <select
                      value={newCourse.completionEndorsementType}
                      onChange={(event) => setNewCourse((prev) => ({ ...prev, completionEndorsementType: event.target.value }))}
                      className="mt-1 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="">Select endorsement</option>
                      {endorsementTypes.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <span className="mt-1 text-[11px] font-normal text-emerald-700">
                      Add or rename endorsement options in Training / Syllabus Settings.
                    </span>
                  </label>
                  <label className="flex flex-col text-xs font-medium text-emerald-950">
                    Expiry months
                    <input
                      type="number"
                      min={1}
                      value={newCourse.completionEndorsementExpiryMonths}
                      onChange={(event) => setNewCourse((prev) => ({ ...prev, completionEndorsementExpiryMonths: event.target.value }))}
                      placeholder="No expiry"
                      className="mt-1 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          {/* Assessment criteria for new course */}
          <div className="mt-6 rounded-lg border border-blue-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-blue-900">
                <ClipboardList className="h-4 w-4" />
                <h4 className="text-sm font-semibold">Assessment criteria</h4>
              </div>
              <button type="button" onClick={() => setCourseCriteria((p) => [...p, createEmptyCriterion(trainingSettings.defaultGradingSystem)])} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                <Plus className="h-3.5 w-3.5" />Add criterion
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {newCourseMode === 'advanced'
                ? 'These are the broad outcomes shown on records. Detailed matrix items can be linked to these after the course is created.'
                : 'Define what will be assessed across all lessons in this course. You can set a pass mark per lesson later.'}
            </p>
            <div className="space-y-3">
              {courseCriteria.map((criterion) => (
                <div key={criterion.id} className="flex flex-wrap items-center gap-3 rounded-md border border-blue-100 px-3 py-2.5">
                  <input type="text" placeholder="e.g. Airmanship" value={criterion.name}
                    onChange={(e) => setCourseCriteria((p) => p.map((c) => c.id === criterion.id ? { ...c, name: e.target.value } : c))}
                    className="flex-1 rounded-md border border-blue-200 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none" />
                  <select value={criterion.gradingSystem}
                    onChange={(e) => setCourseCriteria((p) => p.map((c) => c.id === criterion.id ? { ...c, gradingSystem: e.target.value as LessonGradingSystem, passingGrade: getDefaultPassingGrade(e.target.value as LessonGradingSystem) } : c))}
                    className="rounded-md border border-blue-200 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none">
                    {gradingOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button type="button" onClick={() => setCourseCriteria((p) => p.filter((c) => c.id !== criterion.id))} className="text-red-500 hover:text-red-700"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={handleCancelCreate} className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-medium text-blue-900 transition hover:bg-blue-100">Cancel</button>
            <button onClick={handleCreateCourse} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
              <Plus className="mr-2 h-4 w-4" />Create course
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3 lg:sticky lg:top-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Courses</h2>
              <p className="text-xs text-slate-400">Select a course to review or edit.</p>
            </div>
          </div>
          {filteredModules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
              No courses match your filters. Try adjusting your search or create a new course.
            </div>
          ) : (
            filteredModules.map((module) => {
              const isActive = module.id === selectedModuleId;
              return (
                <button
                  key={module.id}
                  onClick={() => handleModuleSelect(module.id)}
                  className={`w-full text-left transition ${
                    isActive
                      ? 'border-blue-300 bg-blue-50 shadow-md ring-2 ring-blue-100'
                      : 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-sm'
                  } rounded-xl border p-4`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-slate-950">{module.title}</h3>
                      <p className="mt-0.5 truncate text-sm text-slate-500">{module.category || 'Uncategorised'} · v{module.version}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        module.status === 'published'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
                      }`}
                    >
                      {module.status === 'published' ? 'Live' : 'Draft'}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">
                    {module.description || 'No course overview has been recorded yet.'}
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lessons</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-800">{module.lessons.length}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Hours</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-800">{module.estimatedDurationHours}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Exams</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-800">{(module.exams || []).length}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      module.requiresStudentAcknowledgement ?? true
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {(module.requiresStudentAcknowledgement ?? true) ? 'Sign-off' : 'No sign-off'}
                    </span>
                    {module.completionEndorsementEnabled && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        Endorsement
                      </span>
                    )}
                    {module.lessons.some((lesson) => lesson.isFlightTest) && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        Flight test
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {module.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
                        {tag}
                      </span>
                    ))}
                    {module.tags.length > 3 && (
                      <span className="text-xs font-medium text-slate-400">+{module.tags.length - 3}</span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      {formatDistanceToNow(module.lastUpdated, { addSuffix: true })}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="space-y-6">
          {selectedModule ? (
            <>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Delete course confirmation */}
                {showDeleteCourseConfirm && (
                  <div className="m-5 mb-0 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm text-red-700">Permanently delete this course and all its lessons? Student completion records are not affected.</p>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setShowDeleteCourseConfirm(false)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                      <button type="button" onClick={handleDeleteCourse} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Delete</button>
                    </div>
                  </div>
                )}

                <div className="border-b border-slate-100 bg-slate-50 px-5 py-5 sm:px-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <BookOpenCheck className="h-5 w-5 text-blue-600" />
                        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{selectedModule.title}</h2>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedModule.status === 'published' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}>
                          {selectedModule.status === 'published' ? 'Published' : 'Draft'}
                        </span>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                        {selectedModule.description || 'No course overview has been recorded yet.'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{selectedModule.category || 'Uncategorised'}</span>
                        <span>-</span>
                        <span>Version {selectedModule.version}</span>
                        <span>-</span>
                        <span>Updated {formatDistanceToNow(selectedModule.lastUpdated, { addSuffix: true })}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      {selectedModule.status !== 'published' && (
                        <button onClick={handlePublishCourse} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100">
                          <CheckCircle2 className="h-4 w-4" />
                          Publish
                        </button>
                      )}
                      {canManageCourse(selectedModule) && (
                        <>
                          <button onClick={handleOpenEditCourse} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                            <Pencil className="h-4 w-4" />
                            Edit course
                          </button>
                          <button onClick={() => setShowDeleteCourseConfirm(true)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </>
                      )}
                      <button onClick={handleOpenLessonForm} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100">
                        <FilePlus className="h-4 w-4" />
                        New lesson
                      </button>
                      <button onClick={handleOpenFlightTestLessonForm} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100">
                        <Award className="h-4 w-4" />
                        Add flight test
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-b border-slate-100 bg-white px-5 pt-4 sm:px-6">
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    {[
                      { id: 'overview' as const, label: 'Overview' },
                      { id: 'matrix' as const, label: 'Matrix' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setCourseDetailTab(tab.id)}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          courseDetailTab === tab.id
                            ? 'bg-white text-blue-700 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {courseDetailTab === 'overview' ? (
                <div className="p-5 sm:p-6">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Course length</p>
                      <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
                        <Clock3 className="h-5 w-5 text-blue-500" />
                        {selectedModule.estimatedDurationHours}h
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lessons</p>
                      <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
                        <Layers className="h-5 w-5 text-blue-500" />
                        {selectedModule.lessons.length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Criteria</p>
                      <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
                        <ClipboardList className="h-5 w-5 text-blue-500" />
                        {selectedLessonStats.criteria}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exams / Tests</p>
                      <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
                        <Award className="h-5 w-5 text-amber-500" />
                        {selectedLessonStats.exams + selectedLessonStats.flightTests}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-5">
                      {(selectedModule.objectives.length > 0 || selectedModule.evaluationCriteria.length > 0) ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          {selectedModule.objectives.length > 0 && (
                            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <h3 className="text-sm font-semibold text-slate-950">Objectives</h3>
                              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                                {selectedModule.objectives.map((objective) => (
                                  <li key={objective} className="flex items-start gap-2">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                                    <span>{objective}</span>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )}
                          {selectedModule.evaluationCriteria.length > 0 && (
                            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <h3 className="text-sm font-semibold text-slate-950">Evaluation focus</h3>
                              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                                {selectedModule.evaluationCriteria.map((criteria) => (
                                  <li key={criteria} className="flex items-start gap-2">
                                    <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                                    <span>{criteria}</span>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                          Add objectives and evaluation focus from Edit course so instructors and students understand the intent of this syllabus.
                        </div>
                      )}
                    </div>

                    <aside className="space-y-4">
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-slate-950">Course rules</h3>
                        <dl className="mt-3 space-y-3 text-sm">
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Student acknowledgement</dt>
                            <dd className="mt-1 text-slate-700">{(selectedModule.requiresStudentAcknowledgement ?? true) ? 'Required for this course' : 'Not required unless forced in settings'}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flying declaration</dt>
                            <dd className="mt-1 text-slate-700">
                              {selectedModule.requiresFlyingDeclaration
                                ? `${selectedModule.flyingDeclarationTitle || 'Flying Declaration'} v${selectedModule.flyingDeclarationVersion ?? 1}`
                                : 'Not required'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completion endorsement</dt>
                            <dd className="mt-1 text-slate-700">
                              {selectedModule.completionEndorsementEnabled
                                ? `${selectedModule.completionEndorsementType || 'Endorsement'}${selectedModule.completionEndorsementExpiryMonths ? ` - expires after ${selectedModule.completionEndorsementExpiryMonths} months` : ''}`
                                : 'None'}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      {selectedModule.assessmentCriteria.length > 0 && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                          <h3 className="text-sm font-semibold text-blue-950">Assessment criteria</h3>
                          <div className="mt-3 space-y-2">
                            {selectedModule.assessmentCriteria.map((c) => (
                              <div key={c.id} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-blue-100">
                                <div className="font-semibold text-slate-900">{c.name}</div>
                                <div className="mt-0.5 text-xs text-slate-500">{c.gradingSystem} - pass mark {c.passingGrade}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(selectedModule.exams || []).length > 0 && (
                        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                          <h3 className="text-sm font-semibold text-amber-950">Course exams</h3>
                          <div className="mt-3 space-y-2">
                            {(selectedModule.exams || []).map((exam) => (
                              <div key={exam.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-amber-100">
                                <span className="min-w-0 truncate text-sm font-medium text-amber-950">{exam.name}</span>
                                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                  {exam.passMark}% pass
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedModule.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedModule.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                              <Tag className="mr-1 h-3 w-3" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </aside>
                  </div>
                </div>
                ) : (
                  <CourseMatrixPanel
                    course={selectedModule}
                    rows={selectedMatrixRows}
                    requirements={selectedMatrixRequirements}
                    loading={selectedMatrixLoading}
                    error={selectedMatrixError}
                    canEdit={user?.role === 'admin' || user?.role === 'instructor'}
                    onMatrixChanged={refetchSelectedMatrix}
                  />
                )}
              </div>

              {/* ── Edit course form ── */}
              {showEditCourseForm && selectedModule && (
                <div ref={editCourseFormRef} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <div className="flex items-center gap-2 text-gray-900">
                      <Pencil className="h-5 w-5 text-blue-600" />
                      <h3 className="text-lg font-semibold">Edit course</h3>
                    </div>
                    <button onClick={() => setShowEditCourseForm(false)} className="text-sm text-gray-500 underline-offset-2 hover:underline">Cancel</button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col text-sm font-medium text-gray-700">
                      Course title
                      <input type="text" value={editCourse.title} onChange={(e) => setEditCourse((p) => ({ ...p, title: e.target.value }))} className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-gray-700">
                      Category
                      <input type="text" value={editCourse.category} onChange={(e) => setEditCourse((p) => ({ ...p, category: e.target.value }))} className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-gray-700 md:col-span-2">
                      Description
                      <textarea rows={2} value={editCourse.description} onChange={(e) => setEditCourse((p) => ({ ...p, description: e.target.value }))} className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-gray-700">
                      Objectives
                      <textarea
                        rows={5}
                        value={editCourse.objectives}
                        onChange={(e) => setEditCourse((p) => ({ ...p, objectives: e.target.value }))}
                        placeholder="One objective per line"
                        className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-gray-700">
                      Evaluation focus
                      <textarea
                        rows={5}
                        value={editCourse.evaluationFocus}
                        onChange={(e) => setEditCourse((p) => ({ ...p, evaluationFocus: e.target.value }))}
                        placeholder="One focus item per line"
                        className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-gray-700">
                      Estimated duration (hours)
                      <input type="number" min={1} value={editCourse.estimatedDurationHours} onChange={(e) => setEditCourse((p) => ({ ...p, estimatedDurationHours: Number(e.target.value) }))} className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-gray-700">
                      Tags (comma separated)
                      <input type="text" value={editCourse.tags} onChange={(e) => setEditCourse((p) => ({ ...p, tags: e.target.value }))} className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 md:col-span-2">
                      <input
                        type="checkbox"
                        checked={editCourse.requiresStudentAcknowledgement}
                        onChange={(e) => setEditCourse((p) => ({ ...p, requiresStudentAcknowledgement: e.target.checked }))}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        <span className="block font-semibold text-gray-900">Require student acknowledgement for this course</span>
                        <span className="mt-1 block text-xs text-gray-500">
                          Turn this off for internal/proficiency courses that do not need student sign-off. The organisation setting can still force all courses.
                        </span>
                      </span>
                    </label>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 md:col-span-2">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={editCourse.requiresFlyingDeclaration}
                          onChange={(e) => setEditCourse((p) => ({ ...p, requiresFlyingDeclaration: e.target.checked }))}
                          className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span>
                          <span className="block font-semibold text-amber-950">Require a flying declaration before training</span>
                          <span className="mt-1 block text-xs text-amber-700">
                            Active enrolled students must digitally sign this course declaration. Updating the wording creates a new declaration version.
                          </span>
                        </span>
                      </label>
                      {editCourse.requiresFlyingDeclaration && (
                        <div className="mt-4 grid gap-3">
                          <label className="flex flex-col text-xs font-medium text-amber-950">
                            Declaration title
                            <input
                              type="text"
                              value={editCourse.flyingDeclarationTitle}
                              onChange={(e) => setEditCourse((p) => ({ ...p, flyingDeclarationTitle: e.target.value }))}
                              className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col text-xs font-medium text-amber-950">
                            Declaration wording
                            <textarea
                              rows={8}
                              value={editCourse.flyingDeclarationText}
                              onChange={(e) => setEditCourse((p) => ({ ...p, flyingDeclarationText: e.target.value }))}
                              className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none"
                            />
                            <span className="mt-1 text-[11px] font-normal text-amber-700">
                              Signed enrolments store a snapshot of this wording, the student's typed name, member number and signing date.
                            </span>
                          </label>
                          <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-white/70 p-3 text-xs text-amber-950">
                            <input
                              type="checkbox"
                              checked={editCourse.requiresGuardianDeclarationForMinors}
                              onChange={(e) => setEditCourse((p) => ({ ...p, requiresGuardianDeclarationForMinors: e.target.checked }))}
                              className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span>
                              <span className="block font-semibold">Require parent/guardian declaration if student is under 18</span>
                              <span className="mt-1 block text-amber-700">
                                Uses the student's date of birth to request a parent/legal guardian electronic signature.
                              </span>
                            </span>
                          </label>
                          {editCourse.requiresGuardianDeclarationForMinors && (
                            <>
                              <label className="flex flex-col text-xs font-medium text-amber-950">
                                Parent/guardian declaration title
                                <input
                                  type="text"
                                  value={editCourse.guardianDeclarationTitle}
                                  onChange={(e) => setEditCourse((p) => ({ ...p, guardianDeclarationTitle: e.target.value }))}
                                  className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none"
                                />
                              </label>
                              <label className="flex flex-col text-xs font-medium text-amber-950">
                                Parent/guardian declaration wording
                                <textarea
                                  rows={7}
                                  value={editCourse.guardianDeclarationText}
                                  onChange={(e) => setEditCourse((p) => ({ ...p, guardianDeclarationText: e.target.value }))}
                                  className="mt-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-amber-400 focus:outline-none"
                                />
                              </label>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 md:col-span-2">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={editCourse.completionEndorsementEnabled}
                          onChange={(e) => setEditCourse((p) => ({ ...p, completionEndorsementEnabled: e.target.checked }))}
                          className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>
                          <span className="block font-semibold text-emerald-950">Grant an endorsement at 100% course completion</span>
                          <span className="mt-1 block text-xs text-emerald-700">
                            The endorsement is available once the student's course progress reaches 100%.
                          </span>
                        </span>
                      </label>
                      {editCourse.completionEndorsementEnabled && (
                        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                          <label className="flex flex-col text-xs font-medium text-emerald-950">
                            Endorsement name
                            <select
                              value={editCourse.completionEndorsementType}
                              onChange={(e) => setEditCourse((p) => ({ ...p, completionEndorsementType: e.target.value }))}
                              className="mt-1 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none"
                            >
                              <option value="">Select endorsement</option>
                              {endorsementTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                            <span className="mt-1 text-[11px] font-normal text-emerald-700">
                              Add or rename endorsement options in Training / Syllabus Settings.
                            </span>
                          </label>
                          <label className="flex flex-col text-xs font-medium text-emerald-950">
                            Expiry months
                            <input
                              type="number"
                              min={1}
                              value={editCourse.completionEndorsementExpiryMonths}
                              onChange={(e) => setEditCourse((p) => ({ ...p, completionEndorsementExpiryMonths: e.target.value }))}
                              placeholder="No expiry"
                              className="mt-1 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Assessment criteria editor */}
                  <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 text-gray-700">
                        <ClipboardList className="h-4 w-4" />
                        <h4 className="text-sm font-semibold">Assessment criteria</h4>
                      </div>
                      <button type="button" onClick={() => setEditCourseCriteria((p) => [...p, createEmptyCriterion()])} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                        <Plus className="h-3.5 w-3.5" />Add criterion
                      </button>
                    </div>
                    {editCourseCriteria.length === 0 && <p className="text-xs text-gray-500">No criteria yet. Add at least one to track student progress against this course.</p>}
                    <div className="space-y-3">
                      {editCourseCriteria.map((criterion) => (
                        <div key={criterion.id} className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
                          <input type="text" placeholder="Criterion name" value={criterion.name}
                            onChange={(e) => setEditCourseCriteria((p) => p.map((c) => c.id === criterion.id ? { ...c, name: e.target.value } : c))}
                            className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none" />
                          <select value={criterion.gradingSystem}
                            onChange={(e) => setEditCourseCriteria((p) => p.map((c) => c.id === criterion.id ? { ...c, gradingSystem: e.target.value as LessonGradingSystem, passingGrade: getDefaultPassingGrade(e.target.value as LessonGradingSystem) } : c))}
                            className="rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none">
                            {gradingOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                          <button type="button" onClick={() => setEditCourseCriteria((p) => p.filter((c) => c.id !== criterion.id))} className="text-red-500 hover:text-red-700">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 text-amber-950">
                        <Award className="h-4 w-4" />
                        <h4 className="text-sm font-semibold">Course exams</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditCourseExams((current) => [...current, createEmptyExam()])}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add exam
                      </button>
                    </div>
                    <p className="mb-3 text-xs text-amber-800">
                      These appear in the student's Exams tab for logging theory results. They are not shown as flight lessons.
                    </p>
                    {editCourseExams.length === 0 && (
                      <p className="rounded-md border border-dashed border-amber-300 bg-white/70 px-3 py-3 text-xs text-amber-800">
                        No exams yet. Add items like Presolo, Radio, BAK or Pre Certificate Airlaw.
                      </p>
                    )}
                    <div className="space-y-3">
                      {editCourseExams.map((exam) => (
                        <div key={exam.id} className="grid gap-3 rounded-md border border-amber-200 bg-white px-4 py-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                          <label className="flex flex-col text-xs font-medium text-amber-950">
                            Exam name
                            <input
                              type="text"
                              placeholder="e.g. BAK Exam"
                              value={exam.name}
                              onChange={(event) => setEditCourseExams((current) => current.map((item) => item.id === exam.id ? { ...item, name: event.target.value } : item))}
                              className="mt-1 rounded-md border border-amber-200 px-2 py-1.5 text-sm text-gray-900 focus:border-amber-400 focus:outline-none"
                            />
                          </label>
                          <label className="flex flex-col text-xs font-medium text-amber-950">
                            Pass mark %
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={exam.passMark}
                              onChange={(event) => setEditCourseExams((current) => current.map((item) => item.id === exam.id ? { ...item, passMark: Number(event.target.value) } : item))}
                              className="mt-1 rounded-md border border-amber-200 px-2 py-1.5 text-sm text-gray-900 focus:border-amber-400 focus:outline-none"
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => setEditCourseExams((current) => current.filter((item) => item.id !== exam.id))}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                              title="Remove exam"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-3">
                    <button onClick={() => setShowEditCourseForm(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={handleSaveEditCourse} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      <Pencil className="mr-2 h-4 w-4" />Save changes
                    </button>
                  </div>
                </div>
              )}

              {showLessonForm && (
                <div ref={lessonFormRef} className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-blue-900">
                    <div className="flex items-center gap-2">
                      {editingLessonId ? <Pencil className="h-5 w-5" /> : <FilePlus className="h-5 w-5" />}
                      <h3 className="text-lg font-semibold">{editingLessonId ? 'Edit lesson' : 'Create new lesson'}</h3>
                    </div>
                    <button
                      onClick={handleCancelLesson}
                      className="text-sm font-medium underline-offset-2 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col text-sm font-medium text-blue-900">
                      Lesson name
                      <input
                        type="text"
                        value={newLesson.name}
                        onChange={(event) => setNewLesson((prev) => ({ ...prev, name: event.target.value }))}
                        className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-blue-900">
                      Lesson objective
                      <input
                        type="text"
                        value={newLesson.objective}
                        onChange={(event) => setNewLesson((prev) => ({ ...prev, objective: event.target.value }))}
                        className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <RichTextEditor
                      label="Flight exercises"
                      value={newLesson.flightExercises}
                      onChange={(value) => setNewLesson((prev) => ({ ...prev, flightExercises: value }))}
                      placeholder="Use bullet points or paragraphs to describe each flight exercise."
                    />
                    <RichTextEditor
                      label="Theory focus"
                      value={newLesson.theory}
                      onChange={(value) => setNewLesson((prev) => ({ ...prev, theory: value }))}
                      placeholder="Summarise the key theory discussion points, references or briefing sequence."
                    />
                  </div>
                  <label className="mt-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-white p-4 text-sm text-amber-950">
                    <input
                      type="checkbox"
                      checked={newLesson.isFlightTest}
                      onChange={(event) => setNewLesson((prev) => ({ ...prev, isFlightTest: event.target.checked }))}
                      className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>
                      <span className="block font-semibold">This lesson is a test flight</span>
                      <span className="mt-1 block text-xs text-amber-700">
                        Test flights are defined in the course, not selected later on individual flight records.
                      </span>
                    </span>
                  </label>
                  {(() => {
                    const editingLesson = editingLessonId
                      ? selectedModule.lessons.find((lesson) => lesson.id === editingLessonId)
                      : null;
                    const lessonMatrix = getLessonMatrixRequirements(editingLesson);
                    const standardCounts = getMatrixStandardCounts(lessonMatrix);
                    return (
                      <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-2 text-indigo-950">
                            <ClipboardList className="mt-0.5 h-5 w-5 text-indigo-600" />
                            <div>
                              <h4 className="text-sm font-semibold">RPL matrix pass requirements</h4>
                              <p className="mt-1 text-xs leading-5 text-indigo-800">
                                For CASA RPL lessons, pass/fail is determined by the lesson matrix. Every attached row must be assessed at, or better than, its required standard.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCourseDetailTab('matrix')}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                          >
                            Edit matrix
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {!editingLesson ? (
                          <p className="mt-3 rounded-lg border border-dashed border-indigo-200 bg-white/70 p-3 text-xs text-indigo-700">
                            Save the lesson first, then use the Matrix tab to attach its CASA rows and required standards.
                          </p>
                        ) : selectedMatrixLoading ? (
                          <p className="mt-3 text-xs text-indigo-700">Loading lesson matrix...</p>
                        ) : lessonMatrix.length === 0 ? (
                          <div className="mt-3 rounded-lg border border-dashed border-indigo-200 bg-white/70 p-3 text-xs text-indigo-700">
                            No matrix rows are attached to this lesson yet. Open the Matrix tab, select this lesson, then add the required CASA rows.
                          </div>
                        ) : (
                          <div className="mt-3 space-y-3">
                            <div className="flex flex-wrap gap-2 text-xs font-semibold">
                              {[3, 2, 1].map((standard) => (
                                <span key={standard} className={`rounded-lg px-2.5 py-1 ring-1 ${matrixCellClass(standard)}`}>
                                  Standard {standard}: {standardCounts[standard] ?? 0}
                                </span>
                              ))}
                              <span className="rounded-lg bg-white px-2.5 py-1 text-indigo-800 ring-1 ring-indigo-100">
                                {lessonMatrix.length} total rows
                              </span>
                            </div>
                            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                              {lessonMatrix.slice(0, 12).map(({ row, requirement }) => (
                                <div key={requirement.id} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-indigo-950">
                                        {row.elementCode || row.unitCode || row.code}
                                      </p>
                                      <p className="mt-1 text-xs leading-5 text-slate-700">
                                        {formatSyllabusMatrixText(row.description)}
                                      </p>
                                    </div>
                                    <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ring-1 ${matrixCellClass(requirement.requiredStandard)}`}>
                                      Req {requirement.requiredStandard}
                                    </span>
                                  </div>
                                </div>
                              ))}
                              {lessonMatrix.length > 12 && (
                                <p className="px-1 text-xs font-medium text-indigo-700">
                                  + {lessonMatrix.length - 12} more rows in the Matrix tab
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="mt-6 rounded-lg border border-blue-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-blue-900">
                        <ClipboardList className="h-5 w-5" />
                        <h4 className="text-sm font-semibold">Pass mark per criterion</h4>
                      </div>
                    </div>
                    {selectedMatrixRequirements.length > 0 && (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                        This section is for generic course criteria. The RPL lesson pass mark is controlled by the CASA matrix requirements above.
                      </div>
                    )}
                    {selectedModule.assessmentCriteria.length === 0 ? (
                      <p className="mt-3 text-xs text-gray-500">No assessment criteria defined for this course yet. Add them via "Edit course".</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {selectedModule.assessmentCriteria.map((criterion) => {
                          const currentMark = lessonPassMarks[criterion.id] ?? getDefaultPassingGrade(criterion.gradingSystem);
                          return (
                            <div key={criterion.id} className="flex items-center gap-4 rounded-lg border border-blue-100 bg-white px-4 py-3">
                              <div className="flex-1 text-sm font-medium text-blue-900">{criterion.name}</div>
                              <span className="text-xs text-gray-400">{criterion.gradingSystem}</span>
                              {criterion.gradingSystem === 'Out of 100' ? (
                                <input
                                  type="number" min={0} max={100} step={1}
                                  value={currentMark}
                                  onChange={(e) => setLessonPassMarks((prev) => ({ ...prev, [criterion.id]: e.target.value }))}
                                  className="w-20 rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                                />
                              ) : (
                                <select
                                  value={currentMark}
                                  onChange={(e) => setLessonPassMarks((prev) => ({ ...prev, [criterion.id]: e.target.value }))}
                                  className="rounded-md border border-blue-200 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                                >
                                  {getPassingGradeOptions(criterion.gradingSystem).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={handleCancelLesson}
                      className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-medium text-blue-900 transition hover:bg-blue-100"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateLesson}
                      className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                    >
                      {editingLessonId ? <Pencil className="mr-2 h-4 w-4" /> : <FilePlus className="mr-2 h-4 w-4" />}
                      {editingLessonId ? 'Save changes' : 'Save lesson'}
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-slate-950">
                      <ClipboardList className="h-5 w-5 text-blue-600" />
                      <h3 className="text-lg font-semibold">Lesson library</h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Open a lesson to review what the student will brief, fly, and be assessed against.</p>
                  </div>
                  {selectedModule.lessons.length > 0 && (
                    <button
                      onClick={() => handleExpandCollapseAll(!allLessonsExpanded)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      {allLessonsExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                      {allLessonsExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                  )}
                </div>
                {selectedModule.lessons.length === 0 ? (
                  <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                    No lessons recorded yet. Use the “New lesson” button to start building this course.
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {selectedModule.lessons.map((lesson, lessonIndex) => {
                      const isExpanded = expandedLessons[lesson.id] ?? false;
                      const flightExercisesContent = formatRichTextContent(lesson.flightExercises);
                      const theoryContent = formatRichTextContent(lesson.theory);
                      const isFirstLesson = lessonIndex === 0;
                      const isLastLesson = lessonIndex === selectedModule.lessons.length - 1;

                      return (
                        <article
                          key={lesson.id}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                        >
                          {/* Delete confirmation banner */}
                          {deletingLessonId === lesson.id && (
                            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                              <p className="text-sm text-red-700">Remove this lesson from the course? Students who have already completed it will not be affected.</p>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDeletingLessonId(null)}
                                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLesson(lesson.id)}
                                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="grid gap-3 bg-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                            <div className="flex min-w-0 items-start gap-2">
                              <button
                                type="button"
                                onClick={() => handleToggleLessonExpansion(lesson.id)}
                                className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                                aria-label={isExpanded ? 'Collapse lesson details' : 'Expand lesson details'}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
                                    Lesson {lessonIndex + 1}
                                  </span>
                                  <h4 className="min-w-0 flex-1 text-base font-semibold text-slate-950">
                                    {lesson.name || lesson.sequenceTitle}
                                  </h4>
                                  {lesson.isFlightTest && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                      <Award className="h-3 w-3" />
                                      Test flight
                                    </span>
                                  )}
                                </div>
                                <p className="mt-2 text-sm leading-5 text-slate-600">
                                  {lesson.objective || 'Document the lesson objective for instructors.'}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 lg:justify-end">
                              <div className="inline-flex rounded-lg border border-slate-200 bg-white">
                                <button
                                  type="button"
                                  onClick={() => handleMoveLesson(lesson.id, 'up')}
                                  disabled={isFirstLesson}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-l-lg text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                                  title="Move lesson up"
                                  aria-label="Move lesson up"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveLesson(lesson.id, 'down')}
                                  disabled={isLastLesson}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-r-lg border-l border-slate-200 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                                  title="Move lesson down"
                                  aria-label="Move lesson down"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleLessonExpansion(lesson.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                              >
                                {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                                {isExpanded ? 'Collapse' : 'Expand'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditLesson(lesson)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingLessonId(deletingLessonId === lesson.id ? null : lesson.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          </div>
                          {isExpanded && (
                            <>
                              <div className="grid gap-4 border-t border-slate-100 p-4 lg:grid-cols-2">
                                <div>
                                  <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Flight exercises
                                  </h5>
                                  <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                                    {flightExercisesContent ? (
                                      <div
                                        className="text-sm leading-6 text-slate-700 [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5"
                                        dangerouslySetInnerHTML={{ __html: flightExercisesContent }}
                                      />
                                    ) : (
                                      <p className="text-sm text-slate-500">Describe the flight exercises to be flown.</p>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Theory focus
                                  </h5>
                                  <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                                    {theoryContent ? (
                                      <div
                                        className="text-sm leading-6 text-slate-700 [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5"
                                        dangerouslySetInnerHTML={{ __html: theoryContent }}
                                      />
                                    ) : (
                                      <p className="text-sm text-slate-500">Outline the theory elements that support this lesson.</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                                <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Assessment criteria
                                </h5>
                                {(() => {
                                  const relevantCriteria =
                                    selectedModule.assessmentCriteria.length > 0
                                      ? selectedModule.assessmentCriteria.filter(
                                          (criterion) => lesson.passMarks?.[criterion.id]
                                        )
                                      : lesson.assessmentCriteria;

                                  return relevantCriteria.length > 0 ? (
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    {relevantCriteria.map((criterion) => (
                                      <div
                                        key={criterion.id}
                                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <span className="font-medium text-slate-900">{criterion.name}</span>
                                          <span className="text-xs text-slate-500">{criterion.gradingSystem}</span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">
                                          {lesson.passMarks?.[criterion.id] === '-' ? 'Not assessed' : 'Passing grade'}{' '}
                                          <span className="font-medium text-slate-700">
                                            {lesson.passMarks?.[criterion.id] ?? criterion.passingGrade}
                                          </span>
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                  ) : (
                                  <p className="mt-2 text-sm text-slate-500">
                                    No assessment criteria recorded for this lesson yet.
                                  </p>
                                  );
                                })()}
                              </div>
                              {(() => {
                                const lessonMatrix = getLessonMatrixRequirements(lesson);
                                if (selectedMatrixRows.length === 0 && selectedMatrixRequirements.length === 0) return null;
                                const standardCounts = getMatrixStandardCounts(lessonMatrix);
                                return (
                                  <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                          RPL lesson matrix pass rules
                                        </h5>
                                        <p className="mt-1 text-xs text-slate-500">
                                          The lesson passes when each attached CASA row is assessed at, or better than, its required standard.
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCourseDetailTab('matrix');
                                          setShowLessonForm(false);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                                      >
                                        Edit matrix
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                    {lessonMatrix.length === 0 ? (
                                      <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
                                        No CASA matrix rows are attached to this lesson yet.
                                      </p>
                                    ) : (
                                      <div className="mt-3 space-y-3">
                                        <div className="flex flex-wrap gap-2 text-xs font-semibold">
                                          {[3, 2, 1].map((standard) => (
                                            <span key={standard} className={`rounded-lg px-2.5 py-1 ring-1 ${matrixCellClass(standard)}`}>
                                              Standard {standard}: {standardCounts[standard] ?? 0}
                                            </span>
                                          ))}
                                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
                                            {lessonMatrix.length} total rows
                                          </span>
                                        </div>
                                        <div className="grid gap-2 md:grid-cols-2">
                                          {lessonMatrix.slice(0, 8).map(({ row, requirement }) => (
                                            <div key={requirement.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                    {row.elementCode || row.unitCode || row.code}
                                                  </p>
                                                  <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">
                                                    {formatSyllabusMatrixText(row.description)}
                                                  </p>
                                                </div>
                                                <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ring-1 ${matrixCellClass(requirement.requiredStandard)}`}>
                                                  Req {requirement.requiredStandard}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        {lessonMatrix.length > 8 && (
                                          <p className="text-xs font-medium text-slate-500">
                                            + {lessonMatrix.length - 8} more rows in the Matrix tab
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
              <BookOpenCheck className="h-10 w-10 text-gray-300" />
              <p>Select a course to view its details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
