export enum Role {
  USER = 'USER',
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
}

export enum TargetRole {
  OWNER = 'OWNER',
  USER = 'USER',
  ALL = 'ALL',
  NULL = 'NULL', // 'null' để chỉ thông báo không dành riêng cho nhóm nào
}
