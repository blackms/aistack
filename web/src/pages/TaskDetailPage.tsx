import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Breadcrumbs,
  Link,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  Chip,
  Paper,
  Divider,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useProjectStore, useProjectTaskStore, useSpecificationStore } from '../stores';
import { useWebSocketEvent } from '../hooks/useWebSocket';
import type { Specification, WSMessage, CreateSpecificationRequest, UpdateSpecificationRequest } from '../api/types';
import PhaseStatusBadge from '../components/common/PhaseStatusBadge';
import SpecificationList from '../components/specifications/SpecificationList';
import SpecificationEditor from '../components/specifications/SpecificationEditor';
import SpecificationViewer from '../components/specifications/SpecificationViewer';
import SpecificationReview from '../components/specifications/SpecificationReview';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export default function TaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const navigate = useNavigate();

  const { currentProject, fetchProject } = useProjectStore();
  const { currentTask, fetchTask, loading: taskLoading, error: taskError, clearError: clearTaskError } = useProjectTaskStore();
  const {
    specifications,
    currentSpec,
    fetchSpecifications,
    createSpecification,
    updateSpecification,
    submitForReview,
    approveSpecification,
    rejectSpecification,
    deleteSpecification,
    setCurrentSpec,
    clearSpecs,
    loading: specsLoading,
    error: specsError,
    clearError: clearSpecsError,
  } = useSpecificationStore();

  const [tabValue, setTabValue] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [specToDelete, setSpecToDelete] = useState<Specification | null>(null);

  useEffect(() => {
    if (projectId && taskId) {
      fetchProject(projectId);
      fetchTask(projectId, taskId);
      fetchSpecifications(taskId);
    }

    return () => {
      clearSpecs();
    };
  }, [projectId, taskId, fetchProject, fetchTask, fetchSpecifications, clearSpecs]);

  // Handle WebSocket events
  const handleSpecEvent = useCallback((message: WSMessage) => {
    if (!taskId) return;
    const payload = message.payload as { taskId?: string };
    if (payload.taskId === taskId) {
      fetchSpecifications(taskId);
    }
  }, [taskId, fetchSpecifications]);

  useWebSocketEvent('spec:created', handleSpecEvent);
  useWebSocketEvent('spec:status', handleSpecEvent);

  const handleCreateSpec = async (data: CreateSpecificationRequest | UpdateSpecificationRequest) => {
    if (!taskId) return;
    await createSpecification(taskId, data as CreateSpecificationRequest);
  };

  const handleUpdateSpec = async (data: CreateSpecificationRequest | UpdateSpecificationRequest) => {
    if (!currentSpec) return;
    await updateSpecification(currentSpec.id, data as UpdateSpecificationRequest);
  };

  const handleViewSpec = (spec: Specification) => {
    setCurrentSpec(spec);
    setViewerOpen(true);
  };

  const handleEditSpec = (spec: Specification) => {
    setCurrentSpec(spec);
    setViewerOpen(false);
    setEditorOpen(true);
  };

  const handleDeleteClick = (spec: Specification) => {
    setSpecToDelete(spec);
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!specToDelete) return;
    await deleteSpecification(specToDelete.id);
    setConfirmDeleteOpen(false);
    setSpecToDelete(null);
  };

  const handleSubmitForReview = async (spec: Specification) => {
    await submitForReview(spec.id);
    setViewerOpen(false);
  };

  const handleApproveClick = (spec: Specification) => {
    setCurrentSpec(spec);
    setReviewAction('approve');
    setViewerOpen(false);
    setReviewDialogOpen(true);
  };

  const handleRejectClick = (spec: Specification) => {
    setCurrentSpec(spec);
    setReviewAction('reject');
    setViewerOpen(false);
    setReviewDialogOpen(true);
  };

  const loading = taskLoading || specsLoading;
  const error = taskError || specsError;

  if (loading && !currentTask) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!currentTask) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          Task not found
        </Typography>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/projects/${projectId}`)}
          sx={{ mt: 2 }}
        >
          Back to Project
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
          <Link
            component="button"
            variant="body2"
            onClick={() => navigate(`/projects/${projectId}`)}
            underline="hover"
          >
            {currentProject?.name || 'Project'}
          </Link>
          <Typography variant="body2" color="text.primary">
            {currentTask.title}
          </Typography>
        </Breadcrumbs>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h4" fontWeight={600}>
                {currentTask.title}
              </Typography>
              <PhaseStatusBadge phase={currentTask.phase} />
            </Box>
            {currentTask.description && (
              <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                {currentTask.description}
              </Typography>
            )}
            <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {currentTask.assignedAgents.map((agent) => (
                <Chip key={agent} label={agent} size="small" variant="outlined" />
              ))}
              <Chip label={`Priority: ${currentTask.priority}`} size="small" />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => taskId && fetchSpecifications(taskId)}
              disabled={loading}
            >
              Refresh
            </Button>
          </Box>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          onClose={() => {
            clearTaskError();
            clearSpecsError();
          }}
          sx={{ mb: 3 }}
        >
          {error}
        </Alert>
      )}

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
          <Tab label="Specifications" />
          <Tab label="Timeline" />
        </Tabs>
      </Paper>

      {/* Specifications Tab */}
      <TabPanel value={tabValue} index={0}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setCurrentSpec(null);
              setEditorOpen(true);
            }}
          >
            New Specification
          </Button>
        </Box>

        <SpecificationList
          specifications={specifications}
          onView={handleViewSpec}
          onEdit={handleEditSpec}
          onDelete={handleDeleteClick}
          loading={specsLoading}
        />
      </TabPanel>

      {/* Timeline Tab */}
      <TabPanel value={tabValue} index={1}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Phase Timeline
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body1">
                {new Date(currentTask.createdAt).toLocaleString()}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Last Updated
              </Typography>
              <Typography variant="body1">
                {new Date(currentTask.updatedAt).toLocaleString()}
              </Typography>
            </Box>
            {currentTask.completedAt && (
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Completed
                </Typography>
                <Typography variant="body1">
                  {new Date(currentTask.completedAt).toLocaleString()}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography variant="body2" color="text.secondary">
                Current Phase
              </Typography>
              <PhaseStatusBadge phase={currentTask.phase} />
            </Box>
          </Box>
        </Paper>
      </TabPanel>

      {/* Specification Editor */}
      <SpecificationEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setCurrentSpec(null);
        }}
        onSave={currentSpec ? handleUpdateSpec : handleCreateSpec}
        specification={currentSpec}
        loading={specsLoading}
      />

      {/* Specification Viewer */}
      <SpecificationViewer
        open={viewerOpen}
        onClose={() => {
          setViewerOpen(false);
          setCurrentSpec(null);
        }}
        specification={currentSpec}
        onEdit={handleEditSpec}
        onSubmitForReview={handleSubmitForReview}
        onApprove={handleApproveClick}
        onReject={handleRejectClick}
      />

      {/* Review Dialog */}
      <SpecificationReview
        open={reviewDialogOpen}
        onClose={() => {
          setReviewDialogOpen(false);
          setCurrentSpec(null);
        }}
        specification={currentSpec}
        action={reviewAction}
        onApprove={approveSpecification}
        onReject={rejectSpecification}
      />

      {/* Delete Confirmation */}
      {confirmDeleteOpen && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1300,
          }}
          onClick={() => setConfirmDeleteOpen(false)}
        >
          <Paper sx={{ p: 3, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <Typography variant="h6" gutterBottom>
              Delete Specification
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Are you sure you want to delete "{specToDelete?.title}"?
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
              <Button onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
              <Button onClick={handleConfirmDelete} color="error" variant="contained">
                Delete
              </Button>
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}
