import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  Divider,
} from '@mui/material';
import type { Specification } from '../../api/types';

interface SpecificationViewerProps {
  open: boolean;
  onClose: () => void;
  specification: Specification | null;
  onEdit?: (spec: Specification) => void;
  onSubmitForReview?: (spec: Specification) => void;
  onApprove?: (spec: Specification) => void;
  onReject?: (spec: Specification) => void;
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

export default function SpecificationViewer({
  open,
  onClose,
  specification,
  onEdit,
  onSubmitForReview,
  onApprove,
  onReject,
}: SpecificationViewerProps) {
  if (!specification) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" component="span">
            {specification.title}
          </Typography>
          <Chip
            label={typeLabels[specification.type] || specification.type}
            size="small"
            variant="outlined"
          />
          <Chip
            label={specification.status.replace('_', ' ')}
            size="small"
            color={statusColors[specification.status] || 'default'}
          />
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Version {specification.version} | Created by {specification.createdBy}
            {specification.reviewedBy && ` | Reviewed by ${specification.reviewedBy}`}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Last updated: {new Date(specification.updatedAt).toLocaleString()}
            {specification.approvedAt && (
              <> | Approved: {new Date(specification.approvedAt).toLocaleString()}</>
            )}
          </Typography>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box
          sx={{
            p: 2,
            bgcolor: 'background.default',
            borderRadius: 1,
            maxHeight: 400,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap',
          }}
        >
          {specification.content}
        </Box>

        {specification.comments && specification.comments.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" gutterBottom>
              Review Comments
            </Typography>
            {specification.comments.map((comment) => (
              <Box
                key={comment.id}
                sx={{
                  p: 1.5,
                  mb: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  borderLeft: 3,
                  borderColor: comment.resolved ? 'success.main' : 'warning.main',
                }}
              >
                <Typography variant="body2">{comment.content}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {comment.author} - {new Date(comment.createdAt).toLocaleString()}
                  {comment.resolved && ' (Resolved)'}
                </Typography>
              </Box>
            ))}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>

        {specification.status === 'draft' && onEdit && (
          <Button onClick={() => onEdit(specification)} variant="outlined">
            Edit
          </Button>
        )}

        {specification.status === 'draft' && onSubmitForReview && (
          <Button
            onClick={() => onSubmitForReview(specification)}
            variant="contained"
            color="primary"
          >
            Submit for Review
          </Button>
        )}

        {specification.status === 'pending_review' && onReject && (
          <Button
            onClick={() => onReject(specification)}
            variant="outlined"
            color="error"
          >
            Reject
          </Button>
        )}

        {specification.status === 'pending_review' && onApprove && (
          <Button
            onClick={() => onApprove(specification)}
            variant="contained"
            color="success"
          >
            Approve
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
