import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { User, Phone, Mail, Calendar, Award, CreditCard as Edit, Save, X, AlertCircle, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import { StudentTrainingRecords } from './StudentTrainingRecords';

interface ProfileData {
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  raausId: string;
  casaId: string;
  occupation: string;
  alternatePhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  medicalType: string;
  medicalExpiry: string;
  licenceExpiry: string;
}

interface Endorsement {
  id: string;
  type: string;
  date_obtained: string;
  expiry_date: string | null;
  is_active: boolean;
}

const empty: ProfileData = {
  name: '', email: '', phone: '', dateOfBirth: '',
  raausId: '', casaId: '', occupation: '', alternatePhone: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  medicalType: '', medicalExpiry: '', licenceExpiry: '',
};

type Tab = 'profile' | 'training';

export const StudentProfile: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData>(empty);
  const [draft, setDraft] = useState<ProfileData>(empty);
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [accountBalance, setAccountBalance] = useState<number | null>(null);
  const [flightStats, setFlightStats] = useState({ total: 0, solo: 0, dual: 0 });

  useEffect(() => {
    if (!user?.id) return;
    fetchAll();
  }, [user?.id]);

  const fetchAll = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [usersRes, studentsRes, endorsementsRes, balanceRes, flightRes] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('students').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('endorsements').select('*').eq('student_id', user.id),
        supabase.from('account_transactions').select('type, amount, verified_status').eq('user_id', user.id),
        supabase.from('flight_logs').select('duration').eq('student_id', user.id),
      ]);

      const u = usersRes.data;
      const s = studentsRes.data;

      const data: ProfileData = {
        name: u?.name || '',
        email: u?.email || '',
        phone: u?.phone || '',
        dateOfBirth: s?.date_of_birth || '',
        raausId: s?.raaus_id || '',
        casaId: s?.casa_id || '',
        occupation: s?.occupation || '',
        alternatePhone: s?.alternate_phone || '',
        emergencyContactName: s?.emergency_contact_name || '',
        emergencyContactPhone: s?.emergency_contact_phone || '',
        emergencyContactRelationship: s?.emergency_contact_relationship || '',
        medicalType: s?.medical_type || '',
        medicalExpiry: s?.medical_expiry || '',
        licenceExpiry: s?.licence_expiry || '',
      };
      setProfile(data);
      setDraft(data);

      setEndorsements(endorsementsRes.data || []);

      if (balanceRes.data) {
        const bal = balanceRes.data.reduce((sum: number, tx: any) => {
          const amt = parseFloat(tx.amount ?? 0);
          if (tx.type === 'topup' || tx.type === 'refund') {
            return tx.verified_status === 'verified' ? sum + amt : sum;
          }
          return sum - amt;
        }, 0);
        setAccountBalance(bal);
      }

      if (flightRes.data) {
        const total = flightRes.data.reduce((s: number, r: any) => s + (parseFloat(r.duration) || 0), 0);
        setFlightStats({ total, solo: 0, dual: 0 });
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error: userError } = await supabase
        .from('users')
        .update({ name: draft.name, phone: draft.phone || null })
        .eq('id', user.id);
      if (userError) throw userError;

      const studentUpdate: any = {
        date_of_birth: draft.dateOfBirth || null,
        raaus_id: draft.raausId || null,
        casa_id: draft.casaId || null,
        occupation: draft.occupation || null,
        alternate_phone: draft.alternatePhone || null,
        emergency_contact_name: draft.emergencyContactName || null,
        emergency_contact_phone: draft.emergencyContactPhone || null,
        emergency_contact_relationship: draft.emergencyContactRelationship || null,
        medical_type: draft.medicalType || null,
        medical_expiry: draft.medicalExpiry || null,
        licence_expiry: draft.licenceExpiry || null,
      };

      // Upsert in case students row doesn't exist yet
      const { error: studentError } = await supabase
        .from('students')
        .upsert({ id: user.id, ...studentUpdate }, { onConflict: 'id' });
      if (studentError) throw studentError;

      setProfile(draft);
      setEditMode(false);
      toast.success('Profile updated successfully');
    } catch (err: any) {
      console.error('Error saving profile:', err);
      toast.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(profile);
    setEditMode(false);
  };

  const field = (label: string, icon: React.ReactNode, value: string, key: keyof ProfileData, type = 'text', readOnly = false) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {icon && <span className="inline-flex items-center mr-1.5">{icon}</span>}
        {label}
      </label>
      <input
        type={type}
        value={editMode ? draft[key] : value}
        onChange={editMode ? (e) => setDraft(prev => ({ ...prev, [key]: e.target.value })) : undefined}
        readOnly={!editMode || readOnly}
        className={`w-full px-3 py-2 border rounded-lg text-sm transition-colors ${
          editMode && !readOnly
            ? 'border-blue-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
            : 'border-gray-200 bg-gray-50 text-gray-700 cursor-default'
        }`}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const activeEndorsements = endorsements.filter(e => e.is_active);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-sm text-gray-500 mt-0.5">{profile.email}</p>
        </div>
        {activeTab === 'profile' && (
          editMode ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Edit className="h-4 w-4" />
              Edit Profile
            </button>
          )
        )}
      </div>

      {/* Tabs */}
      <div className="app-tab-scroller">
        <nav className="app-tab-list">
          <button
            onClick={() => setActiveTab('profile')}
            className={`app-tab-button ${
              activeTab === 'profile'
                ? 'app-tab-button-active'
                : ''
            }`}
          >
            <User className="h-4 w-4" />
            Personal Info
          </button>
          <button
            onClick={() => setActiveTab('training')}
            className={`app-tab-button ${
              activeTab === 'training'
                ? 'app-tab-button-active'
                : ''
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Lesson Records
          </button>
        </nav>
      </div>

      {activeTab === 'training' && (
        <StudentTrainingRecords />
      )}

      {activeTab === 'profile' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Personal Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Personal Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Full Name', <User className="h-3.5 w-3.5 text-gray-400" />, profile.name, 'name')}
              {field('Email', <Mail className="h-3.5 w-3.5 text-gray-400" />, profile.email, 'email', 'email', true)}
              {field('Phone', <Phone className="h-3.5 w-3.5 text-gray-400" />, profile.phone, 'phone', 'tel')}
              {field('Alternate Phone', <Phone className="h-3.5 w-3.5 text-gray-400" />, profile.alternatePhone, 'alternatePhone', 'tel')}
              {field('Date of Birth', <Calendar className="h-3.5 w-3.5 text-gray-400" />, profile.dateOfBirth, 'dateOfBirth', 'date')}
              {field('Occupation', null, profile.occupation, 'occupation')}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Aviation Credentials</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('RAAus ID', null, profile.raausId, 'raausId')}
              {field('CASA ID', null, profile.casaId, 'casaId')}
              {field('Medical Type', null, profile.medicalType, 'medicalType')}
              {field('Medical Expiry', <Calendar className="h-3.5 w-3.5 text-gray-400" />, profile.medicalExpiry, 'medicalExpiry', 'date')}
              {field('Licence Expiry', <Calendar className="h-3.5 w-3.5 text-gray-400" />, profile.licenceExpiry, 'licenceExpiry', 'date')}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Emergency Contact</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Name', <User className="h-3.5 w-3.5 text-gray-400" />, profile.emergencyContactName, 'emergencyContactName')}
              {field('Phone', <Phone className="h-3.5 w-3.5 text-gray-400" />, profile.emergencyContactPhone, 'emergencyContactPhone', 'tel')}
              {field('Relationship', null, profile.emergencyContactRelationship, 'emergencyContactRelationship')}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Flight Stats */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Flight Statistics</h2>
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex justify-between items-center">
                <span className="text-sm font-medium text-blue-900">Total Hours</span>
                <span className="text-lg font-bold text-blue-600">{flightStats.total.toFixed(1)}</span>
              </div>
              <div className="bg-green-50 border border-green-100 rounded-lg p-3 flex justify-between items-center">
                <span className="text-sm font-medium text-green-900">Solo Time</span>
                <span className="text-lg font-bold text-green-600">{flightStats.solo.toFixed(1)}</span>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 flex justify-between items-center">
                <span className="text-sm font-medium text-orange-900">Dual Time</span>
                <span className="text-lg font-bold text-orange-600">{flightStats.dual.toFixed(1)}</span>
              </div>
              <div className={`border rounded-lg p-3 flex justify-between items-center ${accountBalance !== null && accountBalance < 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                <span className={`text-sm font-medium ${accountBalance !== null && accountBalance < 0 ? 'text-red-900' : 'text-green-900'}`}>
                  Account Balance
                </span>
                <span className={`text-lg font-bold ${accountBalance !== null && accountBalance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {accountBalance !== null ? `$${accountBalance.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Endorsements */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Active Endorsements</h2>
            {activeEndorsements.length === 0 ? (
              <div className="text-center py-4">
                <AlertCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No active endorsements</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeEndorsements.map(e => (
                  <div key={e.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-blue-600 flex-shrink-0" />
                      <span className="text-sm font-medium text-blue-900">{e.type.toUpperCase()}</span>
                    </div>
                    <span className="text-xs text-blue-600">
                      {e.date_obtained ? new Date(e.date_obtained).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
