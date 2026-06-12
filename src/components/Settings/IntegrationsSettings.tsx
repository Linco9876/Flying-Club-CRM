import React from 'react';
import { ExternalLink, Link2, Plug, RefreshCw } from 'lucide-react';
import { StripeIntegrationCard } from './StripeIntegrationCard';

interface IntegrationsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const IntegrationsSettings: React.FC<IntegrationsSettingsProps> = ({ canEdit, onFormChange }) => {
  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Plug className="h-5 w-5 mr-2" />
          Integrations
        </h2>
        <p className="text-gray-600">Prepare external services for accounting, notifications and operational data sync.</p>
      </div>

      <StripeIntegrationCard canEdit={canEdit} />

      <section className="rounded-lg border border-gray-200">
        <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Link2 className="h-5 w-5 mr-2 text-blue-600" />
              Xero Accounting
            </h3>
            <p className="text-sm text-gray-500 mt-1">Sync contacts, invoices, payments and account top-ups once billing records are mapped.</p>
          </div>
          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            Planned
          </span>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
            <input
              type="checkbox"
              disabled={!canEdit}
              onChange={onFormChange}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Create Xero contacts for pilots</span>
              <span className="block text-xs text-gray-500 mt-1">Use the student/pilot file as the source of truth for customer details.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
            <input
              type="checkbox"
              disabled={!canEdit}
              onChange={onFormChange}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Sync flight charges as invoice lines</span>
              <span className="block text-xs text-gray-500 mt-1">Keep aircraft hire, instruction and fees separated for reporting.</span>
            </span>
          </label>
        </div>

        <div className="px-5 pb-5">
          <button
            disabled
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-500 rounded-lg cursor-not-allowed"
          >
            <ExternalLink className="h-4 w-4" />
            Connect Xero
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 p-5">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <RefreshCw className="h-5 w-5 mr-2 text-blue-600" />
          Sync Defaults
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Default sync mode</label>
            <select
              disabled={!canEdit}
              onChange={onFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              defaultValue="manual-review"
            >
              <option value="manual-review">Manual review before sync</option>
              <option value="auto-draft">Auto-create draft invoices</option>
              <option value="auto-approved">Auto-create approved invoices</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Failure handling</label>
            <select
              disabled={!canEdit}
              onChange={onFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              defaultValue="queue"
            >
              <option value="queue">Queue for retry</option>
              <option value="notify-admin">Notify admin only</option>
              <option value="block-posting">Block billing finalisation</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
};
