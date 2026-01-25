import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Breadcrumbs,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Chip,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useProjectStore, useProjectTaskStore, useAgentStore } from '../stores';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { ProjectTask, TaskPhase, WSMessage } from '../api/types';
import TaskKanbanBoard from '../components/projects/TaskKanbanBoard';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const { currentProject, fetchProject, loading: projectLoading, error: projectError, clearError: clearProjectError } = useProjectStore();
  const { tasksByPhase, fetchTasks, createTask, transitionPhase, deleteTask, loading: tasksLoading, error: tasksError, clearError: clearTasksError, clearTasks } = useProjectTaskStore();
  const { agentTypes, fetchAgentTypes } = useAgentStore();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState(5);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<ProjectTask | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
      fetchTasks(projectId);
      fetchAgentTypes();
    }

    return () => {
      clearTasks();
    };
  }, [projectId, fetchProject, fetchTasks, fetchAgentTypes, clearTasks]);

  // Handle WebSocket events
  const handleTaskEvent = useCallback((message: WSMessage) => {
    if (!projectId) return;
    const payload = message.payload as { projectId?: string };
    if (payload.projectId === projectId) {
      fetchTasks(projectId);
    }
  }, [projectId, fetchTasks]);

  useWebSocketEvent('project:task:created', handleTaskEvent);
  useWebSocketEvent('project:task:phase', handleTaskEvent);

  const handleCreateTask = async () => {
    if (!projectId || !newTaskTitle) return;

    try {
      await createTask(projectId, {
        title: newTaskTitle,
        description: newTaskDescription || undefined,
        priority: newTaskPriority,
        assignedAgents: selectedAgents.length > 0 ? selectedAgents : undefined,
      });
      setCreateDialogOpen(false);
      setNewTaskTitle('');
      setNewTaskDescription('');
      setNewTaskPriority(5);
      setSelectedAgents([]);
    } catch {
      // Error handled by store
    }
  };

  const handleTaskClick = (task: ProjectTask) => {
    navigate(`/projects/${projectId}/tasks/${task.id}`);
  };

  const handleTransitionPhase = async (task: ProjectTask, newPhase: TaskPhase) => {
    if (!projectId) return;
    try {
      await transitionPhase(projectId, task.id, newPhase);
    } catch {
      // Error handled by store
    }
  };

  const handleDeleteClick = (task: ProjectTask) => {
    setTaskToDelete(task);
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectId || !taskToDelete) return;

    try {
      await deleteTask(projectId, taskToDelete.id);
      setConfirmDeleteOpen(false);
      setTaskToDelete(null);
    } catch {
      // Error handled by store
    }
  };

  const loading = projectLoading || tasksLoading;
  const error = projectError || tasksError;

  if (loading && !currentProject) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!currentProject) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          Project not found
        </Typography>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/projects')} sx={{ mt: 2 }}>
          Back to Projects
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Breadcrumbs sx={{ mb: 2 }}>
          <Link
            component="button"
            variant="body2"
            onClick={() => navigate('/projects')}
            underline="hover"
          >
            Projects
          </Link>
          <Typography variant="body2" color="text.primary">
            {currentProject.name}
          </Typography>
        </Breadcrumbs>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h4" fontWeight={600}>
                {currentProject.name}
              </Typography>
              <Chip
                label={currentProject.status}
                size="small"
                color={currentProject.status === 'active' ? 'success' : 'default'}
              />
            </Box>
            {currentProject.description && (
              <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                {currentProject.description}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {currentProject.path}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => projectId && fetchTasks(projectId)}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              New Task
            </Button>
          </Box>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          onClose={() => {
            clearProjectError();
            clearTasksError();
          }}
          sx={{ mb: 3 }}
        >
          {error}
        </Alert>
      )}

      {/* Kanban Board */}
      <TaskKanbanBoard
        tasksByPhase={tasksByPhase}
        onTaskClick={handleTaskClick}
        onTransitionPhase={handleTransitionPhase}
        onDeleteTask={handleDeleteClick}
        loading={tasksLoading}
      />

      {/* Create Task Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Task</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Task Title"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="What needs to be done?"
          />
          <TextField
            fullWidth
            label="Description (optional)"
            value={newTaskDescription}
            onChange={(e) => setNewTaskDescription(e.target.value)}
            sx={{ mt: 2 }}
            multiline
            rows={3}
            placeholder="Add more details..."
          />
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Priority</InputLabel>
            <Select
              value={newTaskPriority}
              label="Priority"
              onChange={(e) => setNewTaskPriority(e.target.value as number)}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => (
                <MenuItem key={p} value={p}>
                  {p} {p === 1 ? '(Highest)' : p === 10 ? '(Lowest)' : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Assign Agents</InputLabel>
            <Select
              multiple
              value={selectedAgents}
              label="Assign Agents"
              onChange={(e) => setSelectedAgents(e.target.value as string[])}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {agentTypes.map((type) => (
                <MenuItem key={type.type} value={type.type}>
                  {type.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateTask}
            variant="contained"
            disabled={!newTaskTitle || loading}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle>Delete Task</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{taskToDelete?.title}"? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
