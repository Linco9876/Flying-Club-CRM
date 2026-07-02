import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Camera,
  CheckCircle2,
  Eye,
  FileUp,
  Globe,
  Loader2,
  Lock,
  Palette,
  Plus,
  Phone,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useAircraft } from '../../hooks/useAircraft';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';
import { Endorsement } from '../../types';
import { reconcilePilotStatusForUser } from '../../utils/pilotStatus';
import { defaultUserPreferences, useUserPreferences, UserPreferences } from '../../hooks/useSettings';
import { applyPortalTheme, storePortalTheme } from '../../utils/theme';

interface PersonalPreferencesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
  activeAccountTab?: AccountTab;
  saveKey?: string;
  showInternalTabs?: boolean;
}

type PreferenceFormData = Omit<UserPreferences, 'id' | 'user_id' | 'preferences'>;
type PreferenceField = keyof PreferenceFormData;
type AccountTab = 'info' | 'security' | 'calendar' | 'notifications' | 'appearance' | 'dashboard';

interface ProfileFormData {
  name: string;
  email: string;
  avatarUrl: string;
  coverUrl: string;
  birthdate: string;
  mobile: string;
  homePhone: string;
  workPhone: string;
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  preferredAircraftId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface AccountEndorsement extends Pick<Endorsement, 'id' | 'type' | 'dateObtained' | 'expiryDate' | 'isActive'> {}

interface PendingEndorsementDraft {
  localId: string;
  type: string;
  dateObtained: string;
  expiryDate: string;
  isActive: boolean;
  proofFile: File | null;
}

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';
const AVATAR_BUCKET = 'user-avatars';
const STUDENT_DOCUMENTS_BUCKET = 'student-documents';
const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

const imageTargets = {
  avatar: { width: 512, height: 512, quality: 0.84, fit: 'cover' as const },
  cover: { width: 1600, height: 600, quality: 0.82, fit: 'cover' as const },
  background: { width: 1920, height: 1080, quality: 0.78, fit: 'cover' as const },
};

const blankProfile: ProfileFormData = {
  name: '',
  email: '',
  avatarUrl: '',
  coverUrl: '',
  birthdate: '',
  mobile: '',
  homePhone: '',
  workPhone: '',
  address: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
  preferredAircraftId: '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

const createLocalId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_');

const createPendingEndorsement = (): PendingEndorsementDraft => ({
  localId: createLocalId(),
  type: '',
  dateObtained: '',
  expiryDate: '',
  isActive: true,
  proofFile: null,
});

export const PersonalPreferencesSettings: React.FC<PersonalPreferencesSettingsProps> = ({
  canEdit,
  onFormChange,
  activeAccountTab,
  saveKey = 'personal',
  showInternalTabs = true,
}) => {
  const { user, refreshUser } = useAuth();
  const { aircraft } = useAircraft();
  const { settings: trainingSettings } = useTrainingSettings();
  const { preferences, loading, error, updatePreferences } = useUserPreferences(user?.id || '');
  const [activeTab, setActiveTab] = useState<AccountTab>('info');
  const selectedTab = activeAccountTab || activeTab;
  const [profileForm, setProfileForm] = useState<ProfileFormData>(blankProfile);
  const [savedProfile, setSavedProfile] = useState<ProfileFormData>(blankProfile);
  const [profileLoading, setProfileLoading] = useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [existingEndorsements, setExistingEndorsements] = useState<AccountEndorsement[]>([]);
  const [pendingEndorsements, setPendingEndorsements] = useState<PendingEndorsementDraft[]>([]);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [preferenceForm, setPreferenceForm] = useState<PreferenceFormData>(() => {
    const { user_id, preferences: _preferences, ...defaults } = defaultUserPreferences(user?.id || '');
    return defaults;
  });

  const hasStaffRole = user?.roles?.some(role => ['admin', 'senior_instructor', 'instructor'].includes(role))
    || ['admin', 'senior_instructor', 'instructor'].includes(user?.role || '');

  const isStudentOrPilot = user?.roles?.some(role => ['student', 'pilot'].includes(role))
    || ['student', 'pilot'].includes(user?.role || '');

  const tabs = useMemo(() => {
    const base: Array<{ id: AccountTab; label: string; icon: React.ReactNode }> = [
      { id: 'info', label: 'Update My Info', icon: <User className="h-4 w-4" /> },
      { id: 'security', label: 'Security', icon: <Lock className="h-4 w-4" /> },
      { id: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-4 w-4" /> },
      { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
    ];

    if (isStudentOrPilot) {
      base.push({ id: 'dashboard', label: 'Portal Dashboard', icon: <Eye className="h-4 w-4" /> });
    }

    return base;
  }, [isStudentOrPilot]);

  const fetchProfile = async () => {
    if (!user?.id) {
      setProfileLoading(false);
      return;
    }

    try {
      setProfileLoading(true);
      const [
        { data: userData, error: userError },
        { data: studentData, error: studentError },
        { data: endorsementsData, error: endorsementsError },
        { data: authData, error: authError },
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('students').select('*').eq('id', user.id).maybeSingle(),
        supabase
          .from('endorsements')
          .select('id, type, date_obtained, expiry_date, is_active')
          .eq('student_id', user.id)
          .order('date_obtained', { ascending: false }),
        supabase.auth.getUser(),
      ]);

      if (userError) throw userError;
      if (studentError) throw studentError;
      if (endorsementsError) throw endorsementsError;
      if (authError) throw authError;

      const nextProfile: ProfileFormData = {
        ...blankProfile,
        name: userData?.name || user.name || '',
        email: userData?.email || user.email || '',
        avatarUrl: userData?.avatar_url || user.avatar || '',
        coverUrl: userData?.cover_url || user.coverPhoto || '',
        birthdate: userData?.date_of_birth || studentData?.date_of_birth || '',
        mobile: userData?.mobile_phone || userData?.phone || user.phone || '',
        homePhone: userData?.home_phone || '',
        workPhone: userData?.work_phone || '',
        address: userData?.address || '',
        emergencyName: userData?.emergency_contact_name || studentData?.emergency_contact_name || '',
        emergencyPhone: userData?.emergency_contact_phone || studentData?.emergency_contact_phone || '',
        emergencyRelationship: userData?.emergency_contact_relationship || studentData?.emergency_contact_relationship || '',
        preferredAircraftId: userData?.preferred_aircraft_id || '',
      };

      setProfileForm(nextProfile);
      setSavedProfile(nextProfile);
      setAvatarFile(null);
      setCoverFile(null);
      setEmailVerified(Boolean(authData.user?.email_confirmed_at));
      setExistingEndorsements((endorsementsData || []).map((endorsement: any) => ({
        id: endorsement.id,
        type: endorsement.type,
        dateObtained: new Date(endorsement.date_obtained),
        expiryDate: endorsement.expiry_date ? new Date(endorsement.expiry_date) : undefined,
        isActive: Boolean(endorsement.is_active),
      })));
      setPendingEndorsements([]);
    } catch (err: any) {
      console.error('Failed to load account settings:', err);
      toast.error(err.message || 'Failed to load account settings');
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [user?.id]);

  useEffect(() => {
    if (!preferences) return;
    const { id, user_id, preferences: _preferences, ...values } = preferences;
    setPreferenceForm(values);
  }, [preferences]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(avatarFile);
    setAvatarPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [avatarFile]);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('');
      return;
    }

    const previewUrl = URL.createObjectURL(coverFile);
    setCoverPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [coverFile]);

  useEffect(() => {
    const globalSaveKey = `__${saveKey.replace(/-/g, '')}SettingsSave`;
    const globalCancelKey = `__${saveKey.replace(/-/g, '')}SettingsCancel`;

    (window as any)[globalSaveKey] = async () => {
      await saveAccountSettings();
    };
    (window as any)[globalCancelKey] = () => {
      setProfileForm(savedProfile);
      setAvatarFile(null);
      setCoverFile(null);
      if (preferences) {
        const { id, user_id, preferences: _preferences, ...values } = preferences;
        setPreferenceForm(values);
        applyPortalTheme(values.theme);
        storePortalTheme(values.theme, user?.id);
      }
    };
    return () => {
      delete (window as any)[globalSaveKey];
      delete (window as any)[globalCancelKey];
    };
  }, [
    profileForm,
    savedProfile,
    preferenceForm,
    preferences,
    updatePreferences,
    user?.id,
    user?.role,
    user?.roles,
    saveKey,
    avatarFile,
    coverFile,
    emailVerified,
    existingEndorsements,
    pendingEndorsements,
    trainingSettings.pilotStatusEndorsementTypes,
  ]);

  const safeImageFilename = (filename: string) => filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';

  const compressImageForUpload = async (file: File, kind: 'avatar' | 'cover') => {
    const target = imageTargets[kind];
    const imageUrl = URL.createObjectURL(file);

    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = imageUrl;
      try {
        await image.decode();
      } catch {
        throw new Error('This image format could not be optimized. Please use JPG, PNG, or WebP.');
      }

      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image compression is not available in this browser');

      context.fillStyle = '#f3f4f6';
      context.fillRect(0, 0, target.width, target.height);

      const scale = target.fit === 'cover'
        ? Math.max(target.width / image.naturalWidth, target.height / image.naturalHeight)
        : Math.min(target.width / image.naturalWidth, target.height / image.naturalHeight, 1);
      const drawWidth = Math.round(image.naturalWidth * scale);
      const drawHeight = Math.round(image.naturalHeight * scale);
      const drawX = Math.round((target.width - drawWidth) / 2);
      const drawY = Math.round((target.height - drawHeight) / 2);

      context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

      const blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, 'image/webp', target.quality);
      });

      if (!blob) throw new Error('Image compression failed');
      if (blob.size > MAX_UPLOAD_IMAGE_BYTES) {
        throw new Error('Compressed image is still larger than 5 MB');
      }

      return new File([blob], `${kind}-${Date.now()}.webp`, { type: 'image/webp' });
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };

  const uploadImage = async (file: File | null, kind: 'avatar' | 'cover') => {
    if (!user?.id || !file) return null;

    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file');
      throw new Error('Invalid image file type');
    }

    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      toast.error('Image must be smaller than 15 MB');
      throw new Error('Image too large');
    }

    setImageUploading(true);
    try {
      const uploadFile = await compressImageForUpload(file, kind);
      const path = `${user.id}/${kind}-${Date.now()}-${safeImageFilename(uploadFile.name)}`;
      const { error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, uploadFile, {
          cacheControl: '3600',
          contentType: uploadFile.type,
          upsert: false,
        });

      if (error) throw error;

      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    } finally {
      setImageUploading(false);
    }
  };

  const uploadEndorsementProof = async (file: File, endorsementType: string) => {
    if (!user?.id) throw new Error('User not available');

    const storagePath = `${user.id}/${createLocalId()}-${safeFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(STUDENT_DOCUMENTS_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: documentRow, error: documentError } = await supabase
      .from('student_documents')
      .insert({
        student_id: user.id,
        display_name: `Endorsement Proof - ${endorsementType.trim()}`,
        original_filename: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: user.id,
      })
      .select('id')
      .single();

    if (documentError) {
      await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).remove([storagePath]);
      throw documentError;
    }

    return { storagePath, documentId: documentRow?.id as string | undefined };
  };

  const addPendingEndorsement = () => {
    setPendingEndorsements(prev => [...prev, createPendingEndorsement()]);
    onFormChange();
  };

  const updatePendingEndorsement = (
    localId: string,
    field: keyof PendingEndorsementDraft,
    value: string | boolean | File | null
  ) => {
    setPendingEndorsements(prev => prev.map(endorsement => (
      endorsement.localId === localId ? { ...endorsement, [field]: value } : endorsement
    )));
    onFormChange();
  };

  const removePendingEndorsement = (localId: string) => {
    setPendingEndorsements(prev => prev.filter(endorsement => endorsement.localId !== localId));
    onFormChange();
  };

  const sendVerificationEmail = async () => {
    const nextEmail = profileForm.email.trim().toLowerCase() || user?.email || '';
    if (!nextEmail) {
      toast.error('Email is missing');
      return;
    }

    try {
      setSendingVerification(true);
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: nextEmail,
        options: {
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
        },
      });

      if (resendError) throw resendError;
      toast.success('Verification email sent');
    } catch (err: any) {
      console.error('Failed to resend verification email:', err);
      toast.error(err?.message || 'Failed to resend verification email');
    } finally {
      setSendingVerification(false);
    }
  };

  const saveAccountSettings = async () => {
    if (!user?.id) return;

    const trimmedEmail = profileForm.email.trim().toLowerCase();
    const currentEmail = savedProfile.email.trim().toLowerCase();

    if (!profileForm.name.trim()) {
      toast.error('Name is required');
      throw new Error('Name is required');
    }

    if (profileForm.newPassword || profileForm.confirmPassword || profileForm.currentPassword) {
      if (!emailVerified) {
        toast.error('Verify your email address before changing your password');
        throw new Error('Email must be verified before password changes');
      }
      if (!profileForm.currentPassword) {
        toast.error('Enter your current password before changing password');
        throw new Error('Current password required');
      }
      if (profileForm.newPassword.length < 6) {
        toast.error('New password must be at least 6 characters');
        throw new Error('Password too short');
      }
      if (profileForm.newPassword !== profileForm.confirmPassword) {
        toast.error('New password and confirmation do not match');
        throw new Error('Password mismatch');
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: currentEmail || user.email,
        password: profileForm.currentPassword,
      });
      if (signInError) {
        toast.error('Current password could not be verified');
        throw signInError;
      }

      const { error: passwordError } = await supabase.auth.updateUser({ password: profileForm.newPassword });
      if (passwordError) throw passwordError;
      toast.success('Password updated');
    }

    for (const endorsement of pendingEndorsements) {
      if (!endorsement.type.trim()) {
        toast.error('Choose an endorsement type before saving');
        throw new Error('Endorsement type is required');
      }
      if (!endorsement.dateObtained) {
        toast.error('Add the endorsement date before saving');
        throw new Error('Endorsement date is required');
      }
      if (!endorsement.proofFile) {
        toast.error(`Upload proof for ${endorsement.type.trim()} before saving`);
        throw new Error('Endorsement proof is required');
      }
    }

    if (trimmedEmail && trimmedEmail !== currentEmail) {
      const { error: emailError } = await supabase.auth.updateUser({ email: trimmedEmail });
      if (emailError) throw emailError;
      toast.success('Verification email sent. Your login email will change after you confirm it.');
    }

    const avatarUrl = avatarFile ? await uploadImage(avatarFile, 'avatar') : profileForm.avatarUrl.trim() || null;
    const coverUrl = coverFile ? await uploadImage(coverFile, 'cover') : profileForm.coverUrl.trim() || null;

    const profileUpdates = {
      name: profileForm.name.trim(),
      avatar_url: avatarUrl,
      cover_url: coverUrl,
      phone: profileForm.mobile.trim() || null,
      mobile_phone: profileForm.mobile.trim() || null,
      home_phone: profileForm.homePhone.trim() || null,
      work_phone: profileForm.workPhone.trim() || null,
      address: profileForm.address.trim() || null,
      date_of_birth: profileForm.birthdate || null,
      emergency_contact_name: profileForm.emergencyName.trim() || null,
      emergency_contact_phone: profileForm.emergencyPhone.trim() || null,
      emergency_contact_relationship: profileForm.emergencyRelationship.trim() || null,
      preferred_aircraft_id: profileForm.preferredAircraftId || null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateUserError } = await supabase
      .from('users')
      .update(profileUpdates)
      .eq('id', user.id);

    if (updateUserError) throw updateUserError;

    if (isStudentOrPilot) {
      const { error: studentError } = await supabase
        .from('students')
        .upsert({
          id: user.id,
          date_of_birth: profileForm.birthdate || null,
          emergency_contact_name: profileForm.emergencyName.trim() || null,
          emergency_contact_phone: profileForm.emergencyPhone.trim() || null,
          emergency_contact_relationship: profileForm.emergencyRelationship.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (studentError) throw studentError;
    }

    if (pendingEndorsements.length > 0) {
      for (const endorsement of pendingEndorsements) {
        const { storagePath, documentId } = await uploadEndorsementProof(endorsement.proofFile!, endorsement.type);
        const { error: endorsementError } = await supabase
          .from('endorsements')
          .insert({
            student_id: user.id,
            type: endorsement.type.trim(),
            date_obtained: endorsement.dateObtained,
            expiry_date: endorsement.expiryDate || null,
            instructor_id: null,
            is_active: endorsement.isActive,
          });

        if (endorsementError) {
          if (documentId) {
            await supabase.from('student_documents').delete().eq('id', documentId);
          }
          await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).remove([storagePath]);
          throw endorsementError;
        }
      }

      await reconcilePilotStatusForUser({
        userId: user.id,
        endorsements: [
          ...existingEndorsements,
          ...pendingEndorsements.map(endorsement => ({
            type: endorsement.type.trim(),
            dateObtained: endorsement.dateObtained ? new Date(endorsement.dateObtained) : new Date(),
            expiryDate: endorsement.expiryDate ? new Date(endorsement.expiryDate) : undefined,
            isActive: endorsement.isActive,
          })),
        ],
        pilotStatusEndorsementTypes: trainingSettings.pilotStatusEndorsementTypes,
        currentRole: user.role,
        currentRoles: user.roles,
      });
    }

    await updatePreferences({
      ...preferenceForm,
      background_image_url: '',
    });
    setProfileForm(prev => ({
      ...prev,
      avatarUrl: avatarUrl || '',
      coverUrl: coverUrl || '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      email: trimmedEmail === currentEmail ? trimmedEmail : savedProfile.email,
    }));
    await fetchProfile();
    await refreshUser();
    toast.success('Account settings saved');
  };

  const updateProfile = (field: keyof ProfileFormData, value: string) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleImageChange = (file: File | undefined, kind: 'avatar' | 'cover') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file');
      return;
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      toast.error('Image must be smaller than 15 MB');
      return;
    }
    if (kind === 'avatar') setAvatarFile(file);
    if (kind === 'cover') setCoverFile(file);
    onFormChange();
  };

  const removeAvatar = () => {
    setAvatarFile(null);
    updateProfile('avatarUrl', '');
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const removeCover = () => {
    setCoverFile(null);
    updateProfile('coverUrl', '');
    if (coverInputRef.current) coverInputRef.current.value = '';
  };

  const updatePreference = (field: PreferenceField, value: string | boolean | number) => {
    setPreferenceForm(prev => ({ ...prev, [field]: value }));
    if (field === 'theme') {
      applyPortalTheme(value);
      storePortalTheme(value, user?.id);
    }
    onFormChange();
  };

  const Toggle = ({ field, label, description }: { field: PreferenceField; label: string; description: string }) => (
    <label className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3">
      <input
        type="checkbox"
        checked={Boolean(preferenceForm[field])}
        onChange={event => updatePreference(field, event.target.checked)}
        disabled={!canEdit}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );

  const Select = ({ field, label, children }: { field: PreferenceField; label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <select
        value={String(preferenceForm[field])}
        onChange={event => updatePreference(field, event.target.value)}
        disabled={!canEdit}
        className={inputClass}
      >
        {children}
      </select>
    </div>
  );

  const Field = ({
    label,
    field,
    type = 'text',
    placeholder,
  }: {
    label: string;
    field: keyof ProfileFormData;
    type?: string;
    placeholder?: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type={type}
        value={profileForm[field]}
        onChange={event => updateProfile(field, event.target.value)}
        disabled={!canEdit}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );

  const ImageSetting = ({
    label,
    description,
    preview,
    file,
    inputRef,
    onChoose,
    onRemove,
    shape = 'rectangle',
  }: {
    label: string;
    description: string;
    preview: string;
    file: File | null;
    inputRef: React.RefObject<HTMLInputElement>;
    onChoose: (file: File | undefined) => void;
    onRemove: () => void;
    shape?: 'avatar' | 'rectangle';
  }) => (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <div className={`relative flex flex-shrink-0 items-center justify-center overflow-hidden bg-blue-600 text-white ${
          shape === 'avatar' ? 'h-20 w-20 rounded-full ring-4 ring-blue-50' : 'h-20 w-32 rounded-lg border border-gray-200'
        }`}>
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : shape === 'avatar' ? (
            <User className="h-9 w-9" />
          ) : (
            <Camera className="h-8 w-8 text-white/80" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          <p className="mt-1 text-xs text-gray-500">{description}</p>
          {file && <p className="mt-1 truncate text-xs text-blue-600">{file.name}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={event => onChoose(event.target.files?.[0])}
          disabled={!canEdit || imageUploading}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canEdit || imageUploading}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Change
        </button>
        {(preview || file) && (
          <button
            type="button"
            onClick={onRemove}
            disabled={!canEdit || imageUploading}
            className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        )}
      </div>
    </div>
  );

  const timezones = [
    'Australia/Melbourne',
    'Australia/Sydney',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Perth',
    'Australia/Darwin',
    'Australia/Hobart',
  ];

  const tabLabel = tabs.find(tab => tab.id === selectedTab)?.label || 'Account & Preferences';
  const introText = {
    info: 'Update your personal details, contact numbers, emergency contact, preferred aircraft and self-uploaded endorsements.',
    security: 'Manage your password and account sign-in security.',
    calendar: 'Choose your personal date, time and calendar defaults.',
    notifications: 'Tune notifications for your own account.',
    appearance: 'Adjust display preferences for your own account.',
    dashboard: 'Choose which personal dashboard panels appear where supported.',
  }[selectedTab];

  if (!user) {
    return <div className="p-6"><p className="text-gray-500">Sign in to manage your account settings.</p></div>;
  }

  if (loading || profileLoading) {
    return <div className="p-6 flex items-center justify-center"><div className="text-gray-500">Loading account settings...</div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <User className="h-5 w-5 mr-2" />
          {showInternalTabs ? 'Account & Preferences' : tabLabel}
        </h2>
        <p className="text-gray-600">{showInternalTabs ? 'Update your personal details, password, preferred aircraft and display preferences.' : introText}</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {showInternalTabs && (
        <div className="app-tab-scroller">
          <nav className="app-tab-list">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`app-tab-button ${selectedTab === tab.id ? 'app-tab-button-active' : ''}`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {selectedTab === 'info' && (
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Personal Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name" field="name" />
              <Field label="Email" field="email" type="email" />
              <Field label="Birthdate" field="birthdate" type="date" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Preferred Aircraft</label>
                <select
                  value={profileForm.preferredAircraftId}
                  onChange={event => updateProfile('preferredAircraftId', event.target.value)}
                  disabled={!canEdit}
                  className={inputClass}
                >
                  <option value="">Use first available aircraft</option>
                  {aircraft.filter(a => !a.isArchived).map(a => (
                    <option key={a.id} value={a.id}>{a.registration} - {a.make} {a.model}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">Email changes are sent through Supabase verification before the login email changes.</p>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Phone className="h-5 w-5 mr-2 text-blue-600" />
              Contact Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Mobile" field="mobile" type="tel" />
              <Field label="Home Number" field="homePhone" type="tel" />
              <Field label="Work Number" field="workPhone" type="tel" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
              <textarea
                value={profileForm.address}
                onChange={event => updateProfile('address', event.target.value)}
                disabled={!canEdit}
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-blue-600" />
              Emergency Contact
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Contact Name" field="emergencyName" />
              <Field label="Contact Phone" field="emergencyPhone" type="tel" />
              <Field label="Relationship" field="emergencyRelationship" />
            </div>
          </section>

          {isStudentOrPilot && (
            <section className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Endorsements</h3>
                  <p className="text-sm text-gray-500">Upload your endorsement proof here and it will also appear in your Documents tab.</p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={addPendingEndorsement}
                    className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <Plus className="h-4 w-4" />
                    Add endorsement
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-900">Current endorsements</h4>
                {existingEndorsements.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500">No endorsements are currently recorded on your profile.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {existingEndorsements.map(endorsement => (
                      <div key={endorsement.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{endorsement.type}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${endorsement.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                            {endorsement.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Obtained {endorsement.dateObtained.toLocaleDateString()}
                          {endorsement.expiryDate ? ` • Expires ${endorsement.expiryDate.toLocaleDateString()}` : ' • No expiry recorded'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {pendingEndorsements.length > 0 && (
                <div className="space-y-4">
                  {pendingEndorsements.map(endorsement => (
                    <div key={endorsement.localId} className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">New endorsement</h4>
                          <p className="text-xs text-gray-500">This will be saved when you save your account settings.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePendingEndorsement(endorsement.localId)}
                          disabled={!canEdit}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">Endorsement</label>
                          <select
                            value={endorsement.type}
                            onChange={event => updatePendingEndorsement(endorsement.localId, 'type', event.target.value)}
                            disabled={!canEdit}
                            className={inputClass}
                          >
                            <option value="">Select endorsement</option>
                            {trainingSettings.endorsementTypes.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">Date obtained</label>
                          <input
                            type="date"
                            value={endorsement.dateObtained}
                            onChange={event => updatePendingEndorsement(endorsement.localId, 'dateObtained', event.target.value)}
                            disabled={!canEdit}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">Expiry date</label>
                          <input
                            type="date"
                            value={endorsement.expiryDate}
                            onChange={event => updatePendingEndorsement(endorsement.localId, 'expiryDate', event.target.value)}
                            disabled={!canEdit}
                            className={inputClass}
                          />
                        </div>
                        <label className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                          <input
                            type="checkbox"
                            checked={endorsement.isActive}
                            onChange={event => updatePendingEndorsement(endorsement.localId, 'isActive', event.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">Mark this endorsement active</span>
                        </label>
                      </div>

                      <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-white p-4">
                        <label className="mb-2 block text-sm font-medium text-gray-700">Proof of endorsement</label>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"
                          onChange={event => updatePendingEndorsement(endorsement.localId, 'proofFile', event.target.files?.[0] || null)}
                          disabled={!canEdit}
                          className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
                        />
                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                          <FileUp className="h-3.5 w-3.5" />
                          {endorsement.proofFile ? `${endorsement.proofFile.name} will be saved into Documents` : 'Upload the certificate, logbook extract or other proof document'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {selectedTab === 'security' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Password</h3>
          <div className={`rounded-lg border px-4 py-3 ${emailVerified ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className={`mt-0.5 h-5 w-5 ${emailVerified ? 'text-green-600' : 'text-amber-600'}`} />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {emailVerified ? 'Your email is verified' : 'Verify your email before changing your password'}
                  </p>
                  <p className="text-xs text-gray-600">
                    {emailVerified
                      ? 'Password changes can be made once your current password is confirmed.'
                      : 'We require email verification first so password changes stay tied to a confirmed email address.'}
                  </p>
                </div>
              </div>
              {!emailVerified && (
                <button
                  type="button"
                  onClick={sendVerificationEmail}
                  disabled={sendingVerification}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingVerification ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Resend verification email
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-gray-500">Password changes require your current password before a new password is saved.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Current Password" field="currentPassword" type="password" />
            <Field label="New Password" field="newPassword" type="password" />
            <Field label="Confirm New Password" field="confirmPassword" type="password" />
          </div>
        </section>
      )}

      {selectedTab === 'calendar' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Globe className="h-5 w-5 mr-2 text-blue-600" />
            Date, Time & Calendar
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select field="timezone" label="Timezone">{timezones.map(timezone => <option key={timezone} value={timezone}>{timezone}</option>)}</Select>
            <Select field="date_format" label="Date Format">
              <option value="dd/MM/yyyy">DD/MM/YYYY</option>
              <option value="MM/dd/yyyy">MM/DD/YYYY</option>
              <option value="yyyy-MM-dd">YYYY-MM-DD</option>
              <option value="d MMM yyyy">1 Jan 2026</option>
            </Select>
            <Select field="time_format" label="Time Format">
              <option value="24h">24 Hour (14:30)</option>
              <option value="12h">12 Hour (2:30 PM)</option>
            </Select>
            <Select field="default_calendar_view" label="Default Calendar View">
              <option value="day">Day View</option>
              <option value="week">Week View</option>
              <option value="month">Month View</option>
            </Select>
          </div>
        </section>
      )}

      {selectedTab === 'notifications' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Notification Preferences</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Toggle field="email_notifications" label="Email notifications" description="Receive allowed CRM notifications by email when delivery is connected." />
            <Toggle field="sms_notifications" label="SMS notifications" description="Receive urgent notifications by SMS when SMS delivery is connected." />
            <Toggle field="booking_reminders" label="Booking reminders" description="Receive booking reminders where configured." />
            <Toggle field="currency_alerts" label="Currency alerts" description="Receive alerts for medical, licence, membership and BFR expiry dates." />
            {hasStaffRole && <Toggle field="maintenance_alerts" label="Maintenance alerts" description="Receive aircraft maintenance and defect-related alerts." />}
          </div>
        </section>
      )}

      {selectedTab === 'appearance' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Appearance</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select field="theme" label="Theme">
              <option value="light">Light</option>
              <option value="semi-dark">Semi-dark</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto (System)</option>
            </Select>
            <div className="flex items-end">
              <Toggle field="compact_view" label="Compact view" description="Use denser lists and tables where supported." />
            </div>
          </div>
          <div className="space-y-3">
            <ImageSetting
              label="Profile photo"
              description="Shown in the header, members list and your profile card. Originals up to 15 MB are saved as a 512px WebP."
              preview={avatarPreview || profileForm.avatarUrl}
              file={avatarFile}
              inputRef={avatarInputRef}
              onChoose={file => handleImageChange(file, 'avatar')}
              onRemove={removeAvatar}
              shape="avatar"
            />
            <ImageSetting
              label="Cover photo"
              description="Shown across the top of your profile page. Saved as an optimized 1600 x 600 WebP."
              preview={coverPreview || profileForm.coverUrl}
              file={coverFile}
              inputRef={coverInputRef}
              onChoose={file => handleImageChange(file, 'cover')}
              onRemove={removeCover}
            />
          </div>
          <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-[1fr_220px] md:items-center">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Background colour</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={preferenceForm.background_color || '#f3f4f6'}
                    onChange={event => updatePreference('background_color', event.target.value)}
                    disabled={!canEdit}
                    className="h-10 w-14 rounded-md border border-gray-300 bg-white p-1 disabled:opacity-50"
                  />
                  <input
                    type="text"
                    value={preferenceForm.background_color || '#f3f4f6'}
                    onChange={event => updatePreference('background_color', event.target.value)}
                    disabled={!canEdit}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => updatePreference('background_color', '#f3f4f6')}
                    disabled={!canEdit}
                    className="whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Back to default
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">Used behind the CRM shell. Keep it subtle so cards and tables remain easy to read.</p>
              </div>
            </div>
            <div
              className="relative h-32 overflow-hidden rounded-lg border border-gray-200"
              style={{ backgroundColor: preferenceForm.background_color || '#f3f4f6' }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-md bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-sm">Preview</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {selectedTab === 'dashboard' && isStudentOrPilot && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Portal Dashboard</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Toggle field="show_progress_dashboard" label="Training progress" description="Show training progress summaries on your dashboard." />
            <Toggle field="show_upcoming_bookings" label="Upcoming bookings" description="Show your upcoming bookings on your dashboard." />
            <Toggle field="show_recent_activity" label="Recent activity" description="Show recent training, booking and account activity." />
          </div>
        </section>
      )}
    </div>
  );
};

const accountSection = (activeAccountTab: AccountTab, saveKey: string) => {
  const Section: React.FC<PersonalPreferencesSettingsProps> = ({ canEdit, onFormChange }) => (
    <PersonalPreferencesSettings
      canEdit={canEdit}
      onFormChange={onFormChange}
      activeAccountTab={activeAccountTab}
      saveKey={saveKey}
      showInternalTabs={false}
    />
  );
  return Section;
};

export const UpdateMyInfoSettings = accountSection('info', 'account-info');
export const AccountSecuritySettings = accountSection('security', 'account-security');
export const AccountCalendarSettings = accountSection('calendar', 'account-calendar');
export const AccountNotificationSettings = accountSection('notifications', 'account-notifications');
export const AccountAppearanceSettings = accountSection('appearance', 'account-appearance');
export const AccountDashboardSettings = accountSection('dashboard', 'account-dashboard');
