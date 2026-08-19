export const OUTSTANDING_RECORD_POPUP_EVENT = 'bfc:open-outstanding-record';

export interface OutstandingRecordPopupRequest {
  flightLogId?: string;
}

export const openOutstandingRecordPopup = (request: OutstandingRecordPopupRequest = {}) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OutstandingRecordPopupRequest>(OUTSTANDING_RECORD_POPUP_EVENT, {
    detail: request,
  }));
};

export const isOutstandingRecordNotification = (notification: {
  type?: string;
  metadata?: Record<string, string>;
}) => notification.type === 'outstanding_record'
  || notification.metadata?.notification_kind === 'outstanding_record'
  || Boolean(notification.metadata?.outstanding_flight_log_id);
