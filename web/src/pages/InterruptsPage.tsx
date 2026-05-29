/**
 * Interrupts page (AIG-644): list of pending HITL interrupts plus a form
 * for the reviewer to submit a resume value and optionally edit the
 * captured workflow state.
 *
 * Self-contained — does not modify existing pages, uses the same MUI stack
 * already present elsewhere in the dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Refresh as RefreshIcon, Send as SendIcon, Close as CloseIcon } from '@mui/icons-material';

// --- Inline API client for HITL interrupts (AIG-644). Kept here instead of
// in a separate api/interrupts.ts module to minimize the file footprint of
// this change. Mirrors the conventions of api/client.ts (envelope + fetch).
type InterruptStatus = 'pending' | 'resolved' | 'cancelled';
type InterruptNotifyChannel = 'console' | 'slack' | 'webhook';
interface InterruptValueSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum';
  enum?: ReadonlyArray<string | number>;
  description?: string;
  default?: unknown;
}
interface InterruptRecord {
  id: string;
  sessionId: string;
  workflowId?: string;
  prompt: string;
  schema?: InterruptValueSchema;
  state?: Record<string, unknown>;
  status: InterruptStatus;
  notify: InterruptNotifyChannel[];
  resumeValue?: unknown;
  claimedAt?: string;
  resolvedAt?: string;
  createdAt: string;
  cancelReason?: string;
}
interface ResumePayload {
  input?: unknown;
  stateEdits?: Array<{ path: string; value: unknown }>;
}
async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as { success: boolean; data?: T; error?: string };
  if (!res.ok || !body.success) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.data as T;
}

function parseEditValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
const interruptsApi = {
  list: (filter?: { status?: InterruptStatus; sessionId?: string }): Promise<InterruptRecord[]> => {
    const p = new URLSearchParams();
    if (filter?.status) p.set('status', filter.status);
    if (filter?.sessionId) p.set('sessionId', filter.sessionId);
    const qs = p.toString();
    return apiCall(`/interrupts${qs ? `?${qs}` : ''}`);
  },
  claim: (id: string): Promise<InterruptRecord> =>
    apiCall(`/interrupts/${encodeURIComponent(id)}/claim`, { method: 'POST' }),
  resume: (id: string, payload: ResumePayload): Promise<InterruptRecord> =>
    apiCall(`/interrupts/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancel: (id: string, reason: string): Promise<InterruptRecord> =>
    apiCall(`/interrupts/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

type Banner = { kind: 'success' | 'error'; text: string };

export default function InterruptsPage(): JSX.Element {
  const [items, setItems] = useState<InterruptRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [active, setActive] = useState<InterruptRecord | null>(null);
  const [inputJson, setInputJson] = useState('');
  const [editsText, setEditsText] = useState('');
  const [stateText, setStateText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await interruptsApi.list({ status: 'pending' });
      setItems(data);
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
    const t = setInterval(() => void fetchItems(), 5_000);
    return () => clearInterval(t);
  }, [fetchItems]);

  const openDialog = (rec: InterruptRecord): void => {
    setActive(rec);
    setInputJson(rec.schema?.default !== undefined ? JSON.stringify(rec.schema.default) : '');
    setEditsText('');
    setStateText(rec.state ? JSON.stringify(rec.state, null, 2) : '{}');
    void interruptsApi.claim(rec.id).catch(() => void 0);
  };

  const closeDialog = (): void => {
    setActive(null);
    setInputJson('');
    setEditsText('');
    setStateText('');
  };

  const buildPayload = (): ResumePayload => {
    let input: unknown;
    if (inputJson.trim().length > 0) {
      input = JSON.parse(inputJson);
    }
    const stateEdits = editsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf('=');
        if (idx === -1) throw new Error(`Invalid edit (need path=value): ${line}`);
        return { path: line.slice(0, idx).trim(), value: parseEditValue(line.slice(idx + 1)) };
      });
    return { input, stateEdits };
  };

  const submit = async (): Promise<void> => {
    if (!active) return;
    setSubmitting(true);
    try {
      const payload = buildPayload();
      await interruptsApi.resume(active.id, payload);
      setBanner({ kind: 'success', text: `Resumed interrupt ${active.id}` });
      closeDialog();
      await fetchItems();
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Resume failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string): Promise<void> => {
    try {
      await interruptsApi.cancel(id, 'Cancelled from dashboard');
      await fetchItems();
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Cancel failed' });
    }
  };

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [items]
  );

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h4">Pending HITL Interrupts</Typography>
        <IconButton onClick={() => void fetchItems()} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      {banner && (
        <Alert
          severity={banner.kind}
          sx={{ mb: 2 }}
          action={
            <IconButton size="small" onClick={() => setBanner(null)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          }
        >
          {banner.text}
        </Alert>
      )}

      {loading && items.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && sortedItems.length === 0 && (
        <Typography color="text.secondary">No pending interrupts.</Typography>
      )}

      <Stack spacing={2}>
        {sortedItems.map((rec) => (
          <Card key={rec.id}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Chip size="small" label={rec.status} color="warning" />
                {rec.workflowId && <Chip size="small" label={rec.workflowId} variant="outlined" />}
                <Typography variant="caption" color="text.secondary">
                  session {rec.sessionId} · created {rec.createdAt}
                </Typography>
              </Stack>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {rec.prompt}
              </Typography>
              {rec.schema && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Expected: <code>{JSON.stringify(rec.schema)}</code>
                </Typography>
              )}
              {rec.state && Object.keys(rec.state).length > 0 && (
                <Box
                  component="pre"
                  sx={{
                    bgcolor: 'background.default',
                    p: 1,
                    borderRadius: 1,
                    fontSize: '0.8rem',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(rec.state, null, 2)}
                </Box>
              )}
            </CardContent>
            <CardActions>
              <Button
                startIcon={<SendIcon />}
                variant="contained"
                onClick={() => openDialog(rec)}
              >
                Review &amp; Resume
              </Button>
              <Button color="error" onClick={() => void cancel(rec.id)}>
                Cancel
              </Button>
            </CardActions>
          </Card>
        ))}
      </Stack>

      <Dialog open={active !== null} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle>Resume interrupt {active?.id}</DialogTitle>
        <DialogContent>
          {active && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">{active.prompt}</Typography>
              <TextField
                label="Resume value (JSON)"
                value={inputJson}
                onChange={(e) => setInputJson(e.target.value)}
                fullWidth
                multiline
                minRows={2}
                helperText={
                  active.schema
                    ? `Schema: ${JSON.stringify(active.schema)}`
                    : 'Any JSON literal — string in quotes, number, true/false, object'
                }
              />
              <TextField
                label="State edits (one per line: path=value)"
                value={editsText}
                onChange={(e) => setEditsText(e.target.value)}
                fullWidth
                multiline
                minRows={3}
                helperText='e.g. "config.maxRetries=5" — values are JSON-parsed when possible'
              />
              <TextField
                label="Current state snapshot (read-only)"
                value={stateText}
                fullWidth
                multiline
                minRows={4}
                InputProps={{ readOnly: true }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} /> : <SendIcon />}
          >
            Resume
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
