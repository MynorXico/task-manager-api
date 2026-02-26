export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: number;
  email: string;
  created_at: string;
}

export interface Task {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string;
}

// DB-only extension of User — includes password_hash for authentication queries
export interface DbUser extends User {
  password_hash: string;
}

export interface AuthPayload {
  userId: number;
  email: string;
}

export interface FilterParams {
  status?: TaskStatus;
  priority?: TaskPriority;
  due_before?: string;
  due_after?: string;
  include_overdue?: boolean;
}
