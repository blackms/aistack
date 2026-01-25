import { useCallback, useRef, useEffect } from 'react';
import { create } from 'zustand';
import type { WSMessage } from '../api/types';

interface WebSocketState {
  connected: boolean;
  clientId: string | null;
  lastMessage: WSMessage | null;
  messages: WSMessage[];
  setConnected: (connected: boolean) => void;
  setClientId: (clientId: string | null) => void;
  addMessage: (message: WSMessage) => void;
  clearMessages: () => void;
}

export const useWebSocketStore = create<WebSocketState>((set) => ({
  connected: false,
  clientId: null,
  lastMessage: null,
  messages: [],
  setConnected: (connected) => set({ connected }),
  setClientId: (clientId) => set({ clientId }),
  addMessage: (message) =>
    set((state) => ({
      lastMessage: message,
      messages: [...state.messages.slice(-99), message], // Keep last 100 messages
    })),
  clearMessages: () => set({ messages: [], lastMessage: null }),
}));

type MessageHandler = (message: WSMessage) => void;

const messageHandlers = new Map<string, Set<MessageHandler>>();

export function useWebSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const { setConnected, setClientId, addMessage } = useWebSocketStore();

  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = import.meta.env.VITE_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      setClientId(null);

      // Attempt reconnection after 3 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;
        addMessage(message);

        // Handle connected message
        if (message.type === 'connected') {
          const payload = message.payload as { clientId: string };
          setClientId(payload.clientId);
        }

        // Notify handlers
        const handlers = messageHandlers.get(message.type);
        if (handlers) {
          handlers.forEach((handler) => handler(message));
        }

        // Notify wildcard handlers
        const wildcardHandlers = messageHandlers.get('*');
        if (wildcardHandlers) {
          wildcardHandlers.forEach((handler) => handler(message));
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
  }, [setConnected, setClientId, addMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const send = useCallback((type: string, payload?: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const subscribe = useCallback((event: string, handler: MessageHandler) => {
    if (!messageHandlers.has(event)) {
      messageHandlers.set(event, new Set());
    }
    messageHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      messageHandlers.get(event)?.delete(handler);
    };
  }, []);

  return {
    connect,
    disconnect,
    send,
    subscribe,
  };
}

// Hook for subscribing to specific events
export function useWebSocketEvent(event: string, handler: MessageHandler) {
  const { subscribe } = useWebSocket();

  useEffect(() => {
    return subscribe(event, handler);
  }, [event, handler, subscribe]);
}
