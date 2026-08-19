export interface CalendarStickyHeaderTransitionInput {
  viewportWidth: number;
  stickyTop: number;
  originalHeaderTop: number;
  originalHeaderHeight: number;
  calendarBottom: number;
  compactHeaderHeight: number;
  shrinkDistance: number;
  viewMode: string;
  isKioskMode: boolean;
}

export interface CalendarStickyHeaderTransition {
  visible: boolean;
  progress: number;
  height: number;
}

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

export const getCalendarStickyHeaderTransition = ({
  viewportWidth,
  stickyTop,
  originalHeaderTop,
  originalHeaderHeight,
  calendarBottom,
  compactHeaderHeight,
  shrinkDistance,
  viewMode,
  isKioskMode,
}: CalendarStickyHeaderTransitionInput): CalendarStickyHeaderTransition => {
  const supported = !isKioskMode
  && viewportWidth >= 768
  && (viewMode === 'day' || viewMode === 'week');
  const safeOriginalHeight = Math.max(compactHeaderHeight, originalHeaderHeight);
  const progress = clamp(
    (stickyTop - originalHeaderTop) / Math.max(1, shrinkDistance),
    0,
    1
  );
  const height = safeOriginalHeight
    - (safeOriginalHeight - compactHeaderHeight) * progress;

  return {
    visible: supported
      && originalHeaderTop <= stickyTop
      && calendarBottom > stickyTop + height,
    progress,
    height,
  };
};
