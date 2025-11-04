import React, { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Layers,
  Plus,
  Search,
  Tag
} from 'lucide-react';
import toast from 'react-hot-toast';
import { mockTrainingModules } from '../../data/mockData';
import { TrainingModule } from '../../types';
import { cloneTrainingModule } from '../../utils/trainingModules';

interface NewCourseState {
  title: string;
  category: string;
  description: string;
  estimatedDurationHours: number;
  tags: string;
}

export const TrainingCourseCatalog: React.FC = () => {
  const initialModules = useMemo(
    () => mockTrainingModules.map((module) => cloneTrainingModule(module)),
    []
  );
  const [modules, setModules] = useState<TrainingModule[]>(initialModules);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    initialModules[0]?.id ?? null
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourse, setNewCourse] = useState<NewCourseState>({
    title: '',
    category: '',
    description: '',
    estimatedDurationHours: 6,
    tags: ''
  });

  const filteredModules = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const sorted = [...modules].sort(
      (a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()
    );

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

  const handleModuleSelect = (moduleId: string) => {
    setSelectedModuleId(moduleId);
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

    setModules((prev) => [module, ...prev]);
    setSelectedModuleId(module.id);
    setShowCreateForm(false);
    setNewCourse({ title: '', category: '', description: '', estimatedDurationHours: 6, tags: '' });
    toast.success('New course created');
  };

  const handleCancelCreate = () => {
    setShowCreateForm(false);
    setNewCourse({ title: '', category: '', description: '', estimatedDurationHours: 6, tags: '' });
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

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
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
                        <span key={tag} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
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
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {selectedModule ? (
              <>
                <div className="flex items-center gap-2">
                  <BookOpenCheck className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Course snapshot</h2>
                </div>
                <p className="mt-2 text-sm text-gray-600">{selectedModule.description}</p>
                <dl className="mt-4 space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-gray-500">Category</dt>
                    <dd>{selectedModule.category}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-gray-500">Version</dt>
                    <dd>{selectedModule.version}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-gray-500">Estimated duration</dt>
                    <dd className="inline-flex items-center gap-1">
                      <Clock3 className="h-4 w-4 text-gray-400" />
                      {selectedModule.estimatedDurationHours} hours
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-gray-500">Lesson count</dt>
                    <dd>{selectedModule.lessons.length}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="font-medium text-gray-500">Resources</dt>
                    <dd>{selectedModule.resources.length}</dd>
                  </div>
                </dl>
                <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Next steps
                  </div>
                  <p className="mt-2 text-sm">
                    Use the syllabus management area to flesh out lesson objectives, attach resources and publish when ready.
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-gray-500">
                <BookOpenCheck className="h-10 w-10 text-gray-300" />
                <p>Select a course to view its details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
