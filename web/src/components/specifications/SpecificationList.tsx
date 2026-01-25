import {
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import type { Specification } from '../../api/types';

interface SpecificationListProps {
  specifications: Specification[];
  onView: (spec: Specification) => void;
  onEdit: (spec: Specification) => void;
  onDelete: (spec: Specification) => void;
  loading?: boolean;
}

const statusColors: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  draft: 'default',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'error',
};

const typeLabels: Record<string, string> = {
  architecture: 'Architecture',
  requirements: 'Requirements',
  design: 'Design',
  api: 'API',
  other: 'Other',
};

export default function SpecificationList({
  specifications,
  onView,
  onEdit,
  onDelete,
  loading,
}: SpecificationListProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (specifications.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No specifications yet
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {specifications.map((spec) => (
        <ListItem key={spec.id} disablePadding divider>
          <ListItemButton onClick={() => onView(spec)}>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2">{spec.title}</Typography>
                  <Chip
                    label={typeLabels[spec.type] || spec.type}
                    size="small"
                    variant="outlined"
                  />
                  <Chip
                    label={spec.status.replace('_', ' ')}
                    size="small"
                    color={statusColors[spec.status] || 'default'}
                  />
                </Box>
              }
              secondary={
                <Box sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    v{spec.version} | Created by {spec.createdBy} |{' '}
                    {new Date(spec.updatedAt).toLocaleDateString()}
                  </Typography>
                </Box>
              }
            />
            <ListItemSecondaryAction>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onView(spec); }}>
                <ViewIcon fontSize="small" />
              </IconButton>
              {spec.status !== 'approved' && (
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(spec); }}>
                  <EditIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onDelete(spec); }}
                color="error"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
}
