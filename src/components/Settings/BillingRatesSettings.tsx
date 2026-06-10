import React, { useState, useEffect } from 'react';
import { DollarSign, CreditCard, Plus, Trash2, Users, Lock } from 'lucide-react';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { UserRole } from '../../types';

interface BillingRatesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const BillingRatesSettings: React.FC<BillingRatesSettingsProps> = ({ canEdit, onFormChange }) => {
  const {
    flightTypes,
    paymentMethods,
    loading,
    addFlightType,
    updateFlightType,
    deleteFlightType,
    addPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod
  } = useBillingSettings();

  const [newFlightTypeName, setNewFlightTypeName] = useState('');
  const [newFlightTypeRoles, setNewFlightTypeRoles] = useState<UserRole[]>(['student', 'pilot', 'instructor', 'admin']);
  const [newPaymentMethodName, setNewPaymentMethodName] = useState('');
  const [localFlightTypeNames, setLocalFlightTypeNames] = useState<Record<string, string>>({});
  const [localPaymentMethodNames, setLocalPaymentMethodNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const names: Record<string, string> = {};
    flightTypes.forEach(ft => { names[ft.id] = ft.name; });
    setLocalFlightTypeNames(names);
  }, [flightTypes]);

  useEffect(() => {
    const names: Record<string, string> = {};
    paymentMethods.forEach(pm => { names[pm.id] = pm.name; });
    setLocalPaymentMethodNames(names);
  }, [paymentMethods]);

  const allRoles: UserRole[] = ['admin', 'instructor', 'pilot', 'student'];

  const handleAddFlightType = () => {
    if (!newFlightTypeName.trim()) return;
    addFlightType(newFlightTypeName, newFlightTypeRoles);
    setNewFlightTypeName('');
    setNewFlightTypeRoles(['student', 'pilot', 'instructor', 'admin']);
    onFormChange();
  };

  const handleAddPaymentMethod = () => {
    if (!newPaymentMethodName.trim()) return;
    addPaymentMethod(newPaymentMethodName);
    setNewPaymentMethodName('');
    onFormChange();
  };

  const handleFlightTypeNameBlur = (id: string) => {
    const name = localFlightTypeNames[id] ?? '';
    if (!name.trim()) return;
    updateFlightType(id, { name });
    onFormChange();
  };

  const handleFlightTypeRolesChange = (id: string, roles: UserRole[]) => {
    updateFlightType(id, { allowedRoles: roles });
    onFormChange();
  };

  const handleForcedPaymentMethodChange = (id: string, value: string) => {
    updateFlightType(id, { forcedPaymentMethodId: value === '' ? null : value });
    onFormChange();
  };

  const handlePaymentMethodNameBlur = (id: string) => {
    const name = localPaymentMethodNames[id] ?? '';
    if (!name.trim()) return;
    updatePaymentMethod(id, { name });
    onFormChange();
  };

  const toggleRole = (currentRoles: UserRole[], role: UserRole): UserRole[] => {
    if (currentRoles.includes(role)) {
      return currentRoles.filter(r => r !== role);
    } else {
      return [...currentRoles, role];
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading billing settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <DollarSign className="h-5 w-5 mr-2" />
          Billing & Rates
        </h2>
        <p className="text-gray-600">Configure flight types and payment methods</p>
      </div>

      {/* Flight Types */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-1 flex items-center">
            <Users className="h-5 w-5 mr-2" />
            Flight Types
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Define flight types, which roles can use them, and optionally force a specific payment method when that type is selected.
          </p>

          <div className="space-y-3">
            {flightTypes.map(flightType => (
              <div key={flightType.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={localFlightTypeNames[flightType.id] ?? flightType.name}
                    onChange={(e) => setLocalFlightTypeNames(prev => ({ ...prev, [flightType.id]: e.target.value }))}
                    onBlur={() => handleFlightTypeNameBlur(flightType.id)}
                    disabled={!canEdit}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    placeholder="Flight type name"
                  />
                  {canEdit && (
                    <button
                      onClick={() => {
                        deleteFlightType(flightType.id);
                        onFormChange();
                      }}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Allowed Roles</p>
                    <div className="flex flex-wrap gap-2">
                      {allRoles.map(role => (
                        <label key={role} className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={flightType.allowedRoles.includes(role)}
                            onChange={() => handleFlightTypeRolesChange(
                              flightType.id,
                              toggleRole(flightType.allowedRoles, role)
                            )}
                            disabled={!canEdit}
                            className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-700 capitalize">{role}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      Force Payment Method
                    </p>
                    <select
                      value={flightType.forcedPaymentMethodId ?? ''}
                      onChange={(e) => handleForcedPaymentMethodChange(flightType.id, e.target.value)}
                      disabled={!canEdit || paymentMethods.length === 0}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed bg-white"
                    >
                      <option value="">No forced method</option>
                      {paymentMethods.map(pm => (
                        <option key={pm.id} value={pm.id}>{pm.name}</option>
                      ))}
                    </select>
                    {flightType.forcedPaymentMethodId && (
                      <p className="text-xs text-amber-600 mt-1">
                        Bookings with this flight type must use "{paymentMethods.find(p => p.id === flightType.forcedPaymentMethodId)?.name ?? '—'}".
                      </p>
                    )}
                    {paymentMethods.length === 0 && (
                      <p className="text-xs text-gray-400 mt-1">Add payment methods below to enable this option.</p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {canEdit && (
              <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={newFlightTypeName}
                    onChange={(e) => setNewFlightTypeName(e.target.value)}
                    placeholder="New flight type name"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyPress={(e) => e.key === 'Enter' && handleAddFlightType()}
                  />
                  <button
                    onClick={handleAddFlightType}
                    disabled={!newFlightTypeName.trim()}
                    className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Allowed Roles</p>
                  <div className="flex flex-wrap gap-2">
                    {allRoles.map(role => (
                      <label key={role} className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          checked={newFlightTypeRoles.includes(role)}
                          onChange={() => setNewFlightTypeRoles(toggleRole(newFlightTypeRoles, role))}
                          className="h-3.5 w-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="text-xs text-gray-700 capitalize">{role}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment Methods */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-1 flex items-center">
            <CreditCard className="h-5 w-5 mr-2" />
            Payment Methods
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Define available payment methods that can be selected as default for each aircraft, or forced for specific flight types.
          </p>

          <div className="space-y-3">
            {paymentMethods.map(method => (
              <div key={method.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <input
                  type="text"
                  value={localPaymentMethodNames[method.id] ?? method.name}
                  onChange={(e) => setLocalPaymentMethodNames(prev => ({ ...prev, [method.id]: e.target.value }))}
                  onBlur={() => handlePaymentMethodNameBlur(method.id)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  placeholder="Payment method name"
                />
                {canEdit && (
                  <button
                    onClick={() => {
                      deletePaymentMethod(method.id);
                      onFormChange();
                    }}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}

            {canEdit && (
              <div className="flex items-center space-x-3 p-3 border-2 border-dashed border-gray-300 rounded-lg">
                <input
                  type="text"
                  value={newPaymentMethodName}
                  onChange={(e) => setNewPaymentMethodName(e.target.value)}
                  placeholder="New payment method name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleAddPaymentMethod()}
                />
                <button
                  onClick={handleAddPaymentMethod}
                  disabled={!newPaymentMethodName.trim()}
                  className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
