import React, { useState, useEffect } from 'react';
import { getCurrentTimeInMinutes, getTimeSlotFromMinutes } from '../../utils/timeUtils';

interface CurrentTimeIndicatorProps {
  isVisible: boolean;
}

export const CurrentTimeIndicator: React.FC<CurrentTimeIndicatorProps> = ({ isVisible }) => {
  const [currentMinutes, setCurrentMinutes] = useState(getCurrentTimeInMinutes());

  useEffect(() => {
    if (!isVisible) return;

    const updateTime = () => {
      setCurrentMinutes(getCurrentTimeInMinutes());
    };

    // Update immediately
    updateTime();

    // Update every minute
    const interval = setInterval(updateTime, 60000);

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible) return null;

  const timeSlot = getTimeSlotFromMinutes(currentMinutes);
  
  // Don't show if outside calendar hours (6 AM - 8 PM)
  if (timeSlot < 0 || timeSlot >= 28) return null; // 28 slots = 14 hours * 2

  // Calculate position within the calendar grid
  const startHour = 6; // 6:00 AM
  const minutesFromStart = currentMinutes - (startHour * 60);
  const positionPercent = (minutesFromStart / (14 * 60)) * 100; // 14 hours total

  return (
    <div
      className="absolute left-0 right-0 z-30 pointer-events-none"
      style={{
        top: `${positionPercent}%`,
        transform: 'translateY(-50%)'
      }}
    >
      {/* Time indicator line */}
      <div className="flex items-center">
        <div className="w-2 h-2 bg-red-500 rounded-full ml-20 -mr-1 z-10"></div>
        <div className="flex-1 h-0.5 bg-red-500"></div>
      </div>
      
      {/* Time label */}
      <div className="absolute left-2 top-0 transform -translate-y-1/2">
        <div className="bg-red-500 text-white text-xs px-2 py-1 rounded shadow-sm">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};