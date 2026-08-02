export interface TrainingRecordQueueIdentity {
  id: string;
  flightLogId: string;
}

export const enqueueTrainingRecordJob = <T extends TrainingRecordQueueIdentity>(
  current: T[],
  job: T,
) => [
  ...current.filter(item => item.id !== job.id && item.flightLogId !== job.flightLogId),
  job,
];

