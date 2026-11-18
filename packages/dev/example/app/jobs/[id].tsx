import { Component, set } from "@expressive/mvc";
import { Link, Route } from "@expressive/dev";

import { Job } from "./remote";

class Detail extends Component {
  id = "";
  job = set(() => Job.open(this.id)!);

  render() {
    const { id, job } = this;

    return (
      <>
        <h1>Job {id}</h1>
        <progress value={job.progress} max={5} />
        <button onClick={() => job.note("seen")}>Note</button>
        <p>{job.notes.length} notes</p>
        <Link to="/jobs">Back</Link>
      </>
    );
  }
}

export class Page extends Route {
  render() {
    return <Detail id={this.match!.id} />;
  }
}
