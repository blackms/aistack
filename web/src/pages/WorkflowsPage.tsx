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
  TextField,
  Divider,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
  Stop as StopIcon,
  Code as CodeIcon,
} from '@mui/icons-material';
import { workflowApi } from '../api/client';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import { useReviewLoopStore } from '../stores';
import type { Workflow, RunningWorkflow, WSMessage, ReviewLoop } from '../api/types';

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runningWorkflows, setRunningWorkflows] = useState<RunningWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [launching, setLaunching] = useState(false);
  const [activePhases, setActivePhases] = useState<Record<string, string>>({});

  // Review loop state
  const {
    loops: reviewLoops,
    loading: loopsLoading,
    fetchLoops,
    launchLoop,
    abortLoop,
    updateLoop,
    removeLoop,
  } = useReviewLoopStore();
  const [reviewLoopDialogOpen, setReviewLoopDialogOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [maxIterations, setMaxIterations] = useState(3);
  const [launchingLoop, setLaunchingLoop] = useState(false);

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
    fetchLoops();

    // Poll for updates
    const interval = setInterval(() => {
      fetchRunning();
      fetchLoops();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchLoops]);

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

  // Handle review loop WebSocket events
  const handleReviewLoopEvent = useCallback((message: WSMessage) => {
    const payload = message.payload as { loopId: string; state: ReviewLoop };

    if (message.type === 'review-loop:start') {
      fetchLoops();
    } else if (message.type === 'review-loop:iteration' || message.type === 'review-loop:review' || message.type === 'review-loop:fix') {
      // Update the loop in store
      if (payload.state) {
        const updatedLoop: ReviewLoop = {
          id: payload.state.id,
          coderId: payload.state.coderId,
          adversarialId: payload.state.adversarialId,
          sessionId: payload.state.sessionId,
          iteration: payload.state.iteration,
          maxIterations: payload.state.maxIterations,
          status: payload.state.status,
          finalVerdict: payload.state.finalVerdict,
          startedAt: payload.state.startedAt,
          completedAt: payload.state.completedAt,
          reviewCount: payload.state.reviewCount || payload.state.iteration,
        };
        updateLoop(updatedLoop);
      }
    } else if (message.type === 'review-loop:complete' || message.type === 'review-loop:approved') {
      fetchLoops();
    } else if (message.type === 'review-loop:aborted') {
      removeLoop(payload.loopId);
    }
  }, [fetchLoops, updateLoop, removeLoop]);

  useWebSocketEvent('review-loop:start', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:iteration', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:review', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:fix', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:approved', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:complete', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:aborted', handleReviewLoopEvent);
  useWebSocketEvent('review-loop:error', handleReviewLoopEvent);

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

  const handleLaunchReviewLoop = async () => {
    if (!codeInput.trim()) {
      setError('Code input is required');
      return;
    }

    setLaunchingLoop(true);
    try {
      await launchLoop({
        codeInput,
        maxIterations,
      });
      setReviewLoopDialogOpen(false);
      setCodeInput('');
      setMaxIterations(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch review loop');
    } finally {
      setLaunchingLoop(false);
    }
  };

  const handleAbortLoop = async (id: string) => {
    try {
      await abortLoop(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to abort review loop');
    }
  };

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info' => {
    switch (status) {
      case 'running':
      case 'coding':
      case 'reviewing':
      case 'fixing':
        return 'primary';
      case 'completed':
      case 'approved':
        return 'success';
      case 'failed':
        return 'error';
      case 'pending':
        return 'info';
      case 'max_iterations_reached':
        return 'warning';
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

      {/* Review Loops Section */}
      <Divider sx={{ my: 4 }} />
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Review Loops</Typography>
          <Button
            variant="contained"
            startIcon={<CodeIcon />}
            onClick={() => setReviewLoopDialogOpen(true)}
          >
            New Review Loop
          </Button>
        </Box>

        {loopsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : reviewLoops.length === 0 ? (
          <Card>
            <CardContent sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">No active review loops</Typography>
            </CardContent>
          </Card>
        ) : (
          <Grid container spacing={3}>
            {reviewLoops.map((loop) => (
              <Grid item xs={12} md={6} key={loop.id}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h6" sx={{ fontSize: '1rem' }}>
                        Review Loop #{loop.id.slice(0, 8)}
                      </Typography>
                      <Chip
                        label={loop.status}
                        color={getStatusColor(loop.status)}
                        size="small"
                      />
                    </Box>

                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Iteration: {loop.iteration} / {loop.maxIterations}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Reviews: {loop.reviewCount}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Started: {new Date(loop.startedAt).toLocaleString()}
                      </Typography>
                      {loop.completedAt && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Completed: {new Date(loop.completedAt).toLocaleString()}
                        </Typography>
                      )}
                      {loop.finalVerdict && (
                        <Chip
                          label={loop.finalVerdict}
                          color={loop.finalVerdict === 'APPROVE' ? 'success' : 'error'}
                          size="small"
                          sx={{ mt: 1 }}
                        />
                      )}
                    </Box>

                    {(loop.status === 'coding' || loop.status === 'reviewing' || loop.status === 'fixing') && (
                      <LinearProgress sx={{ mb: 2 }} />
                    )}

                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Typography variant="caption" sx={{ px: 1, py: 0.5, bgcolor: 'primary.light', borderRadius: 1 }}>
                        Coder: {loop.coderId.slice(0, 8)}
                      </Typography>
                      <Typography variant="caption" sx={{ px: 1, py: 0.5, bgcolor: 'error.light', borderRadius: 1 }}>
                        Adversarial: {loop.adversarialId.slice(0, 8)}
                      </Typography>
                    </Box>
                  </CardContent>
                  <CardActions>
                    {(loop.status === 'pending' || loop.status === 'coding' || loop.status === 'reviewing' || loop.status === 'fixing') && (
                      <Button
                        size="small"
                        color="error"
                        startIcon={<StopIcon />}
                        onClick={() => handleAbortLoop(loop.id)}
                      >
                        Abort
                      </Button>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      <Divider sx={{ my: 4 }} />

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

      {/* Launch Workflow Dialog */}
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

      {/* Launch Review Loop Dialog */}
      <Dialog open={reviewLoopDialogOpen} onClose={() => setReviewLoopDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Launch Review Loop</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Start an iterative code review loop where a coder agent generates code and an adversarial agent reviews it, providing feedback until the code is approved or max iterations are reached.
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={10}
              label="Code Requirements"
              placeholder="Describe what code you want to generate..."
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              sx={{ mb: 3 }}
            />

            <TextField
              fullWidth
              type="number"
              label="Max Iterations"
              value={maxIterations}
              onChange={(e) => setMaxIterations(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
              inputProps={{ min: 1, max: 10 }}
              helperText="Maximum number of review iterations (1-10)"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewLoopDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleLaunchReviewLoop}
            variant="contained"
            disabled={launchingLoop || !codeInput.trim()}
            startIcon={launchingLoop ? <CircularProgress size={20} /> : <CodeIcon />}
          >
            {launchingLoop ? 'Starting...' : 'Start Review Loop'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
