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
  Chip,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  LinearProgress,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { workflowApi } from '../api/client';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { Workflow, RunningWorkflow, WSMessage } from '../api/types';

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runningWorkflows, setRunningWorkflows] = useState<RunningWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [launching, setLaunching] = useState(false);
  const [activePhases, setActivePhases] = useState<Record<string, string>>({});

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const data = await workflowApi.list();
      setWorkflows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch workflows');
    } finally {
      setLoading(false);
    }
  };

  const fetchRunning = async () => {
    try {
      const data = await workflowApi.getRunning();
      setRunningWorkflows(data);
    } catch (err) {
      console.error('Failed to fetch running workflows:', err);
    }
  };

  useEffect(() => {
    fetchWorkflows();
    fetchRunning();

    // Poll for updates
    const interval = setInterval(fetchRunning, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle WebSocket events
  const handleWorkflowEvent = useCallback((message: WSMessage) => {
    if (message.type === 'workflow:start') {
      fetchRunning();
    } else if (message.type === 'workflow:phase') {
      const payload = message.payload as { workflowId: string; phase: string; status: string };
      setActivePhases((prev) => ({
        ...prev,
        [payload.workflowId]: payload.phase,
      }));
    } else if (message.type === 'workflow:complete' || message.type === 'workflow:error') {
      fetchRunning();
    }
  }, []);

  useWebSocketEvent('workflow:start', handleWorkflowEvent);
  useWebSocketEvent('workflow:phase', handleWorkflowEvent);
  useWebSocketEvent('workflow:complete', handleWorkflowEvent);
  useWebSocketEvent('workflow:error', handleWorkflowEvent);

  const handleLaunch = async () => {
    if (!selectedWorkflow) return;

    setLaunching(true);
    try {
      await workflowApi.launch({ workflow: selectedWorkflow.id });
      setLaunchDialogOpen(false);
      fetchRunning();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch workflow');
    } finally {
      setLaunching(false);
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
      default:
        return 'default';
    }
  };

  const getPhaseIndex = (workflow: RunningWorkflow) => {
    const workflowDef = workflows.find((w) => w.id === workflow.workflow);
    if (!workflowDef) return 0;
    const currentPhase = activePhases[workflow.id];
    if (!currentPhase) return 0;
    return workflowDef.phases.indexOf(currentPhase);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Workflows
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Run multi-phase workflows with agent orchestration
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => {
            fetchWorkflows();
            fetchRunning();
          }}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Running Workflows */}
      {runningWorkflows.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Running Workflows
          </Typography>
          <Grid container spacing={3}>
            {runningWorkflows.map((running) => {
              const workflowDef = workflows.find((w) => w.id === running.workflow);
              return (
                <Grid item xs={12} key={running.id}>
                  <Card>
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6">{running.workflow}</Typography>
                        <Chip
                          label={running.status}
                          color={getStatusColor(running.status)}
                          size="small"
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Started: {new Date(running.startedAt).toLocaleString()}
                      </Typography>
                      {running.status === 'running' && (
                        <Box sx={{ mt: 2 }}>
                          <LinearProgress sx={{ mb: 2 }} />
                          {workflowDef && (
                            <Stepper activeStep={getPhaseIndex(running)} alternativeLabel>
                              {workflowDef.phases.map((phase) => (
                                <Step key={phase}>
                                  <StepLabel>{phase}</StepLabel>
                                </Step>
                              ))}
                            </Stepper>
                          )}
                        </Box>
                      )}
                      {running.status === 'completed' && running.report != null && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2">Report:</Typography>
                          <Box
                            component="pre"
                            sx={{
                              p: 2,
                              backgroundColor: 'background.default',
                              borderRadius: 1,
                              maxHeight: 200,
                              overflow: 'auto',
                              fontFamily: 'monospace',
                              fontSize: '0.75rem',
                              m: 0,
                            }}
                          >
                            {String(JSON.stringify(running.report, null, 2))}
                          </Box>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {/* Available Workflows */}
      <Typography variant="h6" gutterBottom>
        Available Workflows
      </Typography>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : workflows.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">No workflows available</Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {workflows.map((workflow) => (
            <Grid item xs={12} sm={6} md={4} key={workflow.id}>
              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {workflow.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {workflow.description}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {workflow.phases.map((phase) => (
                      <Chip key={phase} label={phase} size="small" variant="outlined" />
                    ))}
                  </Box>
                </CardContent>
                <CardActions>
                  <Button
                    startIcon={<PlayIcon />}
                    onClick={() => {
                      setSelectedWorkflow(workflow);
                      setLaunchDialogOpen(true);
                    }}
                  >
                    Launch
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Launch Dialog */}
      <Dialog open={launchDialogOpen} onClose={() => setLaunchDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Launch Workflow</DialogTitle>
        <DialogContent>
          {selectedWorkflow && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedWorkflow.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {selectedWorkflow.description}
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                Phases:
              </Typography>
              <Stepper orientation="vertical">
                {selectedWorkflow.phases.map((phase) => (
                  <Step key={phase} active={false}>
                    <StepLabel>{phase}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLaunchDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleLaunch}
            variant="contained"
            disabled={launching}
            startIcon={launching ? <CircularProgress size={20} /> : <PlayIcon />}
          >
            {launching ? 'Launching...' : 'Launch'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
