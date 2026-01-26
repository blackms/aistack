import { useWebSocketEvent } from './useWebSocket';
import { useNotificationStore } from '../stores/notificationStore';
import type { WSMessage } from '../api/types';

/**
 * Hook to display toast notifications for WebSocket events
 */
export function useWebSocketNotifications() {
  const { showSuccess, showError, showInfo } = useNotificationStore();

  // Agent events
  useWebSocketEvent('agent:spawned', (message: WSMessage) => {
    const payload = message.payload as { agentId: string; type: string };
    showSuccess(`Agent spawned: ${payload.type}`);
  });

  useWebSocketEvent('agent:stopped', (message: WSMessage) => {
    const payload = message.payload as { agentId: string };
    showInfo(`Agent stopped: ${payload.agentId.slice(0, 8)}`);
  });

  useWebSocketEvent('agent:error', (message: WSMessage) => {
    const payload = message.payload as { agentId: string; error: string };
    showError(`Agent error: ${payload.error}`);
  });

  // Workflow events
  useWebSocketEvent('workflow:start', (message: WSMessage) => {
    const payload = message.payload as { workflowId: string };
    showInfo(`Workflow started: ${payload.workflowId.slice(0, 8)}`);
  });

  useWebSocketEvent('workflow:complete', (message: WSMessage) => {
    const payload = message.payload as { workflowId: string };
    showSuccess(`Workflow completed: ${payload.workflowId.slice(0, 8)}`);
  });

  useWebSocketEvent('workflow:error', (message: WSMessage) => {
    const payload = message.payload as { workflowId: string; error: string };
    showError(`Workflow error: ${payload.error}`);
  });

  // Review loop events
  useWebSocketEvent('review-loop:start', (message: WSMessage) => {
    const payload = message.payload as { loopId: string };
    showInfo(`Review loop started: ${payload.loopId.slice(0, 8)}`);
  });

  useWebSocketEvent('review-loop:approved', (message: WSMessage) => {
    const payload = message.payload as { loopId: string };
    showSuccess(`Code approved in review loop: ${payload.loopId.slice(0, 8)}`);
  });

  useWebSocketEvent('review-loop:complete', (message: WSMessage) => {
    const payload = message.payload as { loopId: string };
    showInfo(`Review loop completed: ${payload.loopId.slice(0, 8)}`);
  });

  useWebSocketEvent('review-loop:error', (message: WSMessage) => {
    const payload = message.payload as { loopId: string; error: string };
    showError(`Review loop error: ${payload.error}`);
  });

  // Task events
  useWebSocketEvent('task:created', (message: WSMessage) => {
    const payload = message.payload as { taskId: string };
    showInfo(`Task created: ${payload.taskId.slice(0, 8)}`);
  });

  useWebSocketEvent('task:completed', (message: WSMessage) => {
    const payload = message.payload as { taskId: string };
    showSuccess(`Task completed: ${payload.taskId.slice(0, 8)}`);
  });

  useWebSocketEvent('task:failed', (message: WSMessage) => {
    const payload = message.payload as { taskId: string; error?: string };
    showError(`Task failed: ${payload.error || 'Unknown error'}`);
  });
}
