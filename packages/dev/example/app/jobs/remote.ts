import { has, Model } from "@expressive/mvc";
import { Current } from "@expressive/dev/server";

export class Job extends Model {
  id = "";
  progress = 0;
  notes: string[] = [];

  async note(text: string) {
    this.notes.push(text);
  }

  static open(id: string) {
    return Studio.get().jobs.get(job => job.id === id);
  }
}

export default class Studio extends Model {
  jobs = has(Job, "id");
  label = "";

  protected static key() {
    return Current.get().cookies.studio ?? "anon";
  }

  async start(id: string) {
    const job = this.jobs.add(id);
    const timer = setInterval(() => {
      if (job.get(null) || ++job.progress >= 5) clearInterval(timer);
    }, 300);
  }

  async slow(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms));
    return (this.label = "first");
  }
}
