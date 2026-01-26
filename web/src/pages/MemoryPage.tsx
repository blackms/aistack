import { useEffect, useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  FormControlLabel,
  Switch,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useMemoryStore } from '../stores';

export default function MemoryPage() {
  const {
    entries,
    searchResults,
    pagination,
    loading,
    searching,
    error,
    fetchEntries,
    search,
    storeEntry,
    deleteEntry,
    clearSearch,
    clearError,
  } = useMemoryStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [useVector, setUseVector] = useState(false);
  const [storeDialogOpen, setStoreDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<typeof entries[0] | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newNamespace, setNewNamespace] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    fetchEntries({ limit: rowsPerPage, offset: page * rowsPerPage });
  }, [fetchEntries, page, rowsPerPage]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      search(searchQuery, { useVector });
    } else {
      clearSearch();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    clearSearch();
  };

  const handleStore = async () => {
    if (!newKey || !newContent) return;

    try {
      await storeEntry(newKey, newContent, newNamespace || undefined);
      setStoreDialogOpen(false);
      setNewKey('');
      setNewContent('');
      setNewNamespace('');
      fetchEntries({ limit: rowsPerPage, offset: page * rowsPerPage });
    } catch {
      // Error is handled by store
    }
  };

  const handleDelete = async (key: string, namespace?: string) => {
    if (window.confirm(`Are you sure you want to delete "${key}"?`)) {
      try {
        await deleteEntry(key, namespace);
        fetchEntries({ limit: rowsPerPage, offset: page * rowsPerPage });
      } catch {
        // Error is handled by store
      }
    }
  };

  const handleView = (entry: typeof entries[0]) => {
    setSelectedEntry(entry);
    setViewDialogOpen(true);
  };

  const displayData = searchResults.length > 0 ? searchResults.map((r) => r.entry) : entries;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Memory
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Explore and manage stored memory entries
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setStoreDialogOpen(true)}
        >
          Store Entry
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Search */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                placeholder="Search memory..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                  endAdornment: searchQuery && (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={handleClearSearch}>
                        <ClearIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControlLabel
                control={
                  <Switch
                    checked={useVector}
                    onChange={(e) => setUseVector(e.target.checked)}
                  />
                }
                label="Vector Search"
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <Button
                fullWidth
                variant="contained"
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                startIcon={searching ? <CircularProgress size={20} /> : <SearchIcon />}
              >
                Search
              </Button>
            </Grid>
          </Grid>
          {searchResults.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Chip
                label={`${searchResults.length} results found`}
                onDelete={handleClearSearch}
                color="primary"
                size="small"
              />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>Namespace</TableCell>
                <TableCell>Content Preview</TableCell>
                <TableCell>Tags</TableCell>
                {searchResults.length > 0 && <TableCell>Score</TableCell>}
                <TableCell>Updated</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && displayData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={searchResults.length > 0 ? 7 : 6} align="center">
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : displayData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={searchResults.length > 0 ? 7 : 6} align="center">
                    <Typography color="text.secondary">No entries found</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                displayData.map((entry, index) => {
                  const result = searchResults[index];
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {entry.key}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={entry.namespace} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                          {entry.content.slice(0, 100)}
                          {entry.content.length > 100 && '...'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {entry.tags && entry.tags.length > 0 ? (
                            entry.tags.map((tag) => (
                              <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                sx={{
                                  backgroundColor: 'primary.light',
                                  color: 'primary.contrastText',
                                  fontSize: '0.7rem',
                                }}
                              />
                            ))
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              No tags
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      {searchResults.length > 0 && (
                        <TableCell>
                          <Tooltip title={result?.matchType || 'exact'}>
                            <Chip
                              label={result?.score.toFixed(2) || '-'}
                              size="small"
                              color={
                                result?.matchType === 'vector'
                                  ? 'primary'
                                  : result?.matchType === 'fts'
                                  ? 'secondary'
                                  : 'default'
                              }
                            />
                          </Tooltip>
                        </TableCell>
                      )}
                      <TableCell>
                        <Typography variant="caption">
                          {new Date(entry.updatedAt).toLocaleString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => handleView(entry)}>
                          <ViewIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(entry.key, entry.namespace)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {searchResults.length === 0 && (
          <TablePagination
            component="div"
            count={pagination.total}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
          />
        )}
      </Card>

      {/* Store Dialog */}
      <Dialog open={storeDialogOpen} onClose={() => setStoreDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Store New Entry</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            sx={{ mt: 2 }}
            required
          />
          <TextField
            fullWidth
            label="Namespace"
            value={newNamespace}
            onChange={(e) => setNewNamespace(e.target.value)}
            sx={{ mt: 2 }}
            placeholder="default"
          />
          <TextField
            fullWidth
            multiline
            rows={6}
            label="Content"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            sx={{ mt: 2 }}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStoreDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleStore} variant="contained" disabled={!newKey || !newContent || loading}>
            Store
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onClose={() => setViewDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Memory Entry: {selectedEntry?.key}</DialogTitle>
        <DialogContent>
          {selectedEntry && (
            <Box>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Namespace
                  </Typography>
                  <Typography>{selectedEntry.namespace}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    ID
                  </Typography>
                  <Typography variant="body2">{selectedEntry.id}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Created
                  </Typography>
                  <Typography>{new Date(selectedEntry.createdAt).toLocaleString()}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Updated
                  </Typography>
                  <Typography>{new Date(selectedEntry.updatedAt).toLocaleString()}</Typography>
                </Grid>
              </Grid>
              <Typography variant="caption" color="text.secondary">
                Content
              </Typography>
              <Box
                sx={{
                  p: 2,
                  backgroundColor: 'background.default',
                  borderRadius: 1,
                  maxHeight: 400,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {selectedEntry.content}
              </Box>
              {selectedEntry.metadata && Object.keys(selectedEntry.metadata).length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Metadata
                  </Typography>
                  <Box
                    sx={{
                      p: 2,
                      backgroundColor: 'background.default',
                      borderRadius: 1,
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                    }}
                  >
                    {JSON.stringify(selectedEntry.metadata, null, 2)}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
