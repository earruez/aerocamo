export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'TECHNICIAN' | 'INSPECTOR' | 'READONLY' | 'SUPER_ADMIN';

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  licenseNumber: string | null;
  licenseExpiry: Date | null;
  certifications: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateUserInput = Pick<
  User,
  'organizationId' | 'email' | 'name' | 'passwordHash' | 'role'
> &
  Partial<Pick<User, 'licenseNumber' | 'licenseExpiry' | 'certifications'>>;

export type PublicUser = Omit<User, 'passwordHash'>;
