import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import type { Role } from './role.entity';
import type { Permission } from './permission.entity';

@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne('Role', (role: Role) => role.rolePermissions)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @ManyToOne(
    'Permission',
    (permission: Permission) => permission.rolePermissions,
  )
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;
}
