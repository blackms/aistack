import { useEffect, useState } from 'react';
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
  TextField,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Stop as StopIcon,
  PlayArrow as PlayIcon,
} from '@mui/icons-material';
import { useSessionStore } from '../stores';
import type { Session } from '../api/types';

export default function SessionsPage() {
  const {
    sessions,
    activeSession,
    loading,
    error,
    fetchSessions,
    fetchActiveSession,
    createSession,
    endSession,
    clearError,
  } = useSessionStore();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [metadata, setMetadata] = useState('{}');
  const [creating, setCreating] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState<'all' | 'active' | 'ended'>('all');

  useEffect(() => {
    fetchSessions();
    fetchActiveSession();
  }, [fetchSessions, fetchActiveSession]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: 'all' | 'active' | 'ended') => {
    setTabValue(newValue);
    if (newValue === 'all') {
      fetchSessions();
    } else {
      fetchSessions(newValue);
    }
  };

  const handleCreateSession = async () => {
    setMetadataError(null);

    // Parse metadata
    let parsedMetadata: Record<string, unknown> | undefined;
    if (metadata.trim()) {
      try {
        parsedMetadata = JSON.parse(metadata) as Record<string, unknown>;
      } catch (err) {
        setMetadataError('Invalid JSON format');
        return;
      }
    }

    setCreating(true);
    try {
      await createSession(parsedMetadata);
      setCreateDialogOpen(false);
      setMetadata('{}');
      fetchActiveSession();
    } catch (err) {
      // Error handled by store
    } finally {
      setCreating(false);
    }
  };

  const handleEndSession = async (id: string) => {
    try {
      await endSession(id);
      fetchActiveSession();
    } catch (err) {
      // Error handled by store
    }
  };

  const getStatusColor = (status: string): 'default' | 'success' | 'error' => {
    switch (status) {
      case 'active':
        return 'success';
      case 'ended':
        return 'default';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatDuration = (session: Session) => {
    const start = new Date(session.startedAt);
    const end = session.endedAt ? new Date(session.endedAt) : new Date();
    const duration = end.getTime() - start.getTime();

    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const filteredSessions = sessions;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Sessions
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage agent execution sessions
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => {
              fetchSessions();
              fetchActiveSession();
            }}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            New Session
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Active Session Card */}
      {activeSession && (
        <Card sx={{ mb: 4, border: 2, borderColor: 'success.main' }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Active Session</Typography>
              <Chip label="Active" color="success" icon={<PlayIcon />} />
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              ID: {activeSession.id}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Started: {new Date(activeSession.startedAt).toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Duration: {formatDuration(activeSession)}
            </Typography>

            {activeSession.metadata && Object.keys(activeSession.metadata).length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Metadata:
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    p: 1,
                    backgroundColor: 'background.default',
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    overflow: 'auto',
                    m: 0,
                  }}
                >
                  {JSON.stringify(activeSession.metadata, null, 2)}
                </Box>
              </Box>
            )}
          </CardContent>
          <CardActions>
            <Button
              size="small"
              color="error"
              startIcon={<StopIcon />}
              onClick={() => handleEndSession(activeSession.id)}
            >
              End Session
            </Button>
          </CardActions>
        </Card>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange}>
          <Tab label="All Sessions" value="all" />
          <Tab label="Active" value="active" />
          <Tab label="Ended" value="ended" />
        </Tabs>
      </Box>

      {/* Sessions List */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filteredSessions.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">No sessions found</Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {filteredSessions.map((session) => (
            <Grid item xs={12} sm={6} md={4} key={session.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontSize: '1rem' }}>
                      Session
                    </Typography>
                    <Chip
                      label={session.status}
                      color={getStatusColor(session.status)}
                      size="small"
                    />
                  </Box>

                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    ID: {session.id.slice(0, 8)}...
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    Started: {new Date(session.startedAt).toLocaleString()}
                  </Typography>
                  {session.endedAt && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                      Ended: {new Date(session.endedAt).toLocaleString()}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block">
                    Duration: {formatDuration(session)}
                  </Typography>

                  {session.metadata && Object.keys(session.metadata).length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        {Object.keys(session.metadata).length} metadata field(s)
                      </Typography>
                    </Box>
                  )}
                </CardContent>
                <CardActions>
                  {session.status === 'active' && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<StopIcon />}
                      onClick={() => handleEndSession(session.id)}
                    >
                      End
                    </Button>
                  )}
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Session Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Session</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Create a new session to group agent executions and tasks. Optionally provide metadata as JSON.
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={6}
              label="Metadata (JSON)"
              placeholder='{"key": "value"}'
              value={metadata}
              onChange={(e) => {
                setMetadata(e.target.value);
                setMetadataError(null);
              }}
              error={!!metadataError}
              helperText={metadataError || 'Optional: Provide metadata as valid JSON'}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateSession}
            variant="contained"
            disabled={creating}
            startIcon={creating ? <CircularProgress size={20} /> : <AddIcon />}
          >
            {creating ? 'Creating...' : 'Create Session'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
