export type UserRole = 'APPLICANT' | 'REVIEWER' | 'APPROVER' | 'ADMIN';

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}
