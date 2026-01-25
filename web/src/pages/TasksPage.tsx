import { useEffect, useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTaskStore, useAgentStore } from '../stores';

export default function TasksPage() {
  const {
    tasks,
    queueStatus,
    pagination,
    loading,
    error,
    fetchTasks,
    fetchQueueStatus,
    createTask,
    clearError,
  } = useTaskStore();
  const { agentTypes, fetchAgentTypes } = useAgentStore();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [newAgentType, setNewAgentType] = useState('');
  const [newInput, setNewInput] = useState('');
  const [newPriority, setNewPriority] = useState(5);

  useEffect(() => {
    fetchTasks({ status: statusFilter || undefined, limit: rowsPerPage, offset: page * rowsPerPage });
    fetchQueueStatus();
    fetchAgentTypes();
  }, [fetchTasks, fetchQueueStatus, fetchAgentTypes, statusFilter, page, rowsPerPage]);

  const handleCreate = async () => {
    if (!newAgentType) return;

    try {
      await createTask(newAgentType, newInput || undefined, newPriority);
      setCreateDialogOpen(false);
      setNewAgentType('');
      setNewInput('');
      setNewPriority(5);
      fetchTasks({ status: statusFilter || undefined, limit: rowsPerPage, offset: page * rowsPerPage });
      fetchQueueStatus();
    } catch {
      // Error is handled by store
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
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Tasks
          </Typography>
          <Typography variant="body1" color="text.secondary">
            View and manage task queue
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => {
              fetchTasks({ status: statusFilter || undefined, limit: rowsPerPage, offset: page * rowsPerPage });
              fetchQueueStatus();
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
            Create Task
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Queue Status */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Queued
              </Typography>
              <Typography variant="h4" fontWeight={600}>
                {queueStatus?.status.queued || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Processing
              </Typography>
              <Typography variant="h4" fontWeight={600} color="primary">
                {queueStatus?.status.processing || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Total
              </Typography>
              <Typography variant="h4" fontWeight={600}>
                {queueStatus?.status.total || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Status Filter</InputLabel>
            <Select
              value={statusFilter}
              label="Status Filter"
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="running">Running</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="failed">Failed</MenuItem>
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      {/* Tasks Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Agent Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Input</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Completed</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography color="text.secondary">No tasks found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {task.id.slice(0, 8)}...
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={task.agentType} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={task.status}
                        size="small"
                        color={getStatusColor(task.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {task.input?.slice(0, 100) || '-'}
                        {task.input && task.input.length > 100 && '...'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {new Date(task.createdAt).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {task.completedAt ? new Date(task.completedAt).toLocaleString() : '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={pagination.total}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Task</DialogTitle>
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
                  {type.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Input (optional)"
            value={newInput}
            onChange={(e) => setNewInput(e.target.value)}
            sx={{ mt: 2 }}
          />
          <TextField
            fullWidth
            type="number"
            label="Priority"
            value={newPriority}
            onChange={(e) => setNewPriority(parseInt(e.target.value, 10) || 5)}
            sx={{ mt: 2 }}
            inputProps={{ min: 1, max: 10 }}
            helperText="Higher priority tasks are processed first (1-10)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained" disabled={!newAgentType || loading}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
