import React, { useState } from 'react';
import { Bell, Mail, MessageSquare, AlertTriangle, Clock, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface NotificationsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface NotificationSetting {
  id: string;
  label: string;
  description: string;
  email: boolean;
  sms: boolean;
  category: 'booking' | 'training' | 'safety' | 'billing';
}

export const NotificationsSettings: React.FC<NotificationsSettingsProps> = ({ canEdit, onFormChange }) => {
  const { user } = useAuth();
  
  const [notifications, setNotifications] = useState<NotificationSetting[]>([
    {
      id: 'booking-confirmed',
      label: 'Booking Confirmed',
      description: 'When a booking is created or confirmed',
      email: true,
      sms: false,
      category: 'booking'
    },
    {
      id: 'booking-changed',
      label: 'Booking Changed',
      description: 'When booking details are modified',
      email: true,
      sms: true,
      category: 'booking'
    },
    {
      id: 'booking-cancelled',
      label: 'Booking Cancelled',
      description: 'When a booking is cancelled',
      email: true,
      sms: true,
      category: 'booking'
    },
    {
      id: 'booking-no-show',
      label: 'No-Show Alert',
      description: 'When a student fails to show for booking',
      email: true,
      sms: false,
      category: 'booking'
    },
    {
      id: 'training-record-submitted',
      label: 'Training Record Submitted',
      description: 'When instructor submits training record',
      email: true,
      sms: false,
      category: 'training'
    },
    {
      id: 'currency-expiry-30',
      label: 'Currency Expiry (30 days)',
      description: 'Medical/licence expiring in 30 days',
      email: true,
      sms: false,
      category: 'safety'
    },
    {
      id: 'currency-expiry-14',
      label: 'Currency Expiry (14 days)',
      description: 'Medical/licence expiring in 14 days',
      email: true,
      sms: true,
      category: 'safety'
    },
    {
      id: 'currency-expiry-7',
      label: 'Currency Expiry (7 days)',
      description: 'Medical/licence expiring in 7 days',
      email: true,
      sms: true,
      category: 'safety'
    },
    {
      id: 'aircraft-grounded',
      label: 'Aircraft Grounded',
      description: 'When aircraft is marked unserviceable',
      email: true,
      sms: true,
      category: 'safety'
    },
    {
      id: 'invoice-created',
      label: 'Invoice Created',
      description: 'When new invoice is generated',
      email: true,
      sms: false,
      category: 'billing'
    }
  ]);

  const [emailSettings, setEmailSettings] = useState({
    provider: 'sendgrid',
    apiKey: '',
    fromEmail: 'noreply@flyingclub.com',
    fromName: 'AeroClub Pro'
  });

  const [smsSettings, setSmsSettings] = useState({
    provider: 'twilio',
    accountSid: '',
    authToken: '',
    fromNumber: ''
  });

  const handleNotificationChange = (id: string, field: 'email' | 'sms', value: boolean) => {
    setNotifications(prev => prev.map(notif =>
      notif.id === id ? { ...notif, [field]: value } : notif
    ));
    onFormChange();
  };

  const handleEmailSettingChange = (field: string, value: string) => {
    setEmailSettings(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleSmsSettingChange = (field: string, value: string) => {
    setSmsSettings(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'booking': return <Clock className="h-4 w-4 text-blue-600" />;
      case 'training': return <FileText className="h-4 w-4 text-green-600" />;
      case 'safety': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'billing': return <Mail className="h-4 w-4 text-purple-600" />;
      default: return <Bell className="h-4 w-4 text-gray-600" />;
    }
  };

  const groupedNotifications = notifications.reduce((groups, notification) => {
    const category = notification.category;
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(notification);
    return groups;
  }, {} as Record<string, NotificationSetting[]>);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Bell className="h-5 w-5 mr-2" />
          Notifications
        </h2>
        <p className="text-gray-600">Configure email and SMS notifications for various events</p>
      </div>

      {/* Notification Events */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Event Notifications</h3>
          
          {Object.entries(groupedNotifications).map(([category, categoryNotifications]) => (
            <div key={category} className="mb-6">
              <h4 className="text-md font-medium text-gray-800 mb-3 flex items-center capitalize">
                {getCategoryIcon(category)}
                <span className="ml-2">{category} Events</span>
              </h4>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="space-y-3">
                  {categoryNotifications.map(notification => (
                    <div key={notification.id} className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{notification.label}</p>
                        <p className="text-xs text-gray-600">{notification.description}</p>
                      </div>
                      <div className="flex items-center space-x-4 ml-4">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`${notification.id}-email`}
                            checked={notification.email}
                            onChange={(e) => handleNotificationChange(notification.id, 'email', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                          <label htmlFor={`${notification.id}-email`} className="text-xs text-gray-700">
                            <Mail className="h-3 w-3 inline mr-1" />
                            Email
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`${notification.id}-sms`}
                            checked={notification.sms}
                            onChange={(e) => handleNotificationChange(notification.id, 'sms', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                          <label htmlFor={`${notification.id}-sms`} className="text-xs text-gray-700">
                            <MessageSquare className="h-3 w-3 inline mr-1" />
                            SMS
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Email Provider Settings */}
        {canEdit && user?.role === 'admin' && (
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Email Provider</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
                <select
                  value={emailSettings.provider}
                  onChange={(e) => handleEmailSettingChange('provider', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="sendgrid">SendGrid</option>
                  <option value="mailgun">Mailgun</option>
                  <option value="ses">Amazon SES</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                <input
                  type="password"
                  value={emailSettings.apiKey}
                  onChange={(e) => handleEmailSettingChange('apiKey', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter API key"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">From Email</label>
                <input
                  type="email"
                  value={emailSettings.fromEmail}
                  onChange={(e) => handleEmailSettingChange('fromEmail', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">From Name</label>
                <input
                  type="text"
                  value={emailSettings.fromName}
                  onChange={(e) => handleEmailSettingChange('fromName', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* SMS Provider Settings */}
        {canEdit && user?.role === 'admin' && (
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">SMS Provider</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
                <select
                  value={smsSettings.provider}
                  onChange={(e) => handleSmsSettingChange('provider', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="twilio">Twilio</option>
                  <option value="messagebird">MessageBird</option>
                  <option value="clicksend">ClickSend</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Account SID</label>
                <input
                  type="text"
                  value={smsSettings.accountSid}
                  onChange={(e) => handleSmsSettingChange('accountSid', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter Account SID"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Auth Token</label>
                <input
                  type="password"
                  value={smsSettings.authToken}
                  onChange={(e) => handleSmsSettingChange('authToken', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter Auth Token"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">From Number</label>
                <input
                  type="tel"
                  value={smsSettings.fromNumber}
                  onChange={(e) => handleSmsSettingChange('fromNumber', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+61 400 123 456"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};