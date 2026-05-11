export type UserRole = 'APPLICANT' | 'REVIEWER' | 'APPROVER' | 'ADMIN';

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface UserListItem {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  items: UserListItem[];
  nextCursor: string | null;
}
