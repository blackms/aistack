import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  CircularProgress,
} from '@mui/material';
import type { Specification, SpecificationType, CreateSpecificationRequest, UpdateSpecificationRequest } from '../../api/types';

interface SpecificationEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: CreateSpecificationRequest | UpdateSpecificationRequest) => Promise<void>;
  specification?: Specification | null;
  loading?: boolean;
  defaultCreatedBy?: string;
}

const SPEC_TYPES: { value: SpecificationType; label: string }[] = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'design', label: 'Design' },
  { value: 'api', label: 'API' },
  { value: 'other', label: 'Other' },
];

export default function SpecificationEditor({
  open,
  onClose,
  onSave,
  specification,
  loading,
  defaultCreatedBy = 'user',
}: SpecificationEditorProps) {
  const [type, setType] = useState<SpecificationType>('architecture');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const isEdit = !!specification;

  useEffect(() => {
    if (specification) {
      setType(specification.type);
      setTitle(specification.title);
      setContent(specification.content);
    } else {
      setType('architecture');
      setTitle('');
      setContent('');
    }
  }, [specification, open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        await onSave({
          title,
          content,
          type,
        } as UpdateSpecificationRequest);
      } else {
        await onSave({
          type,
          title,
          content,
          createdBy: defaultCreatedBy,
        } as CreateSpecificationRequest);
      }
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setSaving(false);
    }
  };

  const isValid = title.trim() && content.trim();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Specification' : 'New Specification'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <FormControl sx={{ minWidth: 150 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={type}
              label="Type"
              onChange={(e) => setType(e.target.value as SpecificationType)}
            >
              {SPEC_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter specification title..."
          />
        </Box>

        <TextField
          fullWidth
          multiline
          rows={15}
          label="Content (Markdown)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="Write your specification in Markdown format..."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!isValid || saving || loading}
          startIcon={saving ? <CircularProgress size={20} /> : null}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
