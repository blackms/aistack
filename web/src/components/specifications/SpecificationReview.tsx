import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import type { Specification, ApproveSpecificationRequest, RejectSpecificationRequest, ReviewComment } from '../../api/types';

interface SpecificationReviewProps {
  open: boolean;
  onClose: () => void;
  specification: Specification | null;
  action: 'approve' | 'reject';
  onApprove: (specId: string, data: ApproveSpecificationRequest) => Promise<void>;
  onReject: (specId: string, data: RejectSpecificationRequest) => Promise<void>;
  reviewerName?: string;
}

export default function SpecificationReview({
  open,
  onClose,
  specification,
  action,
  onApprove,
  onReject,
  reviewerName = 'user',
}: SpecificationReviewProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!specification) return;

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const newComment: ReviewComment = {
        id: crypto.randomUUID(),
        author: reviewerName,
        content: comment,
        createdAt: now,
        resolved: false,
      };

      if (action === 'approve') {
        await onApprove(specification.id, {
          reviewedBy: reviewerName,
          comments: comment ? [newComment] : undefined,
        });
      } else {
        if (!comment.trim()) {
          return; // Comment required for rejection
        }
        await onReject(specification.id, {
          reviewedBy: reviewerName,
          comments: [newComment],
        });
      }
      setComment('');
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = action === 'approve' || comment.trim();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {action === 'approve' ? 'Approve Specification' : 'Reject Specification'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {action === 'approve'
            ? 'You can optionally add a comment with your approval.'
            : 'Please provide feedback explaining why this specification is being rejected.'}
        </Typography>

        <TextField
          fullWidth
          multiline
          rows={4}
          label={action === 'approve' ? 'Comment (optional)' : 'Rejection Reason (required)'}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={
            action === 'approve'
              ? 'Add any comments or notes...'
              : 'Explain what needs to be changed...'
          }
          error={action === 'reject' && !comment.trim()}
          helperText={action === 'reject' && !comment.trim() ? 'Comment is required for rejection' : ''}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color={action === 'approve' ? 'success' : 'error'}
          disabled={!isValid || submitting}
          startIcon={submitting ? <CircularProgress size={20} /> : null}
        >
          {submitting ? 'Submitting...' : action === 'approve' ? 'Approve' : 'Reject'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
