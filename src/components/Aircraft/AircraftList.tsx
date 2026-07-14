import React, { useRef, useEffect } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AircraftForm } from './AircraftForm';
import { DefectReportForm } from '../Maintenance/DefectReportForm';
import { Aircraft, Defect } from '../../types';
import { Plane, Wrench, AlertTriangle, CheckCircle, Flag, Loader2, Eye, FileText, MoreVertical, Pencil, Copy, ShieldCheck, Archive, RotateCcw } from 'lucide-react';
import { useAircraft } from '../../hooks/useAircraft';
import { useMaintenanceMilestones } from '../../hooks/useMaintenanceMilestones';
import { useAuth } from '../../context/AuthContext';
import { usePageLoadState } from '../../context/PageLoadContext';
import { getAircraftIconSrc } from '../../utils/aircraftIcons';

export const AircraftList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.roles?.includes('admin');
  const isStaff = isAdmin
    || user?.role === 'instructor'
    || user?.role === 'senior_instructor'
    || user?.roles?.some(role => role === 'instructor' || role === 'senior_instructor');
  const canSeeMaintenancePlanning = isStaff;
  const { aircraft, loading, addAircraft, updateAircraft, reportDefect, archiveAircraft, restoreAircraft } = useAircraft({ includeRates: false });
  const { milestones, loading: milestonesLoading } = useMaintenanceMilestones();
  const [showAircraftForm, setShowAircraftForm] = useState(false);
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [editingAircraft, setEditingAircraft] = useState<Aircraft | null>(null);
  const [duplicatingAircraft, setDuplicatingAircraft] = useState<Aircraft | null>(null);
  const [selectedAircraftForDefect, setSelectedAircraftForDefect] = useState<string>('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  usePageLoadState(
    loading || milestonesLoading,
    'Loading aircraft',
    'Preparing fleet status, defects, documents and maintenance milestones...'
  );

  const handleAddAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'>) => {
    await addAircraft(aircraftData);
    setShowAircraftForm(false);
  };

  const handleEditAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'>) => {
    if (editingAircraft) {
      await updateAircraft(editingAircraft.id, aircraftData);
      setEditingAircraft(null);
      setShowAircraftForm(false);
    }
  };

  const openEditForm = (aircraft: Aircraft) => {
    setDuplicatingAircraft(null);
    setEditingAircraft(aircraft);
    setShowAircraftForm(true);
  };

  const openDuplicateForm = (aircraft: Aircraft) => {
    setEditingAircraft(null);
    setDuplicatingAircraft(aircraft);
    setShowAircraftForm(true);
  };

  const closeAircraftForm = () => {
    setShowAircraftForm(false);
    setEditingAircraft(null);
    setDuplicatingAircraft(null);
  };

  if (loading || milestonesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const handleReportDefect = (aircraftId: string) => {
    setSelectedAircraftForDefect(aircraftId);
    setShowDefectForm(true);
  };

  const handleDefectSubmit = async (defectData: Omit<Defect, 'id'>) => {
    try {
      await reportDefect(defectData);
      setSelectedAircraftForDefect('');
    } catch (error) {
      console.error('Error reporting defect:', error);
      throw error;
    }
  };

  const openViewModal = (aircraft: Aircraft) => {
    navigate(`/aircraft/${aircraft.id}`);
  };

  const handleArchiveAircraft = async (aircraftItem: Aircraft) => {
    const confirmed = window.confirm(
      `Archive ${aircraftItem.registration}?\n\nIt will be removed from calendar booking options, but flight logs, student records, defects and maintenance history will be retained.`
    );
    if (!confirmed) return;
    await archiveAircraft(aircraftItem.id, user?.id);
    setOpenMenuId(null);
  };

  const handleRestoreAircraft = async (aircraftItem: Aircraft) => {
    const confirmed = window.confirm(
      `Restore ${aircraftItem.registration}?\n\nIt will become available again in calendar resource lists and booking forms if it is serviceable.`
    );
    if (!confirmed) return;
    await restoreAircraft(aircraftItem.id);
    setOpenMenuId(null);
  };
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'serviceable':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'unserviceable':
        return <AlertTriangle className="h-5 w-5 text-red-600" />;
      case 'maintenance':
        return <Wrench className="h-5 w-5 text-yellow-600" />;
      default:
        return <Plane className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'serviceable':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'unserviceable':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'maintenance':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getNextMilestone = (aircraftId: string) => {
    const aircraftMilestones = milestones.filter(m =>
      m.aircraftId === aircraftId
      && m.status !== 'completed'
      && (m.nextDueHours !== undefined || m.nextDueDate)
    );
    if (aircraftMilestones.length === 0) return null;

    const ac = aircraft.find(a => a.id === aircraftId);
    if (!ac) return null;

    let soonest: any = null;
    let soonestDiff = Infinity;

    aircraftMilestones.forEach(milestone => {
      if (milestone.nextDueHours !== undefined) {
        const hoursRemaining = milestone.nextDueHours - ac.totalHours;
        if (hoursRemaining < soonestDiff) {
          soonestDiff = hoursRemaining;
          soonest = {
            title: milestone.title,
            type: 'hours',
            value: milestone.nextDueHours,
            remaining: hoursRemaining
          };
        }
      }
      if (milestone.nextDueDate) {
        const daysRemaining = Math.ceil((new Date(milestone.nextDueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysRemaining < soonestDiff) {
          soonestDiff = daysRemaining;
          soonest = {
            title: milestone.title,
            type: 'days',
            value: new Date(milestone.nextDueDate).toLocaleDateString(),
            remaining: daysRemaining
          };
        }
      }
    });

    return soonest;
  };

  const activeAircraft = aircraft.filter(item => !item.isArchived);
  const archivedAircraft = aircraft.filter(item => item.isArchived);
  const visibleAircraft = isAdmin
    ? aircraft.filter(item => {
        if (archiveFilter === 'archived') return item.isArchived;
        if (archiveFilter === 'all') return true;
        return !item.isArchived;
      })
    : activeAircraft;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Aircraft Fleet</h1>
        {isAdmin && (
          <button
            onClick={() => { setEditingAircraft(null); setDuplicatingAircraft(null); setShowAircraftForm(true); }}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plane className="h-4 w-4" />
            <span>Add Aircraft</span>
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
          {([
            ['active', `Active ${activeAircraft.length}`],
            ['archived', `Archived ${archivedAircraft.length}`],
            ['all', `All ${aircraft.length}`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setArchiveFilter(value)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                archiveFilter === value
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:bg-white hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleAircraft.map(aircraftItem => (
          <div key={aircraftItem.id} className={`rounded-lg border p-6 shadow-md transition-shadow hover:shadow-lg ${
            aircraftItem.isArchived
              ? 'border-gray-300 bg-gray-50 opacity-90'
              : 'border-gray-200 bg-white'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white/85 p-1 shadow-sm dark:border-slate-600 dark:bg-slate-800/90">
                  {getAircraftIconSrc(aircraftItem.iconKey) ? (
                    <img
                      src={getAircraftIconSrc(aircraftItem.iconKey)!}
                      alt=""
                      className="h-full w-full scale-110 object-contain drop-shadow-sm"
                    />
                  ) : (
                    <Plane className="h-6 w-6 text-blue-600" />
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{aircraftItem.registration}</h3>
                  <p className="text-sm text-gray-600">{aircraftItem.make} {aircraftItem.model}</p>
                </div>
              </div>
              {aircraftItem.isArchived ? <Archive className="h-5 w-5 text-gray-500" /> : getStatusIcon(aircraftItem.status)}
            </div>

            <div className="space-y-3">
              {aircraftItem.isArchived && (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                  Removed from new bookings
                  {aircraftItem.archivedAt && (
                    <span className="block">Archived {aircraftItem.archivedAt.toLocaleDateString('en-AU')}</span>
                  )}
                </div>
              )}

              {(aircraftItem.requiredEndorsementTypes?.length || aircraftItem.requiredEndorsementType || aircraftItem.requiredAllEndorsementTypes?.length || aircraftItem.requiredLicenceTypes?.length || aircraftItem.requiredAllLicenceTypes?.length) ? (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Solo hire requirements</p>
                    {aircraftItem.requiredAllLicenceTypes?.length ? <p className="mt-1 text-xs text-emerald-950"><strong>All licences:</strong> {aircraftItem.requiredAllLicenceTypes.join(', ')}</p> : null}
                    {aircraftItem.requiredLicenceTypes?.length ? <p className="mt-1 text-xs text-emerald-950"><strong>One licence:</strong> {aircraftItem.requiredLicenceTypes.join(', ')}</p> : null}
                    {aircraftItem.requiredAllEndorsementTypes && aircraftItem.requiredAllEndorsementTypes.length > 0 && (
                      <div className="mt-1">
                        <p className="text-[11px] font-semibold text-emerald-800">Must hold all</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {aircraftItem.requiredAllEndorsementTypes.map(type => (
                            <span key={`all-${type}`} className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-emerald-950">
                              {type}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(aircraftItem.requiredEndorsementTypes?.length || aircraftItem.requiredEndorsementType) && (
                      <div className="mt-1">
                        <p className="text-[11px] font-semibold text-emerald-800">Must hold one of</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {(aircraftItem.requiredEndorsementTypes?.length
                            ? aircraftItem.requiredEndorsementTypes
                            : aircraftItem.requiredEndorsementType
                              ? [aircraftItem.requiredEndorsementType]
                              : []
                          ).map(type => (
                            <span key={`any-${type}`} className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-emerald-950">
                              {type}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Total Hours</p>
                  <p className="font-semibold text-gray-900">{aircraftItem.totalHours}</p>
                </div>
                {canSeeMaintenancePlanning ? (
                  <div>
                    <p className="text-gray-500">Next Milestone</p>
                    {!milestonesLoading && getNextMilestone(aircraftItem.id) ? (
                      <p className="font-semibold text-gray-900 text-xs">
                        {getNextMilestone(aircraftItem.id)!.title}
                        <span className={`block ${getNextMilestone(aircraftItem.id)!.remaining < 10 ? 'text-red-600' : 'text-gray-600'}`}>
                          {getNextMilestone(aircraftItem.id)!.type === 'hours'
                            ? `${getNextMilestone(aircraftItem.id)!.remaining.toFixed(1)} hrs`
                            : `${getNextMilestone(aircraftItem.id)!.remaining} days`}
                        </span>
                      </p>
                    ) : (
                      <p className="font-semibold text-gray-500">-</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-gray-500">Open Defects</p>
                    <p className="font-semibold text-gray-900">{aircraftItem.defects.length}</p>
                  </div>
                )}
              </div>

              {canSeeMaintenancePlanning && aircraftItem.nextMaintenance && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Next Maintenance</p>
                  <p className="text-sm font-medium text-gray-900">
                    {aircraftItem.nextMaintenance.toLocaleDateString()}
                  </p>
                </div>
              )}

              {aircraftItem.defects.length > 0 && (
                <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
                  <p className="text-xs text-red-600 font-medium">Open Defects: {aircraftItem.defects.length}</p>
                  <p className="text-xs text-red-700 mt-1">
                    {aircraftItem.defects[0].summary || aircraftItem.defects[0].description}
                  </p>
                  {!isStaff && (
                    <p className="mt-1 text-[11px] text-red-600">
                      Reported {aircraftItem.defects[0].dateReported.toLocaleDateString('en-AU')}
                    </p>
                  )}
                  {!isStaff && aircraftItem.defects[0].photos && aircraftItem.defects[0].photos.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {aircraftItem.defects[0].photos.slice(0, 3).map((photo, index) => (
                        <a
                          key={`${photo}-${index}`}
                          href={photo}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                        >
                          Attachment {index + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-2" ref={openMenuId === aircraftItem.id ? menuRef : undefined}>
                <div className="relative">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === aircraftItem.id ? null : aircraftItem.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                    aria-label="Actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {openMenuId === aircraftItem.id && (
                    <div className="absolute right-0 bottom-full mb-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                      <button
                        onClick={() => { openViewModal(aircraftItem); setOpenMenuId(null); }}
                        className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Eye className="h-4 w-4 mr-2 text-gray-400" />
                        View Details
                      </button>
                      {isStaff && (
                        <button
                          onClick={() => { navigate(`/aircraft/${aircraftItem.id}/logs`); setOpenMenuId(null); }}
                          className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <FileText className="h-4 w-4 mr-2 text-gray-400" />
                          Flight Logs
                        </button>
                      )}
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => { openEditForm(aircraftItem); setOpenMenuId(null); }}
                            className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Pencil className="h-4 w-4 mr-2 text-gray-400" />
                            Edit
                          </button>
                          <button
                            onClick={() => { openDuplicateForm(aircraftItem); setOpenMenuId(null); }}
                            className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Copy className="h-4 w-4 mr-2 text-gray-400" />
                            Duplicate
                          </button>
                          {isAdmin && (
                            <>
                              <div className="border-t border-gray-100 my-1" />
                              {aircraftItem.isArchived ? (
                                <button
                                  onClick={() => void handleRestoreAircraft(aircraftItem)}
                                  className="flex items-center w-full px-3 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors"
                                >
                                  <RotateCcw className="h-4 w-4 mr-2" />
                                  Restore
                                </button>
                              ) : (
                                <button
                                  onClick={() => void handleArchiveAircraft(aircraftItem)}
                                  className="flex items-center w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                  <Archive className="h-4 w-4 mr-2" />
                                  Archive
                                </button>
                              )}
                            </>
                          )}
                        </>
                      )}
                      {isStaff && !aircraftItem.isArchived && (
                        <>
                          <div className="border-t border-gray-100 my-1" />
                          <button
                            onClick={() => { handleReportDefect(aircraftItem.id); setOpenMenuId(null); }}
                            className="flex items-center w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Flag className="h-4 w-4 mr-2" />
                            Report Defect
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {visibleAircraft.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-600">
          No aircraft match this view.
        </div>
      )}

      {showAircraftForm && isAdmin && (
        <AircraftForm
          isOpen
          onClose={closeAircraftForm}
          onSubmit={editingAircraft ? handleEditAircraft : handleAddAircraft}
          aircraft={editingAircraft || duplicatingAircraft || undefined}
          isEdit={!!editingAircraft}
          isDuplicate={!!duplicatingAircraft}
        />
      )}

      {showDefectForm && isStaff && (
        <DefectReportForm
          isOpen
          onClose={() => {
            setShowDefectForm(false);
            setSelectedAircraftForDefect('');
          }}
          onSubmit={handleDefectSubmit}
          preSelectedAircraftId={selectedAircraftForDefect}
        />
      )}

    </div>
  );
};
