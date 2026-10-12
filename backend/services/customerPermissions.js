export const isCustomerPermissionEnabled = (permission, accountPermissions = {}, globalPermissions = {}) => {
  if (accountPermissions.view_only_access === true || globalPermissions.view_only_access === true) return false;
  return accountPermissions[permission] !== false && globalPermissions[permission] !== false;
};