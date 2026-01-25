import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Breadcrumbs,
  Link,
  Typography,
  Divider,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  ArrowBack as ArrowBackIcon,
  Home as HomeIcon,
} from '@mui/icons-material';
import { useFilesystemStore } from '../../stores';

interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export default function FolderPicker({
  open,
  onClose,
  onSelect,
  initialPath,
}: FolderPickerProps) {
  const {
    currentPath,
    entries,
    roots,
    parentPath,
    loading,
    error,
    fetchRoots,
    browse,
    clearError,
  } = useFilesystemStore();

  const [manualPath, setManualPath] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchRoots();
      if (initialPath) {
        browse(initialPath, { showFiles: false });
        setManualPath(initialPath);
      } else {
        browse(undefined, { showFiles: false });
      }
    }
  }, [open, fetchRoots, browse, initialPath]);

  useEffect(() => {
    if (currentPath) {
      setManualPath(currentPath);
    }
  }, [currentPath]);

  const handleFolderClick = (path: string) => {
    browse(path, { showFiles: false });
    setValidationError(null);
  };

  const handleNavigateUp = () => {
    if (parentPath) {
      browse(parentPath, { showFiles: false });
    }
  };

  const handleRootClick = (path: string) => {
    browse(path, { showFiles: false });
  };

  const handleManualPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setManualPath(e.target.value);
    setValidationError(null);
  };

  const handleManualPathSubmit = () => {
    if (manualPath) {
      browse(manualPath, { showFiles: false });
    }
  };

  const handleSelect = () => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  };

  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Select Project Folder</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={clearError} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          fullWidth
          label="Path"
          value={manualPath}
          onChange={handleManualPathChange}
          onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
          sx={{ mb: 2 }}
          InputProps={{
            endAdornment: loading ? <CircularProgress size={20} /> : null,
          }}
        />

        {validationError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {validationError}
          </Alert>
        )}

        {/* Quick Access */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Quick Access
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {roots.map((root) => (
              <Chip
                key={root.path}
                icon={root.name === 'Home' ? <HomeIcon /> : <FolderIcon />}
                label={root.name}
                onClick={() => handleRootClick(root.path)}
                variant={currentPath === root.path ? 'filled' : 'outlined'}
                color={currentPath === root.path ? 'primary' : 'default'}
              />
            ))}
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Breadcrumbs */}
        {currentPath && (
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              size="small"
              startIcon={<ArrowBackIcon />}
              onClick={handleNavigateUp}
              disabled={!parentPath}
            >
              Back
            </Button>
            <Breadcrumbs maxItems={4} sx={{ flex: 1 }}>
              <Link
                component="button"
                variant="body2"
                onClick={() => handleRootClick('/')}
                underline="hover"
              >
                /
              </Link>
              {pathParts.map((part, index) => {
                const path = '/' + pathParts.slice(0, index + 1).join('/');
                const isLast = index === pathParts.length - 1;
                return isLast ? (
                  <Typography key={path} variant="body2" color="text.primary">
                    {part}
                  </Typography>
                ) : (
                  <Link
                    key={path}
                    component="button"
                    variant="body2"
                    onClick={() => handleFolderClick(path)}
                    underline="hover"
                  >
                    {part}
                  </Link>
                );
              })}
            </Breadcrumbs>
          </Box>
        )}

        {/* Directory Listing */}
        <Box sx={{ maxHeight: 300, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : entries.filter((e) => e.type === 'directory').length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
              No subdirectories
            </Box>
          ) : (
            <List dense>
              {entries
                .filter((e) => e.type === 'directory')
                .map((entry) => (
                  <ListItem key={entry.path} disablePadding>
                    <ListItemButton onClick={() => handleFolderClick(entry.path)}>
                      <ListItemIcon>
                        <FolderIcon color="primary" />
                      </ListItemIcon>
                      <ListItemText primary={entry.name} />
                    </ListItemButton>
                  </ListItem>
                ))}
            </List>
          )}
        </Box>

        {currentPath && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Selected: <strong>{currentPath}</strong>
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSelect} variant="contained" disabled={!currentPath}>
          Select Folder
        </Button>
      </DialogActions>
    </Dialog>
  );
}
