import React, { useState, useEffect, useRef } from 'react';
import { Edit, FileText, Trash2 } from 'lucide-react';

interface Booking {
  id: string;
  student_id: string;
  instructor_id?: string;
  aircraft_id: string;
  startTime: Date | string;
  endTime: Date | string;
  notes?: string;
}

interface BookingActionMenuProps {
  booking: Booking;
  position: { x: number; y: number };
  onEdit: () => void;
  onLogFlight: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export const BookingActionMenu: React.FC<BookingActionMenuProps> = ({
  booking,
  position,
  onEdit,
  onLogFlight,
  onDelete,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (!menuRef.current) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    if (position.x + menuRect.width > viewportWidth) {
      adjustedX = viewportWidth - menuRect.width - 10;
    }

    if (position.y + menuRect.height > viewportHeight) {
      adjustedY = viewportHeight - menuRect.height - 10;
    }

    setAdjustedPosition({ x: adjustedX, y: adjustedY });
  }, [position]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50 min-w-[180px]"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
    >
      <button
        onClick={() => handleAction(onEdit)}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2 transition-colors"
      >
        <Edit className="h-4 w-4" />
        <span>Edit Booking</span>
      </button>

      <button
        onClick={() => handleAction(onLogFlight)}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2 transition-colors"
      >
        <FileText className="h-4 w-4" />
        <span>Log Flight</span>
      </button>

      <div className="border-t border-gray-200 my-1"></div>

      <button
        onClick={() => handleAction(onDelete)}
        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
        <span>Delete Booking</span>
      </button>
    </div>
  );
};
