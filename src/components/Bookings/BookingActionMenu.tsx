import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, CreditCard as Edit, Trash2, FileText, Eye, X } from 'lucide-react';
import { Booking } from '../../types';
import { formatLocalDateTime } from '../../utils/timeUtils';

interface BookingActionMenuProps {
  booking: Booking;
  onEdit: () => void;
  onDelete: () => void;
  onLogFlight: () => void;
  onViewDetails?: () => void;
  onViewTrainingRecord?: () => void;
  hasTrainingRecord?: boolean;
  canDelete?: boolean;
}

export const BookingActionMenu: React.FC<BookingActionMenuProps> = ({
  booking,
  onEdit,
  onDelete,
  onLogFlight,
  onViewDetails,
  onViewTrainingRecord,
  hasTrainingRecord = false,
  canDelete = true
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-2 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Booking actions"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <MoreVertical className="h-4 w-4 text-gray-600" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Menu */}
          <div
            ref={menuRef}
            className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
            onKeyDown={handleKeyDown}
            role="menu"
            aria-orientation="vertical"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-500">
                Started at {formatLocalDateTime(booking.startTime)}
              </p>
            </div>

            <div className="py-1">
              {/* Log Flight / View Training Record */}
              {hasTrainingRecord ? (
                <button
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2 focus:outline-none focus:bg-gray-50"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction(onViewTrainingRecord || (() => {}));
                  }}
                >
                  <Eye className="h-4 w-4" />
                  <span>View Training Record</span>
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction(onLogFlight);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-blue-50 flex items-center space-x-2 focus:outline-none focus:bg-blue-50 font-medium"
                  role="menuitem"
                >
                  <FileText className="h-4 w-4" />
                  <span>Log Flight</span>
                </button>
              )}
              
              {/* Edit Booking */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onEdit);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2 focus:outline-none focus:bg-gray-50"
                role="menuitem"
              >
                <Edit className="h-4 w-4" />
                <span>Edit Booking</span>
              </button>

              {/* View Details */}
              {onViewDetails && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction(onViewDetails);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2 focus:outline-none focus:bg-gray-50"
                  role="menuitem"
                >
                  <Eye className="h-4 w-4" />
                  <span>View Details</span>
                </button>
              )}
              
              {/* Delete Booking */}
              {canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAction(onDelete);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2 focus:outline-none focus:bg-red-50"
                  role="menuitem"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete Booking</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};