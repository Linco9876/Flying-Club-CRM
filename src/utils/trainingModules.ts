import { TrainingLesson, TrainingModule, TrainingResource } from '../types';

export const cloneTrainingModule = (module: TrainingModule): TrainingModule => ({
  ...module,
  prerequisites: [...module.prerequisites],
  objectives: [...module.objectives],
  evaluationCriteria: [...module.evaluationCriteria],
  tags: [...module.tags],
  lessons: module.lessons.map((lesson: TrainingLesson) => ({
    ...lesson,
    keyExercises: [...lesson.keyExercises]
  })),
  resources: module.resources.map((resource: TrainingResource) => ({ ...resource })),
  lastUpdated: new Date(module.lastUpdated)
});
