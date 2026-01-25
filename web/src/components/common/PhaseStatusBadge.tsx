import { Chip } from '@mui/material';
import type { TaskPhase } from '../../api/types';

interface PhaseStatusBadgeProps {
  phase: TaskPhase;
  size?: 'small' | 'medium';
}

const phaseConfig: Record<TaskPhase, { label: string; color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', color: 'default' },
  specification: { label: 'Specification', color: 'info' },
  review: { label: 'Review', color: 'warning' },
  development: { label: 'Development', color: 'primary' },
  completed: { label: 'Completed', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'error' },
};

export default function PhaseStatusBadge({ phase, size = 'small' }: PhaseStatusBadgeProps) {
  const config = phaseConfig[phase] || { label: phase, color: 'default' as const };

  return (
    <Chip
      label={config.label}
      color={config.color}
      size={size}
      variant="filled"
    />
  );
}
