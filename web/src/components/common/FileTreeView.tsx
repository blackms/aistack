import { useState } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  CircularProgress,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  InsertDriveFile as FileIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import type { FileSystemEntry } from '../../api/types';

interface FileTreeViewProps {
  entries: FileSystemEntry[];
  onSelect: (entry: FileSystemEntry) => void;
  selectedPath?: string;
  loading?: boolean;
}

interface TreeItemProps {
  entry: FileSystemEntry;
  depth: number;
  onSelect: (entry: FileSystemEntry) => void;
  selectedPath?: string;
}

function TreeItem({ entry, depth, onSelect, selectedPath }: TreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedPath === entry.path;
  const isDirectory = entry.type === 'directory';

  const handleClick = () => {
    if (isDirectory) {
      setExpanded(!expanded);
    }
    onSelect(entry);
  };

  return (
    <>
      <ListItem disablePadding>
        <ListItemButton
          onClick={handleClick}
          selected={isSelected}
          sx={{ pl: 2 + depth * 2 }}
        >
          {isDirectory && (
            <ListItemIcon sx={{ minWidth: 24 }}>
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </ListItemIcon>
          )}
          <ListItemIcon sx={{ minWidth: 36 }}>
            {isDirectory ? (
              expanded ? <FolderOpenIcon color="primary" /> : <FolderIcon color="primary" />
            ) : (
              <FileIcon color="disabled" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={entry.name}
            primaryTypographyProps={{
              fontSize: '0.875rem',
              noWrap: true,
            }}
          />
        </ListItemButton>
      </ListItem>
      {isDirectory && entry.children && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {entry.children.map((child) => (
              <TreeItem
                key={child.path}
                entry={child}
                depth={depth + 1}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}

export default function FileTreeView({
  entries,
  onSelect,
  selectedPath,
  loading,
}: FileTreeViewProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box sx={{ py: 2, px: 2, color: 'text.secondary', fontSize: '0.875rem' }}>
        Empty directory
      </Box>
    );
  }

  return (
    <List dense>
      {entries.map((entry) => (
        <TreeItem
          key={entry.path}
          entry={entry}
          depth={0}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </List>
  );
}
