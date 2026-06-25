import React, { useState, useEffect, useMemo } from 'react';
import { X, Plane, Save, Upload, Plus, Trash2, DollarSign, ShieldCheck, Link2, RefreshCw, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Aircraft, AircraftRate } from '../../types';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useAircraftRates } from '../../hooks/useAircraftRates';
import { useResourceSettings } from '../../hooks/useResourceSettings';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface AircraftFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (aircraft: any) => void;
  aircraft?: Aircraft;
  isEdit?: boolean;
  isDuplicate?: boolean;
}

interface MaintenanceMilestone {
  id: string;
  title: string;
  dueCondition: 'hours' | 'date';
  dueValue: string;
}

interface CostStructure {
  prepaid: number;
  payg: number;
  account: number;
}

interface UploadedDocument {
  file: File;
  documentType: string;
}

interface XeroTrackingOption {
  trackingOptionId: string;
  name: string;
  status: string;
}

interface XeroTrackingCategory {
  trackingCategoryId: string;
  name: string;
  status: string;
  options: XeroTrackingOption[];
}

type XeroTrackingVerification =
  | {
      status: 'not-linked' | 'saved-only' | 'not-connected';
      message: string;
    }
  | {
      status: 'verified';
      message: string;
      categoryName: string;
      optionName: string;
    }
  | {
      status: 'mismatch';
      message: string;
    };

const aircraftIconOptions = [
  { key: 'tecnam', label: 'Tecnam', src: '/aircraft-icons/tecnam.png' },
  { key: 'piper', label: 'Piper', src: '/aircraft-icons/piper.png' },
  { key: 'cessna', label: 'Cessna', src: '/aircraft-icons/cessna.png' },
  { key: 'sling', label: 'Sling', src: '/aircraft-icons/sling.png' },
  { key: 'twin', label: 'Twin', src: '/aircraft-icons/twin.png' },
];

export const AircraftForm: React.FC<AircraftFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  aircraft,
  isEdit = false,
  isDuplicate = false
}) => {
  const [formData, setFormData] = useState({
    registration: (isEdit && aircraft?.registration) ? aircraft.registration : '',
    make: aircraft?.make || '',
    model: aircraft?.model || '',
    type: aircraft?.type || 'single-engine' as const,
    tachStart: isEdit ? (aircraft?.totalHours || 0) : 0,
    fuelCapacity: aircraft?.fuelCapacity || 0,
    emptyWeight: aircraft?.emptyWeight || 0,
    maxWeight: aircraft?.maxWeight || 0,
    seatCapacity: aircraft?.seatCapacity || 2,
    status: aircraft?.status || 'serviceable' as const,
    totalHours: isEdit ? (aircraft?.totalHours || 0) : 0,
    requiredEndorsementType: aircraft?.requiredEndorsementType || '',
    requiredEndorsementTypes: aircraft?.requiredEndorsementTypes || (aircraft?.requiredEndorsementType ? [aircraft.requiredEndorsementType] : []),
    iconKey: aircraft?.iconKey || 'tecnam',
    xeroTrackingCategoryId: aircraft?.xeroTrackingCategoryId || '',
    xeroTrackingCategoryName: aircraft?.xeroTrackingCategoryName || 'Aircraft',
    xeroTrackingOptionId: aircraft?.xeroTrackingOptionId || '',
    xeroTrackingOptionName: aircraft?.xeroTrackingOptionName || aircraft?.registration || '',
  });

  const { flightTypes, paymentMethods, loading: billingLoading } = useBillingSettings();
  const { rates: existingRates, loading: ratesLoading, refetch: refetchRates } = useAircraftRates(aircraft?.id);
  const { aircraftFields, documentTypes } = useResourceSettings();
  const { settings: trainingSettings } = useTrainingSettings();

  const [aircraftRates, setAircraftRates] = useState<Partial<AircraftRate>[]>([]);

  const [costStructure, setCostStructure] = useState<{
    aircraft: CostStructure;
    instructor: CostStructure;
  }>({
    aircraft: {
      prepaid: aircraft?.hourlyRate || 0,
      payg: 0,
      account: 0
    },
    instructor: {
      prepaid: 85,
      payg: 95,
      account: 85
    }
  });

  // Re-fetch rates whenever the form opens for an aircraft
  useEffect(() => {
    if (isOpen && aircraft?.id) {
      refetchRates();
    }
  }, [isOpen, aircraft?.id]);

  // Build the rates grid once both flightTypes and existingRates are ready
  useEffect(() => {
    if (!isOpen || billingLoading || flightTypes.length === 0) return;
    // For edit mode wait until rates have finished loading
    if (isEdit && aircraft?.id && ratesLoading) return;

    setAircraftRates(
      flightTypes.filter(ft => ft.active).map(ft => {
        const saved = existingRates.find(r => r.flightTypeId === ft.id);
        return saved ?? {
          flightTypeId: ft.id,
          chargeType: 'not_used' as const,
          soloRate: 0,
          dualRate: 0,
          flatSurcharge: 0,
          weekendSurcharge: 0,
          defaultPaymentMethodId: null,
          includedTaxes: 0,
        };
      })
    );
  // Deliberately depend on existingRates so we repopulate after the fetch completes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEdit, aircraft?.id, flightTypes, existingRates, billingLoading, ratesLoading]);

  const [maintenanceMilestones, setMaintenanceMilestones] = useState<MaintenanceMilestone[]>([]);
  const [newMilestone, setNewMilestone] = useState({
    title: '',
    dueCondition: 'hours' as const,
    dueValue: ''
  });

  // Load existing milestones when editing
  useEffect(() => {
    if (!isOpen || !isEdit || !aircraft?.id) {
      if (!isOpen) setMaintenanceMilestones([]);
      return;
    }
    supabase
      .from('maintenance_milestones')
      .select('id, title, due_condition, due_value')
      .eq('aircraft_id', aircraft.id)
      .then(({ data }) => {
        if (data) {
          setMaintenanceMilestones(data.map(m => ({
            id: m.id,
            title: m.title,
            dueCondition: (m.due_condition as 'hours' | 'date') || 'hours',
            dueValue: m.due_value || '',
          })));
        }
      });
  }, [isOpen, isEdit, aircraft?.id]);

  const [uploadedFiles, setUploadedFiles] = useState<UploadedDocument[]>([]);
  const [existingDocumentTypes, setExistingDocumentTypes] = useState<string[]>([]);
  const [xeroTrackingCategories, setXeroTrackingCategories] = useState<XeroTrackingCategory[]>([]);
  const [xeroTrackingLoading, setXeroTrackingLoading] = useState(false);
  const [xeroTrackingSyncing, setXeroTrackingSyncing] = useState(false);
  const [xeroConnected, setXeroConnected] = useState<boolean | null>(null);

  const xeroTrackingVerification = useMemo<XeroTrackingVerification>(() => {
    const categoryId = formData.xeroTrackingCategoryId.trim();
    const optionId = formData.xeroTrackingOptionId.trim();
    const categoryName = formData.xeroTrackingCategoryName.trim();
    const optionName = formData.xeroTrackingOptionName.trim();

    if (!categoryId && !optionId && !categoryName && !optionName) {
      return {
        status: 'not-linked',
        message: 'This aircraft is not linked to any Xero tracking category yet.',
      };
    }

    if (xeroConnected === false) {
      return {
        status: 'not-connected',
        message: 'Xero is not connected right now, so this link cannot be verified against live Xero data.',
      };
    }

    if (!categoryId || !optionId) {
      return {
        status: 'saved-only',
        message: 'A category or option name has been saved locally, but it has not been verified against a live Xero ID yet.',
      };
    }

    if (!xeroTrackingCategories.length) {
      return {
        status: 'saved-only',
        message: 'A Xero link is saved on this aircraft. Refresh Xero to verify it still exists and is active.',
      };
    }

    const matchingCategory = xeroTrackingCategories.find((category) =>
      category.trackingCategoryId === categoryId ||
      category.name.trim().toLowerCase() === categoryName.toLowerCase()
    );

    if (!matchingCategory) {
      return {
        status: 'mismatch',
        message: `The saved Xero tracking category${categoryName ? ` "${categoryName}"` : ''} could not be found in Xero.`,
      };
    }

    if (String(matchingCategory.status || '').toUpperCase() !== 'ACTIVE') {
      return {
        status: 'mismatch',
        message: `The Xero tracking category "${matchingCategory.name}" exists but is not active.`,
      };
    }

    const matchingOption = (matchingCategory.options || []).find((option) =>
      option.trackingOptionId === optionId ||
      option.name.trim().toLowerCase() === optionName.toLowerCase()
    );

    if (!matchingOption) {
      return {
        status: 'mismatch',
        message: `The saved aircraft option${optionName ? ` "${optionName}"` : ''} could not be found in the Xero category "${matchingCategory.name}".`,
      };
    }

    if (String(matchingOption.status || '').toUpperCase() !== 'ACTIVE') {
      return {
        status: 'mismatch',
        message: `The Xero aircraft option "${matchingOption.name}" exists but is not active.`,
      };
    }

    return {
      status: 'verified',
      message: 'This aircraft link has been verified against the current live Xero tracking category and option.',
      categoryName: matchingCategory.name,
      optionName: matchingOption.name,
    };
  }, [
    formData.xeroTrackingCategoryId,
    formData.xeroTrackingCategoryName,
    formData.xeroTrackingOptionId,
    formData.xeroTrackingOptionName,
    xeroConnected,
    xeroTrackingCategories,
  ]);

  const loadXeroTrackingCategories = async ({ silent = true }: { silent?: boolean } = {}) => {
    setXeroTrackingLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ categories?: XeroTrackingCategory[] }>('xero-sync', {
        body: { action: 'list-tracking-categories' }
      });
      if (error) throw error;
      setXeroTrackingCategories(data?.categories || []);
      setXeroConnected(true);
    } catch (error: any) {
      const message = String(error?.message || '');
      setXeroTrackingCategories([]);
      if (message.toLowerCase().includes('xero is not connected')) {
        setXeroConnected(false);
      } else if (message.toLowerCase().includes('only admins can sync xero')) {
        setXeroConnected(false);
      } else {
        setXeroConnected(false);
        if (!silent) {
          toast.error(message || 'Failed to load Xero tracking categories');
        }
      }
    } finally {
      setXeroTrackingLoading(false);
    }
  };

  const ensureXeroTrackingLink = async () => {
    const categoryName = formData.xeroTrackingCategoryName.trim();
    const optionName = formData.xeroTrackingOptionName.trim();
    if (!categoryName || !optionName) return null;

    setXeroTrackingSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        categoryCreated?: boolean;
        optionCreated?: boolean;
        category?: XeroTrackingCategory;
        option?: XeroTrackingOption;
      }>('xero-sync', {
        body: {
          action: 'ensure-aircraft-tracking',
          categoryName,
          optionName,
          categoryId: formData.xeroTrackingCategoryId || undefined,
        }
      });
      if (error) throw error;

      const category = data?.category;
      const option = data?.option;
      if (!category?.trackingCategoryId || !option?.trackingOptionId) {
        throw new Error('Xero tracking link did not return a category and option.');
      }

      setFormData(prev => ({
        ...prev,
        xeroTrackingCategoryId: category.trackingCategoryId,
        xeroTrackingCategoryName: category.name,
        xeroTrackingOptionId: option.trackingOptionId,
        xeroTrackingOptionName: option.name,
      }));

      await loadXeroTrackingCategories();

      toast.success(
        data?.categoryCreated
          ? 'Created the Xero tracking category and linked this aircraft.'
          : data?.optionCreated
            ? 'Created the Xero aircraft tracking option and linked it.'
            : 'Linked this aircraft to the existing Xero tracking option.'
      );

      return {
        xeroTrackingCategoryId: category.trackingCategoryId,
        xeroTrackingCategoryName: category.name,
        xeroTrackingOptionId: option.trackingOptionId,
        xeroTrackingOptionName: option.name,
      };
    } catch (error: any) {
      toast.error(error?.message || 'Failed to link this aircraft to Xero tracking');
      throw error;
    } finally {
      setXeroTrackingSyncing(false);
    }
  };

  const fieldSetting = (id: string) => aircraftFields.find(field => field.id === id);
  const isFieldVisible = (id: string) => fieldSetting(id)?.visible !== false;
  const isFieldRequired = (id: string) => fieldSetting(id)?.required === true;

  useEffect(() => {
    if (!isOpen || !isEdit || !aircraft?.id) {
      setExistingDocumentTypes([]);
      return;
    }
    supabase
      .from('aircraft_documents')
      .select('document_type')
      .eq('aircraft_id', aircraft.id)
      .then(({ data }) => setExistingDocumentTypes((data || []).map(document => document.document_type).filter(Boolean)));
  }, [isOpen, isEdit, aircraft?.id]);

  useEffect(() => {
    if (!isOpen) return;
    void loadXeroTrackingCategories();
  }, [isOpen]);

  useEffect(() => {
    if (aircraft && (isEdit || isDuplicate)) {
      setFormData({
        registration: isEdit ? aircraft.registration : '',
        make: aircraft.make,
        model: aircraft.model,
        type: aircraft.type,
        tachStart: isEdit ? (aircraft.tachStart || aircraft.totalHours || 0) : 0,
        fuelCapacity: aircraft.fuelCapacity || 0,
        emptyWeight: aircraft.emptyWeight || 0,
        maxWeight: aircraft.maxWeight || 0,
        seatCapacity: aircraft.seatCapacity || 2,
        status: aircraft.status,
        totalHours: isEdit ? (aircraft.totalHours || 0) : 0,
        requiredEndorsementType: aircraft.requiredEndorsementType || '',
        requiredEndorsementTypes: aircraft.requiredEndorsementTypes || (aircraft.requiredEndorsementType ? [aircraft.requiredEndorsementType] : []),
        iconKey: aircraft.iconKey || 'tecnam',
        xeroTrackingCategoryId: aircraft.xeroTrackingCategoryId || '',
        xeroTrackingCategoryName: aircraft.xeroTrackingCategoryName || 'Aircraft',
        xeroTrackingOptionId: aircraft.xeroTrackingOptionId || '',
        xeroTrackingOptionName: aircraft.xeroTrackingOptionName || aircraft.registration || '',
      });
      setCostStructure({
        aircraft: {
          prepaid: aircraft.aircraftRates?.prepaid || aircraft.hourlyRate || 0,
          payg: aircraft.aircraftRates?.payg || 0,
          account: aircraft.aircraftRates?.account || 0
        },
        instructor: {
          prepaid: aircraft.instructorRates?.prepaid || 85,
          payg: aircraft.instructorRates?.payg || 95,
          account: aircraft.instructorRates?.account || 85
        }
      });
    } else if (!aircraft && !isEdit && !isDuplicate) {
      setFormData({
        registration: '',
        make: '',
        model: '',
        type: 'single-engine',
        tachStart: 0,
        fuelCapacity: 0,
        emptyWeight: 0,
        maxWeight: 0,
        seatCapacity: 2,
        status: 'serviceable',
        totalHours: 0,
        requiredEndorsementType: '',
        requiredEndorsementTypes: [],
        iconKey: 'tecnam',
        xeroTrackingCategoryId: '',
        xeroTrackingCategoryName: 'Aircraft',
        xeroTrackingOptionId: '',
        xeroTrackingOptionName: '',
      });
      setCostStructure({
        aircraft: { prepaid: 0, payg: 0, account: 0 },
        instructor: { prepaid: 85, payg: 95, account: 85 }
      });
    }
  }, [aircraft, isEdit, isDuplicate]);

  useEffect(() => {
    if (!formData.registration) return;
    setFormData(prev => {
      if (prev.xeroTrackingOptionName && prev.xeroTrackingOptionName !== aircraft?.registration) {
        return prev;
      }
      return {
        ...prev,
        xeroTrackingOptionName: prev.xeroTrackingOptionName || prev.registration,
      };
    });
  }, [formData.registration, aircraft?.registration]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.registration || !formData.make || !formData.model) {
      toast.error('Registration, Make, and Model are required');
      return;
    }

    const numericValues: Record<string, number> = {
      tachStart: formData.tachStart,
      seatCapacity: formData.seatCapacity,
      fuelCapacity: formData.fuelCapacity,
      emptyWeight: formData.emptyWeight,
      maxWeight: formData.maxWeight,
    };
    const missingField = aircraftFields.find(field =>
      field.required && numericValues[field.id] !== undefined && numericValues[field.id] <= 0
    );
    if (missingField) {
      toast.error(`${missingField.name} is required`);
      return;
    }

    // Validate registration format
    const registrationRegex = /^[A-Z0-9-]{3,10}$/;
    if (!registrationRegex.test(formData.registration)) {
      toast.error('Registration must be 3-10 characters using letters, numbers, and hyphens');
      return;
    }

    let xeroTrackingData = {
      xeroTrackingCategoryId: formData.xeroTrackingCategoryId || null,
      xeroTrackingCategoryName: formData.xeroTrackingCategoryName.trim() || null,
      xeroTrackingOptionId: formData.xeroTrackingOptionId || null,
      xeroTrackingOptionName: formData.xeroTrackingOptionName.trim() || null,
      xeroTrackingLastSyncedAt: formData.xeroTrackingCategoryId && formData.xeroTrackingOptionId ? new Date() : undefined,
      xeroTrackingSyncError: xeroTrackingVerification.status === 'mismatch' ? xeroTrackingVerification.message : null as string | null,
    };

    if (
      xeroConnected &&
      formData.xeroTrackingCategoryName.trim() &&
      formData.xeroTrackingOptionName.trim() &&
      (!formData.xeroTrackingCategoryId || !formData.xeroTrackingOptionId)
    ) {
      try {
        const ensured = await ensureXeroTrackingLink();
        if (ensured) {
          xeroTrackingData = {
            ...xeroTrackingData,
            ...ensured,
            xeroTrackingLastSyncedAt: new Date(),
            xeroTrackingSyncError: null,
          };
        }
      } catch {
        return;
      }
    }

    const aircraftData = {
      registration: formData.registration,
      make: formData.make,
      model: formData.model,
      type: formData.type,
      status: formData.status,
      totalHours: formData.tachStart,
      hourlyRate: costStructure.aircraft.prepaid,
      seatCapacity: formData.seatCapacity,
      fuelCapacity: formData.fuelCapacity,
      emptyWeight: formData.emptyWeight,
      maxWeight: formData.maxWeight,
      tachStart: formData.tachStart,
      requiredEndorsementType: formData.requiredEndorsementTypes[0] || formData.requiredEndorsementType || null,
      requiredEndorsementTypes: formData.requiredEndorsementTypes,
      iconKey: formData.iconKey || null,
      xeroTrackingCategoryId: xeroTrackingData.xeroTrackingCategoryId,
      xeroTrackingCategoryName: xeroTrackingData.xeroTrackingCategoryName,
      xeroTrackingOptionId: xeroTrackingData.xeroTrackingOptionId,
      xeroTrackingOptionName: xeroTrackingData.xeroTrackingOptionName,
      xeroTrackingLastSyncedAt: xeroTrackingData.xeroTrackingLastSyncedAt,
      xeroTrackingSyncError: xeroTrackingData.xeroTrackingSyncError,
      lastMaintenance: aircraft?.lastMaintenance,
      nextMaintenance: aircraft?.nextMaintenance,
      // Send ALL rates (not_used included) — hook will delete+reinsert non-not_used
      rates: aircraftRates.filter(r => r.chargeType !== 'not_used'),
      aircraftRates: {
        prepaid: costStructure.aircraft.prepaid,
        payg: costStructure.aircraft.payg,
        account: costStructure.aircraft.account
      },
      instructorRates: {
        prepaid: costStructure.instructor.prepaid,
        payg: costStructure.instructor.payg,
        account: costStructure.instructor.account
      },
      // Only pass newly-added milestones (temp IDs = numeric strings from Date.now())
      milestones: maintenanceMilestones
        .filter(m => m.id.match(/^\d+$/))
        .map(m => ({
          title: m.title,
          dueCondition: m.dueCondition,
          dueValue: m.dueValue
        })),
      documents: uploadedFiles.map(({ file, documentType }) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        documentType
      }))
    };

    await onSubmit(aircraftData);
    onClose();
  };

  const addMilestone = () => {
    if (!newMilestone.title || !newMilestone.dueValue) {
      toast.error('Please fill in milestone title and due value');
      return;
    }

    const milestone: MaintenanceMilestone = {
      id: Date.now().toString(),
      ...newMilestone
    };

    setMaintenanceMilestones(prev => [...prev, milestone]);
    setNewMilestone({ title: '', dueCondition: 'hours', dueValue: '' });
    toast.success('Maintenance milestone added');
  };

  const removeMilestone = async (milestoneId: string) => {
    // If it's a real DB record (uuid format), delete from DB
    if (isEdit && aircraft?.id && !milestoneId.match(/^\d+$/)) {
      await supabase.from('maintenance_milestones').delete().eq('id', milestoneId);
    }
    setMaintenanceMilestones(prev => prev.filter(m => m.id !== milestoneId));
    toast.success('Maintenance milestone removed');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files.map(file => ({ file, documentType: documentTypes[0]?.id || '' }))]);
    toast.success(`${files.length} file(s) uploaded`);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-50 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="sticky top-0 z-10 flex justify-between items-start gap-4 p-4 sm:p-6 border-b border-gray-200 bg-white">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-3 text-blue-700">
              <Plane className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {isEdit ? 'Edit Aircraft' : isDuplicate ? 'Duplicate Aircraft' : 'Add Aircraft'}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Set the aircraft details, hire eligibility, documents, maintenance, and pricing in one place.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Basic Information */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Plane className="h-5 w-5 mr-2" />
              Basic Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Registration *
                </label>
                <div className="space-y-1">
                <input
                  type="text"
                  value={formData.registration}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setFormData(prev => {
                      const shouldFollowRegistration =
                        !prev.xeroTrackingOptionName ||
                        prev.xeroTrackingOptionName === prev.registration ||
                        prev.xeroTrackingOptionName === aircraft?.registration;
                      return {
                        ...prev,
                        registration: value,
                        xeroTrackingOptionId: shouldFollowRegistration ? '' : prev.xeroTrackingOptionId,
                        xeroTrackingOptionName: shouldFollowRegistration ? value : prev.xeroTrackingOptionName,
                      };
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="VH-ABC or 24-4851"
                  pattern="[A-Z0-9-]{3,10}"
                  required
                />
                  <p className="text-xs text-gray-500">
                    Format: VH-ABC (Australian) or 24-4851 (Competition number)
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Make *
                </label>
                <input
                  type="text"
                  value={formData.make}
                  onChange={(e) => setFormData(prev => ({ ...prev, make: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Cessna"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Model *
                </label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="172"
                  required
                />
              </div>

              {isFieldVisible('type') && <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Aircraft Type {isFieldRequired('type') && '*'}
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="single-engine">Single Engine</option>
                  <option value="multi-engine">Multi Engine</option>
                  <option value="helicopter">Helicopter</option>
                </select>
              </div>}

              {isFieldVisible('tachStart') && <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tach Start {isFieldRequired('tachStart') && '*'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.tachStart}
                  onChange={(e) => setFormData(prev => ({ ...prev, tachStart: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>}

              {isFieldVisible('seatCapacity') && <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Seat Capacity {isFieldRequired('seatCapacity') && '*'}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.seatCapacity}
                  onChange={(e) => setFormData(prev => ({ ...prev, seatCapacity: parseInt(e.target.value) || 2 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>}
            </div>
          </div>

          {/* Specifications */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Specifications</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {isFieldVisible('fuelCapacity') && <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fuel Capacity (L) {isFieldRequired('fuelCapacity') && '*'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuelCapacity}
                  onChange={(e) => setFormData(prev => ({ ...prev, fuelCapacity: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>}

              {isFieldVisible('emptyWeight') && <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Empty Weight (kg) {isFieldRequired('emptyWeight') && '*'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.emptyWeight}
                  onChange={(e) => setFormData(prev => ({ ...prev, emptyWeight: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>}

              {isFieldVisible('maxWeight') && <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Weight (kg) {isFieldRequired('maxWeight') && '*'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.maxWeight}
                  onChange={(e) => setFormData(prev => ({ ...prev, maxWeight: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>}
            </div>

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Aircraft icon
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {aircraftIconOptions.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, iconKey: option.key }))}
                    className={`rounded-xl border p-2 text-center transition ${
                      formData.iconKey === option.key
                        ? 'border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-100'
                        : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/50'
                    }`}
                  >
                    <img src={option.src} alt="" className="mx-auto h-16 w-full object-contain" />
                    <span className="mt-2 block text-xs font-semibold text-gray-800">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
              <ShieldCheck className="h-5 w-5 mr-2 text-emerald-700" />
              Hire Eligibility
            </h3>
            <p className="mb-4 text-sm text-gray-600">
              Use this when an aircraft needs a specific endorsement before a pilot can hire it solo.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)] gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Allowed solo-hire endorsements
                </label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <label className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={formData.requiredEndorsementTypes.length === 0}
                      onChange={(e) => {
                        if (!e.target.checked) return;
                        setFormData(prev => ({
                          ...prev,
                          requiredEndorsementType: '',
                          requiredEndorsementTypes: [],
                        }));
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    No endorsement required
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {trainingSettings.endorsementTypes.map(type => {
                      const checked = formData.requiredEndorsementTypes.includes(type);
                      return (
                        <label
                          key={type}
                          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                            checked
                              ? 'border-blue-300 bg-blue-50 text-blue-900'
                              : 'border-gray-200 bg-white text-gray-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setFormData(prev => {
                                const nextTypes = e.target.checked
                                  ? Array.from(new Set([...prev.requiredEndorsementTypes, type]))
                                  : prev.requiredEndorsementTypes.filter(item => item !== type);
                                return {
                                  ...prev,
                                  requiredEndorsementTypes: nextTypes,
                                  requiredEndorsementType: nextTypes[0] || '',
                                };
                              });
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-medium">{type}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  A pilot can hire this aircraft solo if they hold any one of the selected endorsements. If none are held, the booking can still be requested but it will become pending approval.
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold">Instructor bookings are allowed.</p>
                <p className="mt-1">
                  If an instructor is selected, the endorsement rule does not block the booking because the flight is supervised.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                  <Link2 className="h-5 w-5 mr-2 text-blue-700" />
                  Xero Income Tracking
                </h3>
                <p className="text-sm text-gray-600">
                  Tag flight income against this aircraft in Xero. The usual setup is one tracking category such as <span className="font-semibold text-gray-900">Aircraft</span>, with one option per aircraft registration.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadXeroTrackingCategories({ silent: false })}
                disabled={xeroTrackingLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${xeroTrackingLoading ? 'animate-spin' : ''}`} />
                Refresh Xero
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tracking category name
                </label>
                <input
                  list="aircraft-xero-tracking-categories"
                  type="text"
                  value={formData.xeroTrackingCategoryName}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    xeroTrackingCategoryId: '',
                    xeroTrackingCategoryName: e.target.value,
                  }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Aircraft"
                />
                <datalist id="aircraft-xero-tracking-categories">
                  {xeroTrackingCategories.map(category => (
                    <option key={category.trackingCategoryId} value={category.name} />
                  ))}
                </datalist>
                <p className="mt-2 text-xs text-gray-500">
                  If the category does not exist yet, the link button can create it in Xero.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Aircraft option in that category
                </label>
                <input
                  type="text"
                  value={formData.xeroTrackingOptionName}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    xeroTrackingOptionId: '',
                    xeroTrackingOptionName: e.target.value,
                  }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="24-4851"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Usually this should match the aircraft registration so invoices group cleanly in Xero.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void ensureXeroTrackingLink()}
                disabled={xeroTrackingSyncing || !formData.xeroTrackingCategoryName.trim() || !formData.xeroTrackingOptionName.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {xeroTrackingSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Create / link in Xero
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex items-start gap-3">
                {xeroTrackingVerification.status === 'verified' ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
                ) : xeroTrackingVerification.status === 'mismatch' ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                ) : (
                  <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-500" />
                )}
                <div className="space-y-1">
                  <p className="font-medium text-slate-900">
                    {xeroTrackingVerification.status === 'verified'
                      ? 'Verified in Xero'
                      : xeroTrackingVerification.status === 'mismatch'
                        ? 'Needs attention'
                        : xeroTrackingVerification.status === 'not-connected'
                          ? 'Waiting for Xero connection'
                          : xeroTrackingVerification.status === 'saved-only'
                            ? 'Saved locally only'
                            : 'Not linked yet'}
                  </p>
                  <p className="text-slate-700">{xeroTrackingVerification.message}</p>
                  {xeroTrackingVerification.status === 'verified' && (
                    <p className="text-slate-800">
                      Xero category <span className="font-semibold">{xeroTrackingVerification.categoryName}</span> and option <span className="font-semibold">{xeroTrackingVerification.optionName}</span> are both active.
                    </p>
                  )}
                  {aircraft?.xeroTrackingLastSyncedAt && (
                    <p className="text-xs text-slate-500">
                      Last confirmed locally on {aircraft.xeroTrackingLastSyncedAt.toLocaleString()}.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cost Structure by Flight Type */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <DollarSign className="h-5 w-5 mr-2" />
              Cost Structure by Flight Type
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Configure rates for each flight type. Flight types are managed in Settings &gt; Billing & Rates.
            </p>

            {billingLoading ? (
              <div className="text-center py-4 text-gray-500">Loading flight types...</div>
            ) : aircraftRates.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                No flight types configured. Go to Settings &gt; Billing & Rates to add flight types.
              </div>
            ) : (
              <div className="space-y-4">
                {aircraftRates.map((rate, index) => {
                  const flightType = flightTypes.find(ft => ft.id === rate.flightTypeId);
                  if (!flightType) return null;

                  return (
                    <div key={rate.flightTypeId || index} className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">{flightType.name}</h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Charge Type *
                          </label>
                          <select
                            value={rate.chargeType}
                            onChange={(e) => {
                              const newRates = [...aircraftRates];
                              newRates[index] = { ...newRates[index], chargeType: e.target.value as any };
                              setAircraftRates(newRates);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="not_used">Not Used</option>
                            <option value="tach">Tach Increment</option>
                            <option value="flat">Flat Price</option>
                            <option value="per_pax">Price Per Passenger</option>
                            <option value="free">Free</option>
                          </select>
                        </div>

                        {rate.chargeType !== 'not_used' && rate.chargeType !== 'free' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Solo Rate ($)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={rate.soloRate}
                                onChange={(e) => {
                                  const newRates = [...aircraftRates];
                                  newRates[index] = { ...newRates[index], soloRate: parseFloat(e.target.value) || 0 };
                                  setAircraftRates(newRates);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Dual Rate ($)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={rate.dualRate}
                                onChange={(e) => {
                                  const newRates = [...aircraftRates];
                                  newRates[index] = { ...newRates[index], dualRate: parseFloat(e.target.value) || 0 };
                                  setAircraftRates(newRates);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Flat Surcharge ($)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={rate.flatSurcharge}
                                onChange={(e) => {
                                  const newRates = [...aircraftRates];
                                  newRates[index] = { ...newRates[index], flatSurcharge: parseFloat(e.target.value) || 0 };
                                  setAircraftRates(newRates);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Can be negative for discount"
                              />
                              <p className="text-xs text-gray-500 mt-1">Positive = surcharge, Negative = discount</p>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Weekend/Holiday Surcharge ($)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={rate.weekendSurcharge}
                                onChange={(e) => {
                                  const newRates = [...aircraftRates];
                                  newRates[index] = { ...newRates[index], weekendSurcharge: parseFloat(e.target.value) || 0 };
                                  setAircraftRates(newRates);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Default Payment Method
                              </label>
                              <select
                                value={rate.defaultPaymentMethodId || ''}
                                onChange={(e) => {
                                  const newRates = [...aircraftRates];
                                  newRates[index] = { ...newRates[index], defaultPaymentMethodId: e.target.value || null };
                                  setAircraftRates(newRates);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">None</option>
                                {paymentMethods.filter(pm => pm.active).map(pm => (
                                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Included Taxes ($)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={rate.includedTaxes}
                                onChange={(e) => {
                                  const newRates = [...aircraftRates];
                                  newRates[index] = { ...newRates[index], includedTaxes: parseFloat(e.target.value) || 0 };
                                  setAircraftRates(newRates);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Maintenance Milestones */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Maintenance Milestones</h3>
            
            {/* Add New Milestone */}
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Add Milestone</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={newMilestone.title}
                    onChange={(e) => setNewMilestone(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Milestone title (e.g., 100 hourly, hose replacement)"
                  />
                </div>
                <div>
                  <select
                    value={newMilestone.dueCondition}
                    onChange={(e) => setNewMilestone(prev => ({ ...prev, dueCondition: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="hours">Hours</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <div className="flex space-x-2">
                  <input
                    type={newMilestone.dueCondition === 'date' ? 'date' : 'number'}
                    value={newMilestone.dueValue}
                    onChange={(e) => setNewMilestone(prev => ({ ...prev, dueValue: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={newMilestone.dueCondition === 'hours' ? 'Hours' : ''}
                  />
                  <button
                    type="button"
                    onClick={addMilestone}
                    className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Current Milestones */}
            {maintenanceMilestones.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Current Milestones</h4>
                {maintenanceMilestones.map(milestone => (
                  <div key={milestone.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-blue-900">{milestone.title}</span>
                      <span className="text-xs text-blue-700 ml-2">
                        Due: {milestone.dueCondition === 'hours' ? `${milestone.dueValue} hours` : milestone.dueValue}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMilestone(milestone.id)}
                      className="text-red-600 hover:text-red-800 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Document Upload */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Documents</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload Documents (POH, Insurance, Maintenance Logs, etc.)
                </label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-4 text-gray-500" />
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500">PDF, DOC, DOCX, JPG, PNG (MAX. 10MB)</p>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Uploaded Files */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-700">Uploaded Files</h4>
                  {uploadedFiles.map((upload, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-700 flex-1 truncate">{upload.file.name}</span>
                      <select
                        value={upload.documentType}
                        onChange={(event) => setUploadedFiles(current => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, documentType: event.target.value } : item
                        ))}
                        className="mx-3 px-2 py-1 text-sm border border-gray-300 rounded-md"
                      >
                        {documentTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="text-red-600 hover:text-red-800 p-1"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 -mx-4 -mb-4 sm:-mx-6 sm:-mb-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 border-t border-gray-200 bg-white/95 px-4 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center justify-center space-x-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm"
            >
              <Save className="h-4 w-4" />
              <span>{isEdit ? 'Update Aircraft' : isDuplicate ? 'Add Duplicate' : 'Add Aircraft'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
