import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Grid,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Alert,
  Card,
  CardContent,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { useProjectStore } from '../stores';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { Project, WSMessage } from '../api/types';
import FolderPicker from '../components/projects/FolderPicker';
import ProjectCard from '../components/projects/ProjectCard';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const {
    projects,
    loading,
    error,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    clearError,
  } = useProjectStore();

  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  useEffect(() => {
    fetchProjects(statusFilter === 'all' ? undefined : statusFilter);
  }, [fetchProjects, statusFilter]);

  // Handle WebSocket events
  const handleProjectEvent = useCallback((message: WSMessage) => {
    if (message.type === 'project:created' || message.type === 'project:updated') {
      fetchProjects(statusFilter === 'all' ? undefined : statusFilter);
    }
  }, [fetchProjects, statusFilter]);

  useWebSocketEvent('project:created', handleProjectEvent);
  useWebSocketEvent('project:updated', handleProjectEvent);

  const handleCreate = async () => {
    if (!newProjectName || !newProjectPath) return;

    try {
      const project = await createProject({
        name: newProjectName,
        path: newProjectPath,
        description: newProjectDescription || undefined,
      });
      setCreateDialogOpen(false);
      setNewProjectName('');
      setNewProjectPath('');
      setNewProjectDescription('');
      navigate(`/projects/${project.id}`);
    } catch {
      // Error is handled by store
    }
  };

  const handleOpen = (project: Project) => {
    navigate(`/projects/${project.id}`);
  };

  const handleArchive = async (project: Project) => {
    try {
      await updateProject(project.id, { status: 'archived' });
    } catch {
      // Error is handled by store
    }
  };

  const handleUnarchive = async (project: Project) => {
    try {
      await updateProject(project.id, { status: 'active' });
    } catch {
      // Error is handled by store
    }
  };

  const handleDeleteClick = (project: Project) => {
    setProjectToDelete(project);
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject(projectToDelete.id);
      setConfirmDeleteOpen(false);
      setProjectToDelete(null);
    } catch {
      // Error is handled by store
    }
  };

  const handleFolderSelect = (path: string) => {
    setNewProjectPath(path);
    // Auto-fill name from folder name if empty
    if (!newProjectName) {
      const folderName = path.split('/').pop() || '';
      setNewProjectName(folderName);
    }
  };

  const filteredProjects = statusFilter === 'all'
    ? projects
    : projects.filter(p => p.status === statusFilter);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Projects
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage your development projects
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <ToggleButtonGroup
            value={statusFilter}
            exclusive
            onChange={(_, value) => value && setStatusFilter(value)}
            size="small"
          >
            <ToggleButton value="active">Active</ToggleButton>
            <ToggleButton value="archived">Archived</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => fetchProjects(statusFilter === 'all' ? undefined : statusFilter)}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            New Project
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading && filteredProjects.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : filteredProjects.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <FolderIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No projects yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Create your first project to get started
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              New Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {filteredProjects.map((project) => (
            <Grid item xs={12} sm={6} md={4} key={project.id}>
              <ProjectCard
                project={project}
                onOpen={handleOpen}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
                onDelete={handleDeleteClick}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Project Name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="My Project"
          />
          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <TextField
              fullWidth
              label="Project Path"
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              placeholder="/path/to/project"
            />
            <Button
              variant="outlined"
              onClick={() => setFolderPickerOpen(true)}
              sx={{ minWidth: 100 }}
            >
              Browse
            </Button>
          </Box>
          <TextField
            fullWidth
            label="Description (optional)"
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
            sx={{ mt: 2 }}
            multiline
            rows={2}
            placeholder="A brief description of the project..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={!newProjectName || !newProjectPath || loading}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Folder Picker */}
      <FolderPicker
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onSelect={handleFolderSelect}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{projectToDelete?.name}"? This action cannot be undone.
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
