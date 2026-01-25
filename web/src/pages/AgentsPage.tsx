import { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  Stop as StopIcon,
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAgentStore } from '../stores';
import { agentApi } from '../api/client';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { Agent, WSMessage } from '../api/types';

export default function AgentsPage() {
  const {
    agents,
    agentTypes,
    loading,
    error,
    fetchAgents,
    fetchAgentTypes,
    spawnAgent,
    stopAgent,
    updateAgent,
    removeAgent,
    clearError,
  } = useAgentStore();

  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [newAgentType, setNewAgentType] = useState('');
  const [newAgentName, setNewAgentName] = useState('');
  const [executeTask, setExecuteTask] = useState('');
  const [executeResult, setExecuteResult] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    fetchAgents();
    fetchAgentTypes();
  }, [fetchAgents, fetchAgentTypes]);

  // Handle WebSocket events
  const handleAgentEvent = useCallback((message: WSMessage) => {
    if (message.type === 'agent:spawned') {
      fetchAgents();
    } else if (message.type === 'agent:stopped') {
      const payload = message.payload as { id: string };
      removeAgent(payload.id);
    } else if (message.type === 'agent:status') {
      const payload = message.payload as { id: string; status: string };
      const agent = agents.find((a) => a.id === payload.id);
      if (agent) {
        updateAgent({ ...agent, status: payload.status as typeof agent.status });
      }
    }
  }, [fetchAgents, removeAgent, updateAgent, agents]);

  useWebSocketEvent('agent:spawned', handleAgentEvent);
  useWebSocketEvent('agent:stopped', handleAgentEvent);
  useWebSocketEvent('agent:status', handleAgentEvent);

  const handleSpawn = async () => {
    if (!newAgentType) return;

    try {
      await spawnAgent(newAgentType, newAgentName || undefined);
      setSpawnDialogOpen(false);
      setNewAgentType('');
      setNewAgentName('');
    } catch {
      // Error is handled by store
    }
  };

  const handleStop = async (id: string) => {
    try {
      await stopAgent(id);
    } catch {
      // Error is handled by store
    }
  };

  const handleExecute = async () => {
    if (!selectedAgent || !executeTask) return;

    setExecuting(true);
    try {
      const result = await agentApi.execute(selectedAgent.id, { task: executeTask });
      setExecuteResult(result.response);
    } catch (err) {
      setExecuteResult(`Error: ${err instanceof Error ? err.message : 'Execution failed'}`);
    } finally {
      setExecuting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'primary';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'idle':
        return 'default';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Agents
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage and monitor your AI agents
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => fetchAgents()}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setSpawnDialogOpen(true)}
          >
            Spawn Agent
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading && agents.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No active agents
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Spawn an agent to get started
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setSpawnDialogOpen(true)}
            >
              Spawn Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {agents.map((agent) => (
            <Grid item xs={12} sm={6} md={4} key={agent.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6" fontWeight={600}>
                      {agent.name}
                    </Typography>
                    <Chip
                      label={agent.status}
                      size="small"
                      color={getStatusColor(agent.status)}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Type: {agent.type}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    ID: {agent.id.slice(0, 8)}...
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Created: {new Date(agent.createdAt).toLocaleString()}
                  </Typography>
                </CardContent>
                <CardActions>
                  <Button
                    size="small"
                    startIcon={<PlayIcon />}
                    onClick={() => {
                      setSelectedAgent(agent);
                      setExecuteDialogOpen(true);
                      setExecuteResult(null);
                    }}
                    disabled={agent.status === 'stopped'}
                  >
                    Execute
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleStop(agent.id)}
                    disabled={agent.status === 'stopped'}
                  >
                    <StopIcon />
                  </IconButton>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Spawn Dialog */}
      <Dialog open={spawnDialogOpen} onClose={() => setSpawnDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Spawn New Agent</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Agent Type</InputLabel>
            <Select
              value={newAgentType}
              label="Agent Type"
              onChange={(e) => setNewAgentType(e.target.value)}
            >
              {agentTypes.map((type) => (
                <MenuItem key={type.type} value={type.type}>
                  <Box>
                    <Typography>{type.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {type.description}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            label="Name (optional)"
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="Leave empty for auto-generated name"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSpawnDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSpawn} variant="contained" disabled={!newAgentType || loading}>
            Spawn
          </Button>
        </DialogActions>
      </Dialog>

      {/* Execute Dialog */}
      <Dialog open={executeDialogOpen} onClose={() => setExecuteDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Execute Task with {selectedAgent?.name}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Task"
            value={executeTask}
            onChange={(e) => setExecuteTask(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="Describe the task for the agent..."
          />
          {executeResult && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Result:
              </Typography>
              <Box
                sx={{
                  p: 2,
                  backgroundColor: 'background.default',
                  borderRadius: 1,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {executeResult}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExecuteDialogOpen(false)}>Close</Button>
          <Button
            onClick={handleExecute}
            variant="contained"
            disabled={!executeTask || executing}
            startIcon={executing ? <CircularProgress size={20} /> : <PlayIcon />}
          >
            {executing ? 'Executing...' : 'Execute'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
