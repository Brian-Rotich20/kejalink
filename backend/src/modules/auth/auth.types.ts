export type UserRole = "TENANT" | "SEEKER" | "ADMIN";

 export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";

 export type AuthenticatedUser = {
    id : string;
    name: string;
    email: string;
    image: string | null;
    role: UserRole;
    status: UserStatus;
 }