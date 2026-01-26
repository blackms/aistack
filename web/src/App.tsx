import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/layout/Layout';
import NotificationProvider from './components/common/NotificationProvider';
import DashboardPage from './pages/DashboardPage';
import AgentsPage from './pages/AgentsPage';
import MemoryPage from './pages/MemoryPage';
import TasksPage from './pages/TasksPage';
import WorkflowsPage from './pages/WorkflowsPage';
import SessionsPage from './pages/SessionsPage';
import ChatPage from './pages/ChatPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import TaskDetailPage from './pages/TaskDetailPage';
import { useWebSocket } from './hooks/useWebSocket';
import { useWebSocketNotifications } from './hooks/useWebSocketNotifications';

function App() {
  const { connect, disconnect } = useWebSocket();

  // Enable real-time WebSocket notifications
  useWebSocketNotifications();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </Layout>
      <NotificationProvider />
    </>
  );
}

export default App;
