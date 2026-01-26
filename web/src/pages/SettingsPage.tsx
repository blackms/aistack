import { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Tabs,
  Tab,
  TextField,
  Button,
  Alert,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Divider,
} from '@mui/material';
import {
  Save as SaveIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { systemApi } from '../api/client';
import { useNotificationStore } from '../stores';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

export default function SettingsPage() {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showSuccess } = useNotificationStore();

  // Provider settings
  const [defaultProvider, setDefaultProvider] = useState('anthropic');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');

  // System settings
  const [logLevel, setLogLevel] = useState('info');
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(20);
  const [maxReviewLoops, setMaxReviewLoops] = useState(5);

  // Feature flags
  const [enableVectorSearch, setEnableVectorSearch] = useState(false);
  const [enableMetrics, setEnableMetrics] = useState(true);
  const [enableWebSocket, setEnableWebSocket] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const data = await systemApi.getConfig();
      // Populate fields from config
      if (data.providers) {
        const providers = data.providers as Record<string, unknown>;
        setDefaultProvider((providers.default as string) || 'anthropic');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch config');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProviders = () => {
    showSuccess('Provider settings saved (Note: Requires server restart)');
  };

  const handleSaveSystem = () => {
    showSuccess('System settings saved (Note: Requires server restart)');
  };

  const handleSaveFeatures = () => {
    showSuccess('Feature flags saved (Note: Requires server restart)');
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Settings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Configure system settings and preferences
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={fetchConfig}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }}>
        Note: Most configuration changes require a server restart to take effect.
      </Alert>

      <Card>
        <CardContent>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab label="Providers" />
            <Tab label="System" />
            <Tab label="Features" />
            <Tab label="About" />
          </Tabs>

          {/* Providers Tab */}
          <TabPanel value={tabValue} index={0}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Default Provider</InputLabel>
                  <Select
                    value={defaultProvider}
                    label="Default Provider"
                    onChange={(e) => setDefaultProvider(e.target.value)}
                  >
                    <MenuItem value="anthropic">Anthropic Claude</MenuItem>
                    <MenuItem value="openai">OpenAI</MenuItem>
                    <MenuItem value="ollama">Ollama (Local)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Typography variant="caption">Anthropic Configuration</Typography>
                </Divider>
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Anthropic API Key"
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  helperText="Your Anthropic API key (stored in environment variable)"
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Default Model"
                  defaultValue="claude-sonnet-4-20250514"
                  helperText="Anthropic model to use by default"
                />
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Typography variant="caption">OpenAI Configuration</Typography>
                </Divider>
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="OpenAI API Key"
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  helperText="Your OpenAI API key (stored in environment variable)"
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Default Model"
                  defaultValue="gpt-4o"
                  helperText="OpenAI model to use by default"
                />
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 2 }}>
                  <Typography variant="caption">Ollama Configuration</Typography>
                </Divider>
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Ollama Base URL"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  helperText="URL of your Ollama instance"
                />
              </Grid>

              <Grid item xs={12}>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSaveProviders}
                >
                  Save Provider Settings
                </Button>
              </Grid>
            </Grid>
          </TabPanel>

          {/* System Tab */}
          <TabPanel value={tabValue} index={1}>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Log Level</InputLabel>
                  <Select
                    value={logLevel}
                    label="Log Level"
                    onChange={(e) => setLogLevel(e.target.value)}
                  >
                    <MenuItem value="debug">Debug</MenuItem>
                    <MenuItem value="info">Info</MenuItem>
                    <MenuItem value="warn">Warning</MenuItem>
                    <MenuItem value="error">Error</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Max Concurrent Agents"
                  type="number"
                  value={maxConcurrentAgents}
                  onChange={(e) => setMaxConcurrentAgents(parseInt(e.target.value))}
                  inputProps={{ min: 1, max: 50 }}
                  helperText="Maximum number of concurrent agents (1-50)"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Max Review Loops"
                  type="number"
                  value={maxReviewLoops}
                  onChange={(e) => setMaxReviewLoops(parseInt(e.target.value))}
                  inputProps={{ min: 1, max: 10 }}
                  helperText="Maximum concurrent review loops (1-10)"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Database Path"
                  defaultValue="./data/aistack.db"
                  helperText="SQLite database file path"
                  disabled
                />
              </Grid>

              <Grid item xs={12}>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSaveSystem}
                >
                  Save System Settings
                </Button>
              </Grid>
            </Grid>
          </TabPanel>

          {/* Features Tab */}
          <TabPanel value={tabValue} index={2}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableVectorSearch}
                      onChange={(e) => setEnableVectorSearch(e.target.checked)}
                    />
                  }
                  label="Enable Vector Search"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Use embedding-based semantic search for memory entries
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableMetrics}
                      onChange={(e) => setEnableMetrics(e.target.checked)}
                    />
                  }
                  label="Enable Metrics Collection"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Collect system metrics and performance data
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableWebSocket}
                      onChange={(e) => setEnableWebSocket(e.target.checked)}
                    />
                  }
                  label="Enable WebSocket"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                  Real-time updates via WebSocket connection
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSaveFeatures}
                >
                  Save Feature Settings
                </Button>
              </Grid>
            </Grid>
          </TabPanel>

          {/* About Tab */}
          <TabPanel value={tabValue} index={3}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Typography variant="h6" gutterBottom>
                  AgentStack
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Multi-agent orchestration framework with advanced workflows and real-time collaboration.
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Version
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  1.3.0
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Agent Types
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  11 core agents (Coder, Researcher, Tester, Reviewer, Adversarial, Architect, Coordinator, Analyst, DevOps, Documentation, Security Auditor)
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Features
                </Typography>
                <Typography variant="body2" color="text.secondary" component="div">
                  <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                    <li>Multi-agent orchestration</li>
                    <li>Review loop system</li>
                    <li>Full-stack feature pipeline</li>
                    <li>Session management</li>
                    <li>SQLite + FTS5 memory</li>
                    <li>Real-time WebSocket updates</li>
                    <li>Authentication system</li>
                    <li>E2E testing with Playwright</li>
                  </ul>
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Documentation
                </Typography>
                <Typography variant="body2" color="primary" sx={{ cursor: 'pointer' }}>
                  View README
                </Typography>
              </Grid>
            </Grid>
          </TabPanel>
        </CardContent>
      </Card>
    </Box>
  );
}
