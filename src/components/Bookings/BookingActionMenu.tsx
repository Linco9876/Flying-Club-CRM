import React from 'react';
import { CreditCard as Edit, FileText, Trash2, MoreVertical, Check, X as XIcon } from 'lucide-react';
import { Booking } from '../../types';

interface BookingActionMenuProps {
  booking: Booking;
  onEdit: () => void;
  onLogFlight: () => void;
  onDelete: () => void;
  onViewTrainingRecord?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  hasTrainingRecord?: boolean;
  canDelete?: boolean;
  canApprove?: boolean;
  position?: { x: number; y: number };
  onClose?: () => void;
}

export const BookingActionMenu: React.FC<BookingActionMenuProps> = ({
  booking,
  onEdit,
  onLogFlight,
  onDelete,
  onViewTrainingRecord,
  onApprove,
  onReject,
  hasTrainingRecord,
  canDelete = true,
  canApprove = false,
  position,
  onClose,
}) => {
  const [isOpen, setIsOpen] = React.useState(position ? true : false);
  const [fixedMenuStyle, setFixedMenuStyle] = React.useState<React.CSSProperties>(() => ({
    left: position?.x ?? 0,
    top: position?.y ?? 0,
  }));
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (position && onClose) {
          onClose();
        } else {
          setIsOpen(false);
        }
      }
    };

    if (isOpen && !position) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    if (isOpen || position) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, position, onClose]);

  const handleAction = (action: () => void) => {
    action();
    if (position && onClose) {
      onClose();
    } else {
      setIsOpen(false);
    }
  };

  React.useLayoutEffect(() => {
    if (!position || !menuRef.current) return;

    const menu = menuRef.current;
    const margin = 8;
    const { width, height } = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    setFixedMenuStyle({
      left: Math.min(Math.max(position.x, margin), maxLeft),
      top: Math.min(Math.max(position.y, margin), maxTop),
    });
  }, [position, isOpen, canDelete, canApprove, hasTrainingRecord, booking.status]);

  const menuContent = (
    <>
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

      {hasTrainingRecord && onViewTrainingRecord && (
        <button
          onClick={() => handleAction(onViewTrainingRecord)}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2 transition-colors"
        >
          <FileText className="h-4 w-4" />
          <span>View Training Record</span>
        </button>
      )}

      {canApprove && booking.status === 'pending_approval' && (
        <>
          <div className="border-t border-gray-200 my-1"></div>
          {onApprove && (
            <button
              onClick={() => handleAction(onApprove)}
              className="w-full px-4 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center space-x-2 transition-colors"
            >
              <Check className="h-4 w-4" />
              <span>Approve Booking</span>
            </button>
          )}
          {onReject && (
            <button
              onClick={() => handleAction(onReject)}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2 transition-colors"
            >
              <XIcon className="h-4 w-4" />
              <span>Reject Booking</span>
            </button>
          )}
        </>
      )}

      {canDelete && (
        <>
          <div className="border-t border-gray-200 my-1"></div>
          <button
            onClick={() => handleAction(onDelete)}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete Booking</span>
          </button>
        </>
      )}
    </>
  );

  if (position) {
    return (
      <div
        ref={menuRef}
        className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50 min-w-[200px]"
        style={fixedMenuStyle}
      >
        {menuContent}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        title="More actions"
      >
        <MoreVertical className="h-5 w-5 text-gray-600" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
          {menuContent}
        </div>
      )}
    </div>
  );
};
