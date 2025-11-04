import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  BookOpenCheck,
  ClipboardList,
  Clock3,
  FilePlus,
  Layers,
  Plus,
  Search,
  Tag
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  LessonAssessmentCriterion,
  LessonGradingSystem,
  TrainingLesson,
  TrainingModule
} from '../../types';
import { useTrainingModules } from '../../context/TrainingModulesContext';

interface NewCourseState {
  title: string;
  category: string;
  description: string;
  estimatedDurationHours: number;
  tags: string;
}

interface NewLessonState {
  name: string;
  objective: string;
  flightExercises: string;
  theory: string;
}

type EditableCriterion = {
  id: string;
  name: string;
  gradingSystem: LessonGradingSystem;
  passingGrade: string;
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
  content
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

export const TrainingCourseCatalog: React.FC = () => {
  const { modules, addModule, updateModule } = useTrainingModules();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(() => modules[0]?.id ?? null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourse, setNewCourse] = useState<NewCourseState>({
    title: '',
    category: '',
    description: '',
    estimatedDurationHours: 6,
    tags: ''
  });
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [newLesson, setNewLesson] = useState<NewLessonState>({
    name: '',
    objective: '',
    flightExercises: '',
    theory: ''
  });
  const [lessonCriteria, setLessonCriteria] = useState<EditableCriterion[]>([createEmptyCriterion()]);

  useEffect(() => {
    if (modules.length === 0) {
      setSelectedModuleId(null);
      setShowLessonForm(false);
      setNewLesson({ name: '', objective: '', flightExercises: '', theory: '' });
      setLessonCriteria([createEmptyCriterion()]);
      return;
    }

    if (!selectedModuleId || !modules.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(modules[0].id);
      setShowLessonForm(false);
      setNewLesson({ name: '', objective: '', flightExercises: '', theory: '' });
      setLessonCriteria([createEmptyCriterion()]);
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

  const resetLessonForm = () => {
    setNewLesson({ name: '', objective: '', flightExercises: '', theory: '' });
    setLessonCriteria([createEmptyCriterion()]);
  };

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModuleId(moduleId);
    setShowLessonForm(false);
    resetLessonForm();
  };

  const handleCreateCourse = () => {
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

    const module: TrainingModule = {
      id: `module-${Date.now()}`,
      title,
      description: description || 'Add a course overview for instructors and students.',
      category: category || 'Custom',
      version: '1.0',
      status: 'draft',
      estimatedDurationHours: Math.max(1, Number(newCourse.estimatedDurationHours) || 1),
      prerequisites: [],
      objectives: [],
      evaluationCriteria: [],
      tags: tags.length > 0 ? tags : ['draft'],
      lessons: [],
      resources: [],
      lastUpdated: new Date()
    };

    const createdModule = addModule(module);
    setSelectedModuleId(createdModule.id);
    setShowCreateForm(false);
    setNewCourse({ title: '', category: '', description: '', estimatedDurationHours: 6, tags: '' });
    toast.success('New course created');
  };

  const handleCancelCreate = () => {
    setShowCreateForm(false);
    setNewCourse({ title: '', category: '', description: '', estimatedDurationHours: 6, tags: '' });
  };

  const handleOpenLessonForm = () => {
    if (!selectedModule) {
      toast.error('Please select a course first');
      return;
    }
    resetLessonForm();
    setShowLessonForm(true);
  };

  const handleCancelLesson = () => {
    setShowLessonForm(false);
    resetLessonForm();
  };

  const handleCriterionChange = <K extends keyof EditableCriterion>(
    criterionId: string,
    field: K,
    value: EditableCriterion[K]
  ) => {
    setLessonCriteria((prev) =>
      prev.map((criterion) => {
        if (criterion.id !== criterionId) {
          return criterion;
        }

        if (field === 'gradingSystem') {
          const gradingSystem = value as LessonGradingSystem;
          return {
            ...criterion,
            gradingSystem,
            passingGrade: getDefaultPassingGrade(gradingSystem)
          };
        }

        return { ...criterion, [field]: value };
      })
    );
  };

  const handleAddCriterion = () => {
    setLessonCriteria((prev) => [...prev, createEmptyCriterion()]);
  };

  const handleRemoveCriterion = (criterionId: string) => {
    setLessonCriteria((prev) => {
      const remaining = prev.filter((criterion) => criterion.id !== criterionId);
      return remaining.length > 0 ? remaining : [createEmptyCriterion()];
    });
  };

  const handleCreateLesson = () => {
    if (!selectedModule) {
      toast.error('Please select a course first');
      return;
    }

    const name = newLesson.name.trim();
    const objective = newLesson.objective.trim();
    const flightExercises = newLesson.flightExercises.trim();
    const theory = newLesson.theory.trim();

    if (!name) {
      toast.error('Please provide a lesson name');
      return;
    }

    if (!objective) {
      toast.error('Please provide a lesson objective');
      return;
    }

    if (!flightExercises) {
      toast.error('Please outline the flight exercises for this lesson');
      return;
    }

    if (!theory) {
      toast.error('Please describe the supporting theory content');
      return;
    }

    const criteria: LessonAssessmentCriterion[] = [];
    for (const criterion of lessonCriteria) {
      const trimmedName = criterion.name.trim();
      const trimmedGrade = criterion.passingGrade.trim();

      if (!trimmedName && !trimmedGrade) {
        continue;
      }

      if (!trimmedName) {
        toast.error('Please provide a name for each assessment criterion or remove it.');
        return;
      }

      const passingGrade = trimmedGrade || getDefaultPassingGrade(criterion.gradingSystem);

      if (criterion.gradingSystem === 'Out of 100') {
        const numericGrade = Number(passingGrade);
        if (Number.isNaN(numericGrade) || numericGrade < 0 || numericGrade > 100) {
          toast.error('Numeric criteria require a passing grade between 0 and 100.');
          return;
        }
      }

      criteria.push({
        id: criterion.id,
        name: trimmedName,
        gradingSystem: criterion.gradingSystem,
        passingGrade
      });
    }

    const timestamp = Date.now();
    const sequenceIndex = selectedModule.lessons.length + 1;
    const sequenceId = `custom-${timestamp}`;
    const sequenceCode = `CUST-${sequenceIndex.toString().padStart(2, '0')}`;

    const lesson: TrainingLesson = {
      id: `lesson-${timestamp}`,
      sequenceId,
      sequenceCode,
      sequenceTitle: name,
      stage: 'flight',
      durationMinutes: 60,
      minCompetency: 'Introduce',
      keyExercises: normaliseKeyExercises(flightExercises),
      studentPreparation: theory,
      instructorNotes: flightExercises,
      name,
      objective,
      flightExercises,
      theory,
      assessmentCriteria: criteria
    };

    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: [...current.lessons, lesson]
    }));

    toast.success('Lesson added to course');
    setShowLessonForm(false);
    resetLessonForm();
  };

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
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleCancelCreate}
              className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-medium text-blue-900 transition hover:bg-blue-100"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateCourse}
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create course
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
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <BookOpenCheck className="h-5 w-5 text-blue-600" />
                      <h2 className="text-xl font-semibold text-gray-900">{selectedModule.title}</h2>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">{selectedModule.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        selectedModule.status === 'published'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {selectedModule.status === 'published' ? 'Published' : 'Draft'}
                    </span>
                    <button
                      onClick={handleOpenLessonForm}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                    >
                      <FilePlus className="h-4 w-4" />
                      New lesson
                    </button>
                  </div>
                </div>
                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Category</dt>
                    <dd className="mt-1 text-sm text-gray-700">{selectedModule.category}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Version</dt>
                    <dd className="mt-1 text-sm text-gray-700">{selectedModule.version}</dd>
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
                </dl>
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

              {showLessonForm && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-blue-900">
                    <div className="flex items-center gap-2">
                      <FilePlus className="h-5 w-5" />
                      <h3 className="text-lg font-semibold">Create new lesson</h3>
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
                    <label className="flex flex-col text-sm font-medium text-blue-900 md:col-span-2">
                      Flight exercises
                      <textarea
                        value={newLesson.flightExercises}
                        onChange={(event) => setNewLesson((prev) => ({ ...prev, flightExercises: event.target.value }))}
                        rows={4}
                        placeholder="Use bullet points or paragraphs to describe each flight exercise."
                        className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <label className="flex flex-col text-sm font-medium text-blue-900 md:col-span-2">
                      Theory focus
                      <textarea
                        value={newLesson.theory}
                        onChange={(event) => setNewLesson((prev) => ({ ...prev, theory: event.target.value }))}
                        rows={4}
                        placeholder="Summarise the key theory discussion points, references or briefing sequence."
                        className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                  </div>
                  <div className="mt-6 rounded-lg border border-blue-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-blue-900">
                        <ClipboardList className="h-5 w-5" />
                        <h4 className="text-sm font-semibold">Assessment criteria</h4>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddCriterion}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                      >
                        <Plus className="h-4 w-4" />
                        Add criterion
                      </button>
                    </div>
                    <div className="mt-4 space-y-4">
                      {lessonCriteria.map((criterion) => (
                        <div
                          key={criterion.id}
                          className="rounded-lg border border-blue-100 bg-blue-50 p-4 shadow-sm"
                        >
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px_140px]">
                            <label className="flex flex-col text-xs font-semibold text-blue-900">
                              Criterion name
                              <input
                                type="text"
                                value={criterion.name}
                                onChange={(event) =>
                                  handleCriterionChange(criterion.id, 'name', event.target.value)
                                }
                                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </label>
                            <label className="flex flex-col text-xs font-semibold text-blue-900">
                              Grading system
                              <select
                                value={criterion.gradingSystem}
                                onChange={(event) =>
                                  handleCriterionChange(
                                    criterion.id,
                                    'gradingSystem',
                                    event.target.value as LessonGradingSystem
                                  )
                                }
                                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              >
                                {gradingOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col text-xs font-semibold text-blue-900">
                              Passing grade
                              <input
                                type={criterion.gradingSystem === 'Out of 100' ? 'number' : 'text'}
                                min={criterion.gradingSystem === 'Out of 100' ? 0 : undefined}
                                max={criterion.gradingSystem === 'Out of 100' ? 100 : undefined}
                                value={criterion.passingGrade}
                                onChange={(event) =>
                                  handleCriterionChange(criterion.id, 'passingGrade', event.target.value)
                                }
                                className="mt-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </label>
                          </div>
                          {lessonCriteria.length > 1 && (
                            <div className="mt-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveCriterion(criterion.id)}
                                className="text-xs font-medium text-red-600 underline-offset-2 hover:underline"
                              >
                                Remove criterion
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
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
                      <FilePlus className="mr-2 h-4 w-4" />
                      Save lesson
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-gray-900">
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                  <h3 className="text-lg font-semibold">Lesson library</h3>
                </div>
                {selectedModule.lessons.length === 0 ? (
                  <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                    No lessons recorded yet. Use the “New lesson” button to start building this course.
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {selectedModule.lessons.map((lesson) => (
                      <article
                        key={lesson.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-5 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h4 className="text-base font-semibold text-gray-900">
                              {lesson.name || lesson.sequenceTitle}
                            </h4>
                            <p className="mt-1 text-sm text-gray-600">
                              {lesson.objective || 'Document the lesson objective for instructors.'}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-1">
                              <Layers className="h-3.5 w-3.5" />
                              {lesson.sequenceCode}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {lesson.durationMinutes} min
                            </span>
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 capitalize">
                              {lesson.stage}
                            </span>
                            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                              Min competency: {lesson.minCompetency}
                            </span>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div>
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Flight exercises
                            </h5>
                            <div className="mt-2 rounded-md border border-blue-100 bg-white p-3 text-sm text-gray-700 whitespace-pre-line">
                              {lesson.flightExercises || 'Describe the flight exercises to be flown.'}
                            </div>
                          </div>
                          <div>
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Theory focus
                            </h5>
                            <div className="mt-2 rounded-md border border-indigo-100 bg-white p-3 text-sm text-gray-700 whitespace-pre-line">
                              {lesson.theory || 'Outline the theory elements that support this lesson.'}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4">
                          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Assessment criteria
                          </h5>
                          {lesson.assessmentCriteria.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {lesson.assessmentCriteria.map((criterion) => (
                                <div
                                  key={criterion.id}
                                  className="rounded-md border border-gray-200 bg-white p-3 text-sm"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium text-gray-900">{criterion.name}</span>
                                    <span className="text-xs text-gray-500">{criterion.gradingSystem}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-gray-500">
                                    Passing grade:{' '}
                                    <span className="font-medium text-gray-700">{criterion.passingGrade}</span>
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-gray-500">
                              No assessment criteria recorded for this lesson yet.
                            </p>
                          )}
                        </div>
                      </article>
                    ))}
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
