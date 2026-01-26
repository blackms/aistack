import { useMemo } from 'react';
import { Box, Typography, Tooltip, Chip } from '@mui/material';
import { Agent } from '../../api/types';

interface AgentTimelineProps {
  agents: Agent[];
  timeWindowHours?: number;
}

interface TimelineItem {
  agent: Agent;
  startTime: Date;
  position: number;
  duration: number;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#6366f1',
  completed: '#10b981',
  failed: '#ef4444',
  stopped: '#94a3b8',
  idle: '#f59e0b',
};

export default function AgentTimeline({ agents, timeWindowHours = 1 }: AgentTimelineProps) {
  const timelineData = useMemo(() => {
    const now = Date.now();
    const windowStart = now - timeWindowHours * 60 * 60 * 1000;

    // Filter agents within time window and sort by creation time
    const recentAgents = agents
      .filter((agent) => {
        const createdAt = new Date(agent.createdAt).getTime();
        return createdAt >= windowStart;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Calculate positions and durations for each agent
    const items: TimelineItem[] = recentAgents.map((agent) => {
      const startTime = new Date(agent.createdAt);
      const startMs = startTime.getTime();
      const position = ((startMs - windowStart) / (timeWindowHours * 60 * 60 * 1000)) * 100;

      // If agent is completed/failed/stopped, assume it ran for a short duration
      // If still running, show it extending to now
      const endMs = agent.status === 'running' ? now : startMs + 5 * 60 * 1000; // 5 min default
      const duration = ((endMs - startMs) / (timeWindowHours * 60 * 60 * 1000)) * 100;

      return {
        agent,
        startTime,
        position,
        duration: Math.max(duration, 1), // Minimum 1% width for visibility
      };
    });

    return items;
  }, [agents, timeWindowHours]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  // Generate time markers for the X-axis
  const timeMarkers = useMemo(() => {
    const markers: { position: number; label: string }[] = [];
    const now = new Date();
    const windowStart = new Date(now.getTime() - timeWindowHours * 60 * 60 * 1000);

    // Create markers at regular intervals
    const intervalMinutes = timeWindowHours >= 2 ? 30 : 15;
    const intervals = Math.ceil((timeWindowHours * 60) / intervalMinutes);

    for (let i = 0; i <= intervals; i++) {
      const time = new Date(windowStart.getTime() + i * intervalMinutes * 60 * 1000);
      const position = (i / intervals) * 100;
      markers.push({
        position,
        label: time.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    }

    return markers;
  }, [timeWindowHours]);

  if (timelineData.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          backgroundColor: 'background.default',
          borderRadius: 2,
          border: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          No agent activity in the last {timeWindowHours} hour{timeWindowHours !== 1 ? 's' : ''}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Timeline Container */}
      <Box
        sx={{
          position: 'relative',
          minHeight: Math.max(timelineData.length * 48 + 40, 200),
          backgroundColor: 'background.default',
          borderRadius: 2,
          p: 2,
          mb: 2,
        }}
      >
        {/* Time markers */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 30,
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {timeMarkers.map((marker, index) => (
            <Box
              key={index}
              sx={{
                position: 'absolute',
                left: `${marker.position}%`,
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <Box
                sx={{
                  width: 1,
                  height: 8,
                  backgroundColor: 'divider',
                  mb: 0.5,
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {marker.label}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Agent activity bars */}
        <Box sx={{ position: 'relative', height: timelineData.length * 48, mb: 5 }}>
          {timelineData.map((item, index) => {
            const now = Date.now();
            const startMs = item.startTime.getTime();
            const estimatedDuration = now - startMs;

            return (
              <Tooltip
                key={item.agent.id}
                title={
                  <Box>
                    <Typography variant="caption" display="block">
                      <strong>{item.agent.name}</strong>
                    </Typography>
                    <Typography variant="caption" display="block">
                      Type: {item.agent.type}
                    </Typography>
                    <Typography variant="caption" display="block">
                      Started: {formatTime(item.startTime)}
                    </Typography>
                    <Typography variant="caption" display="block">
                      Duration: {formatDuration(estimatedDuration)}
                    </Typography>
                    <Typography variant="caption" display="block">
                      Status: {item.agent.status}
                    </Typography>
                  </Box>
                }
                arrow
              >
                <Box
                  sx={{
                    position: 'absolute',
                    left: `${item.position}%`,
                    top: index * 48 + 4,
                    width: `${item.duration}%`,
                    height: 36,
                    backgroundColor: STATUS_COLORS[item.agent.status] || '#94a3b8',
                    borderRadius: 1,
                    display: 'flex',
                    alignItems: 'center',
                    px: 1,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                    },
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'white',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.7rem',
                    }}
                  >
                    {item.agent.name}
                  </Typography>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <Chip
            key={status}
            label={status}
            size="small"
            sx={{
              backgroundColor: color,
              color: 'white',
              textTransform: 'capitalize',
              fontWeight: 500,
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
