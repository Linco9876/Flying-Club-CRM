import React, { createContext, useContext, useMemo, useState } from 'react';
import { mockTrainingModules } from '../data/mockData';
import { TrainingModule } from '../types';
import { cloneTrainingModule } from '../utils/trainingModules';

type TrainingModulesContextValue = {
  modules: TrainingModule[];
  addModule: (module: TrainingModule) => TrainingModule;
  createBlankModule: () => TrainingModule;
  duplicateModule: (moduleId: string, overrides?: Partial<TrainingModule>) => TrainingModule | null;
  updateModule: (moduleId: string, updater: (module: TrainingModule) => TrainingModule) => void;
  deleteModule: (moduleId: string) => void;
};

const TrainingModulesContext = createContext<TrainingModulesContextValue | undefined>(undefined);

const normaliseModule = (module: TrainingModule): TrainingModule =>
  cloneTrainingModule({
    ...module,
    id: module.id || `module-${Date.now()}`,
    lastUpdated: module.lastUpdated ? new Date(module.lastUpdated) : new Date(),
  });

export const TrainingModulesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modules, setModules] = useState<TrainingModule[]>(() =>
    mockTrainingModules.map((module) => cloneTrainingModule(module))
  );

  const addModule = (module: TrainingModule) => {
    const normalised = normaliseModule(module);
    setModules((prev) => [normalised, ...prev.filter((existing) => existing.id !== normalised.id)]);
    return normalised;
  };

  const createBlankModule = () => {
    const timestamp = Date.now();
    const blankModule: TrainingModule = {
      id: `module-${timestamp}`,
      title: 'New Training Module',
      description: 'Describe the learning outcomes, delivery methods and scope of this module.',
      category: 'Custom',
      version: '1.0',
      status: 'draft',
      estimatedDurationHours: 6,
      prerequisites: ['Define prerequisites for enrolment'],
      objectives: ['Document primary learning objectives'],
      evaluationCriteria: ['List the assessment checkpoints'],
      tags: ['draft'],
      lessons: [],
      resources: [],
      lastUpdated: new Date(),
    };

    return addModule(blankModule);
  };

  const duplicateModule = (moduleId: string, overrides?: Partial<TrainingModule>) => {
    const module = modules.find((candidate) => candidate.id === moduleId);
    if (!module) {
      return null;
    }

    const duplicate: TrainingModule = {
      ...cloneTrainingModule(module),
      ...overrides,
      id: overrides?.id ?? `${module.id}-copy-${Date.now()}`,
      title: overrides?.title ?? `${module.title} (Copy)`,
      status: overrides?.status ?? 'draft',
      version: overrides?.version ?? module.version,
      lastUpdated: new Date(),
    };

    return addModule(duplicate);
  };

  const updateModule = (moduleId: string, updater: (module: TrainingModule) => TrainingModule) => {
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? normaliseModule({ ...updater({ ...module, lastUpdated: new Date() }) })
          : module
      )
    );
  };

  const deleteModule = (moduleId: string) => {
    setModules((prev) => prev.filter((module) => module.id !== moduleId));
  };

  const value = useMemo(
    () => ({ modules, addModule, createBlankModule, duplicateModule, updateModule, deleteModule }),
    [modules]
  );

  return <TrainingModulesContext.Provider value={value}>{children}</TrainingModulesContext.Provider>;
};

export const useTrainingModules = () => {
  const context = useContext(TrainingModulesContext);
  if (!context) {
    throw new Error('useTrainingModules must be used within a TrainingModulesProvider');
  }
  return context;
};
