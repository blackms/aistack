import { Snackbar, Alert } from '@mui/material';
import { useNotificationStore } from '../../stores/notificationStore';

export default function NotificationProvider() {
  const { notifications, removeNotification } = useNotificationStore();

  return (
    <>
      {notifications.map((notification, index) => (
        <Snackbar
          key={notification.id}
          open={true}
          autoHideDuration={notification.autoHideDuration}
          onClose={() => removeNotification(notification.id)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{
            bottom: `${(notifications.length - 1 - index) * 70 + 24}px`,
          }}
        >
          <Alert
            onClose={() => removeNotification(notification.id)}
            severity={notification.severity}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {notification.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
