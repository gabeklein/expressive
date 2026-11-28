import { Admin } from "../../server/admin";

export class Locked extends Error {
  status = 423;

  constructor(public until: string) {
    super(`The desk is locked until ${until}.`);
  }
}

export const GET = () => ({ desk: Admin.get().name });

export async function whoami() {
  return Admin.get().name;
}

export async function lock(): Promise<never> {
  throw new Locked("noon");
}
