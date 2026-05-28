import React from 'react';
import { BookOpen, CheckCircle, GraduationCap, SlidersHorizontal } from 'lucide-react';

interface TrainingSyllabusSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const TrainingSyllabusSettings: React.FC<TrainingSyllabusSettingsProps> = ({ canEdit, onFormChange }) => {
  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <GraduationCap className="h-5 w-5 mr-2" />
          Training / Syllabus Settings
        </h2>
        <p className="text-gray-600">Set the training defaults that control lesson records and course progress.</p>
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <BookOpen className="h-5 w-5 mr-2 text-blue-600" />
          Lesson Record Defaults
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
            <input
              type="checkbox"
              disabled={!canEdit}
              defaultChecked
              onChange={onFormChange}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Require instructor sign-off</span>
              <span className="block text-xs text-gray-500 mt-1">Training records stay submitted until the instructor finalises them.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
            <input
              type="checkbox"
              disabled={!canEdit}
              defaultChecked
              onChange={onFormChange}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Require student acknowledgement</span>
              <span className="block text-xs text-gray-500 mt-1">Students confirm they have read lesson comments and assessment outcomes.</span>
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <SlidersHorizontal className="h-5 w-5 mr-2 text-blue-600" />
          Progress Rules
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Default grading system</label>
            <select
              disabled={!canEdit}
              onChange={onFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              defaultValue="NC/S/C/-"
            >
              <option value="NC/S/C/-">NC / S / C / -</option>
              <option value="Pass or Fail">Pass or Fail</option>
              <option value="Out of 100">Out of 100</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Course completion threshold</label>
            <select
              disabled={!canEdit}
              onChange={onFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              defaultValue="all-required"
            >
              <option value="all-required">All required criteria met</option>
              <option value="all-lessons">All lessons attempted</option>
              <option value="instructor-override">Instructor override allowed</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex gap-3">
          <CheckCircle className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-blue-900">Course builder lives in Training Records</h3>
            <p className="text-sm text-blue-800 mt-1">
              These settings are for system-wide training rules. Course content, lessons, criteria and published syllabi are managed from the Training Records area.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
