import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  CircularProgress,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  ArrowForward as ArrowForwardIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import type { ProjectTask, TaskPhase } from '../../api/types';

interface TaskKanbanBoardProps {
  tasksByPhase: Record<TaskPhase, ProjectTask[]>;
  onTaskClick: (task: ProjectTask) => void;
  onTransitionPhase: (task: ProjectTask, newPhase: TaskPhase) => void;
  onDeleteTask: (task: ProjectTask) => void;
  loading?: boolean;
}

const PHASE_ORDER: TaskPhase[] = ['draft', 'specification', 'review', 'development', 'completed'];

const PHASE_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  draft: ['specification', 'cancelled'],
  specification: ['review', 'cancelled'],
  review: ['specification', 'development', 'cancelled'],
  development: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const PHASE_LABELS: Record<TaskPhase, string> = {
  draft: 'Draft',
  specification: 'Specification',
  review: 'Review',
  development: 'Development',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

interface TaskCardProps {
  task: ProjectTask;
  onTaskClick: (task: ProjectTask) => void;
  onTransitionPhase: (task: ProjectTask, newPhase: TaskPhase) => void;
  onDeleteTask: (task: ProjectTask) => void;
}

function TaskCard({ task, onTaskClick, onTransitionPhase, onDeleteTask }: TaskCardProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleTransition = (phase: TaskPhase) => {
    handleMenuClose();
    onTransitionPhase(task, phase);
  };

  const handleDelete = () => {
    handleMenuClose();
    onDeleteTask(task);
  };

  const allowedTransitions = PHASE_TRANSITIONS[task.phase];

  return (
    <Card
      sx={{
        mb: 1.5,
        cursor: 'pointer',
        '&:hover': {
          boxShadow: 2,
        },
      }}
      onClick={() => onTaskClick(task)}
    >
      <CardContent sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1, pr: 1 }}>
            {task.title}
          </Typography>
          <IconButton size="small" onClick={handleMenuClick}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Box>

        {task.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {task.description}
          </Typography>
        )}

        <Box sx={{ mt: 1.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {task.assignedAgents.map((agent) => (
            <Chip key={agent} label={agent} size="small" variant="outlined" />
          ))}
        </Box>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Priority: {task.priority}
        </Typography>
      </CardContent>

      <Menu anchorEl={anchorEl} open={menuOpen} onClose={handleMenuClose}>
        {allowedTransitions.length > 0 && (
          <MenuItem disabled>
            <Typography variant="caption" color="text.secondary">
              Move to
            </Typography>
          </MenuItem>
        )}
        {allowedTransitions.map((phase) => (
          <MenuItem key={phase} onClick={() => handleTransition(phase)}>
            <ArrowForwardIcon fontSize="small" sx={{ mr: 1 }} />
            {PHASE_LABELS[phase]}
          </MenuItem>
        ))}
        {allowedTransitions.length > 0 && <MenuItem divider />}
        <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Card>
  );
}

export default function TaskKanbanBoard({
  tasksByPhase,
  onTaskClick,
  onTransitionPhase,
  onDeleteTask,
  loading,
}: TaskKanbanBoardProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        overflowX: 'auto',
        pb: 2,
        minHeight: 400,
      }}
    >
      {PHASE_ORDER.map((phase) => {
        const tasks = tasksByPhase[phase] || [];

        return (
          <Paper
            key={phase}
            sx={{
              minWidth: 280,
              maxWidth: 320,
              flex: 1,
              bgcolor: 'background.default',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                p: 2,
                borderBottom: 1,
                borderColor: 'divider',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {PHASE_LABELS[phase]}
                </Typography>
                <Chip label={tasks.length} size="small" />
              </Box>
            </Box>

            <Box
              sx={{
                p: 1.5,
                flex: 1,
                overflowY: 'auto',
              }}
            >
              {tasks.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: 'center', py: 4 }}
                >
                  No tasks
                </Typography>
              ) : (
                tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onTaskClick={onTaskClick}
                    onTransitionPhase={onTransitionPhase}
                    onDeleteTask={onDeleteTask}
                  />
                ))
              )}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
}
