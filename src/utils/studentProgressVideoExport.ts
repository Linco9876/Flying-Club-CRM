import { StudentProgressVideoProps } from '../types/studentProgressVideo';

const safeFilename = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'student-progress';

export const downloadStudentProgressVideoProps = (props: StudentProgressVideoProps) => {
  const filename = `${safeFilename(props.student.name)}-student-progress-video.json`;
  const blob = new Blob([JSON.stringify(props, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
};
