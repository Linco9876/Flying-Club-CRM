import React, { useState, useEffect, useRef } from 'react';
import { Building2, Globe, Phone, Mail, MapPin, X, Image as ImageIcon } from 'lucide-react';
import { useOrganisationSettings } from '../../hooks/useSettings';

interface OrganisationSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const OrganisationSettings: React.FC<OrganisationSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = useOrganisationSettings();

  const [formData, setFormData] = useState({
    clubName: '',
    address: '',
    timezone: 'Australia/Melbourne',
    currency: 'AUD',
    contactEmail: '',
    contactPhone: '',
    website: '',
    studentPortalUrl: '',
    bookingDayStart: '06:00',
    bookingDayEnd: '22:00',
    defaultSlotLength: 30,
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings) {
      setFormData({
        clubName: settings.club_name ?? '',
        address: settings.address ?? '',
        timezone: settings.timezone ?? 'Australia/Melbourne',
        currency: settings.currency ?? 'AUD',
        contactEmail: settings.contact_email ?? '',
        contactPhone: settings.contact_phone ?? '',
        website: settings.website ?? '',
        studentPortalUrl: settings.student_portal_url ?? '',
        bookingDayStart: settings.booking_day_start ?? '06:00',
        bookingDayEnd: settings.booking_day_end ?? '22:00',
        defaultSlotLength: settings.default_slot_length ?? 30,
      });
      if (settings.logo_url && !logoPreview) {
        setLogoPreview(settings.logo_url);
      }
    }
  }, [settings]);

  const handleChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2 MB');
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    onFormChange();
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    onFormChange();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Register save/discard handlers for the dashboard's global Save/Cancel bar
  useEffect(() => {
    (window as any).__organisationSettingsSave = async () => {
      await updateSettings(
        {
          club_name: formData.clubName,
          address: formData.address,
          timezone: formData.timezone,
          currency: formData.currency,
          contact_email: formData.contactEmail,
          contact_phone: formData.contactPhone,
          website: formData.website,
          student_portal_url: formData.studentPortalUrl,
          booking_day_start: formData.bookingDayStart,
          booking_day_end: formData.bookingDayEnd,
          default_slot_length: formData.defaultSlotLength,
          ...(logoFile === null && logoPreview === null ? { logo_url: null } : {}),
        },
        logoFile
      );
      setLogoFile(null);
    };
    return () => { delete (window as any).__organisationSettingsSave; };
  }, [formData, logoFile, logoPreview, updateSettings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="h-5 w-5 animate-spin text-blue-500 mr-2" />
        <span className="text-gray-500">Loading settings...</span>
      </div>
    );
  }

  const timezones = [
    'Australia/Melbourne',
    'Australia/Sydney',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Perth',
    'Australia/Darwin',
    'Pacific/Auckland',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Singapore',
  ];

  const currencies = ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'CAD', 'SGD'];

  const inputClass = (disabled: boolean) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
      disabled ? 'bg-gray-50 text-gray-500 cursor-not-allowed border-gray-200' : 'border-gray-300 bg-white'
    }`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-gray-600" />
            Organisation Settings
          </h2>
          <p className="text-sm text-gray-500 mt-1">Configure your business information, branding, and contact details.</p>
        </div>

        {/* Business Logo */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2">Business Logo</h3>
          <div className="flex items-start gap-6">
            {/* Preview */}
            <div className="relative flex-shrink-0">
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden">
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Business logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-gray-300" />
                )}
              </div>
              {logoPreview && canEdit && (
                <button
                  onClick={handleRemoveLogo}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                  title="Remove logo"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Upload controls */}
            <div className="flex-1">
              {canEdit ? (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {logoPreview ? 'Replace logo' : 'Upload logo'}
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    onChange={handleLogoSelect}
                    className="block w-full text-sm text-gray-500
                      file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0
                      file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700
                      hover:file:bg-blue-100 cursor-pointer"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">PNG, JPG, SVG or WebP · Max 2 MB · Recommended 200×200 px</p>
                </>
              ) : (
                <p className="text-sm text-gray-400 italic">You don't have permission to change the logo.</p>
              )}
            </div>
          </div>
        </section>

        {/* Business Information */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2">Business Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.clubName}
                onChange={e => handleChange('clubName', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
                placeholder="e.g. Skyline Flying Club"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Currency</label>
              <select
                value={formData.currency}
                onChange={e => handleChange('currency', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
              >
                {currencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Timezone</label>
              <select
                value={formData.timezone}
                onChange={e => handleChange('timezone', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
              >
                {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                <MapPin className="h-3.5 w-3.5 inline mr-1" />
                Address
              </label>
              <textarea
                value={formData.address}
                onChange={e => handleChange('address', e.target.value)}
                disabled={!canEdit}
                className={`${inputClass(!canEdit)} resize-none`}
                rows={3}
                placeholder="Street address, City, State, Postcode"
              />
            </div>
          </div>
        </section>

        {/* Contact Information */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                <Mail className="h-3.5 w-3.5 inline mr-1" />
                Contact Email
              </label>
              <input
                type="email"
                value={formData.contactEmail}
                onChange={e => handleChange('contactEmail', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
                placeholder="admin@yourclub.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                <Phone className="h-3.5 w-3.5 inline mr-1" />
                Contact Phone
              </label>
              <input
                type="tel"
                value={formData.contactPhone}
                onChange={e => handleChange('contactPhone', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
                placeholder="+61 3 9876 5432"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                <Globe className="h-3.5 w-3.5 inline mr-1" />
                Website URL
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={e => handleChange('website', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
                placeholder="https://yourclub.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Student Portal URL</label>
              <input
                type="url"
                value={formData.studentPortalUrl}
                onChange={e => handleChange('studentPortalUrl', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
                placeholder="https://portal.yourclub.com"
              />
            </div>
          </div>
        </section>

        {/* Operating Hours */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-2">Operating Hours</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Booking Day Start</label>
              <input
                type="time"
                value={formData.bookingDayStart}
                onChange={e => handleChange('bookingDayStart', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Booking Day End</label>
              <input
                type="time"
                value={formData.bookingDayEnd}
                onChange={e => handleChange('bookingDayEnd', e.target.value)}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Default Slot Length</label>
              <select
                value={formData.defaultSlotLength}
                onChange={e => handleChange('defaultSlotLength', parseInt(e.target.value))}
                disabled={!canEdit}
                className={inputClass(!canEdit)}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
                <option value={90}>90 minutes</option>
              </select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
