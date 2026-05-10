export enum UserRoleEnum {
  USER = 'USER',
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

export enum TargetRole {
  OWNER = 'OWNER',
  USER = 'USER',
  ALL = 'ALL',
  NULL = 'NULL', // 'null' để chỉ thông báo không dành riêng cho nhóm nào
}
