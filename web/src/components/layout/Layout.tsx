import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Chip,
  Divider,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  SmartToy as AgentIcon,
  Memory as MemoryIcon,
  Assignment as TaskIcon,
  AccountTree as WorkflowIcon,
  EventNote as SessionIcon,
  Chat as ChatIcon,
  Circle as CircleIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { useWebSocketStore } from '../../hooks/useWebSocket';

const DRAWER_WIDTH = 240;

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { path: '/projects', label: 'Projects', icon: <FolderIcon /> },
  { path: '/agents', label: 'Agents', icon: <AgentIcon /> },
  { path: '/memory', label: 'Memory', icon: <MemoryIcon /> },
  { path: '/tasks', label: 'Tasks', icon: <TaskIcon /> },
  { path: '/workflows', label: 'Workflows', icon: <WorkflowIcon /> },
  { path: '/sessions', label: 'Sessions', icon: <SessionIcon /> },
  { path: '/chat', label: 'Chat', icon: <ChatIcon /> },
];

export default function Layout({ children }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { connected } = useWebSocketStore();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const drawer = (
    <Box>
      <Toolbar>
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 700 }}>
          AgentStack
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {navItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path || location.pathname.startsWith(item.path + '/')}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              sx={{
                '&.Mui-selected': {
                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                  '&:hover': {
                    backgroundColor: 'rgba(99, 102, 241, 0.3)',
                  },
                },
              }}
            >
              <ListItemIcon sx={{ color: (location.pathname === item.path || location.pathname.startsWith(item.path + '/')) ? 'primary.main' : 'text.secondary' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { sm: `${DRAWER_WIDTH}px` },
          backgroundColor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
        elevation={0}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, color: 'text.primary' }}>
            {navItems.find((item) => item.path === location.pathname)?.label || 'AgentStack'}
          </Typography>
          <Chip
            icon={<CircleIcon sx={{ fontSize: 12, color: connected ? 'success.main' : 'error.main' }} />}
            label={connected ? 'Connected' : 'Disconnected'}
            size="small"
            variant="outlined"
            sx={{
              borderColor: connected ? 'success.main' : 'error.main',
              color: connected ? 'success.main' : 'error.main',
            }}
          />
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: '64px',
          backgroundColor: 'background.default',
          minHeight: 'calc(100vh - 64px)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
