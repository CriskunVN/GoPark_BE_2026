import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import type { RolePermission } from './role-permission.entity';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  code: string;

  @Column()
  description: string;

  @OneToMany(
    'RolePermission',
    (rolePermission: RolePermission) => rolePermission.permission,
  )
  rolePermissions: RolePermission[];
}
