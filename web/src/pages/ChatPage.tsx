import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Avatar,
  CircularProgress,
  Alert,
  Chip,
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as AgentIcon,
  Person as PersonIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useAgentStore } from '../stores';
import { agentApi } from '../api/client';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { WSMessage } from '../api/types';

interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  agentId?: string;
  agentName?: string;
  content: string;
  timestamp: Date;
}

export default function ChatPage() {
  const { agents, agentTypes, fetchAgents, fetchAgentTypes, spawnAgent } = useAgentStore();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spawnType, setSpawnType] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAgents();
    fetchAgentTypes();
  }, [fetchAgents, fetchAgentTypes]);

  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle WebSocket events
  const handleMessageEvent = useCallback((wsMessage: WSMessage) => {
    if (wsMessage.type === 'message:received') {
      const payload = wsMessage.payload as { from: string; to: string; content: string };
      // Only show messages from agents (responses)
      if (payload.from !== 'user' && payload.to === 'user') {
        const agent = agents.find((a) => a.id === payload.from);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            from: 'agent',
            agentId: payload.from,
            agentName: agent?.name,
            content: payload.content,
            timestamp: new Date(),
          },
        ]);
      }
    }
  }, [agents]);

  useWebSocketEvent('message:received', handleMessageEvent);

  const handleSend = async () => {
    if (!message.trim() || !selectedAgentId) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      from: 'user',
      content: message.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage('');
    setSending(true);
    setError(null);

    try {
      const result = await agentApi.chat(selectedAgentId, userMessage.content);
      const selectedAgent = agents.find((a) => a.id === selectedAgentId);

      const agentMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        from: 'agent',
        agentId: selectedAgentId,
        agentName: selectedAgent?.name,
        content: result.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, agentMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleSpawnAgent = async () => {
    if (!spawnType) return;

    try {
      const agent = await spawnAgent(spawnType);
      setSelectedAgentId(agent.id);
      setSpawnType('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn agent');
    }
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <Box sx={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Chat
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Interact with AI agents through conversation
          </Typography>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Agent Selection */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center', py: 1.5 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Select Agent</InputLabel>
            <Select
              value={selectedAgentId}
              label="Select Agent"
              onChange={(e) => setSelectedAgentId(e.target.value)}
            >
              {agents.map((agent) => (
                <MenuItem key={agent.id} value={agent.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {agent.name}
                    <Chip label={agent.type} size="small" variant="outlined" />
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography color="text.secondary">or</Typography>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Spawn New</InputLabel>
            <Select
              value={spawnType}
              label="Spawn New"
              onChange={(e) => setSpawnType(e.target.value)}
            >
              {agentTypes.map((type) => (
                <MenuItem key={type.type} value={type.type}>
                  {type.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <IconButton
            color="primary"
            onClick={handleSpawnAgent}
            disabled={!spawnType}
          >
            <AddIcon />
          </IconButton>

          {selectedAgent && (
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Chatting with:
              </Typography>
              <Chip
                icon={<AgentIcon />}
                label={selectedAgent.name}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Chat Messages */}
      <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {messages.length === 0 ? (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography color="text.secondary">
                {agents.length === 0
                  ? 'Spawn an agent to start chatting'
                  : 'Start a conversation by sending a message'}
              </Typography>
            </Box>
          ) : (
            messages.map((msg) => (
              <Box
                key={msg.id}
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  alignItems: 'flex-start',
                  flexDirection: msg.from === 'user' ? 'row-reverse' : 'row',
                }}
              >
                <Avatar
                  sx={{
                    bgcolor: msg.from === 'user' ? 'primary.main' : 'secondary.main',
                    width: 36,
                    height: 36,
                  }}
                >
                  {msg.from === 'user' ? <PersonIcon /> : <AgentIcon />}
                </Avatar>
                <Box
                  sx={{
                    maxWidth: '70%',
                    backgroundColor: msg.from === 'user' ? 'primary.main' : 'background.paper',
                    color: msg.from === 'user' ? 'primary.contrastText' : 'text.primary',
                    borderRadius: 2,
                    p: 2,
                    border: msg.from === 'agent' ? '1px solid' : 'none',
                    borderColor: 'divider',
                  }}
                >
                  {msg.from === 'agent' && msg.agentName && (
                    <Typography variant="caption" color="secondary" display="block" sx={{ mb: 0.5 }}>
                      {msg.agentName}
                    </Typography>
                  )}
                  <Typography
                    variant="body2"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.content}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      mt: 1,
                      opacity: 0.7,
                      textAlign: msg.from === 'user' ? 'right' : 'left',
                    }}
                  >
                    {msg.timestamp.toLocaleTimeString()}
                  </Typography>
                </Box>
              </Box>
            ))
          )}
          <div ref={messagesEndRef} />
        </Box>

        {/* Input */}
        <Box
          sx={{
            p: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            gap: 1,
          }}
        >
          <TextField
            fullWidth
            placeholder={
              agents.length === 0
                ? 'Spawn an agent first...'
                : 'Type your message...'
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={sending || agents.length === 0}
            multiline
            maxRows={4}
            size="small"
          />
          <Button
            variant="contained"
            onClick={handleSend}
            disabled={sending || !message.trim() || !selectedAgentId}
            sx={{ minWidth: 100 }}
          >
            {sending ? <CircularProgress size={24} /> : <SendIcon />}
          </Button>
        </Box>
      </Card>
    </Box>
  );
}
