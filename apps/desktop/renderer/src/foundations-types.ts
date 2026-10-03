export interface BoardItem {
  id: string;
  title: string;
  details?: string;
  sourceKind: "manual" | "task" | "workflow" | "routine";
  sourceId?: string;
  projectId?: string;
  sourceStatus?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface TaskBoard {
  version: number;
  items: BoardItem[];
  lastCleanupDate?: string;
}
export interface AlarmSound {
  id: string; name: string; sourceTitle: string; sourceUrl: string; license: string; attribution: string; durationMs: number;
}
export interface Routine {
  id: string;
  title: string;
  details?: string;
  kind: "reminder" | "alarm";
  time: string;
  timeZone: string;
  scheduledDate?: string | null;
  soundId?: string | null;
  weekdays: number[];
  enabled: boolean;
  targetDeviceId?: string;
  targetDeviceIds?: string[];
  requestedBy?: string;
  deviceSchedules?: Record<
    string,
    {
      deviceId: string;
      status: string;
      detail: string;
      reportedAt: string;
      expectedUpdatedAt: string;
    }
  >;
  createdAt: string;
  updatedAt: string;
  deviceSchedule?: {
    deviceId: string;
    status: string;
    detail: string;
    reportedAt: string;
    expectedUpdatedAt: string;
  };
}
export interface RoutineBoard {
  routines: Routine[];
  occurrences?: {
    id: string;
    routineId: string;
    title: string;
    scheduledAt?: string;
    createdAt: string;
  }[];
}
