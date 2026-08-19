export const RPC_STANDARD_ENDORSEMENT_OPTIONS = [
  'Human Factors',
  'Flight Radio',
  'Passenger Carrying',
  'Cross Country',
  'Low Level',
  'Formation',
  'Tailwheel',
];

export const normaliseRpcEndorsements = (value: unknown): string[] => {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;\n]+/)
      : [];
  const seen = new Set<string>();
  return candidates.flatMap(candidate => {
    if (typeof candidate !== 'string') return [];
    const cleaned = candidate.trim();
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) return [];
    seen.add(key);
    return [cleaned];
  });
};

export const rpcEndorsementOptions = (
  configuredOptions: string[],
  selectedOptions: string[],
) => normaliseRpcEndorsements([
  ...RPC_STANDARD_ENDORSEMENT_OPTIONS,
  ...configuredOptions,
  ...selectedOptions,
]);

const formatHours = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '[flight time]';
  return `${(minutes / 60).toFixed(1)} hr`;
};

export const buildRpcLogbookEntryExample = ({
  reviewDate,
  aircraftType,
  registration,
  flightMinutes,
  endorsements,
  reviewerName,
  reviewerIdentifier,
  outcome,
}: {
  reviewDate: string;
  aircraftType?: string;
  registration?: string;
  flightMinutes: number;
  endorsements: string[];
  reviewerName: string;
  reviewerIdentifier?: string;
  outcome: 'passed' | 'further_training_required' | 'pending';
}) => {
  const result = outcome === 'passed'
    ? 'PASS'
    : outcome === 'further_training_required'
      ? 'FURTHER TRAINING REQUIRED'
      : '[PASS / FURTHER TRAINING REQUIRED]';
  const aircraft = [registration?.trim(), aircraftType?.trim()]
    .filter(Boolean)
    .join(' - ') || '[aircraft registration and type]';
  const endorsementText = endorsements.length > 0
    ? endorsements.join(', ')
    : '[endorsements assessed or issued]';
  const examinerId = reviewerIdentifier?.trim() || '[RAAus member number]';

  return [
    `RAAus RPC flight test: ${result}.`,
    `Date: ${reviewDate || '[date]'}.`,
    `Aircraft: ${aircraft}.`,
    `Flight time: ${formatHours(flightMinutes)}.`,
    `Endorsements: ${endorsementText}.`,
    `Examiner: ${reviewerName || '[examiner name]'}; RAAus No. ${examinerId}.`,
    'Examiner signature: ____________________.',
  ].join(' ');
};
