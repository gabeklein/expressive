import { Current } from "@expressive/dev/server";

export const GET = () => ({ photo: Current.get().params.id });
