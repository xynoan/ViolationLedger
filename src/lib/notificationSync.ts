/** Fired when unread / notification list may have changed (any screen). Header listens and refetches. */
export const NOTIFICATIONS_CHANGED_EVENT = 'vl:notifications-changed';

export function notifyNotificationsChanged() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
}
