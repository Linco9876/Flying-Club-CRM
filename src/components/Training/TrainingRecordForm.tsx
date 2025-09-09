import React, { useState, useEffect } from 'react';
import { X, Save, Send, Clock, User, Plane, FileText, Upload, FileSignature as Signature, Check, Plus, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { mockAircraft, mockStudents, mockSyllabusSequences } from '../../data/mockData';
import { Booking, TrainingRecord, SyllabusSequence, TrainingSequenceResult } from '../../types';
import toast from 'react-hot-toast';

interface TrainingRecordFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (recordData: Omit<TrainingRecord, 'id'>) => void;
  booking?: Booking;
  existingRecord?: TrainingRecord;
  isEdit?: boolean;
}

interface SequenceEntry {
  sequence: SyllabusSequence;
  competence: 'NC' | 'S' | 'C' | '-';
}

interface FlightTolerance {
  id: string;
  category: string;
  items: {
    id: string;
    description: string;
    rating: 'excellent' | 'good' | 'satisfactory' | 'unsatisfactory' | '-';
  }[];
}

export const TrainingRecordForm: React.FC<TrainingRecordFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  booking,
  existingRecord,
  isEdit = false
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('header');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [sequenceSearch, setSequenceSearch] = useState('');
  const [showSequenceSearch, setShowSequenceSearch] = useState(false);
  const [instructorSignature, setInstructorSignature] = useState('');
  const [studentAckName, setStudentAckName] = useState('');

  // Get aircraft and student info from booking
  const aircraft = booking ? mockAircraft.find(a => a.id === booking.aircraftId) : null;
  const student = booking ? mockStudents.find(s => s.id === booking.studentId) : null;
  const instructor = booking ? mockStudents.find(s => s.id === booking.instructorId) : null;

  const [formData, setFormData] = useState({
    // Header Information
    date: existingRecord?.date.toISOString().split('T')[0] || booking?.startTime.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
    studentId: existingRecord?.studentId || booking?.studentId || '',
    instructorId: existingRecord?.instructorId || booking?.instructorId || user?.id || '',
    aircraftRegistration: existingRecord?.registration || aircraft?.registration || '',
    aircraftType: existingRecord?.aircraftType || aircraft?.type || 'single-engine',
    formalBriefing: existingRecord?.formalBriefing || false,
    
    // Flight Time
    dualTime: existingRecord ? (existingRecord.dualTimeMin / 60) : (booking?.instructorId ? ((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60)) : 0),
    soloTime: existingRecord ? (existingRecord.soloTimeMin / 60) : (!booking?.instructorId ? ((new Date(booking?.endTime || new Date()).getTime() - new Date(booking?.startTime || new Date()).getTime()) / (1000 * 60 * 60)) : 0),
    landings: 0,
    
    // Lesson Info
    lessonCode: '',
    nextLessonCode: '',
    lessonComments: existingRecord?.comments || '',
    
    // Footer
    studentAck: existingRecord?.studentAck || false
  });

  const [selectedSequences, setSelectedSequences] = useState<SequenceEntry[]>(
    existingRecord?.sequences.map(seq => ({
      sequence: mockSyllabusSequences.find(s => s.id === seq.sequenceId) || mockSyllabusSequences[0],
      competence: seq.competence
    })) || []
  );

  const [flightTolerances, setFlightTolerances] = useState<FlightTolerance[]>([
    {
      id: 'aircraft-handling',
      category: 'Aircraft Handling',
      items: [
        { id: 'pre-flight', description: 'Pre-flight Inspection', rating: '-' },
        { id: 'engine-start', description: 'Engine Start & Warm-up', rating: '-' },
        { id: 'taxiing', description: 'Taxiing', rating: '-' },
        { id: 'take-off', description: 'Take-off', rating: '-' },
        { id: 'climb', description: 'Climb', rating: '-' },
        { id: 'cruise', description: 'Cruise Flight', rating: '-' },
        { id: 'descent', description: 'Descent', rating: '-' },
        { id: 'approach', description: 'Approach', rating: '-' },
        { id: 'landing', description: 'Landing', rating: '-' }
      ]
    },
    {
      id: 'airmanship',
      category: 'Airmanship',
      items: [
        { id: 'lookout', description: 'Lookout', rating: '-' },
        { id: 'radio', description: 'Radio Procedures', rating: '-' },
        { id: 'navigation', description: 'Navigation', rating: '-' },
        { id: 'weather', description: 'Weather Assessment', rating: '-' },
        { id: 'decision-making', description: 'Decision Making', rating: '-' }
      ]
    },
    {
      id: 'emergency-procedures',
      category: 'Emergency Procedures',
      items: [
        { id: 'forced-landing', description: 'Forced Landing', rating: '-' },
        { id: 'engine-failure', description: 'Engine Failure', rating: '-' },
        { id: 'radio-failure', description: 'Radio Failure', rating: '-' },
        { id: 'lost-procedures', description: 'Lost Procedures', rating: '-' }
      ]
    }
  ]);

  const lessonCodes = [
    { value: 'L1', label: 'L1 - First Flight' },
    { value: 'L2', label: 'L2 - Aircraft Familiarization' },
    { value: 'L3', label: 'L3 - Straight & Level Flight' },
    { value: 'L4', label: 'L4 - Climbing & Descending' },
    { value: 'L5', label: 'L5 - Turning' },
    { value: 'L6', label: 'L6 - Slow Flight' },
    { value: 'L7', label: 'L7 - Stalling' },
    { value: 'L8', label: 'L8 - Spinning' },
    { value: 'L9', label: 'L9 - Circuits' },
    { value: 'L10', label: 'L10 - First Solo' },
    { value: 'L11', label: 'L11 - Advanced Circuits' },
    { value: 'L12', label: 'L12 - Forced Landings' },
    { value: 'L13', label: 'L13 - Navigation' },
    { value: 'L14', label: 'L14 - Cross Country' },
    { value: 'L15', label: 'L15 - Flight Test Prep' }
  ];

  const filteredSequences = mockSyllabusSequences.filter(seq =>
    seq.active && (
      seq.code.toLowerCase().includes(sequenceSearch.toLowerCase()) ||
      seq.title.toLowerCase().includes(sequenceSearch.toLowerCase())
    )
  );

  const addSequence = (sequence: SyllabusSequence) => {
    if (!selectedSequences.find(s => s.sequence.id === sequence.id)) {
      setSelectedSequences(prev => [...prev, { sequence, competence: '-' }]);
    }
    setSequenceSearch('');
    setShowSequenceSearch(false);
  };

  const removeSequence = (sequenceId: string) => {
    setSelectedSequences(prev => prev.filter(s => s.sequence.id !== sequenceId));
  };

  const updateSequenceCompetence = (sequenceId: string, competence: 'NC' | 'S' | 'C' | '-') => {
    setSelectedSequences(prev => prev.map(s =>
      s.sequence.id === sequenceId ? { ...s, competence } : s
    ));
  };

  const updateToleranceRating = (categoryId: string, itemId: string, rating: 'excellent' | 'good' | 'satisfactory' | 'unsatisfactory' | '-') => {
    setFlightTolerances(prev => prev.map(category =>
      category.id === categoryId
        ? {
            ...category,
            items: category.items.map(item =>
              item.id === itemId ? { ...item, rating } : item
            )
          }
        : category
    ));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    toast.success(`${files.length} file(s) uploaded`);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const calculateTotalTime = () => {
    const totalHours = formData.dualTime + formData.soloTime;
    return totalHours.toFixed(1);
  };

  const validateForm = () => {
    if (!formData.date || !formData.studentId || !formData.instructorId || !formData.aircraftRegistration) {
      toast.error('Please fill in all required header fields');
      return false;
    }

    if (!formData.lessonComments.trim()) {
      toast.error('Lesson comments are required');
      return false;
    }

    const totalTime = (formData.dualTime * 60) + (formData.soloTime * 60);
    if (totalTime === 0) {
      toast.error('Please enter either dual or solo time');
      return false;
    }

    return true;
  };

  const handleSaveDraft = () => {
    if (!validateForm()) return;

    const recordData: Omit<TrainingRecord, 'id'> = {
      bookingId: booking?.id,
      studentId: formData.studentId,
      instructorId: formData.instructorId,
      date: new Date(formData.date),
      aircraftId: booking?.aircraftId || '',
      aircraftType: formData.aircraftType,
      registration: formData.aircraftRegistration,
      dualTimeMin: formData.dualTime * 60,
      soloTimeMin: formData.soloTime * 60,
      comments: formData.lessonComments,
      formalBriefing: formData.formalBriefing,
      lessonCodes: formData.lessonCode ? [formData.lessonCode] : [],
      nextLesson: formData.nextLessonCode,
      status: 'draft',
      studentAck: false,
      attachments: uploadedFiles.map(f => f.name),
      auditLog: [],
      sequences: selectedSequences.map((s, index) => ({
        id: `${Date.now()}-${index}`,
        trainingRecordId: '',
        sequenceId: s.sequence.id,
        sequenceCode: s.sequence.code,
        sequenceTitle: s.sequence.title,
        competence: s.competence
      }))
    };

    onSubmit(recordData);
    toast.success('Training record saved as draft');
    onClose();
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    if (!instructorSignature) {
      toast.error('Instructor signature is required');
      return;
    }

    if (!formData.studentAck || !studentAckName) {
      toast.error('Student acknowledgement is required');
      return;
    }

    const recordData: Omit<TrainingRecord, 'id'> = {
      bookingId: booking?.id,
      studentId: formData.studentId,
      instructorId: formData.instructorId,
      date: new Date(formData.date),
      aircraftId: booking?.aircraftId || '',
      aircraftType: formData.aircraftType,
      registration: formData.aircraftRegistration,
      dualTimeMin: formData.dualTime * 60,
      soloTimeMin: formData.soloTime * 60,
      comments: formData.lessonComments,
      formalBriefing: formData.formalBriefing,
      lessonCodes: formData.lessonCode ? [formData.lessonCode] : [],
      nextLesson: formData.nextLessonCode,
      status: 'submitted',
      instructorSignatureUrl: `data:text/plain;base64,${btoa(instructorSignature)}`,
      studentAck: formData.studentAck,
      studentAckName: studentAckName,
      instructorSignTimestamp: new Date(),
      studentAckTimestamp: new Date(),
      attachments: uploadedFiles.map(f => f.name),
      auditLog: [],
      sequences: selectedSequences.map((s, index) => ({
        id: `${Date.now()}-${index}`,
        trainingRecordId: '',
        sequenceId: s.sequence.id,
        sequenceCode: s.sequence.code,
        sequenceTitle: s.sequence.title,
        competence: s.competence
      }))
    };

    onSubmit(recordData);
    toast.success('Training record submitted successfully');
    onClose();
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'header', label: 'Header Info', icon: <User className="h-4 w-4" /> },
    { id: 'flight', label: 'Flight Time', icon: <Clock className="h-4 w-4" /> },
    { id: 'lesson', label: 'Lesson Info', icon: <FileText className="h-4 w-4" /> },
    { id: 'sequences', label: 'Competency Grid', icon: <FileText className="h-4 w-4" /> },
    { id: 'tolerances', label: 'Flight Tolerances', icon: <Check className="h-4 w-4" /> },
    { id: 'attachments', label: 'Attachments', icon: <Upload className="h-4 w-4" /> },
    { id: 'signoff', label: 'Sign-off', icon: <Signature className="h-4 w-4" /> }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEdit ? 'Edit Training Record' : 'Training Record Form'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 overflow-x-auto">
          <nav className="flex space-x-8 px-6 min-w-max">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 pt-4">
          {activeTab === 'header' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Header Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Student *</label>
                  <input
                    type="text"
                    value={student?.name || 'Unknown Student'}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Instructor *</label>
                  {user?.role === 'admin' ? (
                    <select
                      value={formData.instructorId}
                      onChange={(e) => setFormData(prev => ({ ...prev, instructorId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {mockStudents.filter(s => s.role === 'instructor').map(instructor => (
                        <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={instructor?.name || user?.name || 'Unknown Instructor'}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Aircraft Registration *</label>
                  <select
                    value={formData.aircraftRegistration}
                    onChange={(e) => setFormData(prev => ({ ...prev, aircraftRegistration: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select Aircraft</option>
                    {mockAircraft.map(aircraft => (
                      <option key={aircraft.id} value={aircraft.registration}>
                        {aircraft.registration} - {aircraft.make} {aircraft.model}
                      </option>
                    ))}
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Aircraft Type</label>
                  <select
                    value={formData.aircraftType}
                    onChange={(e) => setFormData(prev => ({ ...prev, aircraftType: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="single-engine">Single Engine</option>
                    <option value="multi-engine">Multi Engine</option>
                    <option value="helicopter">Helicopter</option>
                  </select>
                </div>

                <div className="flex items-center space-x-3 pt-8">
                  <input
                    type="checkbox"
                    id="formalBriefing"
                    checked={formData.formalBriefing}
                    onChange={(e) => setFormData(prev => ({ ...prev, formalBriefing: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="formalBriefing" className="text-sm font-medium text-gray-700">
                    Formal Briefing
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'flight' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Flight Time</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Dual Time</label>
                  <div className="flex space-x-2">
                    <div className="flex-1">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={Math.floor(formData.dualTime)}
                        onChange={(e) => setFormData(prev => ({ ...prev, dualTime: parseInt(e.target.value) || 0 + (formData.dualTime % 1) }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Hours"
                      />
                    </div>
                    <span className="flex items-center text-gray-500">:</span>
                    <div className="flex-1">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        step="1"
                        value={Math.round((formData.dualTime % 1) * 60)}
                        onChange={(e) => setFormData(prev => ({ ...prev, dualTime: Math.floor(formData.dualTime) + (parseInt(e.target.value) || 0) / 60 }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Minutes"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Decimal: {formData.dualTime.toFixed(1)} hours
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Solo Time</label>
                  <div className="flex space-x-2">
                    <div className="flex-1">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={Math.floor(formData.soloTime)}
                        onChange={(e) => setFormData(prev => ({ ...prev, soloTime: parseInt(e.target.value) || 0 + (formData.soloTime % 1) }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Hours"
                      />
                    </div>
                    <span className="flex items-center text-gray-500">:</span>
                    <div className="flex-1">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        step="1"
                        value={Math.round((formData.soloTime % 1) * 60)}
                        onChange={(e) => setFormData(prev => ({ ...prev, soloTime: Math.floor(formData.soloTime) + (parseInt(e.target.value) || 0) / 60 }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Minutes"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Decimal: {formData.soloTime.toFixed(1)} hours
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total Landings</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.landings}
                    onChange={(e) => setFormData(prev => ({ ...prev, landings: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                </div>

                <div className="flex items-end">
                  <div className="bg-blue-50 p-4 rounded-lg w-full">
                    <div className="flex items-center mb-2">
                      <Clock className="h-4 w-4 text-blue-600 mr-2" />
                      <span className="text-sm font-medium text-blue-900">Total Flight Time</span>
                    </div>
                    <p className="text-lg font-bold text-blue-600">
                      {calculateTotalTime()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'lesson' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Lesson Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Lesson Code</label>
                  <select
                    value={formData.lessonCode}
                    onChange={(e) => setFormData(prev => ({ ...prev, lessonCode: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select lesson code</option>
                    {lessonCodes.map(lesson => (
                      <option key={lesson.value} value={lesson.value}>{lesson.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Next Lesson</label>
                  <select
                    value={formData.nextLessonCode}
                    onChange={(e) => setFormData(prev => ({ ...prev, nextLessonCode: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select next lesson</option>
                    {lessonCodes.map(lesson => (
                      <option key={lesson.value} value={lesson.value}>{lesson.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lesson Comments *
                </label>
                <textarea
                  value={formData.lessonComments}
                  onChange={(e) => setFormData(prev => ({ ...prev, lessonComments: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={8}
                  placeholder="Detailed lesson comments including sequences practiced, student performance, areas for improvement, and critique..."
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Include sequences practiced and detailed critique of student performance
                </p>
              </div>
            </div>
          )}

          {activeTab === 'sequences' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Competency Grid</h3>
                <button
                  onClick={() => setShowSequenceSearch(!showSequenceSearch)}
                  className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Sequence</span>
                </button>
              </div>

              {showSequenceSearch && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex space-x-2 mb-3">
                    <div className="flex-1 relative">
                      <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                      <input
                        type="text"
                        value={sequenceSearch}
                        onChange={(e) => setSequenceSearch(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Search sequences by code or title..."
                      />
                    </div>
                  </div>

                  {sequenceSearch && (
                    <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md bg-white">
                      {filteredSequences.map(sequence => (
                        <button
                          key={sequence.id}
                          onClick={() => addSequence(sequence)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                        >
                          <div className="font-medium text-sm">{sequence.code} - {sequence.title}</div>
                          <div className="text-xs text-gray-500">{sequence.group}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <h4 className="text-md font-medium text-gray-800 mb-4">Selected Training Sequences</h4>
                
                {selectedSequences.length > 0 ? (
                  <div className="space-y-4">
                    {selectedSequences.map((entry, index) => (
                      <div key={entry.sequence.id} className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="font-medium text-gray-900">
                              {entry.sequence.code} - {entry.sequence.title}
                            </h5>
                            <p className="text-sm text-gray-600">{entry.sequence.group}</p>
                          </div>
                          <button
                            onClick={() => removeSequence(entry.sequence.id)}
                            className="text-red-600 hover:text-red-800 p-1"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Competence Rating</label>
                          <div className="flex space-x-4">
                            {(['NC', 'S', 'C', '-'] as const).map(competence => (
                              <label key={competence} className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  name={`competence-${entry.sequence.id}`}
                                  value={competence}
                                  checked={entry.competence === competence}
                                  onChange={() => updateSequenceCompetence(entry.sequence.id, competence)}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                                />
                                <span className={`text-sm font-medium ${
                                  competence === 'NC' ? 'text-red-600' :
                                  competence === 'S' ? 'text-yellow-600' :
                                  competence === 'C' ? 'text-green-600' :
                                  'text-gray-600'
                                }`}>
                                  {competence === 'NC' ? 'Not Competent' :
                                   competence === 'S' ? 'Satisfactory' :
                                   competence === 'C' ? 'Competent' :
                                   'Not Assessed'}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                    <p>No sequences selected. Add sequences to assess competence.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'tolerances' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Flight Tolerances</h3>
              
              {flightTolerances.map(category => (
                <div key={category.id} className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="text-md font-medium text-gray-800 mb-4">{category.category}</h4>
                  
                  <div className="space-y-3">
                    {category.items.map(item => (
                      <div key={item.id} className="flex items-center justify-between">
                        <span className="text-sm text-gray-700 flex-1">{item.description}</span>
                        <div className="flex space-x-2 ml-4">
                          {(['excellent', 'good', 'satisfactory', 'unsatisfactory', '-'] as const).map(rating => (
                            <label key={rating} className="flex items-center">
                              <input
                                type="radio"
                                name={`tolerance-${item.id}`}
                                value={rating}
                                checked={item.rating === rating}
                                onChange={() => updateToleranceRating(category.id, item.id, rating)}
                                className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300"
                              />
                              <span className={`ml-1 text-xs ${
                                rating === 'excellent' ? 'text-green-600' :
                                rating === 'good' ? 'text-blue-600' :
                                rating === 'satisfactory' ? 'text-yellow-600' :
                                rating === 'unsatisfactory' ? 'text-red-600' :
                                'text-gray-600'
                              }`}>
                                {rating === '-' ? '–' : rating.charAt(0).toUpperCase()}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Attachments</h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload Files (Photos, Worksheets, Scanned Documents)
                </label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-4 text-gray-500" />
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500">PDF, JPG, PNG, DOC, DOCX (MAX. 10MB each)</p>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">Uploaded Files</h4>
                    {uploadedFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-700">{file.name}</span>
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
          )}

          {activeTab === 'signoff' && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-gray-900">Sign-off</h3>
              
              {/* Instructor Signature */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Instructor Signature *</label>
                <textarea
                  value={instructorSignature}
                  onChange={(e) => setInstructorSignature(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Type your full name or draw signature"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  By typing your name, you are providing your electronic signature
                </p>
              </div>

              {/* Student Acknowledgement */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Student Acknowledgement</label>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="studentAck"
                      checked={formData.studentAck}
                      onChange={(e) => setFormData(prev => ({ ...prev, studentAck: e.target.checked }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="studentAck" className="text-sm text-gray-700">
                      I acknowledge that I have received and understood this training record
                    </label>
                  </div>

                  {formData.studentAck && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Student Name *</label>
                      <input
                        type="text"
                        value={studentAckName}
                        onChange={(e) => setStudentAckName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Type your full name"
                        required
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Summary */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">Record Summary</h4>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><strong>Date:</strong> {formData.date}</p>
                  <p><strong>Aircraft:</strong> {formData.aircraftRegistration} ({formData.aircraftType})</p>
                  <p><strong>Flight Time:</strong> {calculateTotalTime()}</p>
                  <p><strong>Sequences:</strong> {selectedSequences.length} selected</p>
                  <p><strong>Formal Briefing:</strong> {formData.formalBriefing ? 'Yes' : 'No'}</p>
                  <p><strong>Attachments:</strong> {uploadedFiles.length} files</p>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          
          <div className="flex space-x-3">
            <button
              onClick={handleSaveDraft}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              <span>Save Draft</span>
            </button>
            
            <button
              onClick={handleSubmit}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Send className="h-4 w-4" />
              <span>Submit Record</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};