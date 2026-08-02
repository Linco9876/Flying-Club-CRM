import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  ExternalLink,
  FileQuestion,
  Film,
  GraduationCap,
  Lock,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import {
  createBlankLearningProgram,
  createLearningId,
  LearningContentBlock,
  LearningLessonLink,
  LearningProgram,
  LearningQuestion,
  LearningStep,
  LearningStepProgress,
  LearningStepType,
  useLearningCentre,
} from '../../hooks/useLearningCentre';
import {
  gradeLearningQuiz,
  isLearningStepUnlocked,
  isQuestionAnswered,
  LearningQuizAnswers,
  LearningQuizGrade,
} from '../../utils/learningQuiz';
import { canDeleteLearningProgram } from '../../utils/learningProgramPermissions';

type BuilderTab = 'basic' | 'schedule' | 'enrolment' | 'settings' | 'content' | 'links' | 'preview';

const tabs: Array<{ id: BuilderTab; label: string }> = [
  { id: 'basic', label: 'Basic Info' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'enrolment', label: 'Enrolment & Payment' },
  { id: 'settings', label: 'Content Settings' },
  { id: 'content', label: 'Content Creation' },
  { id: 'links', label: 'Flying Lesson Links' },
  { id: 'preview', label: 'Preview' },
];

const stepTypeMeta: Record<LearningStepType, { label: string; icon: React.ReactNode; color: string }> = {
  article: { label: 'Article', icon: <BookOpen className="h-4 w-4" />, color: 'bg-blue-50 text-blue-800 border-blue-200' },
  video: { label: 'Video', icon: <Film className="h-4 w-4" />, color: 'bg-purple-50 text-purple-800 border-purple-200' },
  quiz: { label: 'Quiz', icon: <FileQuestion className="h-4 w-4" />, color: 'bg-amber-50 text-amber-800 border-amber-200' },
};

const defaultBlock = (): LearningContentBlock => ({
  id: createLearningId('block'),
  type: 'rich_text',
  title: '',
  text: 'Add your lesson content here.',
});

const defaultQuestion = (): LearningQuestion => ({
  id: createLearningId('question'),
  type: 'single_choice',
  prompt: 'New question',
  options: [
    { id: createLearningId('option'), label: 'Option A' },
    { id: createLearningId('option'), label: 'Option B' },
  ],
  correctAnswer: '',
  hint: '',
  additionalInfo: '',
  incorrectExplanation: '',
  successMessage: '',
  required: true,
});

const blankStep = (programId: string, sectionId?: string, type: LearningStepType = 'article'): LearningStep => ({
  id: createLearningId('step'),
  programId,
  sectionId: sectionId || null,
  stepType: type,
  title: type === 'article' ? 'New article' : type === 'video' ? 'New video step' : 'New quiz',
  description: '',
  contentBlocks: type === 'quiz' ? [] : [defaultBlock()],
  videoUrl: '',
  videoStoragePath: '',
  videoDurationSeconds: null,
  quizQuestions: type === 'quiz' ? [defaultQuestion()] : [],
  passingScorePercent: type === 'quiz' ? 80 : null,
  sortOrder: 0,
  isRequired: true,
});

const formatMoney = (cents: number) => cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'Free';

export const LearningCentreDashboard: React.FC = () => {
  const {
    programs,
    progress,
    programProgress,
    loading,
    isStaff,
    saveProgram,
    deleteProgram,
    saveSections,
    saveSteps,
    saveLessonLinks,
    enrolInProgram,
    completeLearningStep,
    submitLearningQuiz,
    approveEnrolment,
  } = useLearningCentre();
  const { user } = useAuth();
  const { modules } = useTrainingModules();
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderTab, setBuilderTab] = useState<BuilderTab>('basic');
  const [draftProgram, setDraftProgram] = useState<Partial<LearningProgram>>(createBlankLearningProgram());
  const [draftSections, setDraftSections] = useState<LearningProgram['sections']>([]);
  const [draftSteps, setDraftSteps] = useState<LearningStep[]>([]);
  const [draftLinks, setDraftLinks] = useState<LearningLessonLink[]>([]);
  const [activeStepId, setActiveStepId] = useState<string>('');
  const [learnerProgramId, setLearnerProgramId] = useState<string>('');
  const [programSearch, setProgramSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [programPendingDeletion, setProgramPendingDeletion] = useState<LearningProgram | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingProgram, setDeletingProgram] = useState(false);

  const selectedProgram = programs.find(program => program.id === selectedProgramId) || programs[0];
  const learnerProgram = programs.find(program => program.id === learnerProgramId) || selectedProgram;

  useEffect(() => {
    if (!selectedProgramId && programs.length > 0) setSelectedProgramId(programs[0].id);
    if (!learnerProgramId && programs.length > 0) setLearnerProgramId(programs[0].id);
  }, [learnerProgramId, programs, selectedProgramId]);

  const openBuilder = (program?: LearningProgram) => {
    const source = program || createBlankLearningProgram();
    setDraftProgram(source);
    setDraftSections(program?.sections || [{ id: createLearningId('section'), programId: program?.id || '', title: 'Welcome', description: 'Start here.', sortOrder: 0 }]);
    setDraftSteps(program?.steps || []);
    setDraftLinks(program?.lessonLinks || []);
    setActiveStepId(program?.steps[0]?.id || '');
    setBuilderTab('basic');
    setBuilderOpen(true);
  };

  const saveAll = async () => {
    if (!draftProgram.name?.trim()) {
      toast.error('Program name is required');
      return;
    }
    const saved = await saveProgram(draftProgram);
    if (!saved?.id) return;
    const sections = draftSections.map((section, index) => ({ ...section, programId: saved.id, sortOrder: index }));
    await saveSections(saved.id, sections);
    await saveSteps(saved.id, draftSteps.map((step, index) => ({ ...step, programId: saved.id, sortOrder: index })));
    await saveLessonLinks(saved.id, draftLinks.map(link => ({ ...link, programId: saved.id })));
    setSelectedProgramId(saved.id);
    setBuilderOpen(false);
    toast.success('Learning program saved');
  };

  const updateDraft = (updates: Partial<LearningProgram>) => setDraftProgram(current => ({ ...current, ...updates }));

  const addSection = () => {
    setDraftSections(current => [
      ...current,
      { id: createLearningId('section'), programId: draftProgram.id || '', title: `Section ${current.length + 1}`, description: '', sortOrder: current.length },
    ]);
  };

  const addStep = (type: LearningStepType) => {
    const step = blankStep(draftProgram.id || '', draftSections[0]?.id, type);
    setDraftSteps(current => [...current, { ...step, sortOrder: current.length }]);
    setActiveStepId(step.id);
  };

  const updateStep = (stepId: string, updates: Partial<LearningStep>) => {
    setDraftSteps(current => current.map(step => step.id === stepId ? { ...step, ...updates } : step));
  };

  const activeStep = draftSteps.find(step => step.id === activeStepId) || draftSteps[0];

  const requestProgramDeletion = () => {
    const program = programs.find(item => item.id === draftProgram.id);
    if (!program || !canDeleteLearningProgram(user, program)) return;
    setDeleteConfirmation('');
    setProgramPendingDeletion(program);
  };

  const confirmProgramDeletion = async () => {
    if (!programPendingDeletion || deleteConfirmation !== programPendingDeletion.name) return;
    setDeletingProgram(true);
    try {
      await deleteProgram(programPendingDeletion.id);
      setBuilderOpen(false);
      if (selectedProgramId === programPendingDeletion.id) setSelectedProgramId('');
      if (learnerProgramId === programPendingDeletion.id) setLearnerProgramId('');
      setProgramPendingDeletion(null);
      setDeleteConfirmation('');
    } catch (error) {
      console.error('Error deleting online program:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete online program');
    } finally {
      setDeletingProgram(false);
    }
  };

  const visiblePrograms = useMemo(() => {
    const available = isStaff ? programs : programs.filter(program => program.status === 'published');
    const search = programSearch.trim().toLocaleLowerCase();
    return available
      .filter(program => categoryFilter === 'all' || program.category === categoryFilter)
      .filter(program => !search || `${program.name} ${program.category} ${program.description}`.toLocaleLowerCase().includes(search))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  }, [categoryFilter, isStaff, programSearch, programs]);

  const categories = useMemo(
    () => [...new Set(programs.filter(program => isStaff || program.status === 'published').map(program => program.category))].sort(),
    [isStaff, programs],
  );
  const isEnrolled = (program: LearningProgram) => program.enrolments.some(
    enrolment => enrolment.userId === user?.id && ['active', 'completed'].includes(enrolment.status),
  );
  const getProgress = (program: LearningProgram) => programProgress.get(program.id) || { completed: 0, total: program.steps.filter(step => step.isRequired).length, percent: 0 };

  const markStepDone = async (program: LearningProgram, step: LearningStep) => {
    await completeLearningStep(step.id);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
          <Sparkles className="mx-auto h-10 w-10 animate-pulse text-blue-600" />
          <p className="mt-3 font-semibold text-gray-900">Loading Learning Centre</p>
          <p className="mt-1 text-sm text-gray-500">Preparing programs, steps and progress...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <section className="overflow-hidden rounded-2xl border border-blue-900/10 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 p-5 text-white shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Learning Centre</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Online Programs</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
              {isStaff
                ? 'Build self-paced or scheduled online courses with articles, videos, quizzes, lesson links, enrolments and progress tracking.'
                : 'Complete your assigned online programs, review lesson material and keep track of your progress.'}
            </p>
          </div>
          {isStaff && (
            <button onClick={() => openBuilder()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-950 shadow-sm hover:bg-blue-50">
              <Plus className="h-4 w-4" />
              New Program
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <span className="sr-only">Search online programs</span>
              <input
                value={programSearch}
                onChange={event => setProgramSearch(event.target.value)}
                className="input pl-9"
                placeholder="Search lessons"
              />
            </label>
            {categories.length > 1 && (
              <select
                aria-label="Filter programs by category"
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
                className="input mt-2"
              >
                <option value="all">All categories</option>
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            )}
          </div>
          {visiblePrograms.map(program => {
            const stats = getProgress(program);
            return (
              <button
                key={program.id}
                onClick={() => {
                  setSelectedProgramId(program.id);
                  setLearnerProgramId(program.id);
                }}
                className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  selectedProgram?.id === program.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    {program.coverPhotoUrl ? <img src={program.coverPhotoUrl} alt="" className="h-full w-full rounded-xl object-cover" /> : <GraduationCap className="h-6 w-6" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 font-semibold text-gray-950">{program.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${program.status === 'published' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {program.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{program.category} - {program.steps.length} steps - {formatMoney(program.priceCents)}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${stats.percent}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{stats.completed}/{stats.total} required steps complete</p>
                  </div>
                </div>
              </button>
            );
          })}
          {visiblePrograms.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <BookOpen className="mx-auto h-9 w-9 text-gray-300" />
              <p className="mt-3 font-semibold text-gray-900">
                {programSearch || categoryFilter !== 'all'
                  ? 'No matching lessons'
                  : isStaff ? 'No online programs yet' : 'No programs available'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {programSearch || categoryFilter !== 'all'
                  ? 'Try a different search or category.'
                  : isStaff
                  ? 'Create the first program to start building the Learning Centre.'
                  : 'Programs assigned or made available to you will appear here.'}
              </p>
            </div>
          )}
        </aside>

        <main className="min-w-0">
          {selectedProgram ? (
            <ProgramViewer
              program={learnerProgram || selectedProgram}
              isStaff={isStaff}
              isEnrolled={isEnrolled(learnerProgram || selectedProgram)}
              progress={progress}
              progressSummary={getProgress(learnerProgram || selectedProgram)}
              onEdit={() => openBuilder(learnerProgram || selectedProgram)}
              onEnrol={() => enrolInProgram(learnerProgram || selectedProgram)}
              onMarkStepDone={markStepDone}
              onSubmitQuiz={async (_program, step, answers) => submitLearningQuiz(step.id, answers)}
              onApproveEnrolment={approveEnrolment}
            />
          ) : null}
        </main>
      </div>

      {builderOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6">
          <div className="my-4 w-full max-w-7xl rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-950">{draftProgram.id ? 'Edit Online Program' : 'Create Online Program'}</h2>
                <p className="text-sm text-gray-500">Work through the tabs left to right, preview, then publish when ready.</p>
              </div>
              <div className="flex gap-2">
                {draftProgram.id && canDeleteLearningProgram(user, draftProgram) && (
                  <button
                    type="button"
                    onClick={requestProgramDeletion}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
                <button onClick={() => setBuilderOpen(false)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Close</button>
                <button onClick={saveAll} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  <Save className="h-4 w-4" />
                  Save Program
                </button>
              </div>
            </div>

            <div className="grid min-h-[70vh] lg:grid-cols-[260px_minmax(0,1fr)]">
              <nav className="border-b border-gray-200 bg-gray-50 p-3 lg:border-b-0 lg:border-r">
                <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-2">
                  {tabs.map((tab, index) => (
                    <button
                      key={tab.id}
                      onClick={() => setBuilderTab(tab.id)}
                      className={`flex min-w-fit items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition lg:w-full ${
                        builderTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white'
                      }`}
                    >
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${builderTab === tab.id ? 'bg-white/20' : 'bg-white'}`}>{index + 1}</span>
                      {tab.label}
                    </button>
                  ))}
                </div>
              </nav>

              <div className="max-h-[78vh] overflow-y-auto p-4 sm:p-6">
                {builderTab === 'basic' && (
                  <BuilderPanel title="Basic Info" description="Set the identity and public-facing summary for the program.">
                    <Field label="Program name"><input value={draftProgram.name || ''} onChange={event => updateDraft({ name: event.target.value })} className="input" /></Field>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Category"><input value={draftProgram.category || ''} onChange={event => updateDraft({ category: event.target.value })} className="input" placeholder="RAAus, Safety, Club Induction..." /></Field>
                      <Field label="Cover photo URL"><input value={draftProgram.coverPhotoUrl || ''} onChange={event => updateDraft({ coverPhotoUrl: event.target.value })} className="input" placeholder="https://..." /></Field>
                    </div>
                    <Field label="Description"><textarea rows={5} value={draftProgram.description || ''} onChange={event => updateDraft({ description: event.target.value })} className="input" /></Field>
                    <Field label="Status"><select value={draftProgram.status || 'draft'} onChange={event => updateDraft({ status: event.target.value as any })} className="input"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></Field>
                  </BuilderPanel>
                )}

                {builderTab === 'schedule' && (
                  <BuilderPanel title="Schedule" description="Choose whether the participant works at their own pace or follows scheduled dates.">
                    <Segmented value={draftProgram.scheduleType || 'self_paced'} onChange={value => updateDraft({ scheduleType: value as any })} options={[['self_paced', 'Self paced'], ['scheduled', 'Scheduled']]} />
                    {draftProgram.scheduleType === 'self_paced' ? (
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Time limit"><select value={draftProgram.selfPacedLimitType || 'none'} onChange={event => updateDraft({ selfPacedLimitType: event.target.value as any })} className="input"><option value="none">No time limit</option><option value="duration_days">Duration in days</option><option value="fixed_end">Scheduled end date</option></select></Field>
                        {draftProgram.selfPacedLimitType === 'duration_days' && <Field label="Duration days"><input type="number" value={draftProgram.durationDays || 30} onChange={event => updateDraft({ durationDays: Number(event.target.value) })} className="input" /></Field>}
                        {draftProgram.selfPacedLimitType === 'fixed_end' && <Field label="End date"><input type="datetime-local" value={(draftProgram.scheduledEndAt || '').slice(0, 16)} onChange={event => updateDraft({ scheduledEndAt: event.target.value })} className="input" /></Field>}
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Start"><input type="datetime-local" value={(draftProgram.scheduledStartAt || '').slice(0, 16)} onChange={event => updateDraft({ scheduledStartAt: event.target.value })} className="input" /></Field>
                        <Field label="End"><input type="datetime-local" value={(draftProgram.scheduledEndAt || '').slice(0, 16)} onChange={event => updateDraft({ scheduledEndAt: event.target.value })} className="input" /></Field>
                      </div>
                    )}
                  </BuilderPanel>
                )}

                {builderTab === 'enrolment' && (
                  <BuilderPanel title="Enrolment & Payment" description="Decide who can join, whether approval is required, and participant limits.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Payment"><select value={draftProgram.priceType || 'free'} onChange={event => updateDraft({ priceType: event.target.value as any })} className="input"><option value="free">Free</option><option value="paid">Pay to join</option></select></Field>
                      {draftProgram.priceType === 'paid' && <Field label="Price"><input type="number" value={(draftProgram.priceCents || 0) / 100} onChange={event => updateDraft({ priceCents: Math.round(Number(event.target.value) * 100) })} className="input" /></Field>}
                      <Field label="Visibility"><select value={draftProgram.visibility || 'private'} onChange={event => updateDraft({ visibility: event.target.value as any })} className="input"><option value="public">Public - anyone can join</option><option value="private">Private - visible but requires approval</option><option value="secret">Secret - invited users only</option></select></Field>
                      <Field label="Participant limit"><input type="number" value={draftProgram.participantLimit || ''} onChange={event => updateDraft({ participantLimit: event.target.value ? Number(event.target.value) : null })} className="input" placeholder="Blank = unlimited" /></Field>
                    </div>
                    <Field label="Payment notes"><textarea rows={3} value={draftProgram.paymentNotes || ''} onChange={event => updateDraft({ paymentNotes: event.target.value })} className="input" /></Field>
                    <label className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm">
                      <input
                        type="checkbox"
                        checked={draftProgram.autoEnrolFromLessonLinks ?? false}
                        onChange={event => updateDraft({ autoEnrolFromLessonLinks: event.target.checked })}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-semibold text-blue-950">Automatically enrol students from linked flying lessons</span>
                        <span className="mt-1 block text-blue-800">
                          Students enrolled in a linked training course receive this online program automatically. Use the Flying Lesson Links tab to choose the course lesson.
                        </span>
                      </span>
                    </label>
                  </BuilderPanel>
                )}

                {builderTab === 'settings' && (
                  <BuilderPanel title="Content Settings" description="Control how participants move through the program and complete video steps.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Step order"><select value={draftProgram.stepOrderMode || 'in_order'} onChange={event => updateDraft({ stepOrderMode: event.target.value as any })} className="input"><option value="any_order">Any order</option><option value="in_order">In order</option></select></Field>
                      <label className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 text-sm font-semibold"><input type="checkbox" checked={draftProgram.futureStepsVisible ?? true} onChange={event => updateDraft({ futureStepsVisible: event.target.checked })} /> Show future steps</label>
                      <label className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 text-sm font-semibold"><input type="checkbox" checked={draftProgram.videoWatchRequired ?? false} onChange={event => updateDraft({ videoWatchRequired: event.target.checked })} /> Require video watch percentage</label>
                      <Field label="Required video watch %"><input type="number" min={0} max={100} value={draftProgram.videoRequiredPercent || 90} onChange={event => updateDraft({ videoRequiredPercent: Number(event.target.value) })} className="input" /></Field>
                      <label className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 text-sm font-semibold"><input type="checkbox" checked={draftProgram.autoplayNextVideo ?? false} onChange={event => updateDraft({ autoplayNextVideo: event.target.checked })} /> Autoplay next video step</label>
                    </div>
                  </BuilderPanel>
                )}

                {builderTab === 'content' && (
                  <BuilderPanel title="Content Creation" description="Build sections, then add article, video or quiz steps inside each section.">
                    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-gray-200 p-4">
                          <div className="flex items-center justify-between"><h3 className="font-semibold">Sections</h3><button onClick={addSection} className="text-sm font-semibold text-blue-700">Add</button></div>
                          <div className="mt-3 space-y-2">
                            {draftSections.map(section => (
                              <input key={section.id} value={section.title} onChange={event => setDraftSections(current => current.map(item => item.id === section.id ? { ...item, title: event.target.value } : item))} className="input" />
                            ))}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-gray-200 p-4">
                          <h3 className="font-semibold">Add step</h3>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {(['article', 'video', 'quiz'] as LearningStepType[]).map(type => <button key={type} onClick={() => addStep(type)} className="rounded-lg border border-gray-200 p-2 text-xs font-semibold hover:bg-blue-50">{stepTypeMeta[type].label}</button>)}
                          </div>
                          <div className="mt-4 space-y-2">
                            {draftSteps.map(step => (
                              <button key={step.id} onClick={() => setActiveStepId(step.id)} className={`w-full rounded-xl border p-3 text-left text-sm ${activeStep?.id === step.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stepTypeMeta[step.stepType].color}`}>{stepTypeMeta[step.stepType].icon}{stepTypeMeta[step.stepType].label}</span>
                                <p className="mt-2 font-semibold">{step.title}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {activeStep ? <StepEditor step={activeStep} sections={draftSections} onChange={updates => updateStep(activeStep.id, updates)} /> : <EmptyEditor />}
                    </div>
                  </BuilderPanel>
                )}

                {builderTab === 'links' && (
                  <BuilderPanel title="Flying Lesson Links" description="Attach online programs to flying course lessons so students can study before or revise after lessons.">
                    <button onClick={() => setDraftLinks(current => [...current, { id: createLearningId('link'), programId: draftProgram.id || '', trainingCourseId: modules[0]?.id || '', trainingLessonId: modules[0]?.lessons[0]?.id || null, visibilityTiming: 'at_or_before_lesson' }])} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Add lesson link</button>
                    <div className="mt-4 space-y-3">
                      {draftLinks.map(link => {
                        const course = modules.find(module => module.id === link.trainingCourseId);
                        return (
                          <div key={link.id} className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-3">
                            <select value={link.trainingCourseId} onChange={event => setDraftLinks(current => current.map(item => item.id === link.id ? { ...item, trainingCourseId: event.target.value, trainingLessonId: modules.find(m => m.id === event.target.value)?.lessons[0]?.id || null } : item))} className="input">
                              {modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
                            </select>
                            <select value={link.trainingLessonId || ''} onChange={event => setDraftLinks(current => current.map(item => item.id === link.id ? { ...item, trainingLessonId: event.target.value || null } : item))} className="input">
                              <option value="">Whole course</option>
                              {course?.lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.name}</option>)}
                            </select>
                            <select value={link.visibilityTiming} onChange={event => setDraftLinks(current => current.map(item => item.id === link.id ? { ...item, visibilityTiming: event.target.value as any } : item))} className="input">
                              <option value="always">Always visible</option>
                              <option value="at_or_before_lesson">When up to this lesson</option>
                              <option value="after_lesson">After this lesson</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </BuilderPanel>
                )}

                {builderTab === 'preview' && (
                  <ProgramPreview program={{ ...(draftProgram as LearningProgram), sections: draftSections, steps: draftSteps, enrolments: [], lessonLinks: draftLinks }} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {programPendingDeletion && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-online-program-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-700">
              <Trash2 className="h-6 w-6" />
            </div>
            <h2 id="delete-online-program-title" className="mt-4 text-xl font-bold text-gray-950">
              Delete {programPendingDeletion.name}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              This permanently deletes the program, its {programPendingDeletion.steps.length} steps,
              {' '}{programPendingDeletion.enrolments.length} enrolments, participant progress and flying lesson links. This cannot be undone.
            </p>
            <label className="mt-5 block">
              <span className="text-sm font-semibold text-gray-800">
                Type <span className="font-bold text-gray-950">{programPendingDeletion.name}</span> to confirm
              </span>
              <input
                autoFocus
                value={deleteConfirmation}
                onChange={event => setDeleteConfirmation(event.target.value)}
                className="input mt-2"
                autoComplete="off"
              />
            </label>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setProgramPendingDeletion(null);
                  setDeleteConfirmation('');
                }}
                disabled={deletingProgram}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmProgramDeletion}
                disabled={deletingProgram || deleteConfirmation !== programPendingDeletion.name}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deletingProgram ? 'Deleting...' : 'Delete program'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const BuilderPanel = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
  <section className="space-y-5">
    <div>
      <h3 className="text-xl font-bold text-gray-950">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</span>
    {children}
  </label>
);

const Segmented = ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) => (
  <div className="inline-grid rounded-xl bg-gray-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(([id, label]) => <button key={id} onClick={() => onChange(id)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${value === id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'}`}>{label}</button>)}
  </div>
);

const StepEditor = ({ step, sections, onChange }: { step: LearningStep; sections: LearningProgram['sections']; onChange: (updates: Partial<LearningStep>) => void }) => {
  const updateBlock = (blockId: string, updates: Partial<LearningContentBlock>) => onChange({ contentBlocks: step.contentBlocks.map(block => block.id === blockId ? { ...block, ...updates } : block) });
  const updateQuestion = (questionId: string, updates: Partial<LearningQuestion>) => onChange({ quizQuestions: step.quizQuestions.map(question => question.id === questionId ? { ...question, ...updates } : question) });

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Step name"><input value={step.title} onChange={event => onChange({ title: event.target.value })} className="input" /></Field>
        <Field label="Section"><select value={step.sectionId || ''} onChange={event => onChange({ sectionId: event.target.value || null })} className="input">{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></Field>
      </div>
      <Field label="Description"><textarea rows={3} value={step.description} onChange={event => onChange({ description: event.target.value })} className="input" /></Field>
      {step.stepType === 'video' && <Field label="Video URL"><input value={step.videoUrl || ''} onChange={event => onChange({ videoUrl: event.target.value })} className="input" placeholder="Paste YouTube, Vimeo or hosted video URL" /></Field>}
      {step.stepType !== 'quiz' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h4 className="font-semibold">Content blocks</h4><button onClick={() => onChange({ contentBlocks: [...step.contentBlocks, defaultBlock()] })} className="text-sm font-semibold text-blue-700">Add block</button></div>
          {step.contentBlocks.map(block => (
            <div key={block.id} className="rounded-xl border border-gray-200 p-3">
              <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                <select value={block.type} onChange={event => updateBlock(block.id, { type: event.target.value as any })} className="input">
                  <option value="rich_text">Rich text</option><option value="divider">Divider</option><option value="button">Button</option><option value="table">Table</option><option value="video">Video</option><option value="image">Image</option><option value="gallery">Gallery</option><option value="gif">GIF</option><option value="file">File</option><option value="audio">Audio file</option>
                </select>
                <input value={block.title || ''} onChange={event => updateBlock(block.id, { title: event.target.value })} className="input" placeholder="Optional title" />
              </div>
              <textarea rows={4} value={block.text || ''} onChange={event => updateBlock(block.id, { text: event.target.value })} className="input mt-3" placeholder="Text, table notes or embed description" />
              <input value={block.url || ''} onChange={event => updateBlock(block.id, { url: event.target.value })} className="input mt-3" placeholder="Optional URL / file link / media link" />
            </div>
          ))}
        </div>
      )}
      {step.stepType === 'quiz' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h4 className="font-semibold">Quiz questions</h4><button onClick={() => onChange({ quizQuestions: [...step.quizQuestions, defaultQuestion()] })} className="text-sm font-semibold text-blue-700">Add question</button></div>
          <Field label="Passing score %"><input type="number" min={0} max={100} value={step.passingScorePercent || 80} onChange={event => onChange({ passingScorePercent: Number(event.target.value) })} className="input" /></Field>
          {step.quizQuestions.map(question => (
            <div key={question.id} className="rounded-xl border border-gray-200 p-3">
              <div className="grid gap-3 md:grid-cols-[190px_minmax(0,1fr)]">
                <select value={question.type} onChange={event => updateQuestion(question.id, { type: event.target.value as any })} className="input">
                  <option value="short_answer">Short answer</option><option value="long_answer">Long answer</option><option value="number">Number</option><option value="single_choice">Single choice</option><option value="multiple_choice">Multiple choice</option><option value="image_choice">Image choice</option><option value="file_upload">File upload</option><option value="heading">Heading</option><option value="text">Text</option>
                </select>
                <input value={question.prompt} onChange={event => updateQuestion(question.id, { prompt: event.target.value })} className="input" placeholder="Question, heading or text" />
              </div>
              <textarea rows={2} value={Array.isArray(question.correctAnswer) ? question.correctAnswer.join(', ') : String(question.correctAnswer ?? '')} onChange={event => updateQuestion(question.id, { correctAnswer: event.target.value })} className="input mt-3" placeholder="Correct answer" />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input value={question.hint || ''} onChange={event => updateQuestion(question.id, { hint: event.target.value })} className="input" placeholder="Hint" />
                <input value={question.additionalInfo || ''} onChange={event => updateQuestion(question.id, { additionalInfo: event.target.value })} className="input" placeholder="Additional info" />
                <input value={question.incorrectExplanation || ''} onChange={event => updateQuestion(question.id, { incorrectExplanation: event.target.value })} className="input" placeholder="If incorrect, show..." />
                <input value={question.successMessage || ''} onChange={event => updateQuestion(question.id, { successMessage: event.target.value })} className="input" placeholder="If correct, show..." />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const EmptyEditor = () => (
  <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-gray-500">Add or select a step to start editing.</div>
);

const ProgramViewer = ({
  program,
  isStaff,
  isEnrolled,
  progress,
  progressSummary,
  onEdit,
  onEnrol,
  onMarkStepDone,
  onSubmitQuiz,
  onApproveEnrolment,
}: {
  program: LearningProgram;
  isStaff: boolean;
  isEnrolled: boolean;
  progress: LearningStepProgress[];
  progressSummary: { completed: number; total: number; percent: number };
  onEdit: () => void;
  onEnrol: () => void;
  onMarkStepDone: (program: LearningProgram, step: LearningStep) => Promise<void> | void;
  onSubmitQuiz: (program: LearningProgram, step: LearningStep, answers: LearningQuizAnswers) => Promise<LearningQuizGrade>;
  onApproveEnrolment: (enrolmentId: string) => void;
}) => {
  const canViewContent = isStaff || isEnrolled;
  const canTrackProgress = isEnrolled;
  const orderedSteps = [...program.steps].sort((left, right) => left.sortOrder - right.sortOrder);
  const contentVersion = String(program.sourceMetadata?.contentVersion || '');
  const aircraftFamily = String(program.sourceMetadata?.aircraftFamily || '');

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="relative min-h-[220px] bg-slate-950 p-5 text-white sm:p-7">
        {program.coverPhotoUrl && <img src={program.coverPhotoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
        <div className="relative z-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">{program.category}</span>
              <h2 className="mt-4 text-2xl font-bold sm:text-3xl">{program.name}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-50">{program.description}</p>
            </div>
            {isStaff && <button onClick={onEdit} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950"><Settings className="h-4 w-4" />Edit</button>}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            <InfoCard label="Steps" value={String(program.steps.length)} />
            <InfoCard label="Price" value={formatMoney(program.priceCents)} />
            <InfoCard label="Aircraft" value={aircraftFamily || 'As briefed'} />
            <InfoCard label="Progress" value={`${progressSummary.percent}%`} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_300px] sm:p-6">
        <div className="space-y-5">
          {!isEnrolled && !isStaff && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <p className="font-semibold text-blue-950">{program.visibility === 'private' ? 'Request approval to join this program' : 'Join this program to begin'}</p>
              <p className="mt-1 text-sm text-blue-800">The lesson content and assessment become available after enrolment.</p>
              {program.visibility !== 'secret' && <button onClick={onEnrol} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Join Program</button>}
            </div>
          )}
          {canViewContent && program.sections.map(section => {
            const sectionSteps = orderedSteps.filter(step => step.sectionId === section.id);
            if (sectionSteps.length === 0) return null;
            return (
              <div key={section.id} className="space-y-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-950">{section.title}</h3>
                  {section.description && <p className="text-sm text-gray-500">{section.description}</p>}
                </div>
                {sectionSteps.map(step => {
                  const stepProgress = progress.find(item => item.stepId === step.id);
                  const done = stepProgress?.status === 'completed';
                  const unlocked = program.stepOrderMode === 'any_order'
                    || isLearningStepUnlocked(orderedSteps, progress, step);
                  if (!unlocked && !program.futureStepsVisible && !isStaff) return null;
                  return (
                    <article key={step.id} className={`rounded-2xl border p-4 ${unlocked ? 'border-gray-200' : 'border-gray-200 bg-gray-50/70'}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${stepTypeMeta[step.stepType].color}`}>{stepTypeMeta[step.stepType].icon}{stepTypeMeta[step.stepType].label}</span>
                          <h4 className="mt-2 text-lg font-semibold text-gray-950">{step.title}</h4>
                          {step.description && <p className="mt-1 text-sm text-gray-600">{step.description}</p>}
                        </div>
                        {done && (
                          <span className="inline-flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                            <CheckCircle className="h-4 w-4" />
                            Completed
                          </span>
                        )}
                      </div>
                      {!unlocked ? (
                        <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-600">
                          <Lock className="h-4 w-4" />
                          Complete the earlier required steps first.
                        </div>
                      ) : (
                        <>
                          <StepPreview step={step} compact={false} hideQuizQuestions={step.stepType === 'quiz'} />
                          {step.stepType === 'quiz' ? (
                            <QuizPlayer
                              step={step}
                              existingProgress={stepProgress}
                              unlocked={unlocked}
                              canInteract={canTrackProgress}
                              onSubmit={answers => onSubmitQuiz(program, step, answers)}
                            />
                          ) : canTrackProgress && !done ? (
                            <button
                              onClick={async () => {
                                try {
                                  await onMarkStepDone(program, step);
                                  toast.success('Step completed');
                                } catch (error) {
                                  toast.error(error instanceof Error ? error.message : 'Unable to complete this step');
                                }
                              }}
                              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Mark complete
                            </button>
                          ) : null}
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            );
          })}
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-950">Completion</h3>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progressSummary.percent}%` }} /></div>
            <p className="mt-2 text-sm text-gray-500">{progressSummary.completed} of {progressSummary.total} required steps complete</p>
          </div>
          {(aircraftFamily || contentVersion) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <h3 className="font-semibold">Operational source check</h3>
              {aircraftFamily && <p className="mt-2">Aircraft family: {aircraftFamily}</p>}
              {contentVersion && <p className="mt-1">Content version: {contentVersion}</p>}
              <p className="mt-2 leading-5">Always use the current flight manual, cockpit placards, aircraft checklist, club procedures and your instructor’s direction for the aircraft booked today.</p>
            </div>
          )}
          {isStaff && (
            <div className="rounded-2xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-950">Enrolments</h3>
              <div className="mt-3 space-y-2">
                {program.enrolments.map(enrolment => (
                  <div key={enrolment.id} className="rounded-lg bg-gray-50 p-3 text-sm">
                    <p className="font-semibold">{enrolment.invitedEmail || enrolment.userId || 'Participant'}</p>
                    <p className="text-xs text-gray-500">{enrolment.status} - {enrolment.paymentStatus}</p>
                    {enrolment.status === 'pending_approval' && <button onClick={() => onApproveEnrolment(enrolment.id)} className="mt-2 text-xs font-semibold text-blue-700">Approve</button>}
                  </div>
                ))}
                {program.enrolments.length === 0 && <p className="text-sm text-gray-500">No enrolments yet.</p>}
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};

const InfoCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-white/10 bg-white/10 p-3">
    <p className="text-xs uppercase tracking-wide text-blue-100">{label}</p>
    <p className="mt-1 font-bold text-white">{value}</p>
  </div>
);

const ProgramPreview = ({ program }: { program: LearningProgram }) => (
  <BuilderPanel title="Preview" description="Review how the program reads before you publish.">
    <ProgramViewer
      program={program}
      isStaff={false}
      isEnrolled
      progress={[]}
      progressSummary={{ completed: 0, total: program.steps.length, percent: 0 }}
      onEdit={() => undefined}
      onEnrol={() => undefined}
      onMarkStepDone={() => undefined}
      onSubmitQuiz={async (_program, step, answers) => gradeLearningQuiz(step.quizQuestions, answers, step.passingScorePercent || 80)}
      onApproveEnrolment={() => undefined}
    />
  </BuilderPanel>
);

const ContentBlockView = ({ block }: { block: LearningContentBlock }) => {
  if (block.type === 'divider') return <hr className="my-2 border-gray-200" />;
  if (block.type === 'button' || block.type === 'file') {
    return block.url ? (
      <a
        href={block.url}
        target={/^https?:/i.test(block.url) ? '_blank' : undefined}
        rel={/^https?:/i.test(block.url) ? 'noreferrer' : undefined}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700"
      >
        {block.label || block.title || 'Open resource'}
        <ExternalLink className="h-4 w-4" />
      </a>
    ) : null;
  }
  if (block.type === 'image' || block.type === 'gif') {
    return block.url ? <img src={block.url} alt={block.title || ''} className="max-h-[480px] w-auto rounded-xl object-contain" loading="lazy" /> : null;
  }
  if (block.type === 'audio') {
    return block.url ? <audio controls src={block.url} className="w-full">Your browser cannot play this audio.</audio> : null;
  }
  if (block.type === 'video') {
    return block.url ? <video controls src={block.url} className="w-full rounded-xl">Your browser cannot play this video.</video> : null;
  }
  if (block.type === 'table' && block.rows?.length) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${block.id}-${rowIndex}`} className="border-b border-gray-200">
                {row.map((cell, cellIndex) => <td key={`${block.id}-${rowIndex}-${cellIndex}`} className="px-2 py-2 align-top">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <p className="whitespace-pre-wrap leading-6 text-gray-700">{block.text || block.url || ''}</p>;
};

const StepPreview = ({
  step,
  compact = false,
  hideQuizQuestions = false,
}: {
  step: LearningStep;
  compact?: boolean;
  hideQuizQuestions?: boolean;
}) => (
  <div className={compact ? 'mt-4 space-y-3 text-sm' : 'space-y-3'}>
    {step.videoUrl && (
      <a href={step.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-purple-100 bg-purple-50 p-3 font-semibold text-purple-900">
        Open lesson video <ExternalLink className="h-4 w-4" />
      </a>
    )}
    {step.contentBlocks.slice(0, compact ? 3 : undefined).map(block => (
      <div key={block.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
        {block.title && <p className="font-semibold text-gray-900">{block.title}</p>}
        <div className={block.title ? 'mt-2' : ''}><ContentBlockView block={block} /></div>
      </div>
    ))}
    {!hideQuizQuestions && step.quizQuestions.slice(0, compact ? 3 : undefined).map(question => (
      <div key={question.id} className="rounded-xl border border-amber-100 bg-amber-50 p-3">
        <p className="font-semibold text-amber-950">{question.prompt}</p>
        {question.hint && <p className="mt-1 text-xs text-amber-700">Hint: {question.hint}</p>}
      </div>
    ))}
  </div>
);

const QuizPlayer = ({
  step,
  existingProgress,
  unlocked,
  canInteract,
  onSubmit,
}: {
  step: LearningStep;
  existingProgress?: LearningStepProgress;
  unlocked: boolean;
  canInteract: boolean;
  onSubmit: (answers: LearningQuizAnswers) => Promise<LearningQuizGrade>;
}) => {
  const [answers, setAnswers] = useState<LearningQuizAnswers>(
    (existingProgress?.quizAnswers || {}) as LearningQuizAnswers,
  );
  const [submitting, setSubmitting] = useState(false);
  const [grade, setGrade] = useState<LearningQuizGrade | null>(
    existingProgress?.quizScorePercent === null || existingProgress?.quizScorePercent === undefined
      ? null
      : {
        ...gradeLearningQuiz(step.quizQuestions, answers, step.passingScorePercent || 80),
        scorePercent: existingProgress.quizScorePercent,
        passed: existingProgress.status === 'completed',
      },
  );

  useEffect(() => {
    setAnswers((existingProgress?.quizAnswers || {}) as LearningQuizAnswers);
    setGrade(
      existingProgress?.quizScorePercent === null || existingProgress?.quizScorePercent === undefined
        ? null
        : {
          ...gradeLearningQuiz(step.quizQuestions, (existingProgress.quizAnswers || {}) as LearningQuizAnswers, step.passingScorePercent || 80),
          scorePercent: existingProgress.quizScorePercent,
          passed: existingProgress.status === 'completed',
        },
    );
  }, [existingProgress?.quizScorePercent, existingProgress?.status, step.id]);

  const setAnswer = (questionId: string, answer: string | number | string[]) => {
    setAnswers(current => ({ ...current, [questionId]: answer }));
    setGrade(null);
  };

  const submit = async () => {
    const unanswered = step.quizQuestions.find(question => !isQuestionAnswered(question, answers[question.id]));
    if (unanswered) {
      toast.error('Answer each required question before submitting.');
      return;
    }
    try {
      setSubmitting(true);
      const result = await onSubmit(answers);
      setGrade(result);
      if (result.passed) toast.success(`Quiz passed: ${result.scorePercent}%`);
      else toast.error(`Score ${result.scorePercent}%. Review the lesson and try again.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to submit this quiz');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {step.quizQuestions.map((question, questionIndex) => {
        const answer = answers[question.id];
        return (
          <fieldset key={question.id} className="rounded-xl border border-amber-100 bg-amber-50 p-4" disabled={!canInteract || !unlocked || submitting}>
            <legend className="px-1 font-semibold text-amber-950">{questionIndex + 1}. {question.prompt}</legend>
            {question.hint && <p className="mt-1 text-xs text-amber-800">Hint: {question.hint}</p>}
            {['single_choice', 'image_choice'].includes(question.type) && (
              <div className="mt-3 space-y-2">
                {(question.options || []).map(option => (
                  <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-white p-3 text-sm text-gray-800">
                    <input type="radio" name={question.id} value={option.id} checked={answer === option.id} onChange={() => setAnswer(question.id, option.id)} className="mt-0.5" />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            )}
            {question.type === 'multiple_choice' && (
              <div className="mt-3 space-y-2">
                {(question.options || []).map(option => {
                  const selected = Array.isArray(answer) && answer.includes(option.id);
                  return (
                    <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-white p-3 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        value={option.id}
                        checked={selected}
                        onChange={() => {
                          const current = Array.isArray(answer) ? answer : [];
                          setAnswer(question.id, selected ? current.filter(value => value !== option.id) : [...current, option.id]);
                        }}
                        className="mt-0.5"
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {['short_answer', 'long_answer', 'number'].includes(question.type) && (
              <input
                type={question.type === 'number' ? 'number' : 'text'}
                value={typeof answer === 'string' || typeof answer === 'number' ? answer : ''}
                onChange={event => setAnswer(question.id, question.type === 'number' ? Number(event.target.value) : event.target.value)}
                className="input mt-3 bg-white"
              />
            )}
          </fieldset>
        );
      })}
      {!canInteract && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Enrol in this program to submit the assessment and record your progress.
        </div>
      )}
      {grade && (
        <div role="status" className={`rounded-xl border p-4 ${grade.passed ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
          <p className="font-semibold">{grade.passed ? 'Assessment passed' : 'Review and try again'} — {grade.scorePercent}%</p>
          <p className="mt-1 text-sm">Passing score: {grade.passingScorePercent}%.</p>
        </div>
      )}
      {canInteract && (
        <button
          onClick={submit}
          disabled={!unlocked || submitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Checking answers...' : grade?.passed ? 'Submit again' : 'Submit assessment'}
        </button>
      )}
    </div>
  );
};
