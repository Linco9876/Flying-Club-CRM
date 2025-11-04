import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Copy,
  FilePlus,
  Plus,
  Search,
  Target,
  Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { mockSyllabusSequences } from '../../data/mockData';
import {
  SyllabusSequence,
  TrainingLesson,
  TrainingModule,
  TrainingResource
} from '../../types';
import { useTrainingModules } from '../../context/TrainingModulesContext';

const createLessonFromSequence = (sequence: SyllabusSequence): TrainingLesson => ({
  id: `lesson-${sequence.id}-${Date.now()}`,
  sequenceId: sequence.id,
  sequenceCode: sequence.code,
  sequenceTitle: sequence.title,
  stage: sequence.group === 'Pre-Solo' ? 'flight' : 'ground',
  durationMinutes: sequence.group === 'Navigation' ? 120 : 60,
  minCompetency: 'Introduce',
  keyExercises: [`Introduce ${sequence.title.toLowerCase()}`],
  studentPreparation: 'Review relevant handbook sections and prepare briefing notes.',
  instructorNotes: 'Capture any student risks or adaptations discussed during pre-brief.',
  name: sequence.title,
  objective: `Outline objectives for ${sequence.title.toLowerCase()}.`,
  flightExercises: 'Describe the flight exercises to be covered during delivery.',
  theory: 'Summarise the theory topics or references for this lesson.',
  assessmentCriteria: []
});

export const TrainingModuleBuilder: React.FC = () => {
  const {
    modules,
    createBlankModule,
    duplicateModule: duplicateTrainingModule,
    updateModule: updateTrainingModule,
    deleteModule: deleteTrainingModule
  } = useTrainingModules();
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    () => modules[0]?.id ?? null
  );
  const [sequenceSearch, setSequenceSearch] = useState('');
  const [newTag, setNewTag] = useState('');

  const selectedModule = modules.find((module) => module.id === selectedModuleId) ?? null;

  useEffect(() => {
    if (modules.length === 0) {
      setSelectedModuleId(null);
      return;
    }

    if (!selectedModuleId || !modules.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(modules[0].id);
    }
  }, [modules, selectedModuleId]);

  const sequencesByGroup = useMemo(() => {
    const groups: Record<string, SyllabusSequence[]> = {};
    const term = sequenceSearch.trim().toLowerCase();

    mockSyllabusSequences
      .filter((sequence) => {
        if (!term) return true;
        return (
          sequence.title.toLowerCase().includes(term) ||
          sequence.code.toLowerCase().includes(term) ||
          sequence.group.toLowerCase().includes(term)
        );
      })
      .forEach((sequence) => {
        if (!groups[sequence.group]) {
          groups[sequence.group] = [];
        }
        groups[sequence.group].push(sequence);
      });

    Object.keys(groups).forEach((group) => {
      groups[group] = groups[group].sort((a, b) => a.order - b.order);
    });

    return groups;
  }, [sequenceSearch]);

  const totalLessonDuration = useMemo(() => {
    if (!selectedModule) return 0;
    return selectedModule.lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
  }, [selectedModule]);

  const handleSelectModule = (moduleId: string) => {
    setSelectedModuleId(moduleId);
  };

  const updateModule = (moduleId: string, updater: (module: TrainingModule) => TrainingModule) => {
    updateTrainingModule(moduleId, updater);
  };

  const handleCreateModule = () => {
    const module = createBlankModule();
    setSelectedModuleId(module.id);
    toast.success('New module created');
  };

  const handleDuplicateModule = (module: TrainingModule) => {
    const duplicate = duplicateTrainingModule(module.id, {
      title: `${module.title} (Copy)`,
      status: 'draft',
      version: `${module.version}-draft`
    });

    if (duplicate) {
      setSelectedModuleId(duplicate.id);
      toast.success('Module duplicated as draft');
    } else {
      toast.error('Unable to duplicate module');
    }
  };

  const handleDeleteModule = (moduleId: string) => {
    deleteTrainingModule(moduleId);
    toast.success('Module removed');
  };

  const handleStatusToggle = (module: TrainingModule) => {
    updateModule(module.id, (current) => ({
      ...current,
      status: current.status === 'draft' ? 'published' : 'draft'
    }));
    toast.success(
      module.status === 'draft' ? 'Module published for instructors' : 'Module returned to draft'
    );
  };

  const handleModuleFieldChange = <K extends keyof TrainingModule>(
    field: K,
    value: TrainingModule[K]
  ) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleListItemChange = (
    field: 'objectives' | 'evaluationCriteria' | 'prerequisites',
    index: number,
    value: string
  ) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => {
      const next = [...current[field]];
      next[index] = value;
      return {
        ...current,
        [field]: next
      };
    });
  };

  const handleAddListItem = (
    field: 'objectives' | 'evaluationCriteria' | 'prerequisites',
    defaultValue: string
  ) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      [field]: [...current[field], defaultValue]
    }));
  };

  const handleRemoveListItem = (
    field: 'objectives' | 'evaluationCriteria' | 'prerequisites',
    index: number
  ) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      [field]: current[field].filter((_, idx) => idx !== index)
    }));
  };

  const handleAddTag = () => {
    if (!selectedModule || !newTag.trim()) return;
    const tagToAdd = newTag.trim();
    if (selectedModule.tags.includes(tagToAdd)) {
      toast.error('Tag already added to module');
      return;
    }

    updateModule(selectedModule.id, (current) => ({
      ...current,
      tags: [...current.tags, tagToAdd]
    }));
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      tags: current.tags.filter((existing) => existing !== tag)
    }));
  };

  const handleResourceChange = <K extends keyof TrainingResource>(
    resourceId: string,
    field: K,
    value: TrainingResource[K]
  ) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      resources: current.resources.map((resource) =>
        resource.id === resourceId ? { ...resource, [field]: value } : resource
      )
    }));
  };

  const handleAddResource = () => {
    if (!selectedModule) return;
    const resource: TrainingResource = {
      id: `resource-${Date.now()}`,
      type: 'document',
      title: 'New resource',
      notes: ''
    };
    updateModule(selectedModule.id, (current) => ({
      ...current,
      resources: [...current.resources, resource]
    }));
  };

  const handleRemoveResource = (resourceId: string) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      resources: current.resources.filter((resource) => resource.id !== resourceId)
    }));
  };

  const handleLessonFieldChange = <K extends keyof TrainingLesson>(
    lessonId: string,
    field: K,
    value: TrainingLesson[K]
  ) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: current.lessons.map((lesson) =>
        lesson.id === lessonId ? { ...lesson, [field]: value } : lesson
      )
    }));
  };

  const handleKeyExerciseChange = (lessonId: string, index: number, value: string) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: current.lessons.map((lesson) => {
        if (lesson.id !== lessonId) return lesson;
        const exercises = [...lesson.keyExercises];
        exercises[index] = value;
        return { ...lesson, keyExercises: exercises };
      })
    }));
  };

  const handleAddKeyExercise = (lessonId: string) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: current.lessons.map((lesson) =>
        lesson.id === lessonId
          ? {
              ...lesson,
              keyExercises: [...lesson.keyExercises, 'Add specific exercise focus']
            }
          : lesson
      )
    }));
  };

  const handleRemoveKeyExercise = (lessonId: string, index: number) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: current.lessons.map((lesson) =>
        lesson.id === lessonId
          ? {
              ...lesson,
              keyExercises: lesson.keyExercises.filter((_, idx) => idx !== index)
            }
          : lesson
      )
    }));
  };

  const handleRemoveLesson = (lessonId: string) => {
    if (!selectedModule) return;
    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: current.lessons.filter((lesson) => lesson.id !== lessonId)
    }));
  };

  const handleAddSequenceToModule = (sequence: SyllabusSequence) => {
    if (!selectedModule) return;
    if (selectedModule.lessons.some((lesson) => lesson.sequenceId === sequence.id)) {
      toast.error('Sequence already added to this module');
      return;
    }

    const newLesson = createLessonFromSequence(sequence);
    updateModule(selectedModule.id, (current) => ({
      ...current,
      lessons: [...current.lessons, newLesson]
    }));
    toast.success(`${sequence.title} added to module`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Training Module Builder</h1>
          <p className="mt-1 text-sm text-gray-600">
            Curate lesson plans, resources and assessment points for each training syllabus.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleCreateModule}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <Plus className="h-4 w-4" />
            New module
          </button>
          {selectedModule && (
            <button
              onClick={() => handleDuplicateModule(selectedModule)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Copy className="h-4 w-4" />
              Duplicate
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Modules</h2>
            </div>
            <div className="max-h-[600px] space-y-3 overflow-y-auto p-4">
              {modules.map((module) => {
                const isActive = module.id === selectedModuleId;
                return (
                  <button
                    key={module.id}
                    onClick={() => handleSelectModule(module.id)}
                    className={`w-full rounded-xl border p-4 text-left transition-all ${
                      isActive
                        ? 'border-blue-200 bg-blue-50 shadow-sm'
                        : 'border-transparent bg-gray-50 hover:border-blue-200 hover:bg-blue-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-900">{module.title}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          module.status === 'published'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {module.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-600 line-clamp-2">{module.description}</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {module.estimatedDurationHours} hrs
                      </span>
                      <span>
                        {formatDistanceToNow(new Date(module.lastUpdated), { addSuffix: true })}
                      </span>
                    </div>
                  </button>
                );
              })}
              {modules.length === 0 && (
                <p className="text-sm text-gray-500">No modules created yet.</p>
              )}
            </div>
          </div>
        </aside>

        <section className="space-y-6">
          {!selectedModule ? (
            <div className="flex h-full min-h-[480px] items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white">
              <div className="text-center">
                <BookOpenCheck className="mx-auto h-10 w-10 text-gray-400" />
                <h3 className="mt-4 text-base font-semibold text-gray-900">Select or create a module</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Choose an existing module from the list or build a new syllabus from scratch.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Module overview</h2>
                      <p className="text-xs text-gray-500">
                        Last updated {formatDistanceToNow(new Date(selectedModule.lastUpdated))} ·
                        Total lesson time {(totalLessonDuration / 60).toFixed(1)} hrs
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleStatusToggle(selectedModule)}
                        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          selectedModule.status === 'published'
                            ? 'bg-green-50 text-green-700 hover:bg-green-100'
                            : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {selectedModule.status === 'published' ? 'Published' : 'Draft'}
                      </button>
                      <button
                        onClick={() => handleDuplicateModule(selectedModule)}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Copy className="h-4 w-4" />
                        Clone
                      </button>
                      <button
                        onClick={() => handleDeleteModule(selectedModule.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-6 px-6 py-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Module title</label>
                      <input
                        value={selectedModule.title}
                        onChange={(event) => handleModuleFieldChange('title', event.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Category</label>
                        <input
                          value={selectedModule.category}
                          onChange={(event) => handleModuleFieldChange('category', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Version</label>
                        <input
                          value={selectedModule.version}
                          onChange={(event) => handleModuleFieldChange('version', event.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Est. duration (hrs)</label>
                        <input
                          type="number"
                          min={0}
                          value={selectedModule.estimatedDurationHours}
                          onChange={(event) =>
                            handleModuleFieldChange(
                              'estimatedDurationHours',
                              Number(event.target.value)
                            )
                          }
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Module description</label>
                    <textarea
                      value={selectedModule.description}
                      onChange={(event) => handleModuleFieldChange('description', event.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700">Module tags</label>
                      <div className="flex items-center gap-2">
                        <input
                          value={newTag}
                          onChange={(event) => setNewTag(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              handleAddTag();
                            }
                          }}
                          placeholder="Add tag"
                          className="w-32 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                          onClick={handleAddTag}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedModule.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                        >
                          #{tag}
                          <button
                            onClick={() => handleRemoveTag(tag)}
                            className="ml-1 rounded-full bg-white/60 p-0.5 text-blue-600 hover:bg-white"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {selectedModule.tags.length === 0 && (
                        <p className="text-xs text-gray-500">Tags help instructors find relevant material.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-6">
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h3 className="text-base font-semibold text-gray-900">Learning objectives</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Outline the measurable skills and knowledge learners should demonstrate.
                    </p>
                    <div className="mt-4 space-y-3">
                      {selectedModule.objectives.map((objective, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <div className="mt-2">
                            <Target className="h-4 w-4 text-blue-500" />
                          </div>
                          <div className="flex-1">
                            <textarea
                              value={objective}
                              onChange={(event) =>
                                handleListItemChange('objectives', index, event.target.value)
                              }
                              rows={2}
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveListItem('objectives', index)}
                            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          handleAddListItem('objectives', 'Describe the targeted proficiency outcome')
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add objective
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h3 className="text-base font-semibold text-gray-900">Evaluation checkpoints</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Define how competence is assessed and recorded for the module.
                    </p>
                    <div className="mt-4 space-y-3">
                      {selectedModule.evaluationCriteria.map((criteria, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <div className="mt-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          </div>
                          <div className="flex-1">
                            <textarea
                              value={criteria}
                              onChange={(event) =>
                                handleListItemChange('evaluationCriteria', index, event.target.value)
                              }
                              rows={2}
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveListItem('evaluationCriteria', index)}
                            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          handleAddListItem('evaluationCriteria', 'Capture the assessment criteria and evidence required')
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add checkpoint
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h3 className="text-base font-semibold text-gray-900">Prerequisites</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Capture membership, prior training or documentation requirements.
                    </p>
                    <div className="mt-4 space-y-3">
                      {selectedModule.prerequisites.map((prerequisite, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <div className="mt-2">
                            <FilePlus className="h-4 w-4 text-amber-500" />
                          </div>
                          <div className="flex-1">
                            <textarea
                              value={prerequisite}
                              onChange={(event) =>
                                handleListItemChange('prerequisites', index, event.target.value)
                              }
                              rows={2}
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveListItem('prerequisites', index)}
                            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          handleAddListItem('prerequisites', 'Document evidence required before commencement')
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add prerequisite
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-gray-900">Reference resources</h3>
                      <button
                        onClick={handleAddResource}
                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add resource
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Attach documents, videos or checklists that support the lesson plan.
                    </p>
                    <div className="mt-4 space-y-4">
                      {selectedModule.resources.map((resource) => (
                        <div
                          key={resource.id}
                          className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                        >
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-gray-600">Title</label>
                              <input
                                value={resource.title}
                                onChange={(event) =>
                                  handleResourceChange(resource.id, 'title', event.target.value)
                                }
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-gray-600">Type</label>
                              <select
                                value={resource.type}
                                onChange={(event) =>
                                  handleResourceChange(
                                    resource.id,
                                    'type',
                                    event.target.value as TrainingResource['type']
                                  )
                                }
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                              >
                                <option value="document">Document</option>
                                <option value="video">Video</option>
                                <option value="link">Link</option>
                                <option value="checklist">Checklist</option>
                              </select>
                            </div>
                            <div className="md:col-span-2 space-y-2">
                              <label className="text-xs font-medium text-gray-600">URL (optional)</label>
                              <input
                                value={resource.url ?? ''}
                                onChange={(event) =>
                                  handleResourceChange(resource.id, 'url', event.target.value)
                                }
                                placeholder="https://"
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                              />
                            </div>
                            <div className="md:col-span-2 space-y-2">
                              <label className="text-xs font-medium text-gray-600">Notes</label>
                              <textarea
                                value={resource.notes ?? ''}
                                onChange={(event) =>
                                  handleResourceChange(resource.id, 'notes', event.target.value)
                                }
                                rows={2}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                              />
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end">
                            <button
                              onClick={() => handleRemoveResource(resource.id)}
                              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                      {selectedModule.resources.length === 0 && (
                        <p className="text-xs text-gray-500">
                          Attach references to standardise delivery across instructors.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Lesson flow</h3>
                    <p className="text-xs text-gray-500">
                      Align sequences with lesson delivery, preparation tasks and instructor notes.
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    {(totalLessonDuration / 60).toFixed(1)} hrs scheduled
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {selectedModule.lessons.map((lesson) => (
                    <div key={lesson.id} className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">
                            {lesson.sequenceCode} · {lesson.sequenceTitle}
                          </h4>
                          <p className="text-xs text-gray-500">Sequence ID: {lesson.sequenceId}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={lesson.stage}
                            onChange={(event) =>
                              handleLessonFieldChange(
                                lesson.id,
                                'stage',
                                event.target.value as TrainingLesson['stage']
                              )
                            }
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="ground">Ground</option>
                            <option value="flight">Flight</option>
                            <option value="simulator">Simulator</option>
                          </select>
                          <input
                            type="number"
                            min={15}
                            step={15}
                            value={lesson.durationMinutes}
                            onChange={(event) =>
                              handleLessonFieldChange(
                                lesson.id,
                                'durationMinutes',
                                Number(event.target.value)
                              )
                            }
                            className="w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <select
                            value={lesson.minCompetency}
                            onChange={(event) =>
                              handleLessonFieldChange(
                                lesson.id,
                                'minCompetency',
                                event.target.value as TrainingLesson['minCompetency']
                              )
                            }
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            <option value="Introduce">Introduce</option>
                            <option value="Practice">Practice</option>
                            <option value="Assess">Assess</option>
                          </select>
                          <button
                            onClick={() => handleRemoveLesson(lesson.id)}
                            className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3">
                          <label className="text-xs font-medium text-gray-600">Key exercises</label>
                          <div className="space-y-2">
                            {lesson.keyExercises.map((exercise, index) => (
                              <div key={index} className="flex items-start gap-2">
                                <textarea
                                  value={exercise}
                                  onChange={(event) =>
                                    handleKeyExerciseChange(lesson.id, index, event.target.value)
                                  }
                                  rows={2}
                                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />
                                <button
                                  onClick={() => handleRemoveKeyExercise(lesson.id, index)}
                                  className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => handleAddKeyExercise(lesson.id)}
                              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              <Plus className="h-4 w-4" />
                              Add exercise
                            </button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <label className="text-xs font-medium text-gray-600">Student preparation</label>
                          <textarea
                            value={lesson.studentPreparation}
                            onChange={(event) =>
                              handleLessonFieldChange(
                                lesson.id,
                                'studentPreparation',
                                event.target.value
                              )
                            }
                            rows={3}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <label className="text-xs font-medium text-gray-600">Instructor notes</label>
                          <textarea
                            value={lesson.instructorNotes}
                            onChange={(event) =>
                              handleLessonFieldChange(
                                lesson.id,
                                'instructorNotes',
                                event.target.value
                              )
                            }
                            rows={3}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {selectedModule.lessons.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
                      No lessons configured yet. Add sequences from the library to build out the lesson flow.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Sequence library</h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  value={sequenceSearch}
                  onChange={(event) => setSequenceSearch(event.target.value)}
                  placeholder="Search sequences"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 pl-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="max-h-[600px] space-y-4 overflow-y-auto pr-1">
                {Object.entries(sequencesByGroup).map(([group, sequences]) => (
                  <div key={group} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {group}
                      </h3>
                      <span className="text-xs text-gray-400">{sequences.length} sequences</span>
                    </div>
                    <div className="space-y-2">
                      {sequences.map((sequence) => {
                        const isAdded = selectedModule?.lessons.some(
                          (lesson) => lesson.sequenceId === sequence.id
                        );
                        return (
                          <div
                            key={sequence.id}
                            className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">
                                  {sequence.code} · {sequence.title}
                                </p>
                                <p className="text-xs text-gray-500">#{sequence.id}</p>
                              </div>
                              <button
                                onClick={() => handleAddSequenceToModule(sequence)}
                                disabled={isAdded || !selectedModule}
                                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                                  isAdded
                                    ? 'cursor-not-allowed border border-green-200 bg-green-50 text-green-600'
                                    : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                                }`}
                              >
                                {isAdded ? 'Added' : (
                                  <>
                                    <Plus className="h-3.5 w-3.5" /> Add
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {Object.keys(sequencesByGroup).length === 0 && (
                  <p className="text-sm text-gray-500">
                    No sequences match your search. Try a different keyword.
                  </p>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default TrainingModuleBuilder;

