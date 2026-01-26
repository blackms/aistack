import { useEffect, useCallback } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
} from '@mui/material';
import {
  SmartToy as AgentIcon,
  Memory as MemoryIcon,
  Assignment as TaskIcon,
  Speed as SpeedIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Pending as PendingIcon,
  PlayArrow as RunningIcon,
} from '@mui/icons-material';
import { useSystemStore, useAgentStore, useTaskStore } from '../stores';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { WSMessage } from '../api/types';
import AgentTimeline from '../components/dashboard/AgentTimeline';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: string;
}

function StatCard({ title, value, subtitle, icon, color = 'primary.main' }: StatCardProps) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box
            sx={{
              backgroundColor: `${color}20`,
              borderRadius: 2,
              p: 1,
              mr: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box sx={{ color }}>{icon}</Box>
          </Box>
          <Typography variant="subtitle2" color="text.secondary">
            {title}
          </Typography>
        </Box>
        <Typography variant="h4" fontWeight={600}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { status, fetchStatus } = useSystemStore();
  const { agents, fetchAgents, updateAgent, removeAgent } = useAgentStore();
  const { queueStatus, fetchQueueStatus } = useTaskStore();

  useEffect(() => {
    fetchStatus();
    fetchAgents();
    fetchQueueStatus();

    // Refresh periodically
    const interval = setInterval(() => {
      fetchStatus();
      fetchQueueStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchAgents, fetchQueueStatus]);

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

  const memoryUsagePercent = status
    ? Math.round((status.memory.heapUsed / status.memory.heapTotal) * 100)
    : 0;

  const getStatusIcon = (agentStatus: string) => {
    switch (agentStatus) {
      case 'running':
        return <RunningIcon color="primary" fontSize="small" />;
      case 'completed':
        return <CheckIcon color="success" fontSize="small" />;
      case 'failed':
        return <ErrorIcon color="error" fontSize="small" />;
      case 'idle':
        return <PendingIcon color="action" fontSize="small" />;
      default:
        return <PendingIcon fontSize="small" />;
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight={600}>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Overview of your AgentStack system
      </Typography>

      <Grid container spacing={3}>
        {/* Stats Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Active Agents"
            value={status?.agents.active || 0}
            icon={<AgentIcon />}
            color="#6366f1"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Tasks in Queue"
            value={queueStatus?.status.queued || 0}
            subtitle={`${queueStatus?.status.processing || 0} processing`}
            icon={<TaskIcon />}
            color="#22d3ee"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Memory Usage"
            value={status ? formatBytes(status.memory.heapUsed) : '0 B'}
            subtitle={status ? `of ${formatBytes(status.memory.heapTotal)}` : ''}
            icon={<MemoryIcon />}
            color="#10b981"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Uptime"
            value={status ? formatUptime(status.uptime) : '0s'}
            icon={<SpeedIcon />}
            color="#f59e0b"
          />
        </Grid>

        {/* Agent Activity Timeline */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Agent Activity Timeline
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Visual timeline of agent spawning and execution over the last hour
              </Typography>
              <AgentTimeline agents={agents} timeWindowHours={1} />
            </CardContent>
          </Card>
        </Grid>

        {/* Memory Progress */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Memory Usage
              </Typography>
              <Box sx={{ mt: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Heap Used
                  </Typography>
                  <Typography variant="body2">{memoryUsagePercent}%</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={memoryUsagePercent}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: 'rgba(99, 102, 241, 0.2)',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 4,
                    },
                  }}
                />
              </Box>
              {status && (
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={4}>
                    <Typography variant="body2" color="text.secondary">
                      Heap Total
                    </Typography>
                    <Typography variant="body1" fontWeight={500}>
                      {formatBytes(status.memory.heapTotal)}
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" color="text.secondary">
                      Heap Used
                    </Typography>
                    <Typography variant="body1" fontWeight={500}>
                      {formatBytes(status.memory.heapUsed)}
                    </Typography>
                  </Grid>
                  <Grid item xs={4}>
                    <Typography variant="body2" color="text.secondary">
                      External
                    </Typography>
                    <Typography variant="body1" fontWeight={500}>
                      {formatBytes(status.memory.external)}
                    </Typography>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Active Agents */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Active Agents
              </Typography>
              {agents.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                  No active agents
                </Typography>
              ) : (
                <List dense>
                  {agents.slice(0, 5).map((agent, index) => (
                    <Box key={agent.id}>
                      {index > 0 && <Divider />}
                      <ListItem>
                        <ListItemIcon>{getStatusIcon(agent.status)}</ListItemIcon>
                        <ListItemText
                          primary={agent.name}
                          secondary={agent.type}
                        />
                        <Chip
                          label={agent.status}
                          size="small"
                          color={
                            agent.status === 'running'
                              ? 'primary'
                              : agent.status === 'completed'
                              ? 'success'
                              : agent.status === 'failed'
                              ? 'error'
                              : 'default'
                          }
                          variant="outlined"
                        />
                      </ListItem>
                    </Box>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Agent Status Distribution */}
        {status && Object.keys(status.agents.byStatus).length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Agent Status Distribution
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
                  {Object.entries(status.agents.byStatus).map(([statusName, count]) => (
                    <Chip
                      key={statusName}
                      label={`${statusName}: ${count}`}
                      color={
                        statusName === 'running'
                          ? 'primary'
                          : statusName === 'completed'
                          ? 'success'
                          : statusName === 'failed'
                          ? 'error'
                          : 'default'
                      }
                    />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
