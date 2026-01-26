import { create } from 'zustand';

export type NotificationSeverity = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  message: string;
  severity: NotificationSeverity;
  autoHideDuration?: number;
}

interface NotificationState {
  notifications: Notification[];

  // Actions
  showNotification: (message: string, severity?: NotificationSeverity, autoHideDuration?: number) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

let notificationId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  showNotification: (message, severity = 'info', autoHideDuration = 6000) => {
    const id = `notification-${++notificationId}`;
    const notification: Notification = {
      id,
      message,
      severity,
      autoHideDuration,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));
  },

  showSuccess: (message) => {
    const id = `notification-${++notificationId}`;
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, message, severity: 'success', autoHideDuration: 4000 },
      ],
    }));
  },

  showError: (message) => {
    const id = `notification-${++notificationId}`;
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, message, severity: 'error', autoHideDuration: 8000 },
      ],
    }));
  },

  showWarning: (message) => {
    const id = `notification-${++notificationId}`;
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, message, severity: 'warning', autoHideDuration: 6000 },
      ],
    }));
  },

  showInfo: (message) => {
    const id = `notification-${++notificationId}`;
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, message, severity: 'info', autoHideDuration: 5000 },
      ],
    }));
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },
}));
