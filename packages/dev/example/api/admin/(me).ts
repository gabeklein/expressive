import { Admin } from "../../server/admin";

export const GET = () => ({ admin: Admin.get().name });
