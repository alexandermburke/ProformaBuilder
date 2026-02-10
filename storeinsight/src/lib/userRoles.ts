const ADMIN_EMAILS = new Set(["alex@storestorage.com"]);

export const isAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
};

export type UserRole = "admin" | "user";

export const getUserRole = (email?: string | null): UserRole => (isAdminEmail(email) ? "admin" : "user");
