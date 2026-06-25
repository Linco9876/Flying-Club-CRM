import React from 'react';
import { Plug } from 'lucide-react';
import { StripeIntegrationCard } from './StripeIntegrationCard';
import { XeroIntegrationCard } from './XeroIntegrationCard';

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
      <XeroIntegrationCard canEdit={canEdit} onFormChange={onFormChange} />
    </div>
  );
};
