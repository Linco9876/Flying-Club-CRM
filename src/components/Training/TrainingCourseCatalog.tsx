import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowDown,
  ArrowUp,
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
  TrainingLesson,
  TrainingModule
} from '../../types';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { useAuth } from '../../context/AuthContext';

interface NewCourseState {
  title: string;
  category: string;
  description: string;
  estimatedDurationHours: number;
  tags: string;
  objectives: string;
  evaluationFocus: string;
}

interface NewLessonState {
  name: string;
  objective: string;
  flightExercises: string;
  theory: string;
}

type CourseFormState = NewCourseState;

type EditableCriterion = {
  id: string;
  name: string;
  gradingSystem: LessonGradingSystem;
  passingGrade: string;
};

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
  tags: '',
  objectives: '',
  evaluationFocus: '',
});

const parseListLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

export const TrainingCourseCatalog: React.FC = () => {
  const { modules, loading: modulesLoading, addModule, updateModule, reorderLessons, deleteModule } = useTrainingModules();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(() => modules[0]?.id ?? null);

  // Create course form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourse, setNewCourse] = useState<CourseFormState>(emptyCourseForm);
  // Course-level criteria (shared across all lessons)
  const [courseCriteria, setCourseCriteria] = useState<EditableCriterion[]>([]);

  // Edit course form
  const [showEditCourseForm, setShowEditCourseForm] = useState(false);
  const [editCourse, setEditCourse] = useState<CourseFormState>(emptyCourseForm);
  const [editCourseCriteria, setEditCourseCriteria] = useState<EditableCriterion[]>([]);

  // Delete course confirm
  const [showDeleteCourseConfirm, setShowDeleteCourseConfirm] = useState(false);

  // Lesson form
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [newLesson, setNewLesson] = useState<NewLessonState>({
    name: '',
    objective: '',
    flightExercises: '',
    theory: ''
  });
  // Per-lesson pass marks: criterionId → passingGrade
  const [lessonPassMarks, setLessonPassMarks] = useState<Record<string, string>>({});
  const [expandedLessons, setExpandedLessons] = useState<Record<string, boolean>>({});
  const [deletingLessonId, setDeletingLessonId] = useState<string | null>(null);

  useEffect(() => {
    if (modules.length === 0) {
      setSelectedModuleId(null);
      setShowLessonForm(false);
      setNewLesson({ name: '', objective: '', flightExercises: '', theory: '' });
      setLessonPassMarks({});
      return;
    }

    if (!selectedModuleId || !modules.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(modules[0].id);
      setShowLessonForm(false);
      setNewLesson({ name: '', objective: '', flightExercises: '', theory: '' });
      setLessonPassMarks({});
    }
  }, [modules, selectedModuleId]);

  const filteredModules = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const sorted = [...modules].sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());

    if (!term) {
      return sorted;
    }

    return sorted.filter((module) => {
      const tagString = module.tags.join(' ').toLowerCase();
      return (
        module.title.toLowerCase().includes(term) ||
        module.category.toLowerCase().includes(term) ||
        tagString.includes(term)
      );
    });
  }, [modules, searchTerm]);

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;

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
    setNewLesson({ name: '', objective: '', flightExercises: '', theory: '' });
    setLessonPassMarks({});
    setEditingLessonId(null);
  };

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModuleId(moduleId);
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
    setEditCourse({
      title: selectedModule.title,
      category: selectedModule.category,
      description: selectedModule.description,
      estimatedDurationHours: selectedModule.estimatedDurationHours,
      tags: selectedModule.tags.join(', '),
      objectives: selectedModule.objectives.join('\n'),
      evaluationFocus: selectedModule.evaluationCriteria.join('\n'),
    });
    setEditCourseCriteria(selectedModule.assessmentCriteria.map((c) => ({ ...c })));
    setShowEditCourseForm(true);
    setShowLessonForm(false);
  };

  const handleSaveEditCourse = async () => {
    if (!selectedModule) return;
    const title = editCourse.title.trim();
    const category = editCourse.category.trim();
    if (!title) { toast.error('Course title is required'); return; }
    if (!category) { toast.error('Category is required'); return; }

    // Validate criteria
    const criteria: LessonAssessmentCriterion[] = [];
    for (const c of editCourseCriteria) {
      if (!c.name.trim()) { toast.error('Each criterion needs a name'); return; }
      criteria.push({ id: c.id, name: c.name.trim(), gradingSystem: c.gradingSystem, passingGrade: c.passingGrade });
    }

    const tags = editCourse.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const objectives = parseListLines(editCourse.objectives);
    const evaluationCriteria = parseListLines(editCourse.evaluationFocus);
    try {
      await updateModule(selectedModule.id, (cur) => ({
        ...cur,
        title,
        category,
        description: editCourse.description.trim() || cur.description,
        estimatedDurationHours: Math.max(1, Number(editCourse.estimatedDurationHours) || 1),
        tags: tags.length > 0 ? tags : cur.tags,
        objectives,
        evaluationCriteria,
        assessmentCriteria: criteria,
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
    setNewLesson({
      name: lesson.name,
      objective: lesson.objective,
      flightExercises: lesson.flightExercises,
      theory: lesson.theory,
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
      prerequisites: [],
      objectives,
      evaluationCriteria,
      tags: tags.length > 0 ? tags : ['draft'],
      assessmentCriteria: builtCriteria,
      lessons: [],
      resources: [],
      lastUpdated: new Date()
    };

    try {
      const createdModule = await addModule(module);
      setSelectedModuleId(createdModule.id);
      setShowCreateForm(false);
      setNewCourse(emptyCourseForm());
      setCourseCriteria([]);
      toast.success('New course created');
    } catch {
      // error toast handled in context
    }
  };

  const handleCancelCreate = () => {
    setShowCreateForm(false);
    setNewCourse(emptyCourseForm());
    setCourseCriteria([]);
  };

  const handleOpenLessonForm = () => {
    if (!selectedModule) {
      toast.error('Please select a course first');
      return;
    }
    resetLessonForm();
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
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Training Courses</h1>
          <p className="text-gray-600">
            Review published training syllabi, monitor drafts and create new course shells for instructors.
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Course
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-lg border border-gray-200 px-3 py-2 shadow-sm">
              <Search className="mr-2 h-4 w-4 text-gray-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search courses by name, category or tag"
                className="w-full border-none bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
            <div className="hidden text-sm text-gray-500 md:block">
              {filteredModules.length} course{filteredModules.length === 1 ? '' : 's'} found
            </div>
          </div>
          <div className="text-sm text-gray-500 md:hidden">
            {filteredModules.length} course{filteredModules.length === 1 ? '' : 's'} found
          </div>
        </div>
      </div>

      {showCreateForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 shadow-inner">
          <div className="mb-4 flex items-center gap-2 text-blue-900">
            <BookOpenCheck className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Create new course</h2>
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
          </div>
          {/* Assessment criteria for new course */}
          <div className="mt-6 rounded-lg border border-blue-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-blue-900">
                <ClipboardList className="h-4 w-4" />
                <h4 className="text-sm font-semibold">Assessment criteria</h4>
              </div>
              <button type="button" onClick={() => setCourseCriteria((p) => [...p, createEmptyCriterion()])} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                <Plus className="h-3.5 w-3.5" />Add criterion
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Define what will be assessed across all lessons in this course. You can set a pass mark per lesson later.</p>
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

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
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
                      ? 'border-blue-300 bg-blue-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-blue-200 hover:shadow-sm'
                  } rounded-xl border p-5`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{module.title}</h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            module.status === 'published'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {module.status === 'published' ? 'Published' : 'Draft'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{module.description}</p>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-4 w-4" />
                        {module.estimatedDurationHours}h
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-4 w-4" />
                        {module.lessons.length} lessons
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-gray-400">Tags:</span>
                    {module.tags.length === 0 ? (
                      <span className="text-xs text-gray-500">No tags</span>
                    ) : (
                      module.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                        >
                          <Tag className="mr-1 h-3 w-3 text-gray-400" />
                          {tag}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    Updated {formatDistanceToNow(module.lastUpdated, { addSuffix: true })}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="space-y-6">
          {selectedModule ? (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                {/* Delete course confirmation */}
                {showDeleteCourseConfirm && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm text-red-700">Permanently delete this course and all its lessons? Student completion records are not affected.</p>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setShowDeleteCourseConfirm(false)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                      <button type="button" onClick={handleDeleteCourse} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Delete</button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <BookOpenCheck className="h-5 w-5 text-blue-600" />
                      <h2 className="text-xl font-semibold text-gray-900">{selectedModule.title}</h2>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">{selectedModule.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedModule.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {selectedModule.status === 'published' ? 'Published' : 'Draft'}
                    </span>
                    <div className="flex flex-wrap justify-end gap-2">
                      {selectedModule.status !== 'published' && (
                        <button onClick={handlePublishCourse} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100">
                          <CheckCircle2 className="h-4 w-4" />
                          Publish
                        </button>
                      )}
                      {canManageCourse(selectedModule) && (
                        <>
                          <button onClick={handleOpenEditCourse} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                            <Pencil className="h-4 w-4" />
                            Edit course
                          </button>
                          <button onClick={() => setShowDeleteCourseConfirm(true)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </>
                      )}
                      <button onClick={handleOpenLessonForm} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100">
                        <FilePlus className="h-4 w-4" />
                        New lesson
                      </button>
                    </div>
                  </div>
                </div>
                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Category</dt>
                    <dd className="mt-1 text-sm text-gray-700">{selectedModule.category}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estimated duration</dt>
                    <dd className="mt-1 inline-flex items-center gap-1 text-sm text-gray-700">
                      <Clock3 className="h-4 w-4 text-gray-400" />
                      {selectedModule.estimatedDurationHours} hours
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lessons</dt>
                    <dd className="mt-1 text-sm text-gray-700">{selectedModule.lessons.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assessment criteria</dt>
                    <dd className="mt-1 text-sm text-gray-700">{selectedModule.assessmentCriteria.length} defined</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-gray-500">Last updated {formatDistanceToNow(selectedModule.lastUpdated, { addSuffix: true })}</p>
                {/* Course-level criteria display */}
                {selectedModule.assessmentCriteria.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Course criteria</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedModule.assessmentCriteria.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
                          <ClipboardList className="h-3 w-3" />
                          {c.name}
                          <span className="text-blue-500">·</span>
                          <span className="text-blue-600">{c.gradingSystem}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedModule.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedModule.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                      >
                        <Tag className="mr-1 h-3 w-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {selectedModule.objectives.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-900">Objectives</h3>
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {selectedModule.objectives.map((objective) => (
                        <li key={objective} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                          <span>{objective}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedModule.evaluationCriteria.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-gray-900">Evaluation focus</h3>
                    <ul className="mt-2 space-y-1 text-sm text-gray-700">
                      {selectedModule.evaluationCriteria.map((criteria) => (
                        <li key={criteria} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500" />
                          <span>{criteria}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* ── Edit course form ── */}
              {showEditCourseForm && selectedModule && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
                  <div className="mt-5 flex justify-end gap-3">
                    <button onClick={() => setShowEditCourseForm(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button onClick={handleSaveEditCourse} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      <Pencil className="mr-2 h-4 w-4" />Save changes
                    </button>
                  </div>
                </div>
              )}

              {showLessonForm && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-inner">
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
                  <div className="mt-6 rounded-lg border border-blue-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-blue-900">
                        <ClipboardList className="h-5 w-5" />
                        <h4 className="text-sm font-semibold">Pass mark per criterion</h4>
                      </div>
                    </div>
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

              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-gray-900">
                    <ClipboardList className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-semibold">Lesson library</h3>
                  </div>
                  {selectedModule.lessons.length > 0 && (
                    <button
                      onClick={() => handleExpandCollapseAll(!allLessonsExpanded)}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
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
                          className="rounded-lg border border-gray-200 bg-gray-50 p-5 shadow-sm"
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

                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                            <div className="flex min-w-0 items-start gap-2">
                              <button
                                type="button"
                                onClick={() => handleToggleLessonExpansion(lesson.id)}
                                className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-100"
                                aria-label={isExpanded ? 'Collapse lesson details' : 'Expand lesson details'}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-blue-100 px-2 text-xs font-semibold text-blue-700">
                                    {lessonIndex + 1}
                                  </span>
                                  <h4 className="min-w-0 flex-1 text-base font-semibold text-gray-900">
                                    {lesson.name || lesson.sequenceTitle}
                                  </h4>
                                </div>
                                <p className="mt-1 text-sm text-gray-600">
                                  {lesson.objective || 'Document the lesson objective for instructors.'}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 lg:justify-end">
                              <div className="inline-flex rounded-md border border-gray-200 bg-white">
                                <button
                                  type="button"
                                  onClick={() => handleMoveLesson(lesson.id, 'up')}
                                  disabled={isFirstLesson}
                                  className="inline-flex h-7 w-8 items-center justify-center rounded-l-md text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                                  title="Move lesson up"
                                  aria-label="Move lesson up"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveLesson(lesson.id, 'down')}
                                  disabled={isLastLesson}
                                  className="inline-flex h-7 w-8 items-center justify-center rounded-r-md border-l border-gray-200 text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                                  title="Move lesson down"
                                  aria-label="Move lesson down"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleLessonExpansion(lesson.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                              >
                                {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                                {isExpanded ? 'Collapse' : 'Expand'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditLesson(lesson)}
                                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingLessonId(deletingLessonId === lesson.id ? null : lesson.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          </div>
                          {isExpanded && (
                            <>
                              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <div>
                                  <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Flight exercises
                                  </h5>
                                  <div className="mt-2 rounded-md border border-blue-100 bg-white p-3">
                                    {flightExercisesContent ? (
                                      <div
                                        className="text-sm text-gray-700 [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5"
                                        dangerouslySetInnerHTML={{ __html: flightExercisesContent }}
                                      />
                                    ) : (
                                      <p className="text-sm text-gray-500">Describe the flight exercises to be flown.</p>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Theory focus
                                  </h5>
                                  <div className="mt-2 rounded-md border border-blue-100 bg-white p-3">
                                    {theoryContent ? (
                                      <div
                                        className="text-sm text-gray-700 [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5"
                                        dangerouslySetInnerHTML={{ __html: theoryContent }}
                                      />
                                    ) : (
                                      <p className="text-sm text-gray-500">Outline the theory elements that support this lesson.</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-4">
                                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                                  <div className="mt-2 space-y-2">
                                    {relevantCriteria.map((criterion) => (
                                      <div
                                        key={criterion.id}
                                        className="rounded-md border border-gray-200 bg-white p-3 text-sm"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <span className="font-medium text-gray-900">{criterion.name}</span>
                                          <span className="text-xs text-gray-500">{criterion.gradingSystem}</span>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500">
                                          {lesson.passMarks?.[criterion.id] === '-' ? 'Not assessed' : 'Passing grade'}{' '}
                                          <span className="font-medium text-gray-700">
                                            {lesson.passMarks?.[criterion.id] ?? criterion.passingGrade}
                                          </span>
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                  ) : (
                                  <p className="mt-2 text-sm text-gray-500">
                                    No assessment criteria recorded for this lesson yet.
                                  </p>
                                  );
                                })()}
                              </div>
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
